import { describe, expect, it } from 'vitest';
import { toolBreakSeconds } from '../../../src/content/items.ts';
import { basePack } from '../../../src/content/packs/base/index.ts';
import { addStrings, i18nMissing } from '../../../src/i18n/i18n.ts';
import { itemLines } from '../../../src/ui/itemInfo.ts';
import { registry } from '../../helpers/registry.ts';

addStrings(basePack.strings);

/*
 * Item descriptions (plan v3 « M18 »): written from the pack's data, the same break time rule as
 * the simulation.
 */

describe('item descriptions', () => {
  it('tells a pickaxe’s tier, its time on stone by the simulation’s rule, and its uses', () => {
    const pick = registry.item('item:flint_pickaxe')!;
    const stone = registry.blockDef(registry.defaultState('block:stone'));
    const seconds = Math.round(toolBreakSeconds(stone, pick.tool) * 10) / 10;
    expect(itemLines(registry, 'item:flint_pickaxe')).toEqual(
      expect.arrayContaining([
        'Flint pickaxe',
        `Stone: ${seconds} s`,
        `${pick.tool!.durability} uses`,
      ]),
    );
  });

  it('tells a weapon’s blow, a wearable’s protection, a food’s worth and a fuel’s time', () => {
    const knife = registry.item('item:flint_knife')!.weapon!;
    expect(itemLines(registry, 'item:flint_knife')).toContain(
      `Damage ${knife.damage} · every ${knife.cooldown} s · reach ${knife.reach} b`,
    );
    expect(itemLines(registry, 'item:fur_hood')).toContain('Warmth +6 °C');
    expect(itemLines(registry, 'item:scanner')).toContain(
      'Studies a creature in 2 s within 24 blocks',
    );
    expect(itemLines(registry, 'item:berries')).toEqual(['Food +6']);
    expect(itemLines(registry, 'item:stick')).toContain('Burns 5 s');
    expect(itemLines(registry, 'tag:log')).toEqual([]);
  });

  it('has a string for every line of every item of the pack', () => {
    for (const item of registry.items) itemLines(registry, item.key);
    expect(i18nMissing()).toEqual([]);
  });
});
