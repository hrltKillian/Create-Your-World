/**
 * The plants' sway (plan v5 « M46 »): its phase advances by the wind's speed each frame, so a
 * change of wind (the weather easing in) changes how fast the plants move, never where they are.
 * The shader used to multiply the clock by the wind: an hour of clock made the smallest change of
 * wind a frantic jump.
 */

/** Wraps the phase: a multiple of both sway periods (2π across, 2.5π along), so it never jumps. */
export const WIND_WRAP = 1000 * Math.PI;

/** The sway's speed (radians a second) in a wind (1 calm, more in a storm). */
export function swaySpeed(wind: number): number {
  return 1.2 + 0.5 * wind;
}

/** The sway's phase after `dt` seconds of a wind. */
export function advanceWind(phase: number, wind: number, dt: number): number {
  return (phase + dt * swaySpeed(wind)) % WIND_WRAP;
}
