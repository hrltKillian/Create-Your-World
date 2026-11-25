import type {
  FuelDef,
  Ingredient,
  ProcessDef,
  ProcessFuel,
  RecipeCategory,
  RecipeDef,
  StationDef,
  StationKey,
} from '../../schema.ts';
import type { PackI18nKey } from './i18n.en.ts';

type PackStation = StationDef & { readonly nameKey: PackI18nKey };

/** Burn times (docs « Stations de transformation »: stick 5 s … charcoal 80 s). */
export const FUELS = {
  stick: { seconds: 5 },
  planks: { seconds: 15 },
  log: { seconds: 40 },
  peat: { seconds: 60 },
  emberstone: { seconds: 50 },
  charcoal: { seconds: 80, charcoal: true },
} as const satisfies Readonly<Record<string, FuelDef>>;

const BENCH = 'station:workbench';
const CAMPFIRE = 'station:campfire';
const KILN = 'station:kiln';
const BLOOMERY = 'station:bloomery';

/**
 * Stations: the workbench makes its recipes through its own queue into its 4 outputs; the others
 * are block entities with slots whose fire burns only while they process. The campfire's may also
 * be kept burning (warmth, light).
 */
export const stations = [
  { key: BENCH, nameKey: 'block.workbench', inputSlots: 0, fuelSlot: false, outputSlots: 4 },
  {
    key: CAMPFIRE,
    nameKey: 'block.campfire',
    inputSlots: 2,
    fuelSlot: true,
    outputSlots: 1,
    burns: true,
    keepLit: true,
  },
  {
    key: KILN,
    nameKey: 'block.kiln',
    inputSlots: 2,
    fuelSlot: true,
    outputSlots: 1,
    burns: true,
  },
  {
    key: BLOOMERY,
    nameKey: 'block.bloomery',
    inputSlots: 1,
    fuelSlot: true,
    outputSlots: 1,
    burns: true,
  },
] as const satisfies readonly PackStation[];

/** Inputs by item id (`flint` is `item:flint`) or tag (`tag:log`), with their counts. */
type Inputs = Readonly<Record<string, number>>;

const ingredients = (inputs: Inputs): Ingredient[] =>
  Object.entries(inputs).map(([id, count]) => ({
    item: id.startsWith('tag:') ? (id as `tag:${string}`) : `item:${id}`,
    count,
  }));

interface RecipeExtra {
  readonly count?: number;
  readonly station?: StationKey;
  readonly known?: 'start' | 'blueprint';
  readonly level?: number;
}

/** A Logbook recipe named after its output: `recipe:<id>` makes `item:<id>`. */
const recipe = (
  id: string,
  category: RecipeCategory,
  seconds: number,
  inputs: Inputs,
  extra: RecipeExtra = {},
): RecipeDef => ({
  key: `recipe:${id}`,
  category,
  ...(extra.station ? { station: extra.station } : {}),
  seconds,
  inputs: ingredients(inputs),
  output: { item: `item:${id}`, count: extra.count ?? 1 },
  ...(extra.known ? { known: extra.known } : {}),
  ...(extra.level ? { level: extra.level } : {}),
});

/** Known from the start (by hand), or made at the workbench. */
const START = { known: 'start' } as const;
const bench = (id: string, category: RecipeCategory, seconds: number, inputs: Inputs) =>
  recipe(id, category, seconds, inputs, { station: BENCH });

/** Metal tools at the workbench: ingots, sticks and a leather grip; bronze adds a sinew. */
const metalTools = (metal: 'copper' | 'bronze' | 'iron') => {
  const grip: Inputs = metal === 'bronze' ? { leather: 1, prowler_sinew: 1 } : { leather: 1 };
  const ingot = `${metal}_ingot`;
  return [
    bench(`${metal}_hatchet`, 'tools', 3, { [ingot]: 2, stick: 2, ...grip }),
    bench(`${metal}_pickaxe`, 'tools', 3, { [ingot]: 3, stick: 2, ...grip }),
    bench(`${metal}_blade`, 'tools', 3, { [ingot]: 2, stick: 1, ...grip }),
  ];
};

/**
 * Logbook recipes (docs « Progression »): by hand the cord, flint tools, torches, campfire,
 * planks, unfired flask and workbench; at the workbench the furniture, leather, kiln, cut stone,
 * metal tools and gear. Hand recipes take 1–3 s.
 */
