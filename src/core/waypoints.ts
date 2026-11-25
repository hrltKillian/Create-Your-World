/*
 * What a waypoint can look like (plan v3 « M31 »), shared by the simulation (which checks it) and
 * the maps (which draw it).
 */

/** The symbols a waypoint can wear. */
export const WAYPOINT_ICONS = ['flag', 'home', 'star', 'cave', 'gem', 'danger'] as const;
export type WaypointIcon = (typeof WAYPOINT_ICONS)[number];
/** How many colours a waypoint can take (the maps' palette, by index). */
export const WAYPOINT_COLOURS = 6;
