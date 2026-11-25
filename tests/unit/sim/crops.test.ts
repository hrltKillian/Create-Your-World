import { describe, expect, it } from 'vitest';
import { blockItemKey } from '../../../src/content/items.ts';
import { BlockUpdateQueue, UPDATE_GROW } from '../../../src/sim/blockUpdates.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import type { ClientTarget } from '../../../src/sim/commands.ts';
import { scheduleRipening } from '../../../src/sim/crops.ts';
import { countItem } from '../../../src/sim/inventory.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Crops (plan v3 « M33 »): a ripe plant picked by secondary, left bare, ripening again in the
 * light; planted bare; broken ripe with its harvest. Numbers from the pack's crop data.
 */

const BUSH = 'block:berry_bush';
const crop = registry.blockDef(registry.defaultState(BUSH)).crop!;
const harvestItems = registry.loot(crop.harvest)!.entries.map((e) => e.item as string);
const LONGEST = ticksOf(crop.seconds[1]);
/** The bush one block north of the player, its +z face. */
const AT: ClientTarget = { x: 0, y: 65, z: -1, face: 4 };

function field() {
  const s = playerTestSim({ seed: 'crops' });
  const harvested = () =>
    harvestItems.reduce((n, item) => n + countItem(s.player.inventory, item), 0);
  return { ...s, harvested };
}

describe('crops', () => {
  it('generate ripe, and a ripe one is picked by secondary: its harvest, the plant left bare', () => {
    const s = field();
    s.put(0, 65, -1, BUSH);
    expect(s.block(0, 65, -1)).toBe(`${BUSH}[ripe=1]`);
    s.tick(1, { secondary: true, target: AT });
    s.tick(20);
    expect(s.block(0, 65, -1)).toBe(`${BUSH}[ripe=0]`);
    expect(s.harvested()).toBeGreaterThan(0);
    expect(eventsOf(s.events, 'cropHarvested')).toHaveLength(1);
    // Bare, it gives nothing more.
    const had = s.harvested();
    s.tick(1, { secondary: false });
    s.tick(1, { secondary: true, target: AT });
    s.tick(20);
    expect(s.harvested()).toBe(had);
    // It ripens again within its longest time under the sky.
    s.tick(LONGEST);
    expect(s.block(0, 65, -1)).toBe(`${BUSH}[ripe=1]`);
  });

  it('are planted bare from their item and ripen in the light', () => {
    const s = field();
    s.give(blockItemKey(BUSH));
    s.tick(1, { secondary: true, target: { x: 0, y: 64, z: -1, face: 2 } });
    expect(s.block(0, 65, -1)).toBe(`${BUSH}[ripe=0]`);
    expect(s.sim.blockUpdates.serialize(s.sim.tick)).toEqual(
      expect.arrayContaining([0, 65, -1, UPDATE_GROW]),
    );
    s.tick(ticksOf(crop.seconds[0]) - 2);
    expect(s.block(0, 65, -1)).toBe(`${BUSH}[ripe=0]`);
    s.tick(LONGEST);
    expect(s.block(0, 65, -1)).toBe(`${BUSH}[ripe=1]`);
  });

  it('wait in the dark: no ripening shut in stone until the sky comes back', () => {
    const s = field();
    s.fill(4, 65, 4, 6, 67, 6, 'block:stone');
    s.put(5, 65, 5, `${BUSH}[ripe=0]`);
    scheduleRipening(s.sim, 5, 65, 5);
    s.tick(LONGEST * 2);
    expect(s.block(5, 65, 5)).toBe(`${BUSH}[ripe=0]`);
    s.fill(4, 66, 4, 6, 67, 6, 'block:air');
    s.tick(LONGEST * 2 + 1);
    expect(s.block(5, 65, 5)).toBe(`${BUSH}[ripe=1]`);
  });

  it('broken ripe give the plant and its harvest, broken bare the plant alone', () => {
    const s = field();
    s.put(0, 65, -1, BUSH);
    s.tick(10, { primary: true, target: AT });
    s.tick(20);
    expect(countItem(s.player.inventory, blockItemKey(BUSH))).toBe(1);
    expect(s.harvested()).toBeGreaterThan(0);
    const had = s.harvested();
    s.put(0, 65, -1, `${BUSH}[ripe=0]`);
    s.tick(10, { primary: true, target: AT });
    s.tick(20);
    expect(countItem(s.player.inventory, blockItemKey(BUSH))).toBe(2);
    expect(s.harvested()).toBe(had);
  });

  it('keep their ripening in the saved block updates', () => {
    const queue = new BlockUpdateQueue();
    queue.schedule(1, 65, 2, UPDATE_GROW, 500);
    const copy = new BlockUpdateQueue();
    copy.restore(queue.serialize(100), 100);
    expect(copy.serialize(100)).toEqual([1, 65, 2, UPDATE_GROW, 400]);
  });
});
