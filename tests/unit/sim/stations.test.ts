import { describe, expect, it } from 'vitest';
import { fuelSlotOf, outputSlotOf, stationSlotCount } from '../../../src/content/crafting.ts';
import type { StationDef } from '../../../src/content/schema.ts';
import type { StationEntity } from '../../../src/sim/blockEntities.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import type { ItemStack } from '../../../src/sim/inventory.ts';
import { advanceStation, MAX_REPLAY_TICKS, stepStation } from '../../../src/sim/stations.ts';
import { registry } from '../../helpers/registry.ts';

const def = (key: string): StationDef => registry.crafting.station(key)!;

/** A station entity with its inputs, fuel and outputs filled as given (item keys and counts). */
function station(
  key: string,
  inputs: (ItemStack | null)[],
  fuel: ItemStack | null = null,
  outputs: (ItemStack | null)[] = [],
): StationEntity {
  const d = def(key);
  const slots = new Array<ItemStack | null>(stationSlotCount(d)).fill(null);
  inputs.forEach((stack, i) => {
    slots[i] = stack;
  });
  if (d.fuelSlot) slots[fuelSlotOf(d)] = fuel;
  outputs.forEach((stack, i) => {
    slots[outputSlotOf(d) + i] = stack;
  });
  return {
    kind: 'station',
    x: 0,
    y: 64,
    z: 0,
    station: key,
    slots,
    burnTicksLeft: 0,
    burnTicks: 0,
    progressTicks: 0,
    process: '',
    lit: false,
    keepLit: false,
    tick: 0,
  };
}

const run = (entity: StationEntity, ticks: number) => {
  const d = def(entity.station);
  for (let i = 0; i < ticks; i++) stepStation(entity, d, registry);
};
const output = (entity: StationEntity) => entity.slots[outputSlotOf(def(entity.station))];
const fuel = (entity: StationEntity) => entity.slots[fuelSlotOf(def(entity.station))];
const stack = (item: string, count: number): ItemStack => ({ item: `item:${item}`, count });

