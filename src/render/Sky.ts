import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector2, Vector3 } from 'three';
import { skyFragment, skyVertex } from './shaders/sky.glsl.ts';

/** A palette keyframe: the sky at an hour of the day (sRGB hex colours). */
interface SkyKey {
  readonly hour: number;
  readonly zenith: string;
  /** Horizon, fog and clear colour. */
  readonly horizon: string;
  /** Tint of sky light on blocks and boxes (`uSkyTint`). */
  readonly light: string;
  /** Star visibility, 0–1. */
  readonly stars: number;
}

const NIGHT = { zenith: '#070c1f', horizon: '#17203d', light: '#b4c4ff', stars: 1 };
const DAY = { zenith: '#4f86c6', horizon: '#a9c8e2', light: '#ffffff', stars: 0 };

/**
 * Our own day palette, by hour (ascending from 0; the last key blends into the first at 24 h).
 * Warm horizons around sunrise (05:15) and sunset (18:45), a deep blue night with stars.
 */
export const SKY_KEYS: readonly SkyKey[] = [
  { hour: 0, ...NIGHT },
  { hour: 4.5, ...NIGHT },
  { hour: 5.4, zenith: '#3a4f86', horizon: '#e09468', light: '#ffc8a4', stars: 0.2 },
  { hour: 6.5, ...DAY },
  { hour: 17.5, ...DAY },
  { hour: 19.1, zenith: '#424a88', horizon: '#e37b4e', light: '#ffb68e', stars: 0.15 },
  { hour: 20.5, ...NIGHT },
];

/** The sky at one moment, in linear RGB (three's working colour space). */
export interface SkyColors {
  readonly zenith: Color;
  readonly horizon: Color;
  readonly light: Color;
  stars: number;
}

const KEYS = SKY_KEYS.map((k) => ({
  hour: k.hour,
  zenith: new Color(k.zenith),
  horizon: new Color(k.horizon),
  light: new Color(k.light),
  stars: k.stars,
}));

export function createSkyColors(): SkyColors {
  return { zenith: new Color(), horizon: new Color(), light: new Color(), stars: 0 };
}

/** The sky at an hour (0 ≤ hour < 24): linear blend of the keyframes around it. No allocation. */
export function skyPalette(hour: number, out: SkyColors): SkyColors {
  let i = KEYS.length - 1;
  while (i > 0 && KEYS[i]!.hour > hour) i--;
  const a = KEYS[i]!;
  const b = KEYS[(i + 1) % KEYS.length]!;
  const end = b.hour > a.hour ? b.hour : b.hour + 24;
  const t = (hour - a.hour) / (end - a.hour);
  out.zenith.lerpColors(a.zenith, b.zenith, t);
  out.horizon.lerpColors(a.horizon, b.horizon, t);
  out.light.lerpColors(a.light, b.light, t);
  out.stars = a.stars + (b.stars - a.stars) * t;
  return out;
}

/** The sun's circle is lifted this much, so it rises near 05:15 and sets near 18:45… */
const SUN_LIFT = 0.2;
/** …and passes this much south (+z) of the zenith (the moon as much north). */
const SUN_TILT = 0.35;

/** Angle of the sky's turn at an hour: 0 at 06:00, a full turn a day. */
function skyAngle(hour: number): number {
  return ((hour - 6) / 24) * Math.PI * 2;
}

/** Unit vector towards the sun: it rises in the east (+x), culminates south, sets in the west. */
export function sunDirection(hour: number, out: Vector3): Vector3 {
  const a = skyAngle(hour);
  return out.set(Math.cos(a), Math.sin(a) + SUN_LIFT, SUN_TILT).normalize();
}

/** Unit vector towards the moon, across the sky from the sun. */
export function moonDirection(hour: number, out: Vector3): Vector3 {
  const a = skyAngle(hour);
  return out.set(-Math.cos(a), SUN_LIFT - Math.sin(a), -SUN_TILT).normalize();
}

/**
 * Sky dome following the camera: palette gradient, a round sun and a round moon, and stars that
 * turn with them. All in one draw (the discs and stars are computed per pixel).
 */
export class Sky {
  readonly mesh: Mesh;
  /** The sky of the last `update`: fog, clear colour and the sky light tint follow it. */
  readonly colors = createSkyColors();
  private readonly material: ShaderMaterial;
  private readonly sun = new Vector3();
  private readonly moon = new Vector3();
  private readonly starTurn = new Vector2(1, 0);

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      // The palette colours and directions are shared by reference: `update` writes them in place.
      uniforms: {
        uZenith: { value: this.colors.zenith },
        uHorizon: { value: this.colors.horizon },
        uSunDir: { value: this.sun },
        uMoonDir: { value: this.moon },
        uStars: { value: 0 },
        uStarTurn: { value: this.starTurn },
      },
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(10, 24, 12), this.material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.update(12);
  }

  /** Palette, sun, moon and stars for an hour of the day (0 ≤ hour < 24). */
  update(hour: number): void {
    skyPalette(hour, this.colors);
    sunDirection(hour, this.sun);
    moonDirection(hour, this.moon);
    const a = skyAngle(hour);
    this.starTurn.set(Math.cos(a), Math.sin(a));
    this.material.uniforms.uStars!.value = this.colors.stars;
  }

  follow(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y, z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
