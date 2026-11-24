import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { clampPitch } from '../../../src/core/angles.ts';
import { en } from '../../../src/i18n/en.ts';
import type { ClientTarget, InputCommand } from '../../../src/sim/commands.ts';
import { countItem } from '../../../src/sim/inventory.ts';
import { breakSeconds, canHarvest, TOOL_TOO_WEAK_HINT } from '../../../src/sim/mining.ts';
import { eyeHeight } from '../../../src/sim/physics.ts';
import { type Placement, planPlacement } from '../../../src/sim/placement.ts';
import { WORLD_HEIGHT } from '../../../src/world/coords.ts';
import type { WorldType } from '../../../src/world/gen/generateColumn.ts';
import { createRayHit } from '../../../src/world/raycast.ts';
import { registry } from '../../helpers/registry.ts';
import { eventsOf, playerTestSim, rejections } from '../../helpers/simHarness.ts';

/** A flat world (grass at y 64) with the player standing at (0.5, 65, 0.5), looking north. */
function setup(worldType: WorldType = 'flat') {
  return playerTestSim({ seed: 'mine', worldType });
}

/** Places a creature on the ground, idle for a while. */
function spawnAt(s: ReturnType<typeof setup>, creature: string, x: number, z: number): void {
  const before = s.sim.nextEntityId;
  expect(rejections(s.send({ type: 'debug.spawn', creature, x, y: 'surface', z }))).toEqual([]);
  const c = s.sim.entities.get(before);
  if (c?.kind !== 'creature') throw new Error('no creature placed');
  c.modeTicks = 600;
}

/** Holds primary on a block until it breaks; returns the ticks it took. */
function ticksToBreak(s: ReturnType<typeof setup>, input: Partial<InputCommand> = {}): number {
  s.events.length = 0;
  for (let tick = 1; tick <= 400; tick++) {
    s.tick(1, { primary: true, ...input });
    if (eventsOf(s.events, 'blockBroken').length > 0) return tick;
  }
  return Number.POSITIVE_INFINITY;
}

