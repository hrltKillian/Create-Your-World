import type { CameraPose, WeatherLook, WorldView } from '../render/WorldView.ts';
import type { SimEvent } from '../sim/events.ts';
import type { SimView } from '../sim/host.ts';
import { dimOf, isWet, precipitationOf, type WeatherKind } from '../sim/weather.ts';

/*
 * The weather as the client shows it (plan v3 « M34 »): the simulation's kind, eased in and out
 * over WEATHER_FADE_SECONDS: clouds that grey the sky and dim its light, fog that closes in, rain
 * or snow where the biome under the camera has it (render/Precipitation.ts), and the flash of a
 * lightning strike nearby. The ambience reads `rain` and `snow` for its rain loop (AudioBridge).
 */

/** Seconds a change of weather takes to show. */
export const WEATHER_FADE_SECONDS = 5;
/** A flash fades in this time (s); strikes farther than FLASH_REACH blocks light nothing. */
const FLASH_SECONDS = 0.4;
const FLASH_REACH = 160;
/** How cloudy and foggy each kind looks (0–1). */
const CLOUD: Readonly<Record<WeatherKind, number>> = { clear: 0, rain: 0.6, storm: 1, fog: 0.5 };
const FOG: Readonly<Record<WeatherKind, number>> = { clear: 0, rain: 0.3, storm: 0.45, fog: 1 };

/** Moves `from` towards `to` by at most `step`. */
function ease(from: number, to: number, step: number): number {
  return from < to ? Math.min(to, from + step) : Math.max(to, from - step);
}

export class WeatherFeel {
  /** Rain and snow falling around the camera, eased (0–1). */
  rain = 0;
  snow = 0;
  private readonly look: WeatherLook = { cloud: 0, fog: 0, flash: 0, dim: 1 };
  private readonly view: WorldView;
  private readonly sim: SimView;
  private flashX = 0;
  private flashZ = 0;
  private struck = false;
  /** Where rain and snow stop falling: the top of a block column. */
  private readonly floorAt = (x: number, z: number) => this.sim.world.heightAt(x, z);

  constructor(view: WorldView, sim: SimView) {
    this.view = view;
    this.sim = sim;
  }

  /** The weather's look now (automation). */
  get state(): Readonly<WeatherLook> {
    return this.look;
  }

  /** Rain drops or snowflakes drawn on the last frame (automation). */
  drops(): number {
    return this.view.precipitation.drawn;
  }

  /** A lightning strike: the flash, when it is near enough (on the next frame). */
  onEvent(event: SimEvent): void {
    if (event.type !== 'lightning') return;
    this.flashX = event.x;
    this.flashZ = event.z;
    this.struck = true;
  }

  /** The world closes: the sky clears and nothing falls (the world view outlives it). */
  dispose(): void {
    const look = this.look;
    look.cloud = look.fog = look.flash = 0;
    look.dim = 1;
    this.rain = this.snow = 0;
    this.view.setWeather(look);
    this.view.precipitation.update(0, 0, 0, 0, 0, 0, this.floorAt);
  }

  /** One frame of `dt` seconds seen from the camera `pose`. */
  frame(dt: number, pose: CameraPose): void {
    const { world, gen, registry } = this.sim;
    const kind = this.sim.weather();
    const step = dt / WEATHER_FADE_SECONDS;
    const x = Math.floor(pose.x);
    const z = Math.floor(pose.z);
    const biome = world.biomeAt(x, z);
    const falls = isWet(kind)
      ? precipitationOf(biome < 0 ? undefined : gen.biomeDefs[biome])
      : 'none';
    this.rain = ease(this.rain, falls === 'rain' ? 1 : 0, step);
    this.snow = ease(this.snow, falls === 'snow' ? 1 : 0, step);
    const look = this.look;
    look.cloud = ease(look.cloud, CLOUD[kind], step);
    look.fog = ease(look.fog, FOG[kind], step);
    look.dim = ease(look.dim, dimOf(kind, registry.pack.balance.weather), step);
    if (this.struck && Math.hypot(this.flashX - pose.x, this.flashZ - pose.z) <= FLASH_REACH)
      look.flash = 1;
    this.struck = false;
    look.flash = Math.max(0, look.flash - dt / FLASH_SECONDS);
    this.view.setWeather(look);
    const { rain, snow, floorAt } = this;
    this.view.precipitation.update(dt, pose.x, pose.y, pose.z, rain, snow, floorAt);
  }
}
