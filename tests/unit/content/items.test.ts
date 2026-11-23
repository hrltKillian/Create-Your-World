import { describe, expect, it } from 'vitest';
import { BLOCK_STACK, fitsTool, harvests } from '../../../src/content/items.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import type { BlockKey, ContentPack } from '../../../src/content/schema.ts';
import { validatePack } from '../../../src/content/validate.ts';
import { registry } from '../../helpers/registry.ts';

const items = registry.itemTables;
const id = (key: string) => registry.itemId(key);

function broken(mutate: (pack: Record<string, Record<string, unknown>[]>) => void): ContentPack {
  const pack = JSON.parse(JSON.stringify(basePack));
  mutate(pack);
  return pack as ContentPack;
}

describe('items', () => {
  it('gives every placeable block an implicit item that places it, whatever it drops', () => {
    const { air, unknownBlock } = basePack.manifest.bindings;
    for (const block of basePack.blocks) {
      const item = id(`item:${block.key.slice('block:'.length)}`);
      const unplaceable =
        block.key === air ||
        block.key === unknownBlock ||
        block.shape === 'liquid' ||
        block.hardness < 0;
      if (unplaceable) {
        // No item places it (`item:unknown` is the pack's unknown item, not the unknown block's).
        expect(item < 0 ? -1 : items.places[item], block.key).toBe(-1);
        continue;
      }
      expect(registry.items[item]!.icon).toEqual({ block: block.key });
      expect(registry.items[item]!.nameKey).toBe(block.nameKey);
      expect(items.maxStack[item]).toBe(BLOCK_STACK);
      expect(items.places[item]).toBe(registry.defaultState(block.key));
      expect(registry.items[item]!.tool).toBeUndefined();
    }
    // Glass drops nothing and grass drops dirt (loot), yet both can be placed from their item.
    expect(items.places[id('item:glass')]).toBe(registry.defaultState('block:glass'));
    expect(items.places[id('item:grass')]).toBe(registry.defaultState('block:grass'));
    for (const key of ['item:air', 'item:worldrock', 'item:fresh_water'])
      expect(id(key), key).toBe(-1);
    expect(id(registry.unknownItem)).toBeGreaterThanOrEqual(0);
    expect(items.maxStack[id(registry.unknownItem)]).toBe(BLOCK_STACK);
    // Self-dropping blocks keep their item.
    for (const key of ['item:dirt', 'item:stone', 'item:torch', 'item:gate'])
      expect(id(key), key).toBeGreaterThanOrEqual(0);
  });

  it('defines the flint tools, which place nothing and never stack', () => {
    const hatchet = id('item:flint_hatchet');
    const pickaxe = id('item:flint_pickaxe');
    expect(registry.items[hatchet]!.tool).toMatchObject({ kind: 'axe', tier: 1 });
    expect(registry.items[pickaxe]!.tool).toMatchObject({ kind: 'pick', tier: 1 });
    for (const tool of [hatchet, pickaxe]) {
      expect(items.toolSpeed[tool]).toBe(2);
      expect(items.durability[tool]).toBe(60);
    }
    for (const key of ['item:flint_knife', 'item:flint_hatchet', 'item:flint_spear']) {
      expect(items.maxStack[id(key)], key).toBe(1);
      expect(items.places[id(key)], key).toBe(-1);
    }
    expect(registry.maxStack('item:nope')).toBe(1);
  });

  it('fits a tool to the blocks of its kind only, which it harvests up to its tier', () => {
    const block = (key: BlockKey) => registry.blockDef(registry.defaultState(key));
    const hatchet = registry.items[id('item:flint_hatchet')]!.tool;
    const pickaxe = registry.items[id('item:flint_pickaxe')]!.tool;
    const log = block('block:broadleaf_log');
    const stone = block('block:stone');
    const dirt = block('block:dirt');
    expect([hatchet, pickaxe, undefined].map((tool) => fitsTool(log, tool))).toEqual([
      true,
      false,
      false,
    ]);
    // Dirt wants no tool: nothing fits it, and the hand harvests it.
    expect([fitsTool(dirt, hatchet), harvests(dirt, undefined)]).toEqual([false, true]);
    expect([undefined, hatchet, pickaxe].map((tool) => harvests(stone, tool))).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('names every tier and binds a sound to every material', () => {
    expect(basePack.tiers!.map((t) => t.tier)).toEqual([0, 1, 2, 3, 4]);
    const dirt = registry.defaultState('block:dirt');
    expect(registry.blockSfx(dirt, 'break')).toBe('sfx:break_soil');
    expect(registry.loot('loot:grass')?.entries[0]?.item).toBe('item:dirt');
  });
});

describe('item validation', () => {
  it('reports bad items, tools, loot and masks with exact paths', () => {
    const pack = broken((p) => {
      const knife = p.items!.find((i) => i.key === 'item:flint_knife')!;
      knife.icon = 'tex:missing';
      const hatchet = p.items!.find((i) => i.key === 'item:flint_hatchet')!;
      hatchet.maxStack = 4;
      p.items!.push({ key: 'item:dirt', nameKey: 'block.dirt', icon: 'tex:dirt', maxStack: 9 });
      p.loot![0]!.entries = [{ item: 'item:nope', count: [2, 1], weight: 0 }];
      p.blocks!.find((b) => b.key === 'block:sand')!.drops = 'loot:missing';
      p.blocks!.find((b) => b.key === 'block:fresh_water')!.drops = 'self';
      (p as unknown as { toolNames: Record<string, string> }).toolNames.pick = 'tool.nope';
      const icon = p.textures!.find((t) => t.key === 'tex:icon_flint_spear')!;
      icon.mask = ['..x.', '...'];
    });
    const paths = validatePack(pack).map((i) => i.path);
    const knife = basePack.items!.findIndex((i) => i.key === 'item:flint_knife');
    const hatchet = basePack.items!.findIndex((i) => i.key === 'item:flint_hatchet');
    const sand = basePack.blocks.findIndex((b) => b.key === 'block:sand');
    const water = basePack.blocks.findIndex((b) => b.key === 'block:fresh_water');
    const spear = basePack.textures.findIndex((t) => t.key === 'tex:icon_flint_spear');
    expect(paths).toContain(`items[${knife}].icon`);
    expect(paths).toContain(`items[${hatchet}].maxStack`);
    expect(paths).toContain(`items[${basePack.items!.length}].key`);
    expect(paths).toContain('loot[0].entries[0].item');
    expect(paths).toContain('loot[0].entries[0].count');
    expect(paths).toContain('loot[0].entries[0].weight');
    expect(paths).toContain(`blocks[${sand}].drops`);
    expect(paths).toContain(`blocks[${water}].drops`); // a liquid has no item to drop
    expect(paths).toContain('toolNames.pick');
    expect(paths).toContain(`textures[${spear}].mask[0]`);
    expect(paths).toContain(`textures[${spear}].mask[1]`);
  });

  it('checks the unknown item binding', () => {
    const pack = broken((p) => {
      (p.manifest as unknown as { bindings: { unknownItem: string } }).bindings.unknownItem =
        'item:nope';
    });
    expect(validatePack(pack).map((i) => i.path)).toEqual(['manifest.bindings.unknownItem']);
  });

  it('checks the arena blocks', () => {
    const pack = broken((p) => {
      (p.arena as unknown as { oreWall: string[] }).oreWall = ['block:nope'];
    });
    expect(validatePack(pack).map((i) => i.path)).toEqual(['arena.oreWall[0]']);
  });
});
