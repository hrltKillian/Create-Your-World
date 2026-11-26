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
 * Crops (plan v3 « M33 », the reference game's sweet berry bush): a ripe plant picked by
 * secondary, its harvest popped out at its foot, left bare, ripening again in the light; planted
 * bare from its harvest; broken ripe it gives its harvest, bare nothing. Numbers from the pack's
 * crop data.
 */

const BUSH = 'block:berry_bush';
const FARMLAND = 'block:farmland';
const crop = registry.blockDef(registry.defaultState(BUSH)).crop!;
const harvestItems = registry.loot(crop.harvest)!.entries.map((e) => e.item as string);
const LONGEST = ticksOf(crop.seconds[1]);
/** The item that plants the bush (its berries). */
const SEED = registry.items.find((item) => item.places === BUSH)!.key;
/** The bush one block north of the player, its +z face. */
const AT: ClientTarget = { x: 0, y: 65, z: -1, face: 4 };

function field() {
  const s = playerTestSim({ seed: 'crops' });
  const harvested = () =>
    harvestItems.reduce((n, item) => n + countItem(s.player.inventory, item), 0);
  return { ...s, harvested };
}

describe('crops', () => {
  it('generate ripe, and a ripe one is picked by secondary: its harvest at its foot, left bare', () => {
    const s = field();
    // Three blocks ahead: out of the player's pickup reach.
    const far: ClientTarget = { x: 0, y: 65, z: -3, face: 4 };
    s.put(0, 65, -3, BUSH);
    expect(s.block(0, 65, -3)).toBe(`${BUSH}[ripe=1]`);
    s.tick(1, { secondary: true, target: far });
    s.tick(20);
    expect(s.block(0, 65, -3)).toBe(`${BUSH}[ripe=0]`);
    expect(eventsOf(s.events, 'cropHarvested')).toHaveLength(1);
    // The harvest lies at the bush's foot, not in the bag.
    expect(s.harvested()).toBe(0);
    const drops = () => [...s.sim.entities.values()].filter((e) => e.kind === 'itemDrop');
    expect(drops().map((d) => d.kind === 'itemDrop' && d.item)).toEqual([harvestItems[0]]);
    for (const d of drops()) expect(Math.hypot(d.body.x - 0.5, d.body.z + 2.5)).toBeLessThan(1);
    // Bare, it gives nothing more.
    s.tick(1, { secondary: false });
    s.tick(1, { secondary: true, target: far });
    s.tick(20);
    expect(drops()).toHaveLength(1);
    // It ripens again within its longest time under the sky.
    s.tick(LONGEST);
    expect(s.block(0, 65, -3)).toBe(`${BUSH}[ripe=1]`);
  });

  it('are planted bare from their harvest on watered farmland, not eaten, and ripen', () => {
    const s = field();
    // Watered farmland (plan v3 « M33 »: farmland.ts), the pool two blocks off.
    s.put(2, 64, -1, 'block:fresh_water');
    s.put(0, 64, -1, `${FARMLAND}[moist=1]`);
    s.give(SEED, 2);
    s.send({ type: 'debug.setStat', stat: 'hunger', value: 20 });
    const hunger = s.player.survival.hunger;
    s.tick(40, { secondary: true, target: { x: 0, y: 64, z: -1, face: 2 } });
    expect(s.block(0, 65, -1)).toBe(`${BUSH}[ripe=0]`);
    expect(countItem(s.player.inventory, SEED)).toBe(1);
    expect(s.player.survival.hunger).toBeLessThanOrEqual(hunger);
    expect(s.sim.blockUpdates.serialize(s.sim.tick)).toEqual(
      expect.arrayContaining([0, 65, -1, UPDATE_GROW]),
    );
    s.tick(ticksOf(crop.seconds[0]) - 2);
    expect(s.block(0, 65, -1)).toBe(`${BUSH}[ripe=0]`);
    s.tick(LONGEST);
    expect(s.block(0, 65, -1)).toBe(`${BUSH}[ripe=1]`);
  });

  it('are eaten where their harvest cannot be planted: grass, the sky', () => {
    const s = field();
    s.give(SEED, 3);
    s.send({ type: 'debug.setStat', stat: 'hunger', value: 20 });
    const eat = ticksOf(registry.item(SEED)!.consume!.seconds);
    s.tick(eat, { secondary: true, pitch: 1.2 });
    expect(countItem(s.player.inventory, SEED)).toBe(2);
    // Grass is not farmland: the berries are eaten, nothing planted.
    s.tick(1);
    s.tick(eat, { secondary: true, target: { x: 0, y: 64, z: -1, face: 2 } });
    expect(s.block(0, 65, -1)).toBe('block:air');
    expect(countItem(s.player.inventory, SEED)).toBe(1);
    expect(eventsOf(s.events, 'consumed').map((e) => e.item)).toEqual([SEED, SEED]);
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

  it('broken ripe give their harvest, broken bare nothing (never the bush itself)', () => {
    const s = field();
    s.put(0, 65, -1, BUSH);
    s.tick(10, { primary: true, target: AT });
    s.tick(20);
    expect(s.harvested()).toBeGreaterThan(0);
    const had = s.harvested();
    s.put(0, 65, -1, `${BUSH}[ripe=0]`);
    s.tick(10, { primary: true, target: AT });
    s.tick(20);
    expect(s.block(0, 65, -1)).toBe('block:air');
    expect(s.harvested()).toBe(had);
    expect(countItem(s.player.inventory, blockItemKey(BUSH))).toBe(0);
  });

  it('keep their ripening in the saved block updates', () => {
    const queue = new BlockUpdateQueue();
    queue.schedule(1, 65, 2, UPDATE_GROW, 500);
    const copy = new BlockUpdateQueue();
    copy.restore(queue.serialize(100), 100);
    expect(copy.serialize(100)).toEqual([1, 65, 2, UPDATE_GROW, 400]);
  });
});
