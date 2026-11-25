import { blockItemKey, packItems, tagNameKey } from './items.ts';
import {
  type ContentPack,
  type ImplicitItemTraits,
  type ItemDef,
  type ItemKey,
  WEAR_SLOTS,
  type WeaponDef,
} from './schema.ts';

type AddIssue = (path: string, message: string) => void;

const MAX_STACK = 999;
const MAX_DURABILITY = 65_535;
const MAX_LOOT_ENTRIES = 31;

const isCount = (v: number, min: number) => Number.isInteger(v) && v >= min;
const positive = (v: number) => Number.isFinite(v) && v > 0;

/** What crafting data may name: every item, the tags items carry and the loot tables. */
export interface ItemRefs {
  readonly items: ReadonlyMap<string, ItemDef>;
  readonly tags: ReadonlySet<string>;
  readonly loot: ReadonlySet<string>;
}

/** Items, tool tiers and names, and loot tables (and the block drops naming them). */
export function validateItems(
  pack: ContentPack,
  blockKeys: ReadonlySet<string>,
  textureKeys: ReadonlySet<string>,
  add: AddIssue,
): ItemRefs {
  const itemKeys = checkItems(pack, blockKeys, textureKeys, add);
  const items = new Map(packItems(pack).map((item) => [item.key as string, item]));
  (pack.items ?? []).forEach((item, i) => {
    checkTraits(pack, item, `items[${i}]`, add);
    checkUses(item, `items[${i}]`, items, add);
  });
  pack.blocks.forEach((block, i) => {
    if (block.item) checkTraits(pack, block.item, `blocks[${i}].item`, add);
    for (const [empty, filled] of Object.entries(block.liquid?.fills ?? {})) {
      const path = `blocks[${i}].liquid.fills`;
      if (items.get(empty)?.container?.contents !== 'empty')
        add(path, `"${empty}" is no empty container`);
      if (!items.get(filled ?? '')?.container) add(path, `"${filled}" is no container`);
    }
    const hardens = block.liquid?.hardens;
    for (const key of hardens ? [hardens.source, hardens.flow] : [])
      if (!blockKeys.has(key)) add(`blocks[${i}].liquid.hardens`, `unknown block "${key}"`);
    const step = block.liquid?.flow?.step ?? 1;
    if (!Number.isInteger(step) || step < 1 || step > 7)
      add(`blocks[${i}].liquid.flow.step`, 'must be a whole number from 1 to 7');
  });
  const unknownItem = pack.manifest.bindings.unknownItem;
  if (!itemKeys.has(unknownItem))
    add('manifest.bindings.unknownItem', `unknown item "${unknownItem}"`);
  checkTiers(pack, add);
  const loot = checkLoot(pack, itemKeys, add);
  pack.blocks.forEach((block, i) => {
    if (block.drops.startsWith('loot:') && !loot.has(block.drops))
      add(`blocks[${i}].drops`, `unknown loot table "${block.drops}"`);
    // Liquids, unbreakable blocks and the bindings have no item to drop.
    if (block.drops === 'self' && !itemKeys.has(blockItemKey(block.key)))
      add(`blocks[${i}].drops`, 'only a placeable block can drop itself');
    const fish = block.liquid?.fish;
    if (fish && !loot.has(fish)) add(`blocks[${i}].liquid.fish`, `unknown loot table "${fish}"`);
    const crop = block.crop;
    if (!crop) return;
    const path = `blocks[${i}].crop`;
    if (!loot.has(crop.harvest)) add(`${path}.harvest`, `unknown loot table "${crop.harvest}"`);
    if (!positive(crop.seconds[0]) || !(crop.seconds[1]! >= crop.seconds[0]))
      add(`${path}.seconds`, 'must be a range of seconds > 0');
    if (!Number.isInteger(crop.light) || crop.light < 0 || crop.light > 15)
      add(`${path}.light`, 'must be an integer 0–15');
    if (!block.states?.includes('ripe')) add(path, 'a crop needs the "ripe" state');
  });
  (pack.biomes ?? []).forEach((biome, i) => {
    if (biome.fish && !loot.has(biome.fish))
      add(`biomes[${i}].fish`, `unknown loot table "${biome.fish}"`);
  });
  const tags = new Set<string>([...items.values()].flatMap((item) => item.tags ?? []));
  return { items, tags, loot };
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
    const max = item.maxStack;
    if (max !== undefined && (!isCount(max, 1) || max > MAX_STACK))
      add(`${path}.maxStack`, `must be an integer 1–${MAX_STACK}`);
    const tool = item.tool;
    if (tool) {
      if (!Number.isInteger(tool.tier) || tool.tier < 0 || tool.tier > 4)
        add(`${path}.tool.tier`, 'must be an integer 0–4');
      if (!positive(tool.speed)) add(`${path}.tool.speed`, 'must be > 0');
      checkDurability(tool.durability, `${path}.tool.durability`, add);
    }
    // Tools, weapons, gear, rods and water containers keep their own wear or charges, so they
    // never stack (stackLimit): a pack may not say otherwise.
    const wears = tool || item.weapon || item.wear || item.container || item.rod;
    if (wears && max !== undefined && max !== 1)
      add(`${path}.maxStack`, 'an item that wears or holds charges must have maxStack 1');
    const rod = item.rod;
    if (rod) {
      checkDurability(rod.durability, `${path}.rod.durability`, add);
      if (!positive(rod.seconds[0]) || !(rod.seconds[1]! >= rod.seconds[0]))
        add(`${path}.rod.seconds`, 'must be a range of seconds > 0');
    }
    if (item.lore !== undefined && pack.strings[item.lore] === undefined)
      add(`${path}.lore`, `no string for "${item.lore}"`);
    (item.blueprint ?? []).forEach((key, b) => {
      const recipe = (pack.recipes ?? []).find((r) => r.key === key);
      if (recipe?.known !== 'blueprint')
        add(`${path}.blueprint[${b}]`, `"${key}" is no recipe a blueprint teaches`);
    });
  });
  // Every blueprint recipe has its blueprint (plan v3 « M26 »).
  (pack.recipes ?? []).forEach((recipe, r) => {
    if (recipe.known !== 'blueprint') return;
    if (!(pack.items ?? []).some((item) => item.blueprint?.includes(recipe.key)))
      add(`recipes[${r}].known`, `no blueprint teaches "${recipe.key}"`);
  });
  return keys;
}

