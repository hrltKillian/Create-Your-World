import { describe, expect, it } from 'vitest';
import { fuelSlotOf, outputSlotOf } from '../../../src/content/crafting.ts';
import type { ContainerEntity, StationEntity } from '../../../src/sim/blockEntities.ts';
import { ticksOf } from '../../../src/sim/clock.ts';
import type { ClientTarget, Command } from '../../../src/sim/commands.ts';
import { createHost } from '../../../src/sim/host.ts';
import { countItem } from '../../../src/sim/inventory.ts';
import type { ItemDropState } from '../../../src/sim/itemDrops.ts';
import { blockEntityRecord } from '../../../src/sim/saveRecords.ts';
import { cellKey, toColumn } from '../../../src/world/coords.ts';
import { createGenContext } from '../../../src/world/gen/generateColumn.ts';
import { LatticeCache } from '../../../src/world/gen/sample.ts';
import { siteIn, structureLootAt } from '../../../src/world/gen/structures.ts';
import { blockOf } from '../../../src/world/light.ts';
import { registry } from '../../helpers/registry.ts';
import { settle } from '../../helpers/save.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/** A flat world (grass at y 64) with the player at (0.5, 65, 0.5); commands go through JSON. */
function setup(seed = 'chests', worldType: 'flat' | 'default' = 'flat') {
  const s = playerTestSim({ seed, worldType, serialize: true });
  return {
    ...s,
    entity: <T extends ContainerEntity | StationEntity>(x: number, y: number, z: number) =>
      s.sim.blockEntities.get(cellKey(x, y, z)) as T | undefined,
  };
}

const lying = (s: ReturnType<typeof setup>) =>
  [...s.sim.entities.values()]
    .filter((e): e is ItemDropState => e.kind === 'itemDrop')
    .map((d) => [d.item, d.count]);
const open = (x: number, y: number, z: number): Command => ({ type: 'container.open', x, y, z });
const debugOpen = (x: number, y: number, z: number): Command => ({ type: 'debug.open', x, y, z });

/** A chest at (0, 65, −3), north of the player, behind a stone wall at z −2 higher than the eye. */
function walledChest() {
  const s = setup();
  s.put(0, 65, -3, 'block:chest[facing4=s]');
  const wall = { x0: -2, y0: 65, z0: -2, x1: 2, y1: 67, z1: -2, state: 'block:stone' };
  s.send({ type: 'debug.fill', ...wall });
  return s;
}

