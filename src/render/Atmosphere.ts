import { Color, type Fog } from 'three';
import type { SkyDef } from '../content/skySchema.ts';
import { approach } from '../core/ease.ts';
import { Sky } from './Sky.ts';
import { createSunLight, mistAt, sunLightAt } from './sunLight.ts';
import type { VoxelUniforms } from './voxelMaterial.ts';

/** What the weather looks like (plan v3 « M34 », the client's WeatherFeel): 0–1 each. */
export interface WeatherLook {
  cloud: number;
  fog: number;
  flash: number;
  /** The share of the sky's light the clouds leave. */
  dim: number;
  /** Rain on the ground around the camera (plan v4 « M37 »): surfaces darker and glossy. */
  wet: number;
}

/** How far clouds turn the sky grey, and how much darker that grey gets under full cloud. */
const CLOUD_GREY = 0.8;
const CLOUD_DARK = 0.5;
/** A flash's light on the blocks and whitening of the sky. */
const FLASH_LIGHT = 0.6;
const FLASH_SKY = 0.5;
/** Thick fog pulls the fog's start and end this much closer. */
const FOG_NEAR = 0.85;
const FOG_FAR = 0.65;
/** Underwater fog (docs « Ciel et brouillard »): Veyra's teal water (plan v4 « M38 »), 1–20 blocks. */
const WATER_FOG = new Color('#2a7486');
const WATER_FOG_NEAR = 1;
const WATER_FOG_FAR = 20;
/** The biome's air tints the horizon and the fog this much, the zenith less (plan v4 « M39 »). */
const AIR_HORIZON = 0.35;
const AIR_ZENITH = 0.12;
/** Seconds the air takes to change from one biome's to the next. */
const AIR_FADE_SECONDS = 4;
const scratch = new Color();
const air = new Color();

function luma(c: Color): number {
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
}

/**
 * The air around the camera (plan v4 « M39 »): the sky and its light through the day, the weather
 * over it, the biome's air and auroras, the fog and the underwater fog. Writes the sky dome, the
 * chunk and box uniforms (sun, light, haze, mist, wetness) and three's fog each frame.
 */
export class Atmosphere {
  readonly sky: Sky;
  /** The sky's light now (`sunLightAt`): what lights and shades the world. */
  readonly light = createSunLight();
  /** The weather shown: clouds, fog and a lightning flash, 0–1; the sky's dim. */
  readonly weather: WeatherLook = { cloud: 0, fog: 0, flash: 0, dim: 1, wet: 0 };
  private readonly uniforms: VoxelUniforms;
  private hour = 12;
  private days = 0;
  private daylight = 1;
  private underwater = false;
  /** The biome's air: its colour and auroras now, eased towards those of the biome around. */
  private readonly air = { tint: new Color(1, 1, 1), share: 0, aurora: 0 };
  private readonly airTarget = { tint: new Color(1, 1, 1), hex: '', share: 0, aurora: 0 };
  private readonly cloudLight = new Color();

  constructor(def: SkyDef | undefined, uniforms: VoxelUniforms) {
    this.sky = new Sky(def);
    this.uniforms = uniforms;
  }

  /** The time: hour of the day (0 ≤ hour < 24), its daylight, days into the world (moon phases). */
  setTime(hour: number, daylight: number, days: number): void {
    this.hour = hour;
    this.daylight = daylight;
    this.days = days;
    this.uniforms.uDaylight.value = this.litDaylight();
  }

  setWeather(look: Readonly<WeatherLook>): void {
    Object.assign(this.weather, look);
    this.uniforms.uDaylight.value = this.litDaylight();
  }

  /**
   * The biome around the camera: its air's colour ('#rrggbb', null: none, the air fades out) and
   * its auroras 0–1 by night. The sky moves to them over AIR_FADE_SECONDS.
   */
  setAir(tint: string | null, aurora: number): void {
    const target = this.airTarget;
    if (tint !== null && tint !== target.hex) {
      target.hex = tint;
      target.tint.set(tint);
    }
    target.share = tint === null ? 0 : 1;
    target.aurora = aurora;
  }

