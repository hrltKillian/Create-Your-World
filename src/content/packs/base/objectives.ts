import type { ObjectiveCondition, ObjectiveDef } from '../../schema.ts';
import type { PackI18nKey } from './i18n.en.ts';

/** Ids of the objectives the pack strings name (`objective.<id>`, with its `.hint`). */
type ObjectiveId = PackI18nKey extends infer K
  ? K extends `objective.${infer Id}.hint`
    ? Id
    : never
  : never;

/** An objective whose key, text and hint follow its id. */
const step = (
  id: ObjectiveId,
  condition: ObjectiveCondition,
  compass?: ObjectiveDef['compass'],
): ObjectiveDef => ({
  key: `objective:${id}`,
  textKey: `objective.${id}`,
  hintKey: `objective.${id}.hint`,
  ...(compass ? { compass } : {}),
  condition,
});

/**
 * The 15 steps up to the first iron ingot (docs « Objectifs jusqu'au fer »). Items count once the
 * player has had them, so a step done early is not asked again; stations count within crafting
 * reach. The journeys north (cold) and south (heat) point the compass; the marsh has no direction.
 */
export const objectives: readonly ObjectiveDef[] = [
  step('gather', { items: ['item:plant_fiber', 'item:stick', 'item:flint'] }),
  step('tools', { items: ['item:flint_hatchet', 'item:torch'] }),
  step('flask', { items: ['item:unfired_flask'] }),
  step('workbench', { stations: ['station:workbench'] }),
  step('shelter', { enclosed: true, stations: ['station:campfire'] }),
  step('night', { nights: 1 }),
  step('copper', { stations: ['station:kiln'], items: ['item:copper_ingot'] }),
  step('copper_tools', { items: ['item:copper_pickaxe', 'item:copper_hatchet'] }),
  step('north', { items: ['item:cassiterite', 'item:fur_hood', 'item:fur_coat'] }, 'north'),
  step('bronze', { items: ['item:bronze_ingot'] }),
  step('bronze_tools', { items: ['item:prowler_sinew', 'item:bronze_pickaxe'] }),
  step('south', { items: ['item:fireclay', 'item:straw_hat', 'item:fiber_veil'] }, 'south'),
  step('marsh', { items: ['item:bog_iron', 'item:filter_mask'] }),
  step('bloomery', { stations: ['station:bloomery'] }),
  step('iron', { items: ['item:iron_ingot'] }),
];
