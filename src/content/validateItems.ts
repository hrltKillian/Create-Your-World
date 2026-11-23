import { packItems } from './items.ts';
import type { ContentPack } from './schema.ts';

type AddIssue = (path: string, message: string) => void;

const MAX_STACK = 999;
const MAX_DURABILITY = 65_535;

const isCount = (v: number, min: number) => Number.isInteger(v) && v >= min;

/** Items, tool tiers, loot tables (and the block drops naming them) and sound bindings. */
export function validateItems(
  pack: ContentPack,
  blockKeys: ReadonlySet<string>,
  textureKeys: ReadonlySet<string>,
  add: AddIssue,
): void {
  const itemKeys = checkItems(pack, blockKeys, textureKeys, add);
  checkTiers(pack, add);
  const lootKeys = checkLoot(pack, itemKeys, add);
  pack.blocks.forEach((block, i) => {
    if (block.drops.startsWith('loot:') && !lootKeys.has(block.drops))
      add(`blocks[${i}].drops`, `unknown loot table "${block.drops}"`);
  });
  const sounds = pack.sounds;
  if (sounds) {
    const keys: [string, string][] = [['sounds.pickup', sounds.pickup]];
    for (const [material, actions] of Object.entries(sounds.blocks)) {
      for (const [action, key] of Object.entries(actions))
        keys.push([`sounds.blocks.${material}.${action}`, key]);
    }
    for (const [path, key] of keys)
      if (!key.startsWith('sfx:')) add(path, `"${key}" must start with "sfx:"`);
  }
}

/** Pack items (the implicit block items come from valid blocks). Returns every item key. */
function checkItems(
  pack: ContentPack,
  blockKeys: ReadonlySet<string>,
  textureKeys: ReadonlySet<string>,
  add: AddIssue,
): Set<string> {
  const all = packItems(pack);
  const implicit = all.length - (pack.items?.length ?? 0);
  const keys = new Set(all.slice(0, implicit).map((item) => item.key as string));
  (pack.items ?? []).forEach((item, i) => {
    const path = `items[${i}]`;
    if (!item.key.startsWith('item:')) add(`${path}.key`, `"${item.key}" must start with "item:"`);
    if (keys.has(item.key)) add(`${path}.key`, `duplicate item "${item.key}"`);
    keys.add(item.key);
    if (pack.strings[item.nameKey] === undefined)
      add(`${path}.nameKey`, `no string for "${item.nameKey}"`);
    if (typeof item.icon === 'string') {
      if (!textureKeys.has(item.icon)) add(`${path}.icon`, `unknown texture "${item.icon}"`);
    } else if (!blockKeys.has(item.icon.block)) {
      add(`${path}.icon.block`, `unknown block "${item.icon.block}"`);
    }
    if (!isCount(item.maxStack, 1) || item.maxStack > MAX_STACK)
      add(`${path}.maxStack`, `must be an integer 1–${MAX_STACK}`);
    (item.tags ?? []).forEach((tag, t) => {
      if (!tag.startsWith('tag:')) add(`${path}.tags[${t}]`, `"${tag}" must start with "tag:"`);
    });
    const tool = item.tool;
    if (tool) {
      if (!Number.isInteger(tool.tier) || tool.tier < 0 || tool.tier > 4)
        add(`${path}.tool.tier`, 'must be an integer 0–4');
      if (!(tool.speed > 0) || !Number.isFinite(tool.speed))
        add(`${path}.tool.speed`, 'must be > 0');
      if (!isCount(tool.durability, 1) || tool.durability > MAX_DURABILITY)
        add(`${path}.tool.durability`, `must be an integer 1–${MAX_DURABILITY}`);
      // Each tool keeps its own wear, so tools never stack.
      if (item.maxStack !== 1) add(`${path}.maxStack`, 'a tool must have maxStack 1');
    }
  });
  return keys;
}

function checkTiers(pack: ContentPack, add: AddIssue): void {
  const seen = new Set<number>();
  (pack.tiers ?? []).forEach((tier, i) => {
    if (seen.has(tier.tier)) add(`tiers[${i}].tier`, `duplicate tier ${tier.tier}`);
    seen.add(tier.tier);
    if (pack.strings[tier.nameKey] === undefined)
      add(`tiers[${i}].nameKey`, `no string for "${tier.nameKey}"`);
  });
}

/** Loot tables: ranges, weights and item references. Returns the table keys. */
function checkLoot(pack: ContentPack, itemKeys: ReadonlySet<string>, add: AddIssue): Set<string> {
  const keys = new Set<string>();
  (pack.loot ?? []).forEach((table, i) => {
    const path = `loot[${i}]`;
    if (!table.key.startsWith('loot:'))
      add(`${path}.key`, `"${table.key}" must start with "loot:"`);
    if (keys.has(table.key)) add(`${path}.key`, `duplicate loot table "${table.key}"`);
    keys.add(table.key);
    const [min, max] = table.rolls;
    if (!isCount(min, 0) || !isCount(max, min))
      add(`${path}.rolls`, 'must be integers 0 ≤ min ≤ max');
    if (table.entries.length === 0) add(`${path}.entries`, 'needs at least one entry');
    table.entries.forEach((entry, e) => {
      const epath = `${path}.entries[${e}]`;
      if (!itemKeys.has(entry.item)) add(`${epath}.item`, `unknown item "${entry.item}"`);
      if (!isCount(entry.count[0], 1) || !isCount(entry.count[1], entry.count[0]))
        add(`${epath}.count`, 'must be integers 1 ≤ min ≤ max');
      if (!(entry.weight > 0)) add(`${epath}.weight`, 'must be > 0');
    });
  });
  return keys;
}
