import { Color, Vector3 } from 'three';
import { moonLit } from './Sky.ts';

/**
 * The light of the sky on the world (plan v4 « M37 »): the direction and colour of the direct
 * light that casts shadows (the sun by day, the moon by night), and the hemisphere of light from
 * the sky above and the ground below. The sky light level of a cell (the light curve) scales all
 * of it in the shaders, so caves stay dark and night stays night; this only shares that light
 * between the faces of a surface.
 */
export interface SunLight {
  /** Unit vector towards the light that casts (the sun, or the moon at night). */
  readonly direction: Vector3;
  /** Its colour and strength on a face turned to it (linear RGB). */
  readonly direct: Color;
  /** The ambient light from the sky above, and the light bounced from the ground below. */
  readonly sky: Color;
  readonly ground: Color;
  /** How strong its shadows are, 0–1 (none with the light at the horizon or under clouds). */
  shadow: number;
  /** The haze round the sun along the horizon (plan v4 « M39 »): strongest at dawn and dusk. */
  readonly haze: Color;
}

/** Shares of the sky's light (a top face in full sun: AMBIENT_SKY + DIRECT_SUN). */
const AMBIENT_SKY = 0.62;
const AMBIENT_GROUND = 0.4;
const DIRECT_SUN = 0.6;
const DIRECT_MOON = 0.35;
/** The direct light grows from the horizon up to this height of its direction (y). */
const RISE = 0.25;
/** Under full cloud, the direct light keeps this share; the ambient gains a little. */
const CLOUD_DIRECT = 0.15;
const CLOUD_AMBIENT = 0.2;
/** The haze's strength with the sun at the horizon; it is gone once the sun is this high. */
const HAZE = 0.45;
const HAZE_GONE = 0.45;

export function createSunLight(): SunLight {
  return {
    direction: new Vector3(0, 1, 0),
    direct: new Color(),
    sky: new Color(),
    ground: new Color(),
    shadow: 0,
    haze: new Color(),
  };
}

function rise(y: number): number {
  const t = Math.min(1, Math.max(0, y / RISE));
  return t * t * (3 - 2 * t);
}

/**
 * The sky's light with the sun towards `sun` and the first moon towards `moon` (null: none), unit
 * vectors from the sky (Sky.ts): `tint` is the sky palette's light colour, `cloud` the weather's
 * cover (0–1). A moon lights as much as the sun lights its face (its phase). No allocation.
 */
export function sunLightAt(
  sun: Vector3,
  moon: Vector3 | null,
  tint: Color,
  cloud: number,
  out: SunLight,
): SunLight {
  out.direction.copy(sun);
  let strength = DIRECT_SUN * rise(sun.y);
  if (sun.y <= 0 && moon) {
    // The moon may be up as the sun sets: its light waits for the dusk to deepen, so it never jumps.
    out.direction.copy(moon);
    strength = DIRECT_MOON * rise(moon.y) * rise(-sun.y) * (0.25 + 0.75 * moonLit(sun, moon));
  } else if (sun.y <= 0) strength = 0;
  const clear = 1 - (1 - CLOUD_DIRECT) * cloud;
  out.direct.copy(tint).multiplyScalar(strength * clear);
  out.sky.copy(tint).multiplyScalar(AMBIENT_SKY * (1 + CLOUD_AMBIENT * cloud));
  out.ground.copy(tint).multiplyScalar(AMBIENT_GROUND);
  out.shadow = (strength / DIRECT_SUN) * (1 - cloud);
  const low = Math.max(0, 1 - Math.abs(sun.y) / HAZE_GONE);
  out.haze.copy(tint).multiplyScalar(HAZE * low * low * (1 - cloud));
  return out;
}

/** The low ground's mist: thin all day, thick around dawn (plan v4 « M37 »). */
const MIST_DAY = 0.12;
const MIST_DAWN = 0.55;
/** Dawn mist peaks at this hour and is gone this many hours either side. */
const MIST_PEAK = 6.5;
const MIST_HOURS = 2.5;

/** The mist's strength (0–1) at an hour (0 ≤ hour < 24). */
export function mistAt(hour: number): number {
  const t = Math.max(0, 1 - Math.abs(hour - MIST_PEAK) / MIST_HOURS);
  return MIST_DAY + (MIST_DAWN - MIST_DAY) * t * t * (3 - 2 * t);
}
