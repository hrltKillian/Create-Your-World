import { describe, expect, it } from 'vitest';
import { blockItemKey } from '../../../src/content/items.ts';
import { anglesTo } from '../../../src/core/angles.ts';
import { COLUMN_LIT } from '../../../src/sim/ColumnPipeline.ts';
import { type Command, type InputCommand, NEUTRAL_INPUT } from '../../../src/sim/commands.ts';
import type { SimEvent } from '../../../src/sim/events.ts';
import { eyeHeight } from '../../../src/sim/physics.ts';
import { createInlineSim } from '../../../src/sim/testing/inlineSim.ts';
import { type WalkPort, walkQuests } from '../../../src/sim/testing/questWalk.ts';
import { blockToColumn } from '../../../src/world/coords.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * The quests walk (sim/testing/questWalk.ts) on inline simulations of the browser walk's world
 * (?seed=7, the generated world, no natural spawns) and five other seeds: every quest of the pack
 * unlocks at its turn and is done with the game's own actions (« téléports et actions réelles »:
 * the items quests name that the world yields are broken out of it and picked up, creatures struck
 * down, the cabin built block by block); a player who has done a quest cannot start the walk. The
 * browser case (selftest/questsWalk.ts) drives the same walk through `__game`'s automation.
 */

/** The browser walk's seed and search radius (selftest/support.ts SEARCH_RADIUS). */
const SEED = '7';
/**
 * Other worlds the chain is walked in: a break right after a walk onto a drop (42, 123, 2024), a
 * source staged on uneven ground (3, 11: a marsh ledge) or in a pod over water (2024).
 */
const OTHER_SEEDS = ['42', '123', '2024', '3', '11'];
const SEARCH_RADIUS = 1500;
/** Columns streamed around the player, and those that must be lit after a teleport. */
const VIEW_RADIUS = 2;
const LIT_RADIUS = 1;
/** Most loading rounds after a teleport. */
const LOAD_ROUNDS = 4000;

/** A walk port over an inline simulation: commands and input sent straight to its host. */
function inlinePort(seed: string) {
  const { sim, host, events } = createInlineSim({
    registry,
    seed,
    allowDebug: true,
    spawns: false,
  });
  const player = sim.addPlayer(1, VIEW_RADIUS);
  // What the walk sent (but its input) and what came of it.
  const sent: Command[] = [];
  const seen: SimEvent[] = [];
  const step = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      host.advance(1, events);
      seen.push(...events);
      events.length = 0;
    }
  };
  const lit = () => {
    const cx = blockToColumn(player.body.x);
    const cz = blockToColumn(player.body.z);
    for (let dz = -LIT_RADIUS; dz <= LIT_RADIUS; dz++)
      for (let dx = -LIT_RADIUS; dx <= LIT_RADIUS; dx++)
        if (sim.columnState(cx + dx, cz + dz) < COLUMN_LIT) return false;
    return true;
  };
  const load = () => {
    for (let i = 0; i < LOAD_ROUNDS && !lit(); i++) {
      host.pumpWorld({ columns: 8 }, events);
      step(1);
    }
    if (!lit()) throw new Error(`the world around ${player.body.x}, ${player.body.z} did not load`);
  };
  load();
  const port: WalkPort = {
    view: host.view,
    send: (command) => {
      if (command.type !== 'input') sent.push(command);
      host.send(command);
      step(1);
    },
    step,
    hold: async (action, slot, at, ticks, until) => {
      const b = player.body;
      const { yaw, pitch } = anglesTo({ x: b.x, y: b.y + eyeHeight(b), z: b.z }, at);
      const free: InputCommand = { ...NEUTRAL_INPUT, yaw, pitch, slot };
      const held: InputCommand = {
        ...free,
        primary: action === 'primary',
        secondary: action === 'secondary',
        forward: action === 'forward' ? 1 : 0,
      };
      for (let i = 0; i < ticks && !until?.(); i++) port.send(held);
      port.send(free);
    },
    travel: async (x, y, z) => {
      port.send({ type: 'debug.teleport', x, y, z });
      load();
      step(5);
    },
  };
  return { sim, player, port, sent, seen };
}

