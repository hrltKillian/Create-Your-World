import { describe, expect, it } from 'vitest';
import { COLUMN_LIT } from '../../../src/sim/ColumnPipeline.ts';
import { type CreatureState, isHostile, removeCreature } from '../../../src/sim/creatures.ts';
import { MemoryStorage } from '../../../src/sim/MemoryStorage.ts';
import { persistentHash } from '../../../src/sim/persistence.ts';
import type { Simulation } from '../../../src/sim/Simulation.ts';
import { SPAWN, stepSpawning } from '../../../src/sim/spawning.ts';
import { blockToColumn, columnKey } from '../../../src/world/coords.ts';
import { skyOf } from '../../../src/world/light.ts';
import { registry } from '../../helpers/registry.ts';
import { restoreFrom, saveTo, settle } from '../../helpers/save.ts';
import { createTestSim, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Spawning and despawning (docs « Créatures et combat », Apparition, Disparition): the light rule,
 * the caps, the grace period, herds placed with their columns, and hostiles leaving.
 */

type Harness = ReturnType<typeof playerTestSim>;

/** A flat world with natural spawns and no grace period, the clock frozen at `hour`. */
function spawnWorld(seed: string, hour: number, graceTicks = 0, hostiles = true): Harness {
  const s = playerTestSim({ seed, viewRadius: 4, spawns: true, graceTicks, hostiles });
  s.send({ type: 'debug.setTime', hours: hour }, { type: 'debug.freezeTime', frozen: true });
  return s;
}

function creatures(s: Harness): CreatureState[] {
  return [...s.sim.entities.values()].filter((e): e is CreatureState => e.kind === 'creature');
}

const hostiles = (s: Harness) =>
  creatures(s).filter((c) => isHostile(registry.creature(c.creature)!));

/** Places a creature on the ground (debug.spawn) and returns it. */
function spawnAt(s: Harness, creature: string, x: number, z: number): CreatureState {
  const id = s.sim.nextEntityId;
  s.send({ type: 'debug.spawn', creature, x, y: 'surface', z });
  const c = s.sim.entities.get(id);
  if (c?.kind !== 'creature') throw new Error(`no ${creature} placed`);
  return c;
}

describe('spawning', () => {
  it('spawns hostiles at night only where the effective light is 4 or less, away from torches', () => {
    const s = spawnWorld('night-spawns', 23);
    const torches: [number, number, number][] = [];
    for (let x = -48; x <= 48; x += 24)
      for (let z = -48; z <= 48; z += 24) if (x !== 0 || z !== 0) torches.push([x, 65, z]);
    for (const [x, y, z] of torches) s.put(x, y, z, 'block:torch');
    s.step(3600);
    expect(s.sim.spawnLog.length).toBeGreaterThanOrEqual(3);
    for (const entry of s.sim.spawnLog) {
      expect(entry.light).toBeLessThanOrEqual(4);
      for (const [x, y, z] of torches) {
        const manhattan =
          Math.abs(Math.floor(entry.x) - x) +
          Math.abs(entry.y - y) +
          Math.abs(Math.floor(entry.z) - z);
        expect(manhattan).toBeGreaterThan(9);
      }
      const p = s.player.body;
      expect(Math.hypot(entry.x - p.x, entry.z - p.z)).toBeGreaterThan(SPAWN.playerClearance);
    }
  });

  it('spawns no hostile while the light is 5 or more (dusk, noon)', () => {
    for (const hour of [19, 12]) {
      const s = spawnWorld(`lit-${hour}`, hour);
      s.step(900);
      expect(s.sim.spawnLog).toEqual([]);
      expect(hostiles(s)).toEqual([]);
    }
  });

  it('places every member of a group on the same kind of spot as the first: never in a closed room', () => {
    const s = spawnWorld('rooms', 12, 0, false);
    // Strips along z: x % 4 = 0 open ground, 1 and 3 walls 2 high, 2 a room closed at both ends,
    // all under a roof at y 67. Herd members land up to 3 blocks from an open candidate.
    const r = 62;
    for (let x = -r; x <= r; x++) {
      const m = ((x % 4) + 4) % 4;
      if (m === 0) continue;
      if (m === 2) {
        s.fill(x, 65, -r, x, 66, -r, 'block:stone');
        s.fill(x, 65, r, x, 66, r, 'block:stone');
      } else s.fill(x, 65, -r, x, 66, r, 'block:stone');
      s.fill(x, 67, -r, x, 67, r, 'block:stone');
    }
    expect(skyOf(s.sim.world.getLight(30, 65, 30))).toBe(0);
    let spawned = 0;
    const wrong: string[] = [];
    for (let k = 1; k <= 200; k++) {
      s.sim.tick = k * SPAWN.herdEveryTicks;
      const before = new Set(s.sim.entities.keys());
      stepSpawning(s.sim);
      for (const c of creatures(s)) {
        if (before.has(c.id)) continue;
        spawned++;
        const { x, y, z } = c.body;
        const sky = skyOf(s.sim.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z)));
        if (sky > 0 === c.cave) wrong.push(`${c.creature} ${x},${y},${z}`);
      }
      for (const c of creatures(s)) removeCreature(s.sim, c.id);
    }
    expect(spawned).toBeGreaterThan(50);
    expect(wrong).toEqual([]);
  });

  it('keeps to the caps: 3 + day / 2 surface hostiles, 3 creatures per column at a spawn', () => {
    const s = spawnWorld('caps', 23);
    for (let cycle = 0; cycle < 120; cycle++) {
      s.step(SPAWN.everyTicks);
      const near = hostiles(s).filter((c) => {
        const p = s.player.body;
        return Math.hypot(c.body.x - p.x, c.body.z - p.z) <= SPAWN.surfaceRadius;
      });
      expect(near.length).toBeLessThanOrEqual(SPAWN.surfaceBase);
    }
    expect(s.sim.spawnLog.length).toBeGreaterThan(0);
    // Group members spawn together: never more than 3 in one column on one tick.
    const byColumn = new Map<string, number>();
    for (const e of s.sim.spawnLog) {
      const key = `${e.tick}:${columnKey(blockToColumn(e.x), blockToColumn(e.z))}`;
      byColumn.set(key, (byColumn.get(key) ?? 0) + 1);
    }
    for (const n of byColumn.values()) expect(n).toBeLessThanOrEqual(SPAWN.perColumn);
  });

  it('waits for the grace period, and spawns no hostile in a peaceful world', () => {
    expect(createTestSim({ seed: 'grace' }).sim.rules.graceTicks).toBe(
      registry.pack.balance.creatures.spawnGraceTicks,
    );
    const s = spawnWorld('grace', 23, 1800);
    while (s.sim.tick < 1800) s.step(1);
    expect(s.sim.spawnLog).toEqual([]);
    s.step(1800);
    expect(s.sim.spawnLog.length).toBeGreaterThan(0);
    expect(s.sim.spawnLog.every((e) => e.tick >= 1800)).toBe(true);
    const peaceful = spawnWorld('peaceful', 23, 0, false);
    peaceful.step(1800);
    expect(hostiles(peaceful)).toEqual([]);
  });

  it('brings grazers back by day, once a minute at most', () => {
    const s = spawnWorld('grazers', 12);
    // Every column loaded: no herd of a first generation from now on.
    settle(s.sim);
    const first = s.sim.nextEntityId;
    const ticks: number[] = [];
    for (let i = 0; i < 3 * SPAWN.herdEveryTicks; i++) {
      const before = s.sim.nextEntityId;
      s.step(1);
      if (s.sim.nextEntityId !== before) ticks.push(s.sim.tick);
    }
    expect(s.sim.nextEntityId).toBeGreaterThan(first);
    for (const tick of ticks) expect(tick % SPAWN.herdEveryTicks).toBe(0);
    expect(hostiles(s)).toEqual([]);
  });

  it('lets hostiles go far away or long unseen, and in unloaded columns', () => {
    const s = spawnWorld('despawn', 23);
    s.send({ type: 'debug.freezeTime', frozen: true });
    const before = s.sim.nextEntityId;
    // 60 blocks south, behind the player's back: unseen.
    s.send({ type: 'debug.spawn', creature: 'creature:prowler', x: 0.5, y: 'surface', z: 60.5 });
    const prowler = s.sim.entities.get(before) as CreatureState;
    prowler.mode = 'idle';
    prowler.modeTicks = 10_000;
    s.step(SPAWN.unseenTicks - 60);
    expect(s.sim.entities.has(prowler.id)).toBe(true);
    s.step(120);
    expect(s.sim.entities.has(prowler.id)).toBe(false);
  });

  it('lets a hostile go beyond 96 blocks of every player, in a loaded and lit column too', () => {
    const s = playerTestSim({ seed: 'far', viewRadius: 4 });
    s.send({ type: 'debug.setTime', hours: 23 }, { type: 'debug.freezeTime', frozen: true });
    const near = spawnAt(s, 'creature:prowler', 40.5, 0.5);
    const far = spawnAt(s, 'creature:prowler', 60.5, 0.5);
    // 86 and 106 blocks from the player now, both in columns still loaded and lit.
    s.send({ type: 'debug.teleport', x: -45.5, y: 'surface', z: 0.5 });
    s.step(SPAWN.everyTicks);
    expect(s.sim.columnState(blockToColumn(far.body.x), 0)).toBeGreaterThanOrEqual(COLUMN_LIT);
    expect(s.sim.entities.has(far.id)).toBe(false);
    expect(s.sim.entities.has(near.id)).toBe(true);
  });

  it('lets creatures dying or burrowing away go out of the simulation too', () => {
    const s = playerTestSim({ seed: 'leaving', viewRadius: 4 });
    s.send({ type: 'debug.setTime', hours: 23 }, { type: 'debug.freezeTime', frozen: true });
    const trotter = spawnAt(s, 'creature:trotter', 0.5, -6.5);
    const prowler = spawnAt(s, 'creature:prowler', 4.5, -6.5);
    s.send({ type: 'debug.killCreature', id: trotter.id });
    prowler.mode = 'burrow';
    prowler.modeTicks = 30;
    // 384 blocks away: both stand out of the simulation (dormant) from the next tick.
    s.send({ type: 'debug.teleport', x: 384.5, y: 'surface', z: 0.5 });
    s.step(2);
    expect(s.sim.entities.has(trotter.id)).toBe(false);
    expect(s.sim.entities.has(prowler.id)).toBe(false);
  });
});

