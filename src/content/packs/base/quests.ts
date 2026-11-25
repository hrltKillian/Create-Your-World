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
  goal: Pick<QuestDef, 'condition' | 'counter' | 'rewards' | 'compass'>,
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
    condition: { items: ['item:plant_fiber', 'item:stick', 'item:flint'] },
    rewards: [{ item: 'item:torch', count: 4 }],
  }),
  quest('drink', { condition: { drank: true }, rewards: [{ item: 'item:berries', count: 4 }] }),
  quest('explore', {
    condition: { biomes: 3 },
    rewards: [{ item: 'item:grilled_meat', count: 2 }],
  }),
  quest('hunt', {
    counter: { event: 'killed', target: 'creature:trotter', count: 1 },
    rewards: [{ item: 'item:bandage', count: 2 }],
  }),
  quest('tools', { condition: { items: ['item:flint_hatchet', 'item:torch'] } }, ['gather']),
  quest('flask', { condition: { items: ['item:flask_empty'] } }, ['drink']),
  quest('workbench', { condition: { stations: ['station:workbench'] } }, ['tools']),
  quest('camp', { condition: { items: ['item:bedroll'], stations: ['station:campfire'] } }, [
    'workbench',
  ]),
  quest(
    'night',
    {
      counter: { event: 'night', count: 1 },
      rewards: [{ item: 'item:grilled_meat', count: 3 }],
    },
    ['camp'],
  ),
  quest(
    'creatures',
    {
      condition: { met: 3 },
      rewards: [{ item: 'item:antidote_tea', count: 1 }],
    },
    ['hunt'],
  ),
  quest('copper', { condition: { stations: ['station:kiln'], items: ['item:copper_ingot'] } }, [
    'workbench',
  ]),
  quest(
    'copper_tools',
    {
      condition: { items: ['item:copper_pickaxe', 'item:copper_hatchet'] },
    },
    ['copper'],
  ),
  quest(
    'north',
    {
      condition: { items: ['item:cassiterite', 'item:fur_hood', 'item:fur_coat'] },
      compass: 'north',
    },
    ['copper_tools', 'explore'],
  ),
  quest(
    'south',
    {
      condition: { items: ['item:fireclay', 'item:straw_hat', 'item:fiber_veil'] },
      compass: 'south',
    },
    ['copper_tools', 'explore'],
  ),
  quest('bronze', { condition: { items: ['item:bronze_ingot'] } }, ['north']),
  quest(
    'bronze_tools',
    {
      condition: { items: ['item:prowler_sinew', 'item:bronze_pickaxe'] },
    },
    ['bronze', 'hunt'],
  ),
  quest('marsh', { condition: { items: ['item:bog_iron', 'item:filter_mask'] } }, ['south']),
  quest('bloomery', { condition: { stations: ['station:bloomery'] } }, ['bronze_tools', 'south']),
  quest('iron', { condition: { items: ['item:iron_ingot'] } }, ['bloomery', 'marsh']),
];