export const recipes: readonly RecipeDef[] = [
  recipe('cord', 'materials', 1, { plant_fiber: 3 }, START),
  recipe('planks', 'building', 1, { 'tag:log': 1 }, { count: 4, ...START }),
  recipe('stick', 'materials', 1, { planks: 1 }, { count: 4, ...START }),
  recipe('stone_shard', 'materials', 1, { stone: 1 }, { count: 4 }),
  recipe('flint_knife', 'tools', 1.5, { flint: 1, stick: 1 }, START),
  recipe('flint_hatchet', 'tools', 2, { flint: 1, stick: 2, cord: 1 }, START),
  recipe('flint_pickaxe', 'tools', 2.5, { flint: 2, stick: 2, cord: 1 }, START),
  recipe('flint_spear', 'tools', 2, { flint: 1, stick: 3, cord: 1 }, START),
  recipe('torch', 'building', 1, { stick: 1, plant_fiber: 2 }, { count: 2, ...START }),
  recipe('campfire', 'building', 3, { 'tag:log': 2, stick: 4, flint: 1 }, START),
  recipe('workbench', 'building', 3, { planks: 8, plant_fiber: 4 }, START),
  recipe('unfired_flask', 'survival', 2, { clay_lump: 3 }, START),
  // Wired from what the crash left (M18 gives it the capsule's parts).
  // The capsule's parts make the scanner (plan v3 « M26 »: the crash site's salvage locker).
  recipe('scanner', 'equipment', 3, { capsule_parts: 1, cord: 2 }, START),
  recipe('bandage', 'survival', 2, { plant_fiber: 3, resin: 1 }),
  recipe('straw_hat', 'equipment', 3, { plant_fiber: 8, cord: 2 }),
  recipe('fiber_veil', 'equipment', 3, { plant_fiber: 6, cord: 1 }),
  bench('chest', 'building', 3, { planks: 8, cord: 1 }),
  bench('gate', 'building', 3, { planks: 4, stick: 2, cord: 1 }),
  bench('bedroll', 'building', 3, { raw_hide: 2, plant_fiber: 4 }),
  bench('cut_stone', 'building', 1, { stone: 1 }),
  bench('glowbloom_lantern', 'building', 2, { glass: 1, glowbloom: 2, stick: 1 }),
  bench('kiln', 'building', 3, { clay_lump: 4, stone_shard: 6 }),
  bench('bloomery', 'building', 4, { fire_bricks: 8, bronze_ingot: 2, stone_shard: 4 }),
  bench('leather', 'materials', 3, { raw_hide: 2, resin: 1 }),
  bench('waterskin_empty', 'survival', 3, { leather: 2, cord: 1 }),
  ...metalTools('copper'),
  ...metalTools('bronze'),
  ...metalTools('iron'),
  bench('fur_hood', 'equipment', 3, { fur: 3, cord: 1 }),
  bench('fur_coat', 'equipment', 4, { fur: 6, leather: 2, cord: 1 }),
  bench('leather_tunic', 'equipment', 3, { leather: 5, cord: 1 }),
  bench('leather_leggings', 'equipment', 3, { leather: 4, cord: 1 }),
  bench('waxed_boots', 'equipment', 3, { leather: 3, resin: 2 }),
  bench('filter_mask', 'equipment', 3, { leather: 2, charcoal: 2, cord: 1 }),
  bench('bronze_helmet', 'equipment', 4, { bronze_ingot: 4, leather: 1 }),
  bench('bronze_cuirass', 'equipment', 4, { bronze_ingot: 7, leather: 2 }),
  bench('shell_cuirass', 'equipment', 4, { shell_plate: 4, leather: 2, cord: 1 }),
  // Blueprint recipes (plan v3 « M26 »): the colony's lamp and bricks, never needed on the way to
  // iron.
  recipe(
    'colony_lamp',
    'building',
    4,
    { copper_ingot: 1, crystal_shard: 1, glass: 1 },
    {
      station: BENCH,
      known: 'blueprint',
    },
  ),
  recipe(
    'colony_brick',
    'building',
    3,
    { stone_shard: 4, clay_lump: 2 },
    {
      station: BENCH,
      known: 'blueprint',
      count: 4,
    },
  ),
  // Level recipes (plan v3 « M22 »): never needed on the way to iron.
  recipe(
    'pack_frame',
    'equipment',
    4,
    { leather: 4, stick: 6, cord: 2 },
    { station: BENCH, level: 3 },
  ),
  recipe(
    'scanner_mk2',
    'equipment',
    5,
    { bronze_ingot: 2, cord: 2, resin: 2 },
    {
      station: BENCH,
      level: 4,
    },
  ),
];

/** A station process named after its output: `process:<id>` makes `item:<id>`. */
const process = (
  id: string,
  station: StationKey,
  seconds: number,
  inputs: Inputs,
  count = 1,
  fuel: ProcessFuel = 'any',
): ProcessDef => ({
  key: `process:${id}`,
  station,
  seconds,
  fuel,
  inputs: ingredients(inputs),
  output: { item: `item:${id}`, count },
});

/** Processes (docs « Stations de transformation »). */
export const processes: readonly ProcessDef[] = [
  process('grilled_meat', CAMPFIRE, 8, { raw_meat: 1 }),
  // Firing the clay flask; boiling raw water.
  process('flask_empty', CAMPFIRE, 10, { unfired_flask: 1 }),
  process('flask_boiled', CAMPFIRE, 6, { flask_raw: 1 }),
  process('waterskin_boiled', CAMPFIRE, 6, { waterskin_raw: 1 }),
  process('antidote_tea', CAMPFIRE, 10, { glowcap: 1, berries: 2 }),
  process('copper_ingot', KILN, 10, { copper_ore: 1 }),
  process('bricks', KILN, 8, { clay_lump: 2 }),
  process('glass', KILN, 8, { 'tag:sand': 1 }),
  process('charcoal', KILN, 12, { 'tag:log': 1 }),
  process('fire_bricks', KILN, 12, { fireclay: 1 }),
  // The alloy: 3 copper and 1 cassiterite give 3 bronze.
  process('bronze_ingot', KILN, 15, { copper_ingot: 3, cassiterite: 1 }, 3),
  process('iron_ingot', BLOOMERY, 20, { bog_iron: 2 }, 1, 'charcoal'),
];
