/**
 * Objectives (docs « Objectifs jusqu'au fer »): a chain in data, each step with its text, a hint
 * and, for a journey, the direction the compass points to. Re-exported by `schema.ts`.
 */
import type { ItemKey, StationKey, TagKey } from './schema.ts';

export type ObjectiveKey = `objective:${string}`;

/** Directions an objective can point the compass to. */
export const COMPASS_POINTS = ['north', 'east', 'south', 'west'] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/** What an objective asks for: every part given must hold at once. */
export interface ObjectiveCondition {
  /** Items (or tags) the player has had in the inventory (`PlayerState.seen`). */
  readonly items?: readonly (ItemKey | TagKey)[];
  /** A block of each station within crafting reach of the player (placed or found). */
  readonly stations?: readonly StationKey[];
  /** Nights survived since the world began (the clock passed 06:00 of a later day). */
  readonly nights?: number;
  /** The player has drunk: a sip, or a drink that quenches thirst (`PlayerState.drank`). */
  readonly drank?: boolean;
}

export interface ObjectiveDef {
  readonly key: ObjectiveKey;
  /** What to do (pack i18n key). */
  readonly textKey: string;
  /** How or where to do it. */
  readonly hintKey?: string;
  /** The compass points this way while the objective is the current one. */
  readonly compass?: CompassPoint;
  readonly condition: ObjectiveCondition;
}
