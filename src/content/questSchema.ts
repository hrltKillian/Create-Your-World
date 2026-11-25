/**
 * Quests (plan v3 « M21 »): a graph in data. A quest unlocks once every quest it `requires` is
 * done (none: from the start), then asks for a state (`condition`, read when checked) or counts
 * events from its unlock on (`counter`); done, its `rewards` wait to be claimed. Re-exported by
 * `schema.ts`.
 */
import type { BlockKey, CreatureKey, ItemCount, ItemKey, StationKey, TagKey } from './schema.ts';

export type QuestKey = `quest:${string}`;

/** Directions a quest can point the compass to, while pinned. */
export const COMPASS_POINTS = ['north', 'east', 'south', 'west'] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/** A state a quest asks for: every part given must hold at once. */
export interface QuestCondition {
  /** Items (or tags) the player has had in the inventory (`PlayerState.seen`). */
  readonly items?: readonly (ItemKey | TagKey)[];
  /** A block of each station within crafting reach of the player (placed or found). */
  readonly stations?: readonly StationKey[];
  /** The player has drunk: a sip, or a drink that quenches thirst (`PlayerState.drank`). */
  readonly drank?: boolean;
  /** Distinct biomes the player has stood in (`PlayerState.biomes`). */
  readonly biomes?: number;
  /** Creatures of the Bestiary met at least (`PlayerState.bestiary`). */
  readonly met?: number;
}

/** Events a counter counts, each from the quest's (or task's) start on. */
export const QUEST_EVENTS = [
  'killed',
  'night',
  'broken',
  'placed',
  'consumed',
  'harvested',
] as const;
export type QuestEvent = (typeof QUEST_EVENTS)[number];

/**
 * A count of the player's own deeds: creatures killed, blocks broken or placed, items eaten or
 * drunk, ripe crops picked (of `target` when given: a creature, block or item key), or nights
 * survived alive.
 */
export interface QuestCounter {
  readonly event: QuestEvent;
  readonly target?: CreatureKey | BlockKey | ItemKey;
  readonly count: number;
}

export interface QuestDef {
  readonly key: QuestKey;
  /** What to do (pack i18n key). */
  readonly textKey: string;
  /** How or where to do it. */
  readonly hintKey?: string;
  /** Quests to finish first (earlier in the pack's list); none: unlocked from the start. */
  readonly requires?: readonly QuestKey[];
  /** The compass points this way while the quest is pinned. */
  readonly compass?: CompassPoint;
  /** Exactly one of a condition and a counter. */
  readonly condition?: QuestCondition;
  readonly counter?: QuestCounter;
  /** Items given when the player claims the quest done. */
  readonly rewards?: readonly ItemCount[];
  /** Experience given with the rewards (plan v3 « M22 »). */
  readonly xp?: number;
}

export type TaskKey = `task:${string}`;

/**
 * A general task (plan v3 « M22 »): a counter drawn for a player among the pack's tasks, which pays
 * its XP once claimed and is replaced by a new draw.
 */
export interface TaskDef {
  readonly key: TaskKey;
  readonly textKey: string;
  readonly counter: QuestCounter;
  readonly xp: number;
}
