import { toolBreakSeconds } from '../content/items.ts';
import type { Registry } from '../content/registry.ts';
import type { BlockDef, ItemDef, ToolDef } from '../content/schema.ts';
import { t } from '../i18n/i18n.ts';

/*
 * An item's description (plan v3 « M18 »), written from its data: what a tool mines and how fast
 * on its favourite block, a weapon's blow, what a wearable protects from, what a food or a drink
 * gives, a fuel's time and the uses left of a fresh one. Shown under the hovered slot and with a
 * Logbook recipe. Pure.
 */

/** One decimal at most (« 0.9 », « 2 »). */
const short = (n: number) => String(Math.round(n * 10) / 10);

/** The block a tool kind is made for: the first breakable block of the pack wanting it. */
function favouriteBlock(registry: Registry, tool: ToolDef): BlockDef | undefined {
  return registry.blocks.find((block) => block.tool === tool.kind && block.hardness > 0);
}

function toolLines(registry: Registry, tool: ToolDef): string[] {
  const kind = registry.pack.toolNames?.[tool.kind];
  const tier = registry.pack.tiers?.find((def) => def.tier === tool.tier)?.nameKey;
  const lines = [
    t('info.tool', { tier: tier ? t(tier) : tool.tier, tool: kind ? t(kind) : tool.kind }),
  ];
  const block = favouriteBlock(registry, tool);
  if (block)
    lines.push(
      t('info.mines', { block: t(block.nameKey), seconds: short(toolBreakSeconds(block, tool)) }),
    );
  return lines;
}

/** Every line describing an item (none for an unknown key or a tag). */
export function itemLines(registry: Registry, key: string): string[] {
  const item: ItemDef | undefined = registry.item(key);
  if (!item) return [];
  const lines: string[] = [];
  if (item.tool) lines.push(...toolLines(registry, item.tool));
  const weapon = item.weapon;
  if (weapon)
    lines.push(
      t('info.weapon', {
        damage: short(weapon.damage),
        cooldown: short(weapon.cooldown),
        reach: short(weapon.reach),
      }),
    );
  const wear = item.wear;
  if (wear) {
    if (wear.armor) lines.push(t('info.armor', { n: wear.armor }));
    if (wear.warmth) lines.push(t('info.warmth', { n: wear.warmth }));
    if (wear.cooling) lines.push(t('info.cooling', { n: wear.cooling }));
    if (wear.airFilter !== undefined)
      lines.push(t('info.filter', { n: Math.round((1 - wear.airFilter) * 100) }));
    if (wear.waterproof) lines.push(t('info.waterproof'));
    if (wear.scanner)
      lines.push(t('info.scanner', { seconds: wear.scanner.seconds, range: wear.scanner.range }));
  }
  const food = item.consume;
  if (food) {
    for (const gauge of ['hunger', 'thirst', 'health'] as const)
      if (food[gauge]) lines.push(t(`info.${gauge}`, { n: food[gauge]! }));
    if (food.toxicity)
      lines.push(
        t('info.toxicity', { n: food.toxicity > 0 ? `+${food.toxicity}` : food.toxicity }),
      );
  }
  if (item.container) lines.push(t('info.charges', { n: item.container.charges }));
  if (item.fuel) lines.push(t('info.fuel', { seconds: item.fuel.seconds }));
  const uses = item.tool?.durability ?? weapon?.durability ?? wear?.durability;
  if (uses) lines.push(t('info.durability', { n: uses }));
  return lines;
}
