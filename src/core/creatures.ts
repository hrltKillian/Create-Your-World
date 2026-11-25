/** Creature timings and body geometry shared by the simulation and the renderer. */

/** Ticks a dead creature falls over and shrinks away before it is removed. */
export const DYING_TICKS = 20;

/** Share of a creature's hitbox height its eyes sit at (sight lines, blows, the head's tilt). */
export const CREATURE_EYE_SHARE = 0.8;

/** Height of the middle of a body `height` tall standing at `y` (its sounds, loot, light). */
export function centreY(y: number, height: number): number {
  return y + height / 2;
}

/**
 * The cell row a body's feet stand in (paths, the light at the feet): a body resting on a block's
 * top face, a hair under it after a collision, still counts as standing in the cell above.
 */
export function feetCell(y: number): number {
  return Math.floor(y + 0.01);
}

/** A player's bestiary entry (docs plan v2 « M17 »): met (seen or struck), or studied. */
export const MET = 1;
export const STUDIED = 2;
