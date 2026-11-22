/** Events emitted by the simulation for the client (rendering, UI, audio, saves). */
export type SimEvent =
  /** All 8 neighbours are available: the column's sections can be meshed. */
  | { readonly type: 'columnMeshable'; readonly cx: number; readonly cz: number }
  | { readonly type: 'columnUnloaded'; readonly cx: number; readonly cz: number };
