import { describe, expect, it } from 'vitest';
import { lineOfSight, unawareOf } from '../../../src/sim/ai/senses.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import { COMBAT, hurtCreature } from '../../../src/sim/combat.ts';
import {
  type CreatureState,
  creatureCensus,
  isAlert,
  PATH_MAX,
} from '../../../src/sim/creatures.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { PHYSICS } from '../../../src/sim/physics.ts';
import { creatureRecord, readCreature } from '../../../src/sim/saveRecords.ts';
import { flatWorld } from '../../helpers/flatWorld.ts';
import { grazeAroundPool } from '../../helpers/pools.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/*
 * Creatures in a flat world (docs « Créatures et combat »): the five brains, their senses and the
 * creatures' side of combat. The player stands at (0.5, 65, 0.5) looking north (−z).
 */

type Harness = ReturnType<typeof playerTestSim>;

function world(seed: string, hour = 12): Harness {
  const s = playerTestSim({ seed });
  s.send({ type: 'debug.setTime', hours: hour }, { type: 'debug.freezeTime', frozen: true });
  return s;
}

/** Places a creature on the ground (facing the player) and returns it. */
function place(s: Harness, creature: string, x: number, z: number): CreatureState {
  const before = s.sim.nextEntityId;
  const events = s.send({ type: 'debug.spawn', creature, x, y: 'surface', z });
  expect(rejections(events)).toEqual([]);
  const c = s.sim.entities.get(before);
  if (c?.kind !== 'creature') throw new Error('no creature placed');
  return c;
}

const distance = (c: CreatureState, x: number, z: number) => Math.hypot(c.body.x - x, c.body.z - z);