describe('chests', () => {
  it('opens for one player within 5 blocks, moves items both ways and closes when left', () => {
    const s = setup();
    s.give('item:chest');
    s.tick(1, { secondary: true, target: { x: 0, y: 64, z: -2, face: 2 } });
    s.tick(1);
    expect(s.block(0, 65, -2)).toMatch(/^block:chest\[/);
    const chest = s.entity<ContainerEntity>(0, 65, -2)!;
    expect(chest.slots).toEqual(new Array(18).fill(null));
    s.give('item:dirt', 10);
    expect(eventsOf(s.send(open(0, 65, -2)), 'blockEntityOpened')).toEqual([
      { type: 'blockEntityOpened', playerId: 1, kind: 'container', x: 0, y: 65, z: -2 },
    ]);
    s.send({ type: 'container.move', from: 0, to: 35, count: 4 });
    expect(chest.slots[3]).toEqual({ item: 'item:dirt', count: 4 });
    s.send({ type: 'container.move', from: 0 });
    expect(chest.slots[3]).toEqual({ item: 'item:dirt', count: 10 });
    expect(countItem(s.player.inventory, 'item:dirt')).toBe(0);
    s.send({ type: 'container.move', from: 35 });
    expect(countItem(s.player.inventory, 'item:dirt')).toBe(10);
    expect(
      rejections(
        s.send(
          { type: 'station.move', from: 0 },
          { type: 'container.move', from: 32 + 18 },
          { type: 'container.move', from: 40 },
          { type: 'container.move', from: -1 },
        ),
      ),
    ).toEqual(['not open', 'invalid', 'nothing to move', 'invalid']);

    // A second player cannot open it meanwhile.
    s.sim.addPlayer(2, 2);
    const other = createHost(s.sim, 2);
    other.send(open(0, 65, -2));
    expect(rejections(s.send())).toEqual(['in use']);

    s.send({ type: 'debug.teleport', x: 8.5, y: 'surface', z: 0.5 });
    expect(eventsOf(s.events, 'blockEntityClosed')).toHaveLength(1);
    expect(s.player.opened).toBeNull();
    expect(rejections(s.send(open(0, 65, -2)))).toEqual(['reach']);
    expect(rejections(s.send({ type: 'container.close' }))).toEqual(['nothing open']);
  });

  it('opens on a right click instead of placing, and spills its items when broken', () => {
    const s = setup();
    s.put(0, 65, -2, 'block:chest[facing4=s]');
    s.give('item:dirt', 5);
    s.give('item:torch', 3);
    const target: ClientTarget = { x: 0, y: 65, z: -2, face: 4 };
    s.tick(1, { secondary: true, target });
    expect(eventsOf(s.events, 'blockEntityOpened')).toHaveLength(1);
    expect(s.block(0, 65, -1)).toBe('block:air');
    s.send({ type: 'container.move', from: 0 }, { type: 'container.move', from: 1 });
    expect(s.entity<ContainerEntity>(0, 65, -2)!.slots.slice(0, 2)).toEqual([
      { item: 'item:dirt', count: 5 },
      { item: 'item:torch', count: 3 },
    ]);
    s.events.length = 0;
    for (let i = 0; i < 200 && s.block(0, 65, -2) !== 'block:air'; i++)
      s.tick(1, { primary: true, target });
    expect(s.block(0, 65, -2)).toBe('block:air');
    expect(s.entity(0, 65, -2)).toBeUndefined();
    expect(lying(s)).toEqual([
      ['item:dirt', 5],
      ['item:torch', 3],
      ['item:chest', 1],
    ]);
    expect(eventsOf(s.events, 'blockEntityClosed')).toHaveLength(1);
  });

  it('fills a generated chest from its structure loot table, the same in every run', () => {
    const seed = 'camp-loot';
    const ctx = createGenContext(seed, registry);
    const cache = new LatticeCache();
    let chest: { x: number; y: number; z: number; table: string } | undefined;
    for (let r = 0; r < 400 && !chest; r++) {
      const site = siteIn(ctx, cache, (r % 20) - 10, Math.floor(r / 20) - 10);
      if (site?.structure.key !== 'structure:camp') continue;
      const s = site.structure;
      const [cell, table] = [...s.loot][0]!;
      const layer = Math.floor(cell / (s.width * s.depth));
      const z = Math.floor((cell % (s.width * s.depth)) / s.width);
      const x = cell % s.width;
      chest = { x: site.x0 + x, y: site.y + layer, z: site.z0 + z, table };
    }
    expect(chest).toBeDefined();
    const { x, y, z, table } = chest!;
    expect(table).toBe('loot:camp');
    expect(structureLootAt(ctx, x, y, z)).toBe('loot:camp');
    expect(structureLootAt(ctx, x, y + 1, z)).toBeUndefined();
    const items = new Set<string>(registry.loot('loot:camp')!.entries.map((e) => e.item));
    const opened = () => {
      const s = setup(seed, 'default');
      // On the camp's floor, east of the chest: its posts and roof hide it from the south.
      s.send({ type: 'debug.teleport', x: x + 2.5, y, z: z + 0.5 });
      settle(s.sim);
      expect(s.block(x, y, z)).toMatch(/^block:chest\[/);
      expect(rejections(s.send(open(x, y, z)))).toEqual([]);
      return s.entity<ContainerEntity>(x, y, z)!.slots;
    };
    const slots = opened();
    const filled = slots.filter((stack) => stack !== null);
    expect(filled.length).toBeGreaterThan(0);
    for (const stack of filled) expect(items.has(stack!.item)).toBe(true);
    expect(opened()).toEqual(slots);
  });

  it('opens only in sight: never through a wall, by command or by aiming', () => {
    const s = walledChest();
    expect(rejections(s.send(open(0, 65, -3)))).toEqual(['sight']);
    // Aimed through the wall, the client target is not confirmed: no screen opens.
    s.tick(1, { secondary: true, target: { x: 0, y: 65, z: -3, face: 4 } });
    s.tick(1);
    expect(eventsOf(s.events, 'blockEntityOpened')).toEqual([]);
    expect(s.player.opened).toBeNull();
    // A hole in the wall: now in view, it opens.
    s.put(0, 65, -2, 'block:air');
    expect(eventsOf(s.send(open(0, 65, -3)), 'blockEntityOpened')).toHaveLength(1);
    expect(s.player.opened).toEqual({ x: 0, y: 65, z: -3 });
  });

  it('opens by debug.open without aiming, within reach only, and never without debugging', () => {
    const s = walledChest();
    expect(rejections(s.send(debugOpen(0, 65, -30), debugOpen(0.5, 65, -3)))).toEqual([
      'reach',
      'invalid',
    ]);
    expect(eventsOf(s.send(debugOpen(0, 65, -3)), 'blockEntityOpened')).toHaveLength(1);
    const locked = playerTestSim({ seed: 'chests', allowDebug: false });
    expect(rejections(locked.send(debugOpen(0, 65, -3)))).toEqual(['debug disabled']);
  });
});

describe('stations in the world', () => {
  const kilnCell = { x: 0, y: 65, z: -2 };
  /** A kiln fed with copper ore and logs through its screen, left open. */
  function kiln(ore = 1, logs = 1) {
    const s = setup();
    s.put(0, 65, -2, 'block:kiln[facing4=s,lit=0]');
    s.give('item:copper_ore', ore);
    s.give('item:broadleaf_log', logs);
    s.tick(1, { secondary: false });
    s.tick(1, { secondary: true, target: { ...kilnCell, face: 4 } });
    const def = registry.crafting.station('station:kiln')!;
    return { ...s, def, kiln: s.entity<StationEntity>(0, 65, -2)! };
  }

  it('opens on a right click and takes fuel and ore, refusing what does not fit a slot', () => {
    const s = kiln();
    expect(eventsOf(s.events, 'blockEntityOpened')[0]?.kind).toBe('station');
    const fuel = 32 + fuelSlotOf(s.def);
    const output = 32 + outputSlotOf(s.def);
    expect(
      rejections(
        s.send(
          { type: 'station.move', from: 0, to: fuel },
          { type: 'station.move', from: 1, to: output },
          { type: 'container.move', from: 1 },
        ),
      ),
    ).toEqual(['slot', 'slot', 'not open']);
    s.send({ type: 'station.move', from: 1 }, { type: 'station.move', from: 0 });
    // The log went to the fuel slot and lit at once; the ore waits in the first input.
    expect(s.kiln.slots).toEqual([{ item: 'item:copper_ore', count: 1 }, null, null, null]);
    expect(s.kiln).toMatchObject({ lit: true, burnTicksLeft: ticksOf(40) - 1, progressTicks: 1 });
  });

  it('smelts a copper ingot in 10 s, lit meanwhile, its light following', () => {
    const s = kiln();
    s.send({ type: 'station.move', from: 1 }, { type: 'station.move', from: 0 });
    expect(s.block(0, 65, -2)).toBe('block:kiln[facing4=s,lit=1]');
    expect(blockOf(s.host.view.world.getLight(0, 65, -1))).toBe(11);
    s.step(298);
    expect(s.kiln.slots[outputSlotOf(s.def)]).toBeNull();
    s.step(1);
    expect(s.kiln.slots[outputSlotOf(s.def)]).toEqual({ item: 'item:copper_ingot', count: 1 });
    expect(s.block(0, 65, -2)).toBe('block:kiln[facing4=s,lit=1]');
    s.step(1);
    expect(s.block(0, 65, -2)).toBe('block:kiln[facing4=s,lit=0]');
    expect(blockOf(s.host.view.world.getLight(0, 65, -1))).toBe(0);
    s.send({ type: 'station.move', from: 32 + outputSlotOf(s.def) });
    expect(countItem(s.player.inventory, 'item:copper_ingot')).toBe(1);
  });

  it('catches up after its column was unloaded exactly as a station that kept ticking', () => {
    const away = kiln(5, 2);
    const stay = kiln(5, 2);
    for (const s of [away, stay])
      s.send({ type: 'station.move', from: 1 }, { type: 'station.move', from: 0 });
    away.send({ type: 'debug.teleport', x: 40 * 32, y: 'surface', z: 0.5 });
    stay.send({ type: 'debug.freezeTime', frozen: false });
    away.step(100);
    expect(away.sim.columnState(0, toColumn(-2))).toBe(0);
    const tick = away.kiln.tick;
    away.step(800);
    expect(away.kiln.tick).toBe(tick);
    away.send({ type: 'debug.teleport', x: 0.5, y: 65, z: 0.5 });
    stay.step(901);
    away.step(150);
    stay.step(150);
    expect(away.sim.tick).toBe(stay.sim.tick);
    expect(away.kiln.tick).toBe(away.sim.tick);
    expect(blockEntityRecord(away.kiln)).toEqual(blockEntityRecord(stay.kiln));
    expect(away.kiln.slots[outputSlotOf(away.def)]?.count).toBe(3);
    expect(away.block(0, 65, -2)).toBe(stay.block(0, 65, -2));
  });

  it('catches up at most one game day', () => {
    const s = setup();
    s.put(0, 65, -2, 'block:campfire[lit=0]');
    s.give('item:broadleaf_log', 50);
    s.send(open(0, 65, -2));
    const def = registry.crafting.station('station:campfire')!;
    s.send({ type: 'station.move', from: 0, to: 32 + fuelSlotOf(def) });
    const fire = s.entity<StationEntity>(0, 65, -2)!;
    fire.keepLit = true;
    fire.burnTicksLeft = 0;
    fire.slots[fuelSlotOf(def)] = { item: 'item:broadleaf_log', count: 50 };
    fire.tick = s.sim.tick - 50_000;
    s.step(1);
    // 36 000 ticks burn 30 logs of 40 s.
    expect(fire.slots[fuelSlotOf(def)]).toEqual({ item: 'item:broadleaf_log', count: 20 });
    expect(fire.burnTicksLeft).toBe(0);
    expect(fire.tick).toBe(s.sim.tick);
  });

  it('sends charcoal to the bloomery fuel and bog iron to its input on Shift+click, not logs', () => {
    const s = setup();
    s.put(0, 65, -2, 'block:bloomery[facing4=s,lit=0]');
    s.give('item:broadleaf_log', 4);
    s.give('item:charcoal', 1);
    s.give('item:bog_iron', 2);
    s.send(open(0, 65, -2));
    const def = registry.crafting.station('station:bloomery')!;
    const bloomery = s.entity<StationEntity>(0, 65, -2)!;
    // Its fire burns charcoal only and no process uses logs: they stay in the bag.
    expect(rejections(s.send({ type: 'station.move', from: 0 }))).toEqual(['slot']);
    expect(s.player.inventory[0]).toEqual({ item: 'item:broadleaf_log', count: 4 });
    expect(rejections(s.send({ type: 'station.move', from: 0, to: 32 + fuelSlotOf(def) }))).toEqual(
      ['slot'],
    );
    s.send({ type: 'station.move', from: 1 }, { type: 'station.move', from: 2 });
    expect(bloomery.slots[fuelSlotOf(def)]).toBeNull(); // lit at once
    expect(bloomery).toMatchObject({ lit: true, process: 'process:iron_ingot' });
    expect(bloomery.slots[0]).toEqual({ item: 'item:bog_iron', count: 2 });
    s.step(ticksOf(20));
    expect(bloomery.slots[outputSlotOf(def)]).toEqual({ item: 'item:iron_ingot', count: 1 });
  });

  it('sends logs on to the kiln inputs once its fuel slot holds another fuel', () => {
    const s = kiln(0, 5);
    s.give('item:charcoal', 3);
    const charcoal = s.player.inventory.findIndex((stack) => stack?.item === 'item:charcoal');
    const logs = s.player.inventory.findIndex((stack) => stack?.item === 'item:broadleaf_log');
    s.send({ type: 'station.move', from: charcoal });
    expect(s.kiln.slots[fuelSlotOf(s.def)]?.item).toBe('item:charcoal');
    s.send({ type: 'station.move', from: logs });
    // Logs both burn and feed (charcoal): with the fuel slot taken they go to an input.
    const inputs = s.kiln.slots.slice(0, s.def.inputSlots);
    const inStation = inputs.reduce(
      (n, stack) => n + (stack?.item === 'item:broadleaf_log' ? stack.count : 0),
      0,
    );
    const inBag = s.player.inventory.reduce(
      (n, stack) => n + (stack?.item === 'item:broadleaf_log' ? stack.count : 0),
      0,
    );
    expect(inStation).toBe(5);
    expect(inBag).toBe(0);
  });

  it('sends fuel and ingredients across: a log to the kiln fuel, then to its inputs', () => {
    const s = kiln(1, 3);
    // Copper ore is no fuel: it goes to an input; the logs fill the fuel slot first.
    s.send({ type: 'station.move', from: 1 }, { type: 'station.move', from: 0 });
    expect(s.kiln.slots.slice(0, 3)).toEqual([
      { item: 'item:copper_ore', count: 1 },
      null,
      { item: 'item:broadleaf_log', count: 2 },
    ]);
    // A stick burns but no kiln process uses it: once the fuel slot holds logs, it stays.
    s.give('item:stick', 2);
    expect(rejections(s.send({ type: 'station.move', from: 0 }))).toEqual(['nothing to move']);
    expect(s.player.inventory[0]).toEqual({ item: 'item:stick', count: 2 });
  });

  it('keeps an open campfire burning on its toggle, lit and warm, and refuses it elsewhere', () => {
    const s = setup();
    s.put(0, 65, -2, 'block:campfire[lit=0]');
    s.give('item:broadleaf_log', 2);
    const keep: Command = { type: 'station.keepLit' };
    // Nothing open: refused.
    expect(rejections(s.send(keep))).toEqual(['not open']);
    const def = registry.crafting.station('station:campfire')!;
    s.send(open(0, 65, -2), { type: 'station.move', from: 0, to: 32 + fuelSlotOf(def) });
    const fire = s.entity<StationEntity>(0, 65, -2)!;
    // Fuel alone: no recipe runs, nothing burns.
    s.step(30);
    expect(fire).toMatchObject({ lit: false, keepLit: false, burnTicksLeft: 0 });
    expect(s.block(0, 65, -2)).toBe('block:campfire[lit=0]');
    expect(rejections(s.send(keep))).toEqual([]);
    s.step(1);
    expect(fire).toMatchObject({ lit: true, keepLit: true });
    expect(s.block(0, 65, -2)).toBe('block:campfire[lit=1]');
    expect(blockOf(s.host.view.world.getLight(0, 65, -1))).toBeGreaterThan(0);
    // It stays on once the screen is closed, and goes out when turned off again.
    s.send({ type: 'container.close' });
    s.step(30);
    expect(fire.lit).toBe(true);
    expect(rejections(s.send(keep))).toEqual(['not open']);
    s.send(open(0, 65, -2), keep);
    s.step(1);
    expect(fire).toMatchObject({ lit: false, keepLit: false });
    expect(s.block(0, 65, -2)).toBe('block:campfire[lit=0]');
    // Two quick clicks (both in one tick) turn it on and off again.
    s.send(keep, keep);
    s.step(1);
    expect(fire).toMatchObject({ lit: false, keepLit: false });
    // A kiln's fire only burns for its processes: no toggle.
    s.put(2, 65, -2, 'block:kiln[facing4=s,lit=0]');
    s.send(open(2, 65, -2));
    expect(rejections(s.send(keep))).toEqual(['invalid']);
    expect(s.entity<StationEntity>(2, 65, -2)!.keepLit).toBe(false);
  });
});
