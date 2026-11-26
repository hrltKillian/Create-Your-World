/**
 * The sky of a pack's world (plan v4 « M39 », decision 29): its palette through the day, its sun,
 * its moons, a ringed giant among the stars, nebulae and auroras. Colours are sRGB '#rrggbb'.
 */

/** The sky at an hour of the day (hours ascending from 0; the last blends into the first). */
export interface SkyKeyDef {
  readonly hour: number;
  readonly zenith: string;
  /** Horizon, fog and clear colour. */
  readonly horizon: string;
  /** Tint of the sky's light on blocks and boxes. */
  readonly light: string;
  /** Star visibility, 0–1. */
  readonly stars: number;
}

export interface MoonDef {
  readonly color: string;
  /** Angular radius in degrees. */
  readonly size: number;
  /** Days from one full moon to the next: it lags the sun by a turn over that time. */
  readonly period: number;
  /** How far north (+) of the sky's turn its circle passes, like the sun's south tilt (−1…1). */
  readonly tilt: number;
}

/** A gas giant fixed among the stars, banded, its ring seen nearly edge on. */
export interface GiantDef {
  readonly color: string;
  readonly bands: string;
  readonly ring: string;
  /** Angular radius in degrees. */
  readonly size: number;
  /**
   * Where it hangs at midnight (it turns with the stars): azimuth in degrees clockwise from north,
   * elevation in degrees.
   */
  readonly azimuth: number;
  readonly elevation: number;
}

export interface SkyDef {
  readonly keys: readonly SkyKeyDef[];
  /** The sun's colour and angular radius (degrees). */
  readonly sun: { readonly color: string; readonly size: number };
  /** One or two moons; the first lights the night (and the compass shows it). */
  readonly moons: readonly MoonDef[];
  readonly giant?: GiantDef;
  /** The two colours of the nebulae drifting among the stars. */
  readonly nebula: readonly [string, string];
  /** The two colours of the auroras: the curtains' foot, then their top. */
  readonly aurora: readonly [string, string];
}
