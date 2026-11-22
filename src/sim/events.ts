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
  | {
      readonly type: 'rejected';
      readonly playerId: number;
      readonly command: string;
      readonly reason: string;
    };