describe('mining', () => {
  it('breaks dirt in 0.75 s by hand and picks up its item', () => {
    const s = setup();
    s.put(0, 66, -1, 'block:dirt');
    expect(ticksToBreak(s)).toBe(Math.ceil(0.75 * 30));
    expect(s.block(0, 66, -1)).toBe('block:air');
    expect(countItem(s.player.inventory, 'item:dirt')).toBe(1);
    const events = s.events.map((e) => e.type);
    expect(events).toContain('itemPickedUp');
    expect(events).toContain('inventoryChanged');
    expect(eventsOf(s.events, 'sound').map((e) => e.sfx)).toContain('sfx:break_soil');
    expect(eventsOf(s.events, 'mineProgress').at(-1)?.stage).toBe(-1);
  });

  it('breaks a log in 3 s by hand and 1.5 s with the flint hatchet, which wears', () => {
    const s = setup();
    s.put(0, 66, -1, 'block:broadleaf_log[axis=y]');
    expect(ticksToBreak(s)).toBe(3 * 30);
    // The log went to slot 0: the hatchet goes to slot 1.
    s.give('item:flint_hatchet');
    s.put(0, 66, -1, 'block:broadleaf_log[axis=y]');
    expect(ticksToBreak(s, { slot: 1 })).toBe(1.5 * 30);
    expect(s.player.inventory[1]).toEqual({ item: 'item:flint_hatchet', count: 1, durability: 59 });
  });

  it('gives nothing for stone by hand, and stone with a flint pickaxe', () => {
    const s = setup();
    const stone = registry.defaultState('block:stone');
    expect(canHarvest(registry, stone, -1)).toBe(false);
    expect(breakSeconds(registry, stone, -1, false)).toBeCloseTo(1.5 * 1.5 * 3.3, 9);
    s.put(0, 66, -1, 'block:stone');
    expect(ticksToBreak(s)).toBe(Math.ceil(1.5 * 1.5 * 3.3 * 30));
    s.tick(5); // primary released: the next stone starts with ticksToBreak
    expect([...s.sim.entities.values()].filter((e) => e.kind === 'itemDrop')).toHaveLength(0);
    expect(countItem(s.player.inventory, 'item:stone')).toBe(0);
    s.give('item:flint_pickaxe');
    s.put(0, 66, -1, 'block:stone');
    expect(ticksToBreak(s)).toBe(Math.ceil(((1.5 * 1.5) / 2) * 30));
    expect(countItem(s.player.inventory, 'item:stone')).toBe(1);
  });

  it('hints once per target that the tool is too weak, naming the tier and tool kind', () => {
    const s = setup();
    s.put(0, 66, -1, 'block:stone');
    s.put(1, 66, -1, 'block:darkstone');
    s.tick(Math.ceil(1.5 * 1.5 * 3.3 * 30), { primary: true }); // the stone breaks by hand
    expect(s.block(0, 66, -1)).toBe('block:air');
    const hint = { type: 'hint', playerId: 1, key: TOOL_TOO_WEAK_HINT };
    expect(eventsOf(s.events, 'hint')).toEqual([
      { ...hint, params: { tier: 'tier.flint', tool: 'tool.pick' } },
    ]);
    expect(en[TOOL_TOO_WEAK_HINT]).toBe('Tool too weak: {tier} {tool} required');
    expect([basePack.strings['tier.flint'], basePack.strings['tool.pick']]).toEqual([
      'Flint',
      'pickaxe',
    ]);
    // Another target, mined with a flint pickaxe: darkstone needs bronze; stone does not hint.
    s.give('item:flint_pickaxe');
    s.events.length = 0;
    s.tick(10, { primary: true, yaw: -1 });
    expect(eventsOf(s.events, 'hint')).toEqual([
      { ...hint, params: { tier: 'tier.bronze', tool: 'tool.pick' } },
    ]);
    s.tick(1, { primary: false });
    s.put(0, 66, -1, 'block:stone');
    s.tick(10, { primary: true });
    expect(eventsOf(s.events, 'hint')).toEqual([]);
    s.put(0, 66, -1, 'block:dirt');
    s.tick(1, { primary: false, slot: 1 });
    s.tick(10, { primary: true, slot: 1 }); // dirt by hand: no minimum tier
    expect(eventsOf(s.events, 'hint')).toEqual([]);
  });

  it('wears a tool twice as fast on the wrong block and slows down when exhausted', () => {
    const s = setup();
    const dirt = registry.defaultState('block:dirt');
    const pickaxe = registry.itemId('item:flint_pickaxe');
    expect(breakSeconds(registry, dirt, pickaxe, true)).toBeCloseTo(0.75 / 0.6, 9);
    s.give('item:flint_pickaxe');
    s.put(0, 66, -1, 'block:dirt');
    ticksToBreak(s);
    expect(s.player.inventory[0]?.durability).toBe(58);
  });

  it('starts over when the target changes and spends stamina', () => {
    const s = setup();
    s.put(0, 66, -1, 'block:dirt');
    s.put(1, 66, -1, 'block:dirt');
    s.tick(15, { primary: true });
    expect(s.player.stamina).toBeLessThan(100);
    s.events.length = 0;
    // Aim at the other block (to the north-east): mining restarts there.
    s.tick(1, { primary: true, yaw: -1 });
    expect(eventsOf(s.events, 'mineProgress').map((e) => [e.x, e.stage])).toEqual([
      [0, -1],
      [1, 0],
    ]);
    expect(s.player.interaction.mineProgress).toBeCloseTo(1 / 22.5, 9);
    s.tick(1, { primary: false });
    expect(eventsOf(s.events, 'mineProgress').at(-1)?.stage).toBe(-1);
  });

  it('digs the grass under the feet in 60 ticks: one dirt, air below (M4 flat-world check)', () => {
    const s = setup();
    s.tick(60, { primary: true, pitch: clampPitch(-Math.PI / 2) });
    expect(s.block(0, 64, 0)).toBe('block:air');
    expect(s.block(0, 63, 0)).toBe('block:dirt');
    expect(countItem(s.player.inventory, 'item:dirt')).toBe(1);
  });

  it('pops the torch standing on a broken block', () => {
    const s = setup();
    s.put(0, 66, -1, 'block:dirt');
    s.put(0, 67, -1, 'block:torch');
    ticksToBreak(s);
    expect(s.block(0, 67, -1)).toBe('block:air');
    expect(countItem(s.player.inventory, 'item:torch')).toBe(1);
  });
});