/** Every item a quest names. */
const NAMED = new Set<string>(registry.pack.quests!.flatMap((q) => q.condition?.items ?? []));

/**
 * The items a quest names that the world yields: a block that no recipe or process makes
 * drops it (its own item, or its loot), or a creature leaves it.
 */
function worldItems(): string[] {
  const made = (item: string) =>
    registry.crafting.recipes.some((r) => r.output.item === item) ||
    registry.crafting.processes.some((p) => p.output.item === item);
  const inLoot = (key: string, item: string) =>
    registry.loot(key)?.entries.some((e) => e.item === item) ?? false;
  return [...NAMED].filter(
    (item) =>
      registry.blocks.some(
        (b) =>
          !made(blockItemKey(b.key)) &&
          (b.drops === 'self' ? blockItemKey(b.key) === item : inLoot(b.drops, item)),
      ) || (registry.pack.creatures ?? []).some((c) => inLoot(c.loot, item)),
  );
}

describe('quests walk', () => {
  it.each([SEED, ...OTHER_SEEDS])(
    'does every quest of the pack in its order with the game actions (seed %s)',
    async (seed) => {
      const { player, port } = inlinePort(seed);
      const done = await walkQuests(port, { searchRadius: SEARCH_RADIUS });
      const keys = registry.pack.quests!.map((q) => q.key);
      expect([...done].sort()).toEqual([...keys].sort());
      expect(player.survival.dead).toBe(false);
    },
    90_000,
  );

  it('takes the named items from the world, strikes the creatures, builds the cabin', async () => {
    const { player, port, sent, seen } = inlinePort(SEED);
    await walkQuests(port, { searchRadius: SEARCH_RADIUS });
    const mine = (e: SimEvent) => 'playerId' in e && e.playerId === player.playerId;
    // Nothing a quest names is given, and no creature dies by command.
    const given = sent.flatMap((c) => (c.type === 'debug.give' ? [c.item] : []));
    expect(given.filter((item) => NAMED.has(item))).toEqual([]);
    expect(sent.filter((c) => c.type === 'debug.killCreature')).toEqual([]);
    // What the world yields was picked up from the ground (broken out of it, or loot).
    const picked = new Set(
      seen.flatMap((e) => (e.type === 'itemPickedUp' && mine(e) ? [e.item] : [])),
    );
    const world = worldItems();
    expect(world.length).toBeGreaterThan(0);
    for (const item of world) expect(picked, item).toContain(item);
    // The creatures hunted and met fell to the player's blows.
    const kills = seen.filter((e) => e.type === 'creatureDied' && e.attacker === player.id);
    expect(kills.length).toBeGreaterThanOrEqual(3);
    // The cabin's walls, roof and door went in by secondary (72 blocks of the wall, one door).
    const placed = (block: string) =>
      seen.filter(
        (e) => e.type === 'blockPlaced' && mine(e) && registry.blockDef(e.state).key === block,
      ).length;
    const wall = registry.pack.worldgen!.stone;
    const door = registry.blocks.find((b) => b.placement?.tall === 2)!.key;
    expect(placed(wall)).toBeGreaterThanOrEqual(70);
    expect(placed(door)).toBe(1);
  }, 90_000);

  it('fails for a player who has done a quest already', async () => {
    const { port } = inlinePort(SEED);
    const first = registry.pack.quests![0]!;
    for (const item of first.condition?.items ?? [])
      port.send({ type: 'debug.give', item, count: 1 });
    port.step(60);
    await expect(walkQuests(port, { searchRadius: SEARCH_RADIUS })).rejects.toThrow(
      `already done ${first.key}`,
    );
  });
});
