import type { DeathCause } from './survival.ts';

/** Events emitted by the simulation for the client (rendering, UI, audio, saves). */
export type SimEvent =
  /** All 8 neighbours are available: the column's sections can be meshed. */
  | { readonly type: 'columnMeshable'; readonly cx: number; readonly cz: number }
  /** The column left the render distance (data stays loaded): its meshes can be freed. */
  | { readonly type: 'columnHidden'; readonly cx: number; readonly cz: number }
  | { readonly type: 'columnUnloaded'; readonly cx: number; readonly cz: number }
  /** A player's jump left the ground (its sound). */
  | { readonly type: 'playerJumped'; readonly playerId: number }
  | { readonly type: 'playerLanded'; readonly playerId: number; readonly fall: number }
  /**
   * Blocks, or the light an edit changed, inside a box (inclusive corners): the sections around it
   * need remeshing.
   */
  | {
      readonly type: 'blocksChanged';
      readonly x0: number;
      readonly y0: number;
      readonly z0: number;
      readonly x1: number;
      readonly y1: number;
      readonly z1: number;
    }
  /** A player broke a block (`state` is the block it was: particles, statistics). */
  | {
      readonly type: 'blockBroken';
      readonly playerId: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly state: number;
    }
  | {
      readonly type: 'blockPlaced';
      readonly playerId: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly state: number;
    }
  /** Crack stage (0–7) of the block a player mines; −1 when mining stops. */
  | {
      readonly type: 'mineProgress';
      readonly playerId: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly stage: number;
    }
  | {
      readonly type: 'itemPickedUp';
      readonly playerId: number;
      /** The item drop entity (gone if it was picked up whole). */
      readonly entityId: number;
      readonly item: string;
      readonly count: number;
    }
  | { readonly type: 'inventoryChanged'; readonly playerId: number }
  /** The bag's items stacked into the chests nearby (plan v3 « M32 »): how many, how many chests. */
  | {
      readonly type: 'stackedNearby';
      readonly playerId: number;
      readonly count: number;
      readonly chests: number;
    }
  /** A player read the journal in hand (secondary, plan v3 « M28 »): the client shows its text. */
  | { readonly type: 'itemRead'; readonly playerId: number; readonly item: string }
  /** A player opened a chest or a station (its screen shows), or it closed (moved away, broken). */
  | {
      readonly type: 'blockEntityOpened';
      readonly playerId: number;
      readonly kind: 'container' | 'station' | 'workbench';
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  | { readonly type: 'blockEntityClosed'; readonly playerId: number }
  /** One craft of a player's queue is done (its output went to the bag or the ground). */
  | {
      readonly type: 'crafted';
      readonly playerId: number;
      readonly recipe: string;
      readonly item: string;
      readonly count: number;
    }
  /** One craft of a workbench's queue is done (its output went to the bench's outputs). */
  | {
      readonly type: 'workbenchCrafted';
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly recipe: string;
      readonly item: string;
      readonly count: number;
    }
  /**
   * A HUD hint for one player, e.g. « Tool too weak: copper pickaxe required », sent once when the
   * player starts mining a block (a new target, or again after releasing) that the held tool
   * cannot harvest. `key` is an engine i18n key (`TOOL_TOO_WEAK_HINT`); every value of `params` is
   * itself an i18n key (pack names: `tier`, `tool`). To show it: translate each value, then
   * `t(key, translatedParams)`.
   */
  | {
      readonly type: 'hint';
      readonly playerId: number;
      readonly key: string;
      readonly params: Readonly<Record<string, string>>;
    }
  /** A sound effect played at a world position. */
  | {
      readonly type: 'sound';
      readonly sfx: string;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  /** A player ate or drank the held item (`item`), or sipped a liquid (`item`: its block key). */
  | { readonly type: 'consumed'; readonly playerId: number; readonly item: string }
  /** A player slept on a bedroll: the clock stands at the morning of `day`. */
  | { readonly type: 'slept'; readonly playerId: number; readonly day: number }
  /**
   * A player died of `cause` (the death screen shows `death.cause.<cause>`; '' when nothing hurt
   * them). With `pack`, what they carried lies in the Abandoned Pack at the cell (x, y, z), now one
   * of their `graves`; without, they carried nothing, or it lies on the ground there (no pack could
   * be left).
   */
  | {
      readonly type: 'died';
      readonly playerId: number;
      readonly cause: DeathCause | '';
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly pack: boolean;
    }
  /** A dead player came back (feet position): at the bedroll slept on last, else the spawn. */
  | {
      readonly type: 'respawned';
      readonly playerId: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  /**
   * A creature's blow landed on a player (combat.ts): `amount` of health before god mode, struck
   * from (x, z) by entity `source` (the HUD's damage direction).
   */
  | {
      readonly type: 'playerHurt';
      readonly playerId: number;
      readonly amount: number;
      readonly source: number;
      readonly x: number;
      readonly z: number;
    }
  /** A creature lost `amount` health to a blow of entity `attacker` (hit markers). */
  | {
      readonly type: 'creatureHurt';
      readonly id: number;
      readonly amount: number;
      readonly attacker: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  /** A creature died (killed by entity `attacker`); its loot lies at (x, y, z). */
  | {
      readonly type: 'creatureDied';
      readonly id: number;
      readonly creature: string;
      readonly attacker: number;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  /** A player did an objective of the pack's chain (`player.objectives` holds it from now on). */
  | { readonly type: 'questUnlocked'; readonly playerId: number; readonly quest: string }
  /** A quest is done; `already`: its condition held when it unlocked. */
  | {
      readonly type: 'questDone';
      readonly playerId: number;
      readonly quest: string;
      readonly already: boolean;
    }
  /** A counter of a quest counted one more deed. */
  | {
      readonly type: 'questProgress';
      readonly playerId: number;
      readonly quest: string;
      readonly progress: number;
    }
  | { readonly type: 'questClaimed'; readonly playerId: number; readonly quest: string }
  /** A task counted one more deed (it is done at its count). */
  | {
      readonly type: 'taskProgress';
      readonly playerId: number;
      readonly task: string;
      readonly progress: number;
    }
  /** A task was claimed or redrawn: the player's tasks changed. */
  | { readonly type: 'taskChanged'; readonly playerId: number }
  /** XP gained (from a claim); `level` is the level now. */
  | {
      readonly type: 'xpGained';
      readonly playerId: number;
      readonly xp: number;
      readonly level: number;
    }
  | { readonly type: 'levelUp'; readonly playerId: number; readonly level: number }
  | { readonly type: 'skillSpent'; readonly playerId: number; readonly skill: string }
  | { readonly type: 'waypointsChanged'; readonly playerId: number }
  /** A player's swing (a blow, or in the air): `strong` when it struck with a full gauge. */
  | { readonly type: 'playerSwung'; readonly playerId: number; readonly strong: boolean }
  /** A creature entered a player's bestiary, or was studied (`level`: MET or STUDIED). */
  | {
      readonly type: 'bestiary';
      readonly playerId: number;
      readonly creature: string;
      readonly level: number;
    }
  /** The clock passed 18:30 of `day`: « The sun is setting… » and a sound (docs « Jour/nuit »). */
  | { readonly type: 'sunset'; readonly day: number }
  /** The clock passed 06:00: night `night` is over (« Night N survived »). */
  | { readonly type: 'nightSurvived'; readonly night: number }
  | {
      readonly type: 'rejected';
      readonly playerId: number;
      readonly command: string;
      readonly reason: string;
    };