describe('placement', () => {
  const ground: ClientTarget = { x: 0, y: 64, z: -2, face: 2 };

  it('places the held block on the aimed face, with sound and events', () => {
    const s = setup();
    s.give('item:dirt', 5);
    s.tick(1, { secondary: true, target: ground });
    expect(s.block(0, 65, -2)).toBe('block:dirt');
    expect(eventsOf(s.events, 'blockPlaced')).toHaveLength(1);
    expect(eventsOf(s.events, 'sound').map((e) => e.sfx)).toContain('sfx:place_soil');
    expect(countItem(s.player.inventory, 'item:dirt')).toBe(4);
    expect(s.sim.world.getColumn(0, -1)!.heightmap[0 | (30 << 5)]).toBe(66);
  });

  it('refuses occupied cells, out-of-reach targets and unsupported blocks', () => {
    const s = setup();
    s.give('item:dirt', 5);
    s.give('item:torch');
    // Looking down in front: the first block goes in, the next would be inside the player.
    s.tick(7, { secondary: true, pitch: -Math.PI / 3 });
    expect(eventsOf(s.events, 'blockPlaced')).toHaveLength(1);
    expect(rejections(s.events)).toEqual(['occupied']);
    s.events.length = 0;
    s.tick(1, { secondary: false });
    s.tick(1, { secondary: true, target: { x: 0, y: 64, z: -10, face: 2 } });
    expect(rejections(s.events)).toEqual(['reach']);
    s.events.length = 0;
    s.put(0, 66, -3, 'block:stone');
    s.tick(1, { secondary: false, slot: 1 });
    s.tick(1, { secondary: true, slot: 1, target: { x: 0, y: 66, z: -3, face: 4 } });
    expect(rejections(s.events)).toEqual(['support']);
    expect(s.block(0, 66, -2)).toBe('block:air');
  });

  it('repeats every 6 ticks while held', () => {
    const s = setup();
    s.give('item:dirt', 5);
    s.tick(13, { secondary: true, pitch: -Math.PI / 3 });
    // Placed at tick 1; tries again at ticks 7 and 13 (the cell is now inside the player).
    expect(eventsOf(s.events, 'blockPlaced')).toHaveLength(1);
    expect(rejections(s.events)).toEqual(['occupied', 'occupied']);
  });

  it('orients logs along the face and gates towards the player', () => {
    const s = setup();
    s.give('item:broadleaf_log');
    s.give('item:gate');
    s.put(0, 66, -3, 'block:stone');
    s.tick(1, { secondary: true, target: { x: 0, y: 66, z: -3, face: 4 } });
    expect(s.block(0, 66, -2)).toBe('block:broadleaf_log[axis=z]');
    s.tick(1, { secondary: false, slot: 1 });
    s.tick(1, { secondary: true, slot: 1, target: { x: 1, y: 64, z: -2, face: 2 } });
    expect(s.block(1, 65, -2)).toBe('block:gate[facing4=s,open=0,half=lower]');
    expect(s.block(1, 66, -2)).toBe('block:gate[facing4=s,open=0,half=upper]');
  });

  it('toggles a gate on the press only, and places against it when crouching', () => {
    const s = setup();
    s.give('item:dirt', 5);
    s.put(0, 65, -2, 'block:gate[facing4=s,open=0,half=lower]');
    const gate: ClientTarget = { x: 0, y: 65, z: -2, face: 4 };
    s.events.length = 0;
    s.tick(13, { secondary: true, target: gate });
    expect(s.block(0, 65, -2)).toBe('block:gate[facing4=s,open=1,half=lower]');
    s.tick(1, { secondary: false, target: gate });
    s.tick(1, { secondary: true, target: gate });
    expect(s.block(0, 65, -2)).toBe('block:gate[facing4=s,open=0,half=lower]');
    // The pack's door sounds, not the place sound.
    const door = basePack.sounds!.door;
    expect(eventsOf(s.events, 'sound').map((e) => e.sfx)).toEqual([door.open, door.close]);
    expect(countItem(s.player.inventory, 'item:dirt')).toBe(5);
    s.tick(1, { secondary: false, target: gate });
    s.tick(1, { secondary: true, crouch: true, target: gate });
    expect(s.block(0, 65, -1)).toBe('block:dirt');
  });

  it('never places a plant into the same plant: held 30 ticks, it uses nothing', () => {
    const s = setup();
    s.give('item:tall_grass', 5);
    s.put(0, 65, -2, 'block:tall_grass');
    // The top of the plant: the cell above has no solid support, so nothing can go anywhere.
    s.tick(30, { secondary: true, target: { x: 0, y: 65, z: -2, face: 2 } });
    expect(eventsOf(s.events, 'blockPlaced')).toHaveLength(0);
    expect(rejections(s.events)).toEqual(Array(5).fill('support'));
    expect(countItem(s.player.inventory, 'item:tall_grass')).toBe(5);
    // Its side: a new plant in front of it, once; the plant itself is never replaced.
    s.events.length = 0;
    s.tick(1, { secondary: false });
    s.tick(30, { secondary: true, target: { x: 0, y: 65, z: -2, face: 4 } });
    const placed = eventsOf(s.events, 'blockPlaced');
    expect(placed.map((e) => [e.x, e.y, e.z])).not.toContainEqual([0, 65, -2]);
    expect(new Set(placed.map((e) => `${e.x},${e.y},${e.z}`)).size).toBe(placed.length);
    expect(placed.length).toBeGreaterThan(0);
    expect(countItem(s.player.inventory, 'item:tall_grass')).toBe(5 - placed.length);
  });

  it('refuses a block in a creature and closing a gate on one', () => {
    const s = setup();
    s.give('item:dirt', 5);
    spawnAt(s, 'creature:trotter', 0.5, -2.5);
    s.tick(1, { secondary: true, target: { x: 0, y: 64, z: -3, face: 2 } });
    expect(rejections(s.events)).toEqual(['occupied']);
    expect(s.block(0, 65, -3)).toBe('block:air');
    spawnAt(s, 'creature:trotter', 2.5, -2.5);
    s.put(2, 65, -3, 'block:gate[facing4=s,open=1,half=lower]');
    s.put(2, 66, -3, 'block:gate[facing4=s,open=1,half=upper]');
    s.events.length = 0;
    s.tick(1, { secondary: false });
    s.tick(1, { secondary: true, target: { x: 2, y: 65, z: -3, face: 4 } });
    expect(rejections(s.events)).toEqual(['occupied']);
    expect(s.block(2, 65, -3)).toBe('block:gate[facing4=s,open=1,half=lower]');
  });

  it('secondary uses no block behind a creature in reach (creatures are tested first)', () => {
    const run = (withTrotter: boolean) => {
      const s = setup();
      s.give('item:dirt', 5);
      if (withTrotter) spawnAt(s, 'creature:trotter', 0.5, -1.5);
      const eye = 65 + eyeHeight(s.player.body);
      s.events.length = 0;
      s.tick(1, { secondary: true, pitch: Math.atan2(65.65 - eye, 2) });
      return eventsOf(s.events, 'blockPlaced').length;
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(0);
  });

  it('secondary still uses or replaces a non-solid block in front of a creature', () => {
    const s = setup();
    s.give('item:dirt', 5);
    // An open gate, a Trotter just behind it (outside the gate's cell): the press closes the gate.
    s.put(0, 65, -2, 'block:gate[facing4=s,open=1,half=lower]');
    s.put(0, 66, -2, 'block:gate[facing4=s,open=1,half=upper]');
    spawnAt(s, 'creature:trotter', 0.5, -2.5);
    // The view goes through the gate's cell into the Trotter's body, within the hand's reach.
    const pitch = Math.atan2(65.5 - (65 + eyeHeight(s.player.body)), 2.8);
    s.tick(1, { secondary: true, pitch, target: { x: 0, y: 65, z: -2, face: 4 } });
    expect(rejections(s.events)).toEqual([]);
    expect(s.block(0, 65, -2)).toBe('block:gate[facing4=s,open=0,half=lower]');
    // Tall grass in front of a Trotter: the held block replaces the grass.
    const t = setup();
    t.give('item:dirt', 5);
    t.put(0, 65, -2, 'block:tall_grass');
    spawnAt(t, 'creature:trotter', 0.5, -2.5);
    t.tick(1, { secondary: true, pitch, target: { x: 0, y: 65, z: -2, face: 4 } });
    expect(t.block(0, 65, -2)).toBe('block:dirt');
  });

  it('falls back to its own ray when the client target is hidden', () => {
    const s = setup();
    s.give('item:dirt', 5);
    s.put(0, 66, -1, 'block:stone');
    // The target behind the stone is not in line of sight: the stone in view is used instead.
    s.tick(1, { secondary: true, target: { x: 0, y: 66, z: -3, face: 4 } });
    expect(s.block(0, 66, 0)).toBe('block:air'); // would be inside the player: refused
    expect(rejections(s.events)).toEqual(['occupied']);
  });
});

describe('doors (two-block gates)', () => {
  const door = (open: 0 | 1, half: 'lower' | 'upper') =>
    `block:gate[facing4=s,open=${open},half=${half}]`;
  const lower: ClientTarget = { x: 0, y: 65, z: -2, face: 4 };
  const upper: ClientTarget = { x: 0, y: 66, z: -2, face: 4 };
  /** Items lying on the ground (the door is 2 m away: out of the pickup magnet). */
  const lying = (s: ReturnType<typeof setup>) =>
    [...s.sim.entities.values()].flatMap((e) => (e.kind === 'itemDrop' ? [[e.item, e.count]] : []));
  /** One press of secondary on a target. */
  const use = (s: ReturnType<typeof setup>, target: ClientTarget) => {
    s.tick(1, { secondary: false, target });
    s.tick(1, { secondary: true, target });
  };

  it('places both halves, toggles both from either one and breaks whole for one item', () => {
    const s = setup();
    s.give('item:gate', 2);
    s.tick(1, { secondary: true, target: { x: 0, y: 64, z: -2, face: 2 } });
    expect([s.block(0, 65, -2), s.block(0, 66, -2)]).toEqual([door(0, 'lower'), door(0, 'upper')]);
    expect(countItem(s.player.inventory, 'item:gate')).toBe(1);
    use(s, upper);
    expect([s.block(0, 65, -2), s.block(0, 66, -2)]).toEqual([door(1, 'lower'), door(1, 'upper')]);
    use(s, lower);
    expect([s.block(0, 65, -2), s.block(0, 66, -2)]).toEqual([door(0, 'lower'), door(0, 'upper')]);
    ticksToBreak(s, { target: lower, slot: 1 });
    expect([s.block(0, 65, -2), s.block(0, 66, -2)]).toEqual(['block:air', 'block:air']);
    expect(eventsOf(s.events, 'blockBroken')).toHaveLength(2);
    expect(lying(s)).toEqual([['item:gate', 1]]);
  });

  it('refuses a door whose upper cell is taken or above the world', () => {
    const s = setup();
    s.give('item:gate');
    s.put(0, 66, -2, 'block:stone');
    s.tick(1, { secondary: true, target: { x: 0, y: 64, z: -2, face: 2 } });
    expect(rejections(s.events)).toEqual(['occupied']);
    expect(s.block(0, 65, -2)).toBe('block:air');
    const top = WORLD_HEIGHT - 2;
    s.put(0, top, -2, 'block:stone');
    s.step(1);
    const hit = { ...createRayHit(), hit: true, x: 0, y: top, z: -2, ny: 1 };
    hit.state = s.sim.world.getBlock(0, top, -2);
    const out: Placement = { x: 0, y: 0, z: 0, state: 0, upper: -1 };
    const gate = registry.defaultState('block:gate');
    const plan = (state: number) =>
      planPlacement(s.sim.world, registry, new Map(), s.player, hit, state, out);
    expect(plan(gate)).toBe('occupied');
    expect(plan(registry.defaultState('block:planks'))).toBeNull(); // a one-cell block fits
    expect(out.upper).toBe(-1);
  });

  it('pops whole, for one item, when the block under it breaks', () => {
    const s = setup();
    s.put(0, 65, -2, 'block:dirt');
    s.give('item:gate');
    s.tick(1, { secondary: true, target: { x: 0, y: 65, z: -2, face: 2 } });
    expect(s.block(0, 67, -2)).toBe('block:gate[facing4=s,open=0,half=upper]');
    ticksToBreak(s, { target: { x: 0, y: 65, z: -2, face: 4 } });
    expect([65, 66, 67].map((y) => s.block(0, y, -2))).toEqual([
      'block:air',
      'block:air',
      'block:air',
    ]);
    expect(lying(s)).toEqual([
      ['item:dirt', 1],
      ['item:gate', 1],
    ]);
  });

  it('opening a gate pops what stood on it (a door whole, for one item)', () => {
    const s = setup();
    s.put(0, 65, -2, door(0, 'lower'));
    s.put(0, 66, -2, door(0, 'upper'));
    s.put(0, 67, -2, door(0, 'lower'));
    s.put(0, 68, -2, door(0, 'upper'));
    s.put(0, 69, -2, 'block:torch');
    use(s, upper);
    expect([65, 66].map((y) => s.block(0, y, -2))).toEqual([door(1, 'lower'), door(1, 'upper')]);
    expect([67, 68, 69].map((y) => s.block(0, y, -2))).toEqual([
      'block:air',
      'block:air',
      'block:air',
    ]);
    expect(lying(s)).toEqual([
      ['item:gate', 1],
      ['item:torch', 1],
    ]);
  });

  it('lets the player walk into the arena cabin once its door is open', () => {
    const s = setup('arena');
    s.host.send({ type: 'debug.teleport', x: 5.5, y: 65, z: -3.5 });
    s.step(5);
    s.tick(20, { forward: 1 });
    expect(s.player.body.z).toBeGreaterThan(-4); // the closed door stops it
    use(s, { x: 5, y: 65, z: -5, face: 4 });
    expect([s.block(5, 65, -5), s.block(5, 66, -5)]).toEqual([door(1, 'lower'), door(1, 'upper')]);
    s.tick(30, { forward: 1 });
    expect(s.player.body.z).toBeLessThan(-6); // inside the cabin (its south wall is at z −5)
  });
});
