import { describe, expect, it } from 'vitest';
import { anglesTo } from '../../../src/core/angles.ts';
import { COLUMN_LIT } from '../../../src/sim/ColumnPipeline.ts';
import { type InputCommand, NEUTRAL_INPUT } from '../../../src/sim/commands.ts';
import { eyeHeight } from '../../../src/sim/physics.ts';
import { createInlineSim } from '../../../src/sim/testing/inlineSim.ts';
import { type WalkPort, walkObjectives } from '../../../src/sim/testing/objectiveWalk.ts';
import { blockToColumn } from '../../../src/world/coords.ts';
import { registry } from '../../helpers/registry.ts';

/*
 * The objectives walk (sim/testing/objectiveWalk.ts) on an inline simulation of the browser
 * walk's world (?seed=7, the generated world, no natural spawns): every objective of the pack is
 * done in chain order, with the game's own commands, and an objective done out of its turn fails
 * the walk. The browser case (selftest/objectivesWalk.ts) drives the same walk through `__game`'s
 * automation.
 */

/** The browser walk's seed and search radius (selftest/support.ts SEARCH_RADIUS). */
const SEED = '7';
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
  const step = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      host.advance(1, events);
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
      host.send(command);
      step(1);
    },
    step,
    use: async (slot, at, ticks) => {
      const b = player.body;
      const { yaw, pitch } = anglesTo({ x: b.x, y: b.y + eyeHeight(b), z: b.z }, at);
      const input: InputCommand = { ...NEUTRAL_INPUT, yaw, pitch, slot, secondary: true };
      for (let i = 0; i < ticks; i++) port.send(input);
      port.send({ ...input, secondary: false });
    },
    travel: async (x, y, z) => {
      port.send({ type: 'debug.teleport', x, y, z });
      load();
      step(5);
    },
  };
  return { sim, player, port };
}

describe('objectives walk', () => {
  it('does every objective of the pack in chain order with the game actions', async () => {
    const { player, port } = inlinePort(SEED);
    const done = await walkObjectives(port, { searchRadius: SEARCH_RADIUS });
    const chain = registry.pack.objectives!.map((o) => o.key);
    expect(done).toEqual(chain);
    expect(player.survival.dead).toBe(false);
  }, 60_000);

  it('fails when the check does an objective out of its turn', async () => {
    const { port } = inlinePort(SEED);
    // The second objective's items in hand: its check comes before the first one is done.
    const second = registry.pack.objectives![1]!;
    for (const item of second.condition.items ?? [])
      port.send({ type: 'debug.give', item, count: 1 });
    await expect(walkObjectives(port, { searchRadius: SEARCH_RADIUS })).rejects.toThrow(
      `objectives done are [${second.key}, ${registry.pack.objectives![0]!.key}]`,
    );
  });
});
