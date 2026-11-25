/*
 * The map's data (plan v3 « M27 »): the explored columns within a radius of the player's,
 * MAP_CELLS × MAP_CELLS colours each, and the player and the waypoints in column units from the
 * player's column (its north-west corner at 0, 0).
 */

/** Cells per column side (one per 2 blocks). */
export const MAP_CELLS = 8;
/** Columns around the player's on the HUD's minimap and on the big map (M). */
export const MINIMAP_RADIUS = 5;
export const BIG_MAP_RADIUS = 13;
/** Canvas sides in cells: the minimap shows ±4 columns, the big map ±12.5. */
export const MINIMAP_SIDE = 64;
export const BIG_MAP_SIDE = 200;

export interface MapView {
  readonly columns: readonly {
    readonly dx: number;
    readonly dz: number;
    /** RGB per cell, row by row from the north-west corner. */
    readonly colours: Uint32Array;
  }[];
  readonly player: { readonly x: number; readonly z: number; readonly yaw: number };
  readonly waypoints: readonly { readonly name: string; readonly x: number; readonly z: number }[];
}
