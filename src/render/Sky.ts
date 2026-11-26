import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector2, Vector3 } from 'three';
import type { MoonDef, SkyDef } from '../content/skySchema.ts';
import { skyFragment, skyVertex } from './shaders/sky.glsl.ts';

/**
 * The sky (plan v4 « M39 »): the pack's palette through the day, the sun, one or two moons whose
 * phases follow the sun, a ringed giant and nebulae among the turning stars, clouds and auroras;
 * all in one draw, computed per pixel (shaders/sky.glsl.ts).
 */

/** The sky of a pack without one: the palette of plan v3. */
export const DEFAULT_SKY: SkyDef = {
  keys: [
    { hour: 0, zenith: '#070c1f', horizon: '#17203d', light: '#b4c4ff', stars: 1 },
    { hour: 4.5, zenith: '#070c1f', horizon: '#17203d', light: '#b4c4ff', stars: 1 },
    { hour: 5.4, zenith: '#3a4f86', horizon: '#e09468', light: '#ffc8a4', stars: 0.2 },
    { hour: 6.5, zenith: '#4f86c6', horizon: '#a9c8e2', light: '#ffffff', stars: 0 },
    { hour: 17.5, zenith: '#4f86c6', horizon: '#a9c8e2', light: '#ffffff', stars: 0 },
    { hour: 19.1, zenith: '#424a88', horizon: '#e37b4e', light: '#ffb68e', stars: 0.15 },
    { hour: 20.5, zenith: '#070c1f', horizon: '#17203d', light: '#b4c4ff', stars: 1 },
  ],
  sun: { color: '#ffebb8', size: 3 },
  moons: [{ color: '#bdc9e6', size: 2.5, period: 8, tilt: -0.35 }],
  nebula: ['#2a2350', '#1d3b52'],
  aurora: ['#5cf2a8', '#9a6bff'],
};

/** The sky at one moment, in linear RGB (three's working colour space). */
export interface SkyColors {
  readonly zenith: Color;
  readonly horizon: Color;
  readonly light: Color;
  stars: number;
}

interface PaletteKey {
  readonly hour: number;
  readonly zenith: Color;
  readonly horizon: Color;
  readonly light: Color;
  readonly stars: number;
}

/** A pack's palette keys as colours, by ascending hour. */
export type SkyPalette = readonly PaletteKey[];

export function skyPaletteOf(def: SkyDef): SkyPalette {
  return def.keys.map((k) => ({
    hour: k.hour,
    zenith: new Color(k.zenith),
    horizon: new Color(k.horizon),
    light: new Color(k.light),
    stars: k.stars,
  }));
}

export function createSkyColors(): SkyColors {
  return { zenith: new Color(), horizon: new Color(), light: new Color(), stars: 0 };
}

/** The sky at an hour (0 ≤ hour < 24): linear blend of the keys around it. No allocation. */
export function skyPalette(keys: SkyPalette, hour: number, out: SkyColors): SkyColors {
  let i = keys.length - 1;
  while (i > 0 && keys[i]!.hour > hour) i--;
  const a = keys[i]!;
  const b = keys[(i + 1) % keys.length]!;
  const end = b.hour > a.hour ? b.hour : b.hour + 24;
  const t = end > a.hour ? (hour - a.hour) / (end - a.hour) : 0;
  out.zenith.lerpColors(a.zenith, b.zenith, t);
  out.horizon.lerpColors(a.horizon, b.horizon, t);
  out.light.lerpColors(a.light, b.light, t);
  out.stars = a.stars + (b.stars - a.stars) * t;
  return out;
}

/** The sun's circle is lifted this much, so it rises near 05:15 and sets near 18:45… */
const SUN_LIFT = 0.2;
/** …and passes this much south (+z) of the zenith. */
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

/**
 * Unit vector towards a moon at an hour, `days` days into the world (ticks / day): opposite the
 * sun at day 0 (full), it lags a turn behind it every `period` days, through its phases.
 */
export function moonDirection(hour: number, days: number, moon: MoonDef, out: Vector3): Vector3 {
  const a = skyAngle(hour) + Math.PI - (2 * Math.PI * days) / moon.period;
  return out.set(Math.cos(a), Math.sin(a) + SUN_LIFT, moon.tilt).normalize();
}

/** The share of a moon's face the sun lights, 0 (new) to 1 (full), from their directions. */
export function moonLit(sun: Vector3, moon: Vector3): number {
  return (1 - sun.dot(moon)) / 2;
}

/** Bearing of a direction for the HUD compass: radians clockwise from north (−z), east +x. */
export function skyBearing(dir: Vector3): number {
  return Math.atan2(dir.x, -dir.z);
}

/** Where the HUD compass shows the sun (the same turn as `sunDirection`). */
export function sunBearing(hour: number): number {
  return Math.atan2(Math.cos(skyAngle(hour)), -SUN_TILT);
}

/** Whether the sun is above the horizon at an hour. */
export function sunAbove(hour: number): boolean {
  return Math.sin(skyAngle(hour)) + SUN_LIFT > 0;
}

const moonScratch = new Vector3();

