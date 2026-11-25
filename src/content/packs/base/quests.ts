import type { QuestDef, QuestKey } from '../../schema.ts';
import type { PackI18nKey } from './i18n.en.ts';

/** Ids of the quests the pack strings name (`quest.<id>`, with its `.hint`). */
type QuestId = PackI18nKey extends infer K
  ? K extends `quest.${infer Id}.hint`
    ? Id
    : never
  : never;

/** A quest whose key, text and hint follow its id; `requires` by id. */
const quest = (
  id: QuestId,
  goal: Pick<QuestDef, 'condition' | 'counter' | 'rewards' | 'compass' | 'xp'>,
  requires: readonly QuestId[] = [],
): QuestDef => ({
  key: `quest:${id}`,
  textKey: `quest.${id}`,
  hintKey: `quest.${id}.hint`,
  ...(requires.length > 0 ? { requires: requires.map((r): QuestKey => `quest:${r}`) } : {}),
  ...goal,
});

/**
 * The quest graph up to the first iron ingot (plan v3 « M21 »): four branches open from the
 * start (tools, water, exploration, hunting) that meet again at the metals. Items count once the
 * player has had them and stations within crafting reach, so a step done ahead is done as soon as
 * it unlocks; the night and the hunt count from the unlock on. The journeys north
 * (cold) and south (heat) point the compass while pinned.
 */
export const quests: readonly QuestDef[] = [
  quest('gather', {
    xp: 20,
    condition: { items: ['item:plant_fiber', 'item:stick', 'item:flint'] },
    rewards: [{ item: 'item:torch', count: 4 }],
  }),
  quest('drink', {
    xp: 20,
    condition: { drank: true },
    rewards: [{ item: 'item:berries', count: 4 }],
  }),
  quest('explore', {
    xp: 40,
    condition: { biomes: 3 },
    rewards: [{ item: 'item:grilled_meat', count: 2 }],
  }),
  quest('hunt', {
    xp: 30,
    counter: { event: 'killed', target: 'creature:trotter', count: 1 },
    rewards: [{ item: 'item:bandage', count: 2 }],
  }),
  quest('tools', { xp: 30, condition: { items: ['item:flint_hatchet', 'item:torch'] } }, [
    'gather',
  ]),
  quest('flask', { xp: 30, condition: { items: ['item:flask_empty'] } }, ['drink']),
  quest('workbench', { xp: 40, condition: { stations: ['station:workbench'] } }, ['tools']),
  quest(
    'camp',
    { xp: 40, condition: { items: ['item:bedroll'], stations: ['station:campfire'] } },
    ['workbench'],
  ),
  quest(
    'night',
    {
      xp: 60,
      counter: { event: 'night', count: 1 },
      rewards: [{ item: 'item:grilled_meat', count: 3 }],
    },
    ['camp'],
  ),
  quest(
    'creatures',
    { xp: 50, condition: { met: 3 }, rewards: [{ item: 'item:antidote_tea', count: 1 }] },
    ['hunt'],
  ),
  quest(
    'copper',
    { xp: 60, condition: { stations: ['station:kiln'], items: ['item:copper_ingot'] } },
    ['workbench'],
  ),
  quest(
    'copper_tools',
    { xp: 60, condition: { items: ['item:copper_pickaxe', 'item:copper_hatchet'] } },
    ['copper'],
  ),
  quest(
    'north',
    {
      xp: 80,
      condition: { items: ['item:cassiterite', 'item:fur_hood', 'item:fur_coat'] },
      compass: 'north',
    },
    ['copper_tools', 'explore'],
  ),
  quest(
    'south',
    {
      xp: 80,
      condition: { items: ['item:fireclay', 'item:straw_hat', 'item:fiber_veil'] },
      compass: 'south',
    },
    ['copper_tools', 'explore'],
  ),
  quest('bronze', { xp: 80, condition: { items: ['item:bronze_ingot'] } }, ['north']),
  quest(
    'bronze_tools',
    { xp: 80, condition: { items: ['item:prowler_sinew', 'item:bronze_pickaxe'] } },
    ['bronze', 'hunt'],
  ),
  quest('marsh', { xp: 80, condition: { items: ['item:bog_iron', 'item:filter_mask'] } }, [
    'south',
  ]),
  quest('bloomery', { xp: 100, condition: { stations: ['station:bloomery'] } }, [
    'bronze_tools',
    'south',
  ]),
  quest('iron', { xp: 150, condition: { items: ['item:iron_ingot'] } }, ['bloomery', 'marsh']),
];
