import { describe, expect, it } from 'vitest';
import { Column } from '../../../src/world/Column.ts';
import { ColumnSlots, slotOf } from '../../../src/world/ColumnSlots.ts';
import { Section } from '../../../src/world/Section.ts';
import { VoxelWorld } from '../../../src/world/VoxelWorld.ts';

describe('section storage', () => {
  it('stays uniform until a different value is written', () => {
    const s = new Section(0);
    s.setBlock(10, 0);
    expect(s.blocks).toBeNull();
    s.setBlock(10, 5);
    expect(s.blocks).not.toBeNull();
    expect(s.getBlock(10)).toBe(5);
    expect(s.getBlock(11)).toBe(0);
    s.setBlock(10, 0);
    s.compact();
    expect(s.blocks).toBeNull();
    expect(s.byteSize()).toBe(0);
  });

  it('promotes blocks and light independently', () => {
    const s = new Section(3, 0xf0);
    s.setLight(7, 0x0e);
    expect(s.light).not.toBeNull();
    expect(s.blocks).toBeNull();
    expect(s.getLight(7)).toBe(0x0e);
    expect(s.getLight(8)).toBe(0xf0);
    expect(s.byteSize()).toBe(32 * 32 * 32);
  });

  it('bumps the version only on real changes', () => {
    const s = new Section(0);
    s.setBlock(0, 1);
    const v = s.version;
    s.setBlock(0, 1);
    expect(s.version).toBe(v);
  });

  it('reads and writes through world coordinates, negatives included', () => {
    const world = new VoxelWorld(0, 9);
    world.setBlock(-1, 70, -33, 4);
    expect(world.getBlock(-1, 70, -33)).toBe(4);
    expect(world.getColumn(-1, -2)).toBeDefined();
    expect(world.getBlock(-1, -1, -33)).toBe(9);
    expect(world.getBlock(500, 70, 500)).toBe(9);
    expect(world.getBlock(0, 300, 0)).toBe(0);
  });
});

describe('column slots', () => {
  it('stores columns by ring slot and checks the key on access', () => {
    const slots = new ColumnSlots();
    const a = new Column(-1, 3);
    slots.set(a);
    expect(slots.get(-1, 3)).toBe(a);
    expect(slots.get(31, 3)).toBeNull();
    expect(slotOf(-1, 3)).toBe(slotOf(31, 3));
    expect(() => slots.set(new Column(31, 3))).toThrow();
    slots.remove(-1, 3);
    expect(slots.get(-1, 3)).toBeNull();
    slots.set(new Column(31, 3));
    expect(slots.at(slotOf(31, 3))?.cx).toBe(31);
  });
});