/** Traits implicit block items can carry too: tags, fuel and the hint. */
function checkTraits(pack: ContentPack, traits: ImplicitItemTraits, path: string, add: AddIssue) {
  (traits.tags ?? []).forEach((tag, t) => {
    if (!tag.startsWith('tag:')) add(`${path}.tags[${t}]`, `"${tag}" must start with "tag:"`);
    else if (pack.strings[tagNameKey(tag)] === undefined)
      add(`${path}.tags[${t}]`, `no string for "${tagNameKey(tag)}"`);
  });
  if (traits.fuel && !positive(traits.fuel.seconds)) add(`${path}.fuel.seconds`, 'must be > 0');
  if (traits.hintKey !== undefined && pack.strings[traits.hintKey] === undefined)
    add(`${path}.hintKey`, `no string for "${traits.hintKey}"`);
}

/** Weapon, wear, consumption and water container data of a pack item. */
function checkUses(
  item: ItemDef,
  path: string,
  items: ReadonlyMap<string, ItemDef>,
  add: AddIssue,
): void {
  const ref = (at: string, key: ItemKey | undefined) => {
    if (key !== undefined && !items.has(key)) add(at, `unknown item "${key}"`);
  };
  if (item.weapon) checkWeapon(item.weapon, `${path}.weapon`, add);
  const wear = item.wear;
  if (wear) {
    if (!WEAR_SLOTS.includes(wear.slot)) add(`${path}.wear.slot`, `unknown slot "${wear.slot}"`);
    checkDurability(wear.durability, `${path}.wear.durability`, add);
    if (wear.scanner) {
      if (wear.slot !== 'head') add(`${path}.wear.scanner`, 'a scanner is worn on the head');
      if (!positive(wear.scanner.seconds) || !positive(wear.scanner.range))
        add(`${path}.wear.scanner`, 'needs positive seconds and range');
    }
  }
  if (item.consume) {
    if (!positive(item.consume.seconds)) add(`${path}.consume.seconds`, 'must be > 0');
    ref(`${path}.consume.returns`, item.consume.returns);
  }
  const container = item.container;
  if (container) {
    if (!isCount(container.charges, 1)) add(`${path}.container.charges`, 'must be an integer ≥ 1');
    ref(`${path}.container.emptyAs`, container.emptyAs);
    const empty = items.get(container.emptyAs)?.container;
    if (empty && (empty.contents !== 'empty' || empty.charges !== container.charges))
      add(`${path}.container.emptyAs`, 'must be an empty container with the same charges');
  }
}

/** Melee numbers of an item, or of the bare hand (the balance). */
export function checkWeapon(weapon: WeaponDef, path: string, add: AddIssue): void {
  for (const field of ['damage', 'cooldown', 'reach'] as const)
    if (!positive(weapon[field])) add(`${path}.${field}`, 'must be > 0');
  if (!(weapon.knockback >= 0)) add(`${path}.knockback`, 'must be ≥ 0');
  if (weapon.durability !== undefined)
    checkDurability(weapon.durability, `${path}.durability`, add);
}

/** A stack's uses (a tool's, a weapon's, gear's wear): an integer 1–MAX_DURABILITY. */
function checkDurability(uses: number, path: string, add: AddIssue): void {
  if (!isCount(uses, 1) || uses > MAX_DURABILITY)
    add(path, `must be an integer 1–${MAX_DURABILITY}`);
}

function checkTiers(pack: ContentPack, add: AddIssue): void {
  const seen = new Set<number>();
  (pack.tiers ?? []).forEach((tier, i) => {
    if (seen.has(tier.tier)) add(`tiers[${i}].tier`, `duplicate tier ${tier.tier}`);
    seen.add(tier.tier);
    if (pack.strings[tier.nameKey] === undefined)
      add(`tiers[${i}].nameKey`, `no string for "${tier.nameKey}"`);
  });
  for (const [kind, nameKey] of Object.entries(pack.toolNames ?? {})) {
    if (pack.strings[nameKey] === undefined) add(`toolNames.${kind}`, `no string for "${nameKey}"`);
  }
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
    // Draws never repeat an entry (a bit mask of 31 entries at most: sim/loot.ts).
    if (table.entries.length === 0 || table.entries.length > MAX_LOOT_ENTRIES)
      add(`${path}.entries`, `needs 1–${MAX_LOOT_ENTRIES} entries`);
    else if (max > table.entries.length)
      add(`${path}.rolls`, 'draws more often than it has entries');
    if (table.empty !== undefined && !(table.empty >= 0)) add(`${path}.empty`, 'must be ≥ 0');
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
