import { Color, Vector3 } from 'three';
import { moonDirection, sunDirection } from './Sky.ts';

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

export function createSunLight(): SunLight {
  return {
    direction: new Vector3(0, 1, 0),
    direct: new Color(),
    sky: new Color(),
    ground: new Color(),
    shadow: 0,
  };
}

function rise(y: number): number {
  const t = Math.min(1, Math.max(0, y / RISE));
  return t * t * (3 - 2 * t);
}

/**
 * The sky's light at an hour (0 ≤ hour < 24): `tint` is the sky palette's light colour, `cloud`
 * the weather's cover (0–1). No allocation.
 */
export function sunLightAt(hour: number, tint: Color, cloud: number, out: SunLight): SunLight {
  const sunY = sunDirection(hour, out.direction).y;
  let strength = DIRECT_SUN * rise(sunY);
  if (sunY <= 0) {
    // Both discs ride high (Sky.ts lifts their circles): the moon is up as the sun sets, so its
    // light waits for the dusk to deepen, and the light never jumps.
    moonDirection(hour, out.direction);
    strength = DIRECT_MOON * rise(out.direction.y) * rise(-sunY);
  }
  const clear = 1 - (1 - CLOUD_DIRECT) * cloud;
  out.direct.copy(tint).multiplyScalar(strength * clear);
  out.sky.copy(tint).multiplyScalar(AMBIENT_SKY * (1 + CLOUD_AMBIENT * cloud));
  out.ground.copy(tint).multiplyScalar(AMBIENT_GROUND);
  out.shadow = (strength / DIRECT_SUN) * (1 - cloud);
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