  /** The air eased towards the biome's over `dt` seconds. */
  private easeAir(dt: number): void {
    const { air, airTarget } = this;
    const step = Math.min(1, dt / AIR_FADE_SECONDS);
    // A first biome shows at once: no fade from white.
    if (air.share === 0) air.tint.copy(airTarget.tint);
    air.tint.lerp(airTarget.tint, step);
    air.share = approach(air.share, airTarget.share, step);
    air.aurora = approach(air.aurora, airTarget.aurora, step);
  }

  setUnderwater(underwater: boolean): void {
    this.underwater = underwater;
    this.uniforms.uUnderwater.value = underwater ? 1 : 0;
  }

  /** The sky's light on the blocks: the hour's under the clouds, a flash on top. */
  private litDaylight(): number {
    const w = this.weather;
    return Math.min(1, this.daylight * w.dim + FLASH_LIGHT * w.flash);
  }

  /**
   * One frame of `dt` seconds: the sky at the hour under the air and the weather, the light it
   * gives, and the fog (`near`/`far`: the render distance's) or the underwater fog. `seconds`
   * moves clouds and auroras.
   */
  update(
    fog: Fog,
    background: Color,
    near: number,
    far: number,
    dt: number,
    seconds: number,
  ): void {
    const { sky, uniforms, weather } = this;
    this.easeAir(dt);
    sky.update(this.hour, this.days);
    this.airSky();
    this.weatherSky();
    const colors = sky.colors;
    uniforms.uZenith.value.copy(colors.zenith);
    uniforms.uHorizon.value.copy(colors.horizon);
    const light = sunLightAt(
      sky.sun,
      sky.moons[0] ?? null,
      colors.light,
      weather.cloud,
      this.light,
    );
    uniforms.uSunDir.value.copy(light.direction);
    uniforms.uSunLight.value.copy(light.direct);
    uniforms.uSkyLight.value.copy(light.sky);
    uniforms.uGroundLight.value.copy(light.ground);
    uniforms.uHaze.value.copy(light.haze);
    uniforms.uWetness.value = weather.wet;
    uniforms.uMist.value = this.underwater ? 0 : mistAt(this.hour) * (1 - weather.fog);
    this.cloudLight.copy(colors.light).multiplyScalar(0.12 + 0.78 * this.litDaylight());
    sky.look(
      { cloud: weather.cloud, aurora: this.air.aurora, seconds },
      light.haze,
      this.cloudLight,
    );
    if (this.underwater) {
      // Darker water at night, never black.
      fog.color.copy(WATER_FOG).multiplyScalar(0.2 + 0.8 * uniforms.uDaylight.value);
      fog.near = WATER_FOG_NEAR;
      fog.far = WATER_FOG_FAR;
    } else {
      fog.color.copy(colors.horizon);
      // The weather's fog closes in (thick fog: a third of the render distance).
      fog.near = near * (1 - FOG_NEAR * weather.fog);
      fog.far = far * (1 - FOG_FAR * weather.fog);
    }
    sky.mesh.visible = !this.underwater;
    background.copy(fog.color);
  }

  /** The biome's air shifts the horizon's and the zenith's hue, keeping their brightness. */
  private airSky(): void {
    const { tint, share } = this.air;
    if (share <= 0) return;
    const c = this.sky.colors;
    towards(c.horizon, tint, AIR_HORIZON * share);
    towards(c.zenith, tint, AIR_ZENITH * share);
  }

  /** Clouds grey and darken the sky's colours; a flash whitens them. No allocation. */
  private weatherSky(): void {
    const { cloud, flash } = this.weather;
    if (cloud <= 0 && flash <= 0) return;
    const c = this.sky.colors;
    overcast(c.zenith, cloud, flash);
    overcast(c.horizon, cloud, flash);
  }
}

/** `colour`'s hue moved towards `tint` by `amount`, its brightness kept. */
function towards(colour: Color, tint: Color, amount: number): void {
  air.copy(tint).multiplyScalar(luma(colour) / Math.max(1e-4, luma(tint)));
  colour.lerp(air, amount);
}

/** `colour` greyed and darkened by `cloud`, whitened by `flash`. */
function overcast(colour: Color, cloud: number, flash: number): void {
  const grey = luma(colour) * (1 - CLOUD_DARK * cloud);
  colour.lerp(scratch.setRGB(grey, grey, grey), CLOUD_GREY * cloud);
  colour.lerp(scratch.setRGB(1, 1, 1), FLASH_SKY * flash);
}
