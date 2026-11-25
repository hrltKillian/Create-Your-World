import { describe, expect, it } from 'vitest';
import { ticksOf } from '../../../src/sim/clock.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Fishing (plan v3 « M33 »): a rod held on water that has fish lands a catch within its bite
 * time, wears one use, and the Mirror Basin's lakes give their own catch. Numbers and tables come
 * from the pack (the rod, the liquids' and biomes' fish).
 */

const ROD = registry.items.find((item) => item.rod)!;
const rod = ROD.rod!;
const FRESH = 'block:fresh_water';
const fresh = registry.blockDef(registry.defaultState(FRESH)).liquid!;
const basin = registry.pack.biomes!.find((b) => b.fish)!;
const entries = (key: string) => registry.loot(key)!.entries.map((e) => e.item as string);
/** Looking down at the cell (0, 64, −1) from (0.5, 65, 0.5). */
const DOWN = { pitch: -1.2 };

/** A flat world, a pool of `water` in front of the player, the rod in hand. */
function pond(water = FRESH) {
  const s = playerTestSim({ seed: 'fish' });
  s.fill(0, 64, -1, 0, 64, -1, water);
  s.give(ROD.key);
  return s;
}

/** Holds secondary on the pool `ticks` ticks; the items caught. */
function fish(s: ReturnType<typeof pond>, ticks: number): string[] {
  s.events.length = 0;
  s.tick(ticks, { ...DOWN, secondary: true });
  return eventsOf(s.events, 'fishCaught').map((e) => e.item);
}

describe('fishing', () => {
  it('lands one catch from the water within the bite time, and the rod wears one use', () => {
    const s = pond();
    expect(fish(s, ticksOf(rod.seconds[0]) - 1)).toEqual([]);
    s.tick(1);
    const caught = fish(s, ticksOf(rod.seconds[1]) + 1);
    expect(caught.length).toBeGreaterThan(0);
    for (const item of caught) expect(entries(fresh.fish!)).toContain(item);
    expect(s.player.inventory[0]?.durability).toBeLessThan(rod.durability);
    // Released and held again: the cast starts over.
    s.tick(1);
    expect(fish(s, ticksOf(rod.seconds[0]) - 1)).toEqual([]);
  });

  it('gives nothing in a liquid without fish', () => {
    const s = pond('block:foul_water');
    expect(fish(s, ticksOf(rod.seconds[1]) * 2)).toEqual([]);
    expect(s.player.inventory[0]?.durability).toBe(rod.durability);
  });

  it("takes the Mirror Basin's catch in its lakes", () => {
    const s = pond();
    // The pool's column lies in the basin.
    s.sim.world.getColumn(0, -1)!.biomes.fill(s.sim.ctx.biomeDefs.indexOf(basin));
    const caught = fish(s, ticksOf(rod.seconds[1]) * 6);
    expect(caught.length).toBeGreaterThanOrEqual(4);
    for (const item of caught) expect(entries(basin.fish!)).toContain(item);
  });
});
