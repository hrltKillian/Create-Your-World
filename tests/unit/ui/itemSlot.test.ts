import { describe, expect, it } from 'vitest';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { addStrings } from '../../../src/i18n/i18n.ts';
import { ingredientItem, ingredientName, stackName } from '../../../src/ui/itemSlot.ts';
import { registry } from '../../helpers/registry.ts';

addStrings(basePack.strings);
const art = { registry, icons: [] };

describe('item names and pictures', () => {
  it('names a tag ingredient and pictures it with the first item carrying the tag', () => {
    expect(ingredientName(registry, 'tag:log')).toBe('Any Log');
    const log = ingredientItem(registry, 'tag:log');
    expect(registry.items[log]!.tags).toContain('tag:log');
    expect(ingredientItem(registry, 'item:flint')).toBe(registry.itemId('item:flint'));
    expect(ingredientName(registry, 'item:flint')).toBe('Flint');
  });

  it('names an unknown item with the key it was saved with, and a worn tool with its uses', () => {
    const unknown = { item: 'item:unknown', count: 2, original: 'item:moon_cheese' };
    expect(stackName(art, unknown)).toBe('Unknown Item (item:moon_cheese)');
    const knife = { item: 'item:flint_knife', count: 1, durability: 12 };
    const max = registry.itemTables.durability[registry.itemId('item:flint_knife')]!;
    expect(stackName(art, knife)).toBe(`Flint Knife · 12/${max} uses left`);
  });
});