/** Where the HUD compass shows a moon, `days` into the world; NaN below the horizon. */
export function moonBearing(hour: number, days: number, moon: MoonDef): number {
  const dir = moonDirection(hour, days, moon, moonScratch);
  return dir.y > 0 ? skyBearing(dir) : Number.NaN;
}

const DEG = Math.PI / 180;
const MAX_MOONS = 2;

/** How the sky looks besides the hour (WorldView): clouds, auroras, the time for their motion. */
export interface SkyLook {
  /** Cloud cover 0–1 (the weather's), the auroras' strength 0–1 (the biome's, by night). */
  cloud: number;
  aurora: number;
  seconds: number;
}

/** The sky dome following the camera. */
export class Sky {
  readonly mesh: Mesh;
  /** The sky of the last `update`: fog, clear colour and the sky light tint follow it. */
  readonly colors = createSkyColors();
  /** The moons' directions of the last `update` (the first lights the night). */
  readonly moons: readonly Vector3[];
  readonly def: SkyDef;
  private readonly palette: SkyPalette;
  private readonly material: ShaderMaterial;
  /** The sun's direction of the last `update`. */
  readonly sun = new Vector3();
  private readonly starTurn = new Vector2(1, 0);
  private readonly giantStars = new Vector3();
  private readonly giant = new Vector3();

  constructor(def: SkyDef = DEFAULT_SKY) {
    this.def = def;
    this.palette = skyPaletteOf(def);
    this.moons = def.moons.slice(0, MAX_MOONS).map(() => new Vector3(0, -1, 0));
    const moonColors = [0, 1].map((i) => new Color(def.moons[i]?.color ?? '#000000'));
    const moonCos = [0, 1].map((i) => Math.cos((def.moons[i]?.size ?? 0) * DEG));
    const giant = def.giant;
    // The giant hangs among the stars: its place at midnight, in their own frame (turned in
    // `update`; at midnight the turn takes the frame's (x, y) to the world's (y, −x)).
    if (giant) {
      const az = giant.azimuth * DEG;
      const el = giant.elevation * DEG;
      const east = Math.sin(az) * Math.cos(el);
      this.giantStars.set(-Math.sin(el), east, -Math.cos(az) * Math.cos(el));
    }
    this.material = new ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      // Colours and directions are shared by reference: `update` writes them in place.
      uniforms: {
        uZenith: { value: this.colors.zenith },
        uHorizon: { value: this.colors.horizon },
        uHaze: { value: new Color() },
        uSunDir: { value: this.sun },
        uSunColor: { value: new Color(def.sun.color) },
        uSunCos: { value: Math.cos(def.sun.size * DEG) },
        uMoonDir: {
          value: [this.moons[0] ?? new Vector3(0, -1, 0), this.moons[1] ?? new Vector3(0, -1, 0)],
        },
        uMoonColor: { value: moonColors },
        uMoonCos: { value: moonCos },
        uGiantDir: { value: giant ? this.giant : new Vector3(0, -1, 0) },
        uGiantCos: { value: Math.cos((giant?.size ?? 0) * DEG) },
        uGiantColor: { value: new Color(giant?.color ?? '#000000') },
        uGiantBands: { value: new Color(giant?.bands ?? '#000000') },
        uGiantRing: { value: new Color(giant?.ring ?? '#000000') },
        uNebula: { value: def.nebula.map((c) => new Color(c)) },
        uAuroraColor: { value: def.aurora.map((c) => new Color(c)) },
        uStars: { value: 0 },
        uStarTurn: { value: this.starTurn },
        uCloud: { value: 0 },
        uCloudLight: { value: new Color() },
        uAurora: { value: 0 },
        uTime: { value: 0 },
      },
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(10, 24, 12), this.material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.update(12, 0);
  }

  /** Palette, sun, moons, giant and stars at an hour (0 ≤ hour < 24), `days` into the world. */
  update(hour: number, days: number): void {
    skyPalette(this.palette, hour, this.colors);
    sunDirection(hour, this.sun);
    for (let i = 0; i < this.moons.length; i++)
      moonDirection(hour, days, this.def.moons[i]!, this.moons[i]!);
    const a = skyAngle(hour);
    const turn = this.starTurn.set(Math.cos(a), Math.sin(a));
    // The stars' frame turns about z: back to the world, its inverse turn.
    const g = this.giantStars;
    this.giant.set(turn.x * g.x - turn.y * g.y, turn.y * g.x + turn.x * g.y, g.z);
    this.material.uniforms.uStars!.value = this.colors.stars;
  }

  /** Clouds, auroras and their motion; the haze round the sun at the horizon; the clouds' light. */
  look(look: Readonly<SkyLook>, haze: Color, cloudLight: Color): void {
    const u = this.material.uniforms;
    u.uCloud!.value = look.cloud;
    u.uAurora!.value = look.aurora * this.colors.stars;
    u.uTime!.value = look.seconds;
    (u.uHaze!.value as Color).copy(haze);
    (u.uCloudLight!.value as Color).copy(cloudLight);
  }

  follow(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y, z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