describe('herds', () => {
  it('are placed when a column is first generated, saved with it and never placed twice', async () => {
    const s = createTestSim({ seed: 'herds', worldType: 'default', allowDebug: true });
    s.sim.addPlayer(1, 4);
    settle(s.sim);
    s.step(5);
    const herds = [...s.sim.entities.values()].filter((e) => e.kind === 'creature');
    expect(s.sim.herdColumns.size).toBeGreaterThan(0);
    expect(herds.length).toBeGreaterThanOrEqual(s.sim.herdColumns.size);
    expect(herds.every((c) => !isHostile(registry.creature(c.creature)!))).toBe(true);
    // A Prowler is never saved.
    s.host.send({ type: 'debug.setTime', hours: 23 });
    const p = s.sim.players.get(1)!.body;
    s.host.send({
      type: 'debug.spawn',
      creature: 'creature:prowler',
      x: p.x + 5,
      y: 'surface',
      z: p.z,
    });
    s.step(1);
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);
    const r = await restoreFrom(storage);
    const restored = [...r.sim.entities.values()].filter((e) => e.kind === 'creature');
    expect(restored.map((c) => c.id)).toEqual(herds.map((c) => c.id));
    expect([...r.sim.herdColumns].sort()).toEqual([...s.sim.herdColumns].sort());
    expect(persistentHash(r.sim)).toBe(persistentHash(s.sim));
    // Loading the world again places no second herd.
    settle(r.sim);
    r.step(5);
    const after = [...r.sim.entities.values()].filter((e) => e.kind === 'creature');
    expect(after.map((c) => c.id)).toEqual(restored.map((c) => c.id));
  });

  it('leave with their column when it unloads, saved with it, and come back when it loads again', async () => {
    const s = createTestSim({
      seed: 'explore',
      worldType: 'default',
      hostiles: false,
      allowDebug: true,
    });
    s.sim.addPlayer(1, 1);
    settle(s.sim);
    s.step(5);
    const live = (sim: Simulation) =>
      [...sim.entities.values()].flatMap((e) => (e.kind === 'creature' ? [e] : []));
    const parked = (sim: Simulation) => [...sim.parked.values()].flat();
    const ids = (list: readonly CreatureState[]) => list.map((c) => c.id).sort((a, b) => a - b);
    /** Only the creatures of loaded columns stay in the simulation. */
    const loadedOnly = (sim: Simulation) =>
      live(sim).every((c) => sim.columnState(blockToColumn(c.body.x), blockToColumn(c.body.z)) > 0);
    const home = ids(live(s.sim));
    expect(home.length).toBeGreaterThan(0);
    // Ten jumps of 160 blocks east: herds in some of the columns generated on the way.
    for (let jump = 1; jump <= 10; jump++) {
      s.host.send({ type: 'debug.teleport', x: jump * 160 + 0.5, y: 'surface', z: 0.5 });
      settle(s.sim);
      s.step(5);
      expect(loadedOnly(s.sim)).toBe(true);
    }
    expect(parked(s.sim).length).toBeGreaterThan(live(s.sim).length);
    expect(ids(parked(s.sim))).toEqual(expect.arrayContaining(home));
    // Saved with their columns: a restored world holds them all, and parks them alike.
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);
    const r = await restoreFrom(storage);
    expect(persistentHash(r.sim)).toBe(persistentHash(s.sim));
    settle(r.sim);
    r.step(5);
    expect(loadedOnly(r.sim)).toBe(true);
    const all = (sim: Simulation) => ids([...live(sim), ...parked(sim)]);
    expect(all(r.sim)).toEqual(all(s.sim));
    // Back home, the herds there are back too, the entities still in id order.
    s.host.send({ type: 'debug.teleport', x: 0.5, y: 'surface', z: 0.5 });
    settle(s.sim);
    s.step(5);
    expect(ids(live(s.sim))).toEqual(expect.arrayContaining(home));
    const order = [...s.sim.entities.keys()];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('carry their brains through a save: the restored world plays on exactly as the original', async () => {
    const s = createTestSim({ seed: 'herds', worldType: 'default', hostiles: false });
    s.sim.addPlayer(1, 4);
    settle(s.sim);
    s.step(300);
    const storage = new MemoryStorage();
    await saveTo(storage, s.sim);
    const r = await restoreFrom(storage);
    settle(r.sim);
    s.step(600);
    r.step(600);
    expect(r.sim.tick).toBe(s.sim.tick);
    expect([...s.sim.entities.values()].some((e) => e.kind === 'creature')).toBe(true);
    expect(persistentHash(r.sim)).toBe(persistentHash(s.sim));
  });
});
