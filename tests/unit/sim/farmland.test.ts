import { describe, expect, it } from 'vitest';
import { blockItemKey } from '../../../src/content/items.ts';
import { UPDATE_GROW } from '../../../src/sim/blockUpdates.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import { scheduleRipening } from '../../../src/sim/crops.ts';
import { checkSoil, soilFactor, stepTrampling } from '../../../src/sim/farmland.ts';
import { countItem } from '../../../src/sim/inventory.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim } from '../../helpers/simHarness.ts';

/*
 * Farmland (plan v3 « M33 », the reference game's): a hoe tills grass or dirt with air above;
 * watered from a liquid within its reach (its level or one above), else it dries, and dry with
 * nothing planted (or under a solid block) it turns back into dirt; a landing from a jump
 * tramples it, the crop on it broken. Numbers from the pack's farmland and hoe.
 */

const FARMLAND = 'block:farmland';
const soil = registry.blockDef(registry.defaultState(FARMLAND)).soil!;
const HOE = registry.items.find((item) => item.hoe)!;
const BUSH = 'block:berry_bush';
/** The grass one block north of the player, its top face. */
const GROUND = { target: { x: 0, y: 64, z: -1, face: 2 } };

function plot() {
  const s = playerTestSim({ seed: 'farmland' });
  s.give(HOE.key);
  return s;
}

/** Runs a farmland's check now (as its block update does). */
const check = (s: ReturnType<typeof plot>, x: number, y: number, z: number) =>
  checkSoil(s.sim, x, y, z, s.events);

describe('farmland', () => {
  it('is tilled from grass with air above by a hoe, which wears; never under a block', () => {
    const s = plot();
    s.tick(1, { secondary: true, ...GROUND });
    expect(s.block(0, 64, -1)).toBe(`${FARMLAND}[moist=0]`);
    expect(s.player.inventory[0]?.durability).toBe(HOE.hoe!.durability - 1);
    // Something on the grass: no tilling.
    s.put(1, 65, -1, 'block:tall_grass');
    s.tick(1);
    s.tick(1, { secondary: true, target: { x: 1, y: 64, z: -1, face: 2 } });
    expect(s.block(1, 64, -1)).toBe('block:grass');
  });

  it('is watered by water within its reach, on its level or one above, and not beyond', () => {
    const s = plot();
    const r = soil.irrigation;
    s.put(0, 64, -2, FARMLAND);
    s.put(r, 64, -2, 'block:fresh_water');
    check(s, 0, 64, -2);
    expect(s.block(0, 64, -2)).toBe(`${FARMLAND}[moist=1]`);
    s.put(r, 64, -2, 'block:grass');
    s.put(r + 1, 64, -2, 'block:fresh_water');
    check(s, 0, 64, -2);
    expect(s.block(0, 64, -2)).toBe(`${FARMLAND}[moist=0]`);
    // Lava waters nothing.
    s.put(1, 64, -2, 'block:lava');
    check(s, 0, 64, -2);
    expect(s.block(0, 64, -2)).toBe('block:dirt');
  });

  it('dries back into dirt with nothing planted, keeps its crop, and goes under a solid block', () => {
    const s = plot();
    s.put(0, 64, -2, `${FARMLAND}[moist=1]`);
    check(s, 0, 64, -2);
    expect(s.block(0, 64, -2)).toBe(`${FARMLAND}[moist=0]`);
    check(s, 0, 64, -2);
    expect(s.block(0, 64, -2)).toBe(soil.dries);
    // Planted, it stays farmland, dry.
    s.put(1, 64, -2, FARMLAND);
    s.put(1, 65, -2, `${BUSH}[ripe=0]`);
    check(s, 1, 64, -2);
    expect(s.block(1, 64, -2)).toBe(`${FARMLAND}[moist=0]`);
    // A solid block over it: dirt.
    s.put(2, 64, -2, `${FARMLAND}[moist=1]`);
    s.put(2, 65, -2, 'block:stone');
    s.put(3, 64, -2, 'block:fresh_water');
    check(s, 2, 64, -2);
    expect(s.block(2, 64, -2)).toBe(soil.dries);
  });

  it('keeps itself checked by its block updates once tilled', () => {
    const s = plot();
    s.tick(1, { secondary: true, ...GROUND });
    s.tick(ticksOf(30) * 2 + 2);
    expect(s.block(0, 64, -1)).toBe(soil.dries);
  });

  it('is trampled by a landing from a fall, its crop broken with its harvest', () => {
    const s = plot();
    s.put(0, 64, 0, `${FARMLAND}[moist=1]`);
    s.put(0, 65, 0, BUSH);
    const before = s.events.length;
    s.events.push({ type: 'playerLanded', playerId: 1, fall: 3 });
    // The player stands in the bush's cell, landed on the farmland.
    stepTrampling(s.sim, s.events, before);
    expect(s.block(0, 64, 0)).toBe(soil.dries);
    expect(s.block(0, 65, 0)).toBe('block:air');
    expect(eventsOf(s.events, 'blockBroken')).toHaveLength(1);
    // A step down of half a block or less never tramples.
    s.put(0, 64, 0, `${FARMLAND}[moist=1]`);
    const next = s.events.length;
    s.events.push({ type: 'playerLanded', playerId: 1, fall: 0.5 });
    stepTrampling(s.sim, s.events, next);
    expect(s.block(0, 64, 0)).toBe(`${FARMLAND}[moist=1]`);
  });

  it('ripens its crop twice as slowly while dry', () => {
    const s = plot();
    s.put(0, 64, -2, FARMLAND);
    s.put(1, 64, -2, `${FARMLAND}[moist=1]`);
    expect(soilFactor(s.sim, 0, 65, -2)).toBe(2);
    expect(soilFactor(s.sim, 1, 65, -2)).toBe(1);
    expect(soilFactor(s.sim, 5, 65, 5)).toBe(1);
    // A bush on dry farmland is scheduled within twice its longest time.
    s.put(0, 65, -2, `${BUSH}[ripe=0]`);
    scheduleRipening(s.sim, 0, 65, -2);
    const longest = ticksOf(registry.blockDef(registry.defaultState(BUSH)).crop!.seconds[1]);
    const rows = s.sim.blockUpdates.serialize(s.sim.tick);
    let left = -1;
    for (let i = 0; i < rows.length; i += 5)
      if (rows[i] === 0 && rows[i + 1] === 65 && rows[i + 2] === -2 && rows[i + 3] === UPDATE_GROW)
        left = rows[i + 4]!;
    const shortest = ticksOf(registry.blockDef(registry.defaultState(BUSH)).crop!.seconds[0]);
    expect(left).toBeGreaterThanOrEqual(shortest * 2);
    expect(left).toBeLessThanOrEqual(longest * 2);
  });

  it('gives its dirt back when broken', () => {
    const s = plot();
    s.put(0, 65, -1, FARMLAND);
    s.tick(40, { primary: true, target: { x: 0, y: 65, z: -1, face: 4 } });
    s.tick(20);
    expect(countItem(s.player.inventory, blockItemKey(soil.dries))).toBe(1);
  });
});
