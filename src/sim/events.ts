/** Events emitted by the simulation for the client (rendering, UI, audio, saves). */
export type SimEvent =
  /** All 8 neighbours are available: the column's sections can be meshed. */
  | { readonly type: 'columnMeshable'; readonly cx: number; readonly cz: number }
  /** The column left the render distance (data stays loaded): its meshes can be freed. */
  | { readonly type: 'columnHidden'; readonly cx: number; readonly cz: number }
  | { readonly type: 'columnUnloaded'; readonly cx: number; readonly cz: number };
