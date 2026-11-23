import type { ContainerContents, ItemDef, WearDef } from '../../schema.ts';
import type { PackI18nKey } from './i18n.en.ts';
import { FUELS } from './recipes.ts';
import { TOOL_TIERS, type ToolMaterial } from './tiers.ts';

type PackItem = ItemDef & { readonly nameKey: PackI18nKey };

/** Ids of the items the pack strings name (`item.<id>`). */
type ItemId = PackI18nKey extends infer K ? (K extends `item.${infer Id}` ? Id : never) : never;

/** What sets an item apart besides its id and stack size. */
type Traits = Omit<Partial<ItemDef>, 'key' | 'nameKey' | 'icon' | 'maxStack'>;

/** Stack sizes (docs « Inventaire »): materials 30, food 20, tools, gear and containers 1. */
const MATERIAL = 30;
const FOOD = 20;

/** An item whose key, name and icon follow its id: `item:<id>`, `item.<id>`, `tex:icon_<id>`. */
const item = (id: ItemId, maxStack: number, traits: Traits = {}): PackItem => ({
  key: `item:${id}`,
  nameKey: `item.${id}`,
  icon: `tex:icon_${id}`,
  maxStack,
  ...traits,
});

/** A raw material found in the world, with where to look. */
const found = (id: ItemId, hintKey: PackI18nKey, traits: Traits = {}) =>
  item(id, MATERIAL, { hintKey, ...traits });

/** Melee use (docs « Combat »): damage, seconds between hits, reach in blocks. */
const weapon = (damage: number, cooldown: number, reach = 3) => ({
  damage,
  cooldown,
  reach,
  knockback: 1,
});

/** Hatchets and pickaxes of a material (tier, speed and durability from `TOOL_TIERS`). */
const hatchet = (material: ToolMaterial, damage: number) =>
  item(`${material}_hatchet`, 1, {
    tool: { kind: 'axe', ...TOOL_TIERS[material] },
    weapon: weapon(damage, 0.6),
  });
const pickaxe = (material: ToolMaterial) =>
  item(`${material}_pickaxe`, 1, { tool: { kind: 'pick', ...TOOL_TIERS[material] } });
const blade = (material: Exclude<ToolMaterial, 'flint'>, damage: number) =>
  item(`${material}_blade`, 1, { weapon: weapon(damage, 0.5) });

const gear = (id: ItemId, wear: WearDef) => item(id, 1, { wear });

/**
 * A water container (M9) with its contents: drinking a charge quenches 25 thirst with the water's
 * toxicity, and the last charge leaves the empty container.
 */
const vessel = (
  shape: 'flask' | 'waterskin',
  charges: number,
  contents: ContainerContents,
  toxicity = 0,
) =>
  item(`${shape}_${contents}`, 1, {
    container: { charges, contents, emptyAs: `item:${shape}_empty` },
    ...(contents === 'empty' ? {} : { consume: { seconds: 1.2, thirst: 25, toxicity } }),
  });

/** Materials (docs « Contenu placeholder », Objets). */
const materials = [
  found('stick', 'where.stick', { fuel: FUELS.stick }),
  found('plant_fiber', 'where.plant_fiber'),
  item('cord', MATERIAL),
  found('flint', 'where.flint'),
  item('stone_shard', MATERIAL),
  found('resin', 'where.resin'),
  found('raw_hide', 'where.raw_hide'),
  item('leather', MATERIAL),
  found('fur', 'where.fur'),
  found('clay_lump', 'where.clay_lump'),
  item('copper_ingot', MATERIAL),
  item('bronze_ingot', MATERIAL),
  item('iron_ingot', MATERIAL),
  item('charcoal', MATERIAL, { fuel: FUELS.charcoal }),
  found('shell_plate', 'where.shell_plate'),
  found('toxic_gland', 'where.toxic_gland'),
  found('prowler_sinew', 'where.prowler_sinew'),
  found('crystal_shard', 'where.crystal_shard'),
];

/** Tools and weapons (« Outils et paliers », the weapon table of « Combat »). */
const tools = [
  item('flint_knife', 1, { weapon: weapon(4, 0.4) }),
  hatchet('flint', 4),
  pickaxe('flint'),
  item('flint_spear', 1, { weapon: weapon(6, 0.8, 4) }),
  hatchet('copper', 5),
  pickaxe('copper'),
  blade('copper', 7),
  hatchet('bronze', 6),
  pickaxe('bronze'),
  blade('bronze', 9),
  hatchet('iron', 8),
  pickaxe('iron'),
  blade('iron', 12),
];

/** Equipment (« Équipement de danger », armour values), from the head down; effects in M9. */
const equipment = [
  gear('fur_hood', { slot: 'head', warmth: 6, durability: 300 }),
  gear('straw_hat', { slot: 'head', cooling: 6, durability: 200 }),
  gear('bronze_helmet', { slot: 'head', armor: 3, durability: 500 }),
  gear('fiber_veil', { slot: 'face', cooling: 8, durability: 200 }),
  // 60 minutes of use.
  gear('filter_mask', { slot: 'face', airFilter: 0.15, durability: 3600 }),
  gear('leather_tunic', { slot: 'body', armor: 2, durability: 250 }),
  gear('fur_coat', { slot: 'body', armor: 2, warmth: 10, durability: 400 }),
  gear('bronze_cuirass', { slot: 'body', armor: 6, durability: 500 }),
  gear('shell_cuirass', { slot: 'body', armor: 5, durability: 450 }),
  gear('leather_leggings', { slot: 'legs', armor: 1, durability: 250 }),
  gear('waxed_boots', { slot: 'feet', waterproof: true, durability: 300 }),
];

/** Food and remedies (« Survie »: raw meat +10 toxicity, the antidote −40); effects in M9. */
const consumables = [
  item('berries', FOOD, { hintKey: 'where.berries', consume: { seconds: 0.8, hunger: 6 } }),
  item('raw_meat', FOOD, {
    hintKey: 'where.raw_meat',
    consume: { seconds: 1.2, hunger: 10, toxicity: 10 },
  }),
  item('grilled_meat', FOOD, { consume: { seconds: 1.2, hunger: 30 } }),
  item('palmthorn_fruit', FOOD, {
    hintKey: 'where.palmthorn_fruit',
    consume: { seconds: 1, hunger: 6, thirst: 10 },
  }),
  item('bandage', FOOD, { consume: { seconds: 2, health: 20 } }),
  item('antidote_tea', FOOD, { consume: { seconds: 1.5, thirst: 5, toxicity: -40 } }),
];

/** Water containers (« Eau potable »): raw water +3 toxicity, boiled 0, foul +12. */
const containers = [
  item('unfired_flask', MATERIAL),
  vessel('flask', 3, 'empty'),
  vessel('flask', 3, 'raw', 3),
  vessel('flask', 3, 'boiled'),
  vessel('flask', 3, 'foul', 12),
  vessel('waterskin', 6, 'empty'),
  vessel('waterskin', 6, 'raw', 3),
  vessel('waterskin', 6, 'boiled'),
  vessel('waterskin', 6, 'foul', 12),
];

/** Items of the base pack besides the implicit block items. */
export const items: readonly PackItem[] = [
  ...materials,
  ...tools,
  ...equipment,
  ...consumables,
  ...containers,
  // A saved item whose key the pack no longer has: it keeps that key, and stacks only with the
  // unknown items of the same key (`sameStack`).
  { key: 'item:unknown', nameKey: 'item.unknown', icon: 'tex:unknown', maxStack: 50 },
];
