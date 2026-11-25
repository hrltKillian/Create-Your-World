import type { ContainerContents, ItemDef, WearDef } from '../../schema.ts';
import type { PackI18nKey } from './i18n.en.ts';
import { FUELS } from './recipes.ts';
import { TOOL_TIERS, type ToolMaterial } from './tiers.ts';

type PackItem = ItemDef & { readonly nameKey: PackI18nKey };

/** Ids of the items the pack strings name (`item.<id>`). */
type ItemId = PackI18nKey extends infer K ? (K extends `item.${infer Id}` ? Id : never) : never;

/** What sets an item apart besides its id (`maxStack` only for a stack other than the default). */
type Traits = Omit<Partial<ItemDef>, 'key' | 'nameKey' | 'icon'>;

/**
 * An item whose key, name and icon follow its id: `item:<id>`, `item.<id>`, `tex:icon_<id>`. It
 * stacks to 64 (content/items.ts `stackLimit`; tools, weapons, gear and containers to 1).
 */
const item = (id: ItemId, traits: Traits = {}): PackItem => ({
  key: `item:${id}`,
  nameKey: `item.${id}`,
  icon: `tex:icon_${id}`,
  ...traits,
});

/** A raw material found in the world, with where to look. */
const found = (id: ItemId, hintKey: PackI18nKey, traits: Traits = {}) =>
  item(id, { hintKey, ...traits });

/**
 * Melee use (docs « Combat »): damage, seconds between hits, reach in blocks; a weapon that is no
 * tool wears like the tools of its `material` (« Outils et paliers »).
 */
const weapon = (damage: number, cooldown: number, reach = 3, material?: ToolMaterial) => ({
  damage,
  cooldown,
  reach,
  knockback: 1,
  ...(material ? { durability: TOOL_TIERS[material].durability } : {}),
});

/** Hatchets and pickaxes of a material (tier, speed and durability from `TOOL_TIERS`). */
const hatchet = (material: ToolMaterial, damage: number) =>
  item(`${material}_hatchet`, {
    tool: { kind: 'axe', ...TOOL_TIERS[material] },
    weapon: weapon(damage, 0.6),
  });
const pickaxe = (material: ToolMaterial) =>
  item(`${material}_pickaxe`, { tool: { kind: 'pick', ...TOOL_TIERS[material] } });
const blade = (material: Exclude<ToolMaterial, 'flint'>, damage: number) =>
  item(`${material}_blade`, { weapon: weapon(damage, 0.5, 3, material) });

const gear = (id: ItemId, wear: WearDef) => item(id, { wear });

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
  item(`${shape}_${contents}`, {
    container: { charges, contents, emptyAs: `item:${shape}_empty` },
    ...(contents === 'empty' ? {} : { consume: { seconds: 1.2, thirst: 25, toxicity } }),
  });

/** Materials (docs « Contenu placeholder », Objets). */
const materials = [
  found('stick', 'where.stick', { fuel: FUELS.stick }),
  found('plant_fiber', 'where.plant_fiber'),
  item('cord'),
  found('flint', 'where.flint'),
  item('stone_shard'),
  found('resin', 'where.resin'),
  found('raw_hide', 'where.raw_hide'),
  item('leather'),
  found('fur', 'where.fur'),
  found('clay_lump', 'where.clay_lump'),
  item('copper_ingot'),
  item('bronze_ingot'),
  item('iron_ingot'),
  item('charcoal', { fuel: FUELS.charcoal }),
  found('shell_plate', 'where.shell_plate'),
  found('toxic_gland', 'where.toxic_gland'),
  found('prowler_sinew', 'where.prowler_sinew'),
  found('crystal_shard', 'where.crystal_shard'),
];

/** Tools and weapons (« Outils et paliers », the weapon table of « Combat »). */
const tools = [
  item('flint_knife', { weapon: weapon(4, 0.4, 3, 'flint') }),
  hatchet('flint', 4),
  pickaxe('flint'),
  item('flint_spear', { weapon: weapon(6, 0.8, 4, 'flint') }),
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
  // Studies a creature looked at for 2 s within 24 blocks (the bestiary), in place of a hood.
  gear('scanner', { slot: 'head', scanner: { seconds: 2, range: 24 }, durability: 600 }),
  // Level 4 (plan v3 « M22 »): twice as quick and farther.
  gear('scanner_mk2', { slot: 'head', scanner: { seconds: 1, range: 40 }, durability: 1200 }),
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
  item('berries', { hintKey: 'where.berries', consume: { seconds: 0.8, hunger: 6 } }),
  item('raw_meat', {
    hintKey: 'where.raw_meat',
    consume: { seconds: 1.2, hunger: 10, toxicity: 10 },
  }),
  item('grilled_meat', { consume: { seconds: 1.2, hunger: 30 } }),
  // Melts in the mouth: water from the Rimefrost (plan v3 « M23 »).
  found('ice_bulb', 'where.ice_bulb', { consume: { seconds: 0.8, thirst: 15 } }),
  // Fitted to the bag in 1.5 s: 8 more slots (plan v3 « M22 », level 3).
  item('pack_frame', { consume: { seconds: 1.5, bagSlots: 8 } }),
  item('palmthorn_fruit', {
    hintKey: 'where.palmthorn_fruit',
    consume: { seconds: 1, hunger: 6, thirst: 10 },
  }),
  item('bandage', { consume: { seconds: 2, health: 20 } }),
  item('antidote_tea', { consume: { seconds: 1.5, thirst: 5, toxicity: -40 } }),
];

/** Water containers (« Eau potable »): raw water +3 toxicity, boiled 0, foul +12. */
const containers = [
  item('unfired_flask'),
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
  { key: 'item:unknown', nameKey: 'item.unknown', icon: 'tex:unknown' },
];
