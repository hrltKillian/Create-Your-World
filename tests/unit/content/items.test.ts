import { describe, expect, it } from 'vitest';
import { BLOCK_STACK, TOOL_NONE, toolCode } from '../../../src/content/items.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import type { ContentPack } from '../../../src/content/schema.ts';
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
  it('gives every block that drops itself an implicit item that places it', () => {
    for (const block of basePack.blocks) {
      const item = id(`item:${block.key.slice('block:'.length)}`);
      if (block.drops !== 'self') {
        expect(item, block.key).toBe(-1);
        continue;
      }
      expect(registry.items[item]!.icon).toEqual({ block: block.key });
      expect(registry.items[item]!.nameKey).toBe(block.nameKey);
      expect(items.maxStack[item]).toBe(BLOCK_STACK);
      expect(items.places[item]).toBe(registry.defaultState(block.key));
      expect(items.toolKind[item]).toBe(TOOL_NONE);
    }
    expect(id('item:dirt')).toBeGreaterThanOrEqual(0);
    expect(id('item:grass')).toBe(-1); // grass drops its loot table (dirt)
  });

  it('defines the flint tools, which place nothing and never stack', () => {
    const hatchet = id('item:flint_hatchet');
    const pickaxe = id('item:flint_pickaxe');
    expect(items.toolKind[hatchet]).toBe(toolCode('axe'));
    expect(items.toolKind[pickaxe]).toBe(toolCode('pick'));
    for (const tool of [hatchet, pickaxe]) {
      expect(items.toolTier[tool]).toBe(1);
      expect(items.toolSpeed[tool]).toBe(2);
      expect(items.durability[tool]).toBe(60);
    }
    for (const key of ['item:flint_knife', 'item:flint_hatchet', 'item:flint_spear']) {
      expect(items.maxStack[id(key)], key).toBe(1);
      expect(items.places[id(key)], key).toBe(-1);
    }
    expect(registry.maxStack('item:nope')).toBe(1);
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
      const icon = p.textures!.find((t) => t.key === 'tex:icon_flint_spear')!;
      icon.mask = ['..x.', '...'];
    });
    const paths = validatePack(pack).map((i) => i.path);
    const knife = basePack.items!.findIndex((i) => i.key === 'item:flint_knife');
    const hatchet = basePack.items!.findIndex((i) => i.key === 'item:flint_hatchet');
    const sand = basePack.blocks.findIndex((b) => b.key === 'block:sand');
    const spear = basePack.textures.findIndex((t) => t.key === 'tex:icon_flint_spear');
    expect(paths).toContain(`items[${knife}].icon`);
    expect(paths).toContain(`items[${hatchet}].maxStack`);
    expect(paths).toContain(`items[${basePack.items!.length}].key`);
    expect(paths).toContain('loot[0].entries[0].item');
    expect(paths).toContain('loot[0].entries[0].count');
    expect(paths).toContain('loot[0].entries[0].weight');
    expect(paths).toContain(`blocks[${sand}].drops`);
    expect(paths).toContain(`textures[${spear}].mask[0]`);
    expect(paths).toContain(`textures[${spear}].mask[1]`);
  });

  it('checks the arena blocks', () => {
    const pack = broken((p) => {
      (p.arena as unknown as { oreWall: string[] }).oreWall = ['block:nope'];
    });
    expect(validatePack(pack).map((i) => i.path)).toEqual(['arena.oreWall[0]']);
  });
});
