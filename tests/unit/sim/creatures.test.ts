import { describe, expect, it } from 'vitest';
import { unawareOf } from '../../../src/sim/ai/senses.ts';
import { hurtCreature } from '../../../src/sim/combat.ts';
import { type CreatureState, isAlert } from '../../../src/sim/creatures.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { creatureRecord, readCreature } from '../../../src/sim/saveRecords.ts';
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

  it('saves a creature record and reads it back as it was; hostile or unknown ones are dropped', () => {
    const s = world('records');
    const trotter = place(s, 'creature:trotter', 0.5, -6.5);
    hurtCreature(s.sim, trotter, 3, 0.5, 0.5, 1, s.player.id, []);
    s.step(20);
    expect(trotter.pathLength).toBeGreaterThan(0);
    const record = creatureRecord(trotter);
    expect(record).not.toHaveProperty('prevX');
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
    const read = readCreature(record, registry)!;
    expect(read).toEqual({
      ...trotter,
      path: trotter.path.slice(0, trotter.pathLength * 3),
      prevX: trotter.body.x,
      prevY: trotter.body.y,
      prevZ: trotter.body.z,
      prevYaw: trotter.yaw,
    });
    const prowler = creatureRecord(place(s, 'creature:prowler', 5.5, -6.5));
    expect(readCreature(prowler, registry)).toBeNull();
    expect(readCreature({ ...record, creature: 'creature:gone' }, registry)).toBeNull();
    expect(readCreature({ ...record, body: null }, registry)).toBeNull();
    // A malformed field keeps its default; a bad path is dropped.
    const odd = readCreature({ ...record, mode: 'dancing', path: [1, 'x', 2] }, registry)!;
    expect(odd).toMatchObject({ mode: 'idle', path: [], pathLength: 0 });
  });
});