describe('station processing', () => {
  it('alloys 3 copper and 1 cassiterite into 3 bronze in 15 s, burning only meanwhile', () => {
    const kiln = station(
      'station:kiln',
      [stack('copper_ingot', 4), stack('cassiterite', 1)],
      stack('broadleaf_log', 2),
    );
    run(kiln, 1);
    expect(kiln).toMatchObject({ process: 'process:bronze_ingot', lit: true, progressTicks: 1 });
    expect(kiln.burnTicks).toBe(ticksOf(40));
    expect(fuel(kiln)).toEqual(stack('broadleaf_log', 1));
    run(kiln, ticksOf(15) - 2);
    expect(output(kiln)).toBeNull();
    run(kiln, 1);
    expect(output(kiln)).toEqual(stack('bronze_ingot', 3));
    expect(kiln.slots.slice(0, 2)).toEqual([stack('copper_ingot', 1), null]);
    // Nothing left to make: the kiln goes out and keeps the rest of its log for later.
    run(kiln, 1);
    expect(kiln).toMatchObject({
      process: '',
      lit: false,
      burnTicksLeft: ticksOf(40) - ticksOf(15),
    });
    run(kiln, 100);
    expect(kiln.burnTicksLeft).toBe(ticksOf(40) - ticksOf(15));
    expect(fuel(kiln)).toEqual(stack('broadleaf_log', 1));
  });

  it('pauses with its output full, keeping its progress and its fuel', () => {
    const kiln = station('station:kiln', [stack('copper_ore', 2)], stack('stick', 3));
    run(kiln, 100);
    expect(kiln.progressTicks).toBe(100);
    // Another item fills the output: the copper has nowhere to go.
    kiln.slots[outputSlotOf(def('station:kiln'))] = stack('glass', 1);
    run(kiln, 500);
    expect(kiln).toMatchObject({ progressTicks: 100, lit: false, process: 'process:copper_ingot' });
    const burnt = fuel(kiln)!.count;
    kiln.slots[outputSlotOf(def('station:kiln'))] = null;
    run(kiln, ticksOf(10) - 100);
    expect(output(kiln)).toEqual(stack('copper_ingot', 1));
    expect(fuel(kiln)!.count).toBeLessThan(burnt);
  });

  it('pauses when the output stack is at its maximum', () => {
    const max = registry.maxStack('item:copper_ingot');
    const kiln = station('station:kiln', [stack('copper_ore', 1)], stack('broadleaf_log', 1), [
      stack('copper_ingot', max),
    ]);
    run(kiln, ticksOf(10) + 10);
    expect(kiln).toMatchObject({ progressTicks: 0, lit: false, burnTicksLeft: 0 });
    expect(fuel(kiln)).toEqual(stack('broadleaf_log', 1));
  });

  it('burns nothing at an idle campfire with fuel and no recipe to run', () => {
    const idle = station('station:campfire', [], stack('broadleaf_log', 3));
    run(idle, 5000);
    expect(idle).toMatchObject({ lit: false, burnTicksLeft: 0, process: '' });
    expect(fuel(idle)).toEqual(stack('broadleaf_log', 3));
    // An input that makes nothing leaves it cold too.
    idle.slots[0] = stack('dirt', 4);
    run(idle, 100);
    expect(idle.lit).toBe(false);
    expect(fuel(idle)).toEqual(stack('broadleaf_log', 3));
  });

  it('cooks at a campfire, burning only while it cooks, then goes out', () => {
    const cooking = station('station:campfire', [stack('raw_meat', 1)], stack('broadleaf_log', 2));
    run(cooking, 1);
    expect(cooking).toMatchObject({ lit: true, process: 'process:grilled_meat' });
    run(cooking, ticksOf(8) - 1);
    expect(output(cooking)).toEqual(stack('grilled_meat', 1));
    run(cooking, 10);
    // Nothing left to cook: the rest of the log waits for the next meal.
    expect(cooking).toMatchObject({ lit: false, burnTicksLeft: ticksOf(40) - ticksOf(8) });
    expect(fuel(cooking)).toEqual(stack('broadleaf_log', 1));
  });

  it('keeps a campfire burning while it has fuel when kept lit, cooking meanwhile', () => {
    const fire = { ...station('station:campfire', [], stack('stick', 2)), keepLit: true };
    run(fire, 1);
    expect(fire.lit).toBe(true);
    run(fire, 2 * ticksOf(5) - 1);
    expect(fire).toMatchObject({ lit: true, burnTicksLeft: 0 });
    expect(fuel(fire)).toBeNull();
    run(fire, 1);
    expect(fire.lit).toBe(false);
    const cooking = {
      ...station('station:campfire', [stack('raw_meat', 1)], stack('broadleaf_log', 1)),
      keepLit: true,
    };
    run(cooking, ticksOf(8));
    expect(output(cooking)).toEqual(stack('grilled_meat', 1));
    run(cooking, 10);
    expect(cooking.lit).toBe(true);
    // Turned off, it goes out at once and keeps the rest of its log.
    cooking.keepLit = false;
    run(cooking, 1);
    expect(cooking).toMatchObject({ lit: false, burnTicksLeft: ticksOf(40) - ticksOf(8) - 10 });
  });

  it('runs the bloomery on charcoal only', () => {
    const logs = station('station:bloomery', [stack('bog_iron', 2)], stack('broadleaf_log', 5));
    run(logs, ticksOf(20) + 5);
    expect(logs).toMatchObject({ lit: false, progressTicks: 0, process: 'process:iron_ingot' });
    expect(output(logs)).toBeNull();
    const charcoal = station('station:bloomery', [stack('bog_iron', 2)], stack('charcoal', 1));
    run(charcoal, ticksOf(20));
    expect(output(charcoal)).toEqual(stack('iron_ingot', 1));
  });

  it('starts over when the inputs call for another process', () => {
    const kiln = station('station:kiln', [stack('copper_ore', 1)], stack('broadleaf_log', 1));
    run(kiln, 50);
    kiln.slots[0] = stack('clay_lump', 2);
    run(kiln, 1);
    expect(kiln).toMatchObject({ process: 'process:bricks', progressTicks: 1 });
  });

  it('catches up exactly as if it had ticked all along, stopping early once idle', () => {
    const make = () =>
      station(
        'station:kiln',
        [stack('copper_ingot', 7), stack('cassiterite', 2)],
        stack('stick', 9),
        [stack('bronze_ingot', 1)],
      );
    for (const ticks of [1, 77, 450, 1000, 5000]) {
      const ticked = make();
      run(ticked, ticks);
      const replayed = make();
      advanceStation(replayed, def('station:kiln'), registry, ticks);
      expect(replayed, `${ticks} ticks`).toEqual(ticked);
    }
    const fire = () => station('station:campfire', [stack('raw_meat', 3)], stack('stick', 20));
    const ticked = fire();
    run(ticked, 4000);
    const replayed = fire();
    advanceStation(replayed, def('station:campfire'), registry, 4000);
    expect(replayed).toEqual(ticked);
    expect(MAX_REPLAY_TICKS).toBe(36_000);
  });
});