describe('creatures', () => {
  it('a Prowler placed 10 blocks in front of the player at night hurts them within 300 ticks', () => {
    const s = world('prowler-hunt', 23);
    const prowler = place(s, 'creature:prowler', 0.5, -9.5);
    s.events.length = 0;
    s.step(300);
    expect(s.player.survival.health).toBeLessThan(100);
    const hurt = eventsOf(s.events, 'playerHurt');
    expect(hurt.length).toBeGreaterThan(0);
    expect(hurt[0]!.source).toBe(prowler.id);
    // Day 1: × (1 + 0.05 × 1).
    expect(hurt[0]!.amount).toBeCloseTo(7 * 1.05, 5);
  });

  it('slows a Prowler down to 30 % while the player looks at it', () => {
    const watchedRun = (yaw: number) => {
      const s = world('prowler-gaze', 23);
      const prowler = place(s, 'creature:prowler', 0.5, -15.5);
      s.tick(60, { yaw });
      return { start: 16, now: distance(prowler, 0.5, 0.5), watched: prowler.watched };
    };
    const watched = watchedRun(0);
    const unwatched = watchedRun(Math.PI);
    expect(watched.watched).toBe(true);
    expect(unwatched.watched).toBe(false);
    const closedWatched = watched.start - watched.now;
    const closedFree = unwatched.start - unwatched.now;
    expect(closedFree).toBeGreaterThan(closedWatched * 2);
  });

  it('lets a player dodge a wind-up by stepping out of reach', () => {
    const s = world('dodge', 23);
    const prowler = place(s, 'creature:prowler', 0.5, -2.2);
    for (let i = 0; i < 60 && prowler.mode !== 'windup'; i++) s.step(1);
    expect(prowler.mode).toBe('windup');
    // Sprint away south until the blow falls.
    s.tick(prowler.modeTicks + 1, { forward: 1, yaw: Math.PI, sprint: true });
    expect(s.player.survival.health).toBe(100);
    expect(prowler.mode).toBe('recover');
  });

  it('a Prowler shuns the light and burrows away at dawn', () => {
    const s = world('prowler-light', 23);
    s.put(-6, 65, -12, 'block:torch');
    const prowler = place(s, 'creature:prowler', -5.5, -11.5);
    s.tick(60, { yaw: Math.PI });
    expect(distance(prowler, -5.5, -11.5)).toBeGreaterThan(3);
    s.send({ type: 'debug.setTime', hours: 5 });
    s.step(60);
    expect(s.sim.entities.has(prowler.id)).toBe(false);
  });

  it('a Trotter flees when hurt, and leaves meat and hide when killed', () => {
    const s = world('trotter');
    const trotter = place(s, 'creature:trotter', 0.5, -6.5);
    const out: SimEvent[] = [];
    hurtCreature(s.sim, trotter, 4, 0.5, 0.5, 1, s.player.id, out);
    expect(trotter.health).toBe(8);
    expect(trotter.mode).toBe('flee');
    s.step(60);
    expect(distance(trotter, 0.5, 0.5)).toBeGreaterThan(10);
    // Still invulnerable for 8 ticks after a blow.
    s.step(30);
    hurtCreature(s.sim, trotter, 20, trotter.body.x, trotter.body.z + 1, 1, s.player.id, out);
    expect(eventsOf(out, 'creatureDied')).toHaveLength(1);
    s.step(30);
    expect(s.sim.entities.has(trotter.id)).toBe(false);
    const drops = [...s.sim.entities.values()].flatMap((e) =>
      e.kind === 'itemDrop' ? [e.item] : [],
    );
    expect(drops.sort()).toEqual(['item:raw_hide', 'item:raw_meat']);
  });

  it('a Trotter stays calm while a crouching player creeps up behind it', () => {
    const creep = (crouch: boolean) => {
      const s = world(`creep-${crouch}`);
      const trotter = place(s, 'creature:trotter', 0.5, -6.5);
      // Facing away from the player, idle.
      trotter.yaw = 0;
      trotter.modeTicks = 600;
      s.tick(30, { forward: 1, crouch });
      return { s, trotter };
    };
    const def = registry.creature('creature:trotter')!;
    const crept = creep(true);
    expect(isAlert(crept.trotter)).toBe(false);
    // The stealth rule: unaware of a player behind it, not of one in front.
    expect(unawareOf(crept.trotter, def, crept.s.player)).toBe(true);
    crept.trotter.yaw = Math.PI;
    expect(unawareOf(crept.trotter, def, crept.s.player)).toBe(false);
    const walked = creep(false);
    expect(isAlert(walked.trotter)).toBe(true);
    expect(unawareOf(walked.trotter, def, walked.s.player)).toBe(false);
  });

  it('a Shagback hurt by the player turns on them with its herd', () => {
    const s = world('shagback');
    const a = place(s, 'creature:shagback', 0.5, -5.5);
    const b = place(s, 'creature:shagback', 3.5, -6.5);
    (b as { herd: number }).herd = a.herd;
    hurtCreature(s.sim, a, 2, 0.5, 0.5, 1, s.player.id, []);
    expect(a.mode).toBe('chase');
    expect(b.mode).toBe('chase');
    s.step(200);
    expect(s.player.survival.health).toBeLessThan(100);
  });

  it('a Shellback charges a player in its territory and is stunned by a wall', () => {
    const s = world('shellback');
    const shellback = place(s, 'creature:shellback', 0.5, -4.5);
    for (let i = 0; i < 60 && shellback.mode !== 'charge'; i++) s.step(1);
    expect(shellback.mode).toBe('charge');
    for (let i = 0; i < 45 && shellback.mode === 'charge'; i++) s.step(1);
    // 12 × 20 / (20 + 0): no armour.
    expect(s.player.survival.health).toBeCloseTo(100 - 12, 5);
    // Behind a glass wall, the player is still seen: the next charge runs into the glass.
    s.fill(-3, 65, 2, 3, 67, 2, 'block:glass');
    s.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 3.5 });
    for (let i = 0; i < 300 && shellback.mode !== 'stunned'; i++) s.step(1);
    expect(shellback.mode).toBe('stunned');
    expect(shellback.modeTicks).toBeGreaterThan(40);
    expect(s.player.survival.health).toBeCloseTo(100 - 12, 5);
  });

  it('a charge keeps its heading while other creatures push each other apart', () => {
    const s = world('charge-push');
    // Two Trotters pressed together 40 blocks away, stepped before the Shellback (lower ids).
    place(s, 'creature:trotter', 20.5, 20.5);
    place(s, 'creature:trotter', 20.6, 20.5);
    const shellback = place(s, 'creature:shellback', -10.5, -10.5);
    Object.assign(shellback, { mode: 'charge', modeTicks: 30, yaw: 0, target: -1 });
    s.step(20);
    // Due north (−z), without a sideways drift.
    expect(shellback.mode).toBe('charge');
    expect(shellback.body.x).toBe(-10.5);
    expect(shellback.body.z).toBeLessThan(-11.5);
  });

  it('sees between two points of one cell; opaque blocks between two points block the sight', () => {
    const w = flatWorld();
    const t = registry.tables;
    expect(lineOfSight(w, t, 0.2, 65.2, 0.2, 0.8, 65.6, 0.8)).toBe(true);
    expect(lineOfSight(w, t, 0.5, 65.5, 0.5, 0.5, 65.5, 0.5)).toBe(true);
    expect(lineOfSight(w, t, 0.2, 65.2, 0.2, 1.3, 65.6, 0.8)).toBe(true);
    w.setBlock(1, 65, 0, registry.defaultState('block:stone'));
    expect(lineOfSight(w, t, 0.5, 65.5, 0.5, 2.5, 65.5, 0.5)).toBe(false);
    // Glass lets the sight through (creatures see through what is not opaque).
    w.setBlock(1, 65, 0, registry.defaultState('block:glass'));
    expect(lineOfSight(w, t, 0.5, 65.5, 0.5, 2.5, 65.5, 0.5)).toBe(true);
  });

  it('a buried creature rises out of the block only into free space, never through rock', () => {
    const run = (roof: boolean) => {
      const s = world(`buried-${roof}`);
      const c = place(s, 'creature:trotter', 0.5, -1.5);
      c.modeTicks = 600;
      if (roof) s.fill(-3, 67, -5, 3, 70, 1, 'block:stone');
      s.put(0, 65, -2, 'block:dirt');
      s.step(10);
      return c.body.y;
    };
    expect(run(false)).toBe(66);
    expect(run(true)).toBe(65);
  });

  it('a Trotter that walked into water climbs back out onto the bank, from shallow or deep water', () => {
    // Pools flush with the ground (feet at 65): 1 and 3 deep from the bank, 9 deep from the middle.
    const cases: [depth: number, x: number][] = [
      [1, 40.5],
      [3, 40.5],
      [9, 48.5],
    ];
    for (const [depth, x] of cases) {
      const s = world(`swim-${depth}`);
      s.fill(40, 65 - depth, -6, 56, 64, 6, 'block:fresh_water');
      const id = s.sim.nextEntityId;
      s.send({ type: 'debug.spawn', creature: 'creature:trotter', x, y: 64, z: 0.5 });
      const c = s.sim.entities.get(id) as CreatureState;
      const dry = () => c.body.x < 40 || c.body.x > 57 || Math.abs(c.body.z) > 7;
      for (let t = 0; t < 3600 && !dry(); t++) s.step(1);
      expect(dry(), `${depth} deep`).toBe(true);
      expect(c.body.y, `${depth} deep`).toBeGreaterThanOrEqual(65);
    }
  });

  it('a Trotter in a pool whose surface is one block below the bank climbs out onto it', () => {
    // Ground feet at 65; the pool's top cell at 63 (2 or 3 deep: it floats), y 64 dug out over it.
    for (const depth of [2, 3]) {
      const s = world(`sunken-${depth}`);
      s.fill(40, 64, -6, 56, 64, 6, 'block:air');
      s.fill(40, 64 - depth, -6, 56, 63, 6, 'block:fresh_water');
      const id = s.sim.nextEntityId;
      s.send({ type: 'debug.spawn', creature: 'creature:trotter', x: 40.5, y: 63, z: 0.5 });
      const c = s.sim.entities.get(id) as CreatureState;
      const dry = () => c.body.x < 40 || c.body.x > 57 || Math.abs(c.body.z) > 7;
      for (let t = 0; t < 3600 && !dry(); t++) s.step(1);
      expect(dry(), `${depth} deep`).toBe(true);
      expect(c.body.y, `${depth} deep`).toBeGreaterThanOrEqual(65);
    }
  });

  it('Trotters grazing around sunken pools are never trapped in them', () => {
    // A pool's surface one block below the bank (they may swim in and out) or two (they never
    // enter): none in the water for 75 s on end (the long run: tests/slow/pools.slow.ts).
    for (const top of [63, 62]) {
      const s = world(`pool-rim-${top}`);
      const result = grazeAroundPool(s, top, 3000, 1500);
      expect(result.trapped, `top ${top}`).toBe(0);
      if (top === 62) expect(result.entered, 'the 2-below pool is never entered').toBe(0);
    }
  });

  it('a Trotter on a dock one block above a pool it could not leave never drops into it', () => {
    // Banks 2 above the surface (top cell 62); planks on the surface at x 40..48, z ±1 (feet 64).
    for (const k of [0, 1]) {
      const s = world(`dock-${k}`);
      s.fill(40, 63, -6, 56, 64, 6, 'block:air');
      s.fill(40, 59, -6, 56, 62, 6, 'block:fresh_water');
      s.fill(40, 63, -1, 48, 63, 1, 'block:planks');
      const id = s.sim.nextEntityId;
      s.send({ type: 'debug.spawn', creature: 'creature:trotter', x: 46.5, y: 64, z: -0.5 });
      const c = s.sim.entities.get(id) as CreatureState;
      for (let t = 0; t < 1200; t++) {
        s.step(1);
        const b = c.body;
        const wet = b.x > 40 && b.x < 57 && Math.abs(b.z) < 7 && b.y < 63.9;
        expect(wet, `world ${k}, tick ${t}`).toBe(false);
      }
    }
  });

  it('water lying on the ground never lifts a creature over a wall 2 high', () => {
    // A stone ring 2 high around the player and one layer of water on the ground outside it.
    for (const [creature, hour] of [
      ['creature:prowler', 23],
      ['creature:trotter', 12],
    ] as const) {
      const s = world(`wall-${creature}`, hour);
      s.send({ type: 'debug.god', on: true });
      s.fill(-4, 65, -4, 4, 66, 4, 'block:stone');
      s.fill(-3, 65, -3, 3, 66, 3, 'block:air');
      s.fill(-9, 65, -9, 9, 65, -5, 'block:fresh_water');
      const bodies = [-1.5, 1.5].map((x) => {
        const id = s.sim.nextEntityId;
        s.send({ type: 'debug.spawn', creature, x: x + 0.5, y: 65, z: -6.5 });
        return (s.sim.entities.get(id) as CreatureState).body;
      });
      for (let t = 0; t < 600; t++) {
        s.step(1);
        for (const b of bodies) expect(b.y, `${creature} tick ${t}`).toBeLessThan(66.9);
      }
    }
  });

  it("a Shellback's brow plate stops 60 % of a blow from the front", () => {
    const s = world('front');
    const shellback = place(s, 'creature:shellback', 0.5, -20.5);
    shellback.yaw = 0;
    const { x, z } = shellback.body;
    expect(hurtCreature(s.sim, shellback, 10, x, z - 3, 0, s.player.id, [])).toBeCloseTo(4, 5);
    shellback.invulnerable = 0;
    expect(hurtCreature(s.sim, shellback, 10, x, z + 3, 0, s.player.id, [])).toBeCloseTo(10, 5);
  });

  it('Swarmlings close in in zigzags and poison', () => {
    const s = world('swarm', 23);
    const mite = place(s, 'creature:swarmling', 0.5, -10.5);
    let sideways = 0;
    for (let i = 0; i < 150; i++) {
      s.step(1);
      sideways = Math.max(sideways, Math.abs(mite.body.x - 0.5));
    }
    expect(sideways).toBeGreaterThan(0.3);
    expect(s.player.survival.toxicity).toBeGreaterThan(0);
  });

  it('debug.killCreature kills a creature like a blow would, loot included; the census counts the living', () => {
    const s = world('debug-kill', 23);
    const shellback = place(s, 'creature:shellback', 0.5, -6.5);
    const prowler = place(s, 'creature:prowler', 4.5, -6.5);
    const census = () => creatureCensus(s.sim.entities, registry);
    expect(census()).toMatchObject({ total: 2, surfaceHostiles: 1, caveHostiles: 0 });
    expect(census().byCreature).toEqual({
      'creature:trotter': 0,
      'creature:shagback': 0,
      'creature:prowler': 1,
      'creature:swarmling': 0,
      'creature:shellback': 1,
      'creature:glimmerback': 0,
      'creature:reedwader': 0,
    });
    // Whatever its front plate or a recent blow.
    shellback.invulnerable = 5;
    const events = s.send({ type: 'debug.killCreature', id: shellback.id });
    expect(rejections(events)).toEqual([]);
    expect(eventsOf(events, 'creatureDied')).toMatchObject([{ id: shellback.id, attacker: -1 }]);
    expect(shellback.mode).toBe('dying');
    expect(census()).toMatchObject({ total: 1, surfaceHostiles: 1 });
    s.step(30);
    expect(s.sim.entities.has(shellback.id)).toBe(false);
    const drops = [...s.sim.entities.values()].flatMap((e) =>
      e.kind === 'itemDrop' ? [e.item] : [],
    );
    expect(drops).toContain('item:shell_plate');
    // Gone, or not a creature: refused.
    for (const id of [shellback.id, s.player.id, 9999])
      expect(rejections(s.send({ type: 'debug.killCreature', id }))).toHaveLength(1);
    expect(s.sim.entities.has(prowler.id)).toBe(true);
    // Burrowing away, it is still alive: it dies where it is, its loot left.
    prowler.mode = 'burrow';
    prowler.modeTicks = 30;
    const burrowed = s.send({ type: 'debug.killCreature', id: prowler.id });
    expect(rejections(burrowed)).toEqual([]);
    expect(eventsOf(burrowed, 'creatureDied')).toMatchObject([{ id: prowler.id, attacker: -1 }]);
    expect(prowler.mode).toBe('dying');
    // Dying: refused.
    expect(rejections(s.send({ type: 'debug.killCreature', id: prowler.id }))).toHaveLength(1);
  });

  it('saves a creature record and reads it back as it was; hostile or unknown ones are dropped', () => {
    const s = world('records');
    const trotter = place(s, 'creature:trotter', 0.5, -6.5);
    hurtCreature(s.sim, trotter, 3, 0.5, 0.5, 1, s.player.id, []);
    s.step(20);
    expect(trotter.pathLength).toBeGreaterThan(0);
    const record = creatureRecord(trotter);
    expect(record).not.toHaveProperty('prevX');
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
    const read = readCreature(record, registry, s.sim.tick)!;
    expect(read).toEqual({
      ...trotter,
      path: trotter.path.slice(0, trotter.pathLength * 3),
      prevX: trotter.body.x,
      prevY: trotter.body.y,
      prevZ: trotter.body.z,
      prevYaw: trotter.yaw,
    });
    const prowler = creatureRecord(place(s, 'creature:prowler', 5.5, -6.5));
    expect(readCreature(prowler, registry, s.sim.tick)).toBeNull();
    expect(readCreature({ ...record, creature: 'creature:gone' }, registry, 0)).toBeNull();
    expect(readCreature({ ...record, body: null }, registry, 0)).toBeNull();
    // A malformed field keeps its default; a bad path is dropped.
    const odd = readCreature({ ...record, mode: 'dancing', path: [1, 'x', 2] }, registry, 0)!;
    expect(odd).toMatchObject({ mode: 'idle', path: [], pathLength: 0 });
  });

  it('reads the counters, timers and ids of a creature record back within their ranges', () => {
    const s = world('wild-records');
    const def = registry.creature('creature:shagback')!;
    const record = creatureRecord(place(s, 'creature:shagback', 0.5, -6.5));
    const tick = s.sim.tick;
    const path = { path: [1, 65, 1, 2, 65, 1], pathLength: 2 };
    const read = (fields: object) =>
      readCreature({ ...record, ...path, ...fields }, registry, tick);
    // A crafted save must neither hang the path walk or a collision sweep nor freeze a creature.
    expect(read({ pathStep: -1e300 })!.pathStep).toBe(0);
    expect(read({ pathStep: 0.5 })!.pathStep).toBe(0);
    // Past the path's end (a path dropped since): kept, unless past any path's end.
    expect(read({ pathStep: 7 })!.pathStep).toBe(7);
    expect(read({ pathStep: 1e9 })!.pathStep).toBe(PATH_MAX);
    expect(read({ mode: 'windup', modeTicks: 0.5 })!.modeTicks).toBe(0);
    const longest = read({ mode: 'windup', modeTicks: 1e9 })!.modeTicks;
    expect(longest).toBeGreaterThan(0);
    expect(longest).toBeLessThanOrEqual(ticksOf(60));
    expect(read({ cooldown: 0.5 })!.cooldown).toBe(0);
    expect(read({ cooldown: 1e9 })!.cooldown).toBe(ticksOf(def.attack!.cooldown));
    expect(read({ invulnerable: 1e300 })!.invulnerable).toBe(COMBAT.creatureInvulnerableTicks);
    expect(read({ planTick: tick + 1e6 })!.planTick).toBe(tick);
    expect(read({ planTick: -5 })!.planTick).toBe(-1);
    expect(read({ unseen: -3 })!.unseen).toBe(0);
    expect(read({ target: -7 })!.target).toBe(-1);
    expect(read({ herd: 0.5 })!.herd).toBe(record.id);
    const fast = read({ body: { ...record.body, vx: 1e300, vy: -1e300, vz: 3 } })!.body;
    expect([fast.vx, fast.vy, fast.vz]).toEqual([PHYSICS.terminal, -PHYSICS.terminal, 3]);
    // Out of the world: dropped.
    expect(read({ body: { ...record.body, y: 1e300 } })).toBeNull();
    expect(read({ body: { ...record.body, x: 1e300 } })).toBeNull();
  });
});
