/** Events emitted by the simulation for the client (rendering, UI, audio, saves). */
export type SimEvent =
  /** All 8 neighbours are available: the column's sections can be meshed. */
  | { readonly type: 'columnMeshable'; readonly cx: number; readonly cz: number }
  /** The column left the render distance (data stays loaded): its meshes can be freed. */
  | { readonly type: 'columnHidden'; readonly cx: number; readonly cz: number }
  | { readonly type: 'columnUnloaded'; readonly cx: number; readonly cz: number }
  | { readonly type: 'playerLanded'; readonly playerId: number; readonly fall: number }
  /** Blocks changed inside a box (inclusive corners): the sections around it need remeshing. */
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
  /** A sound effect played at a world position. */
  | {
      readonly type: 'sound';
      readonly sfx: string;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  | {
      readonly type: 'rejected';
      readonly playerId: number;
      readonly command: string;
      readonly reason: string;
    };
