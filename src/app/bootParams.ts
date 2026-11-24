import { parseQuality, QUALITY_PRESETS, type Quality } from '../render/quality.ts';
import type { WorldType } from '../world/gen/generateColumn.ts';

/** URL parameters that drive deterministic boots for tests and debugging (dev and bench only). */
export interface BootParams {
  readonly seed: string | null;
  /** Boot straight into a new world (implied by `selftest`). */
  readonly skipMenu: boolean;
  /** Id of a saved world to open at boot. */
  readonly world: string | null;
  readonly noLock: boolean;
  readonly debug: boolean;
  readonly storage: 'memory' | 'idb';
  readonly forceNoWebGL: boolean;
  readonly forceNoIdb: boolean;
  readonly scene: string | null;
  readonly freecam: boolean;
  readonly fixedStep: boolean;
  readonly selftest: string | null;
  readonly mute: boolean;
  /** Selftests enforce wall-clock thresholds (`?timing=0` turns them off on slow CI machines). */
  readonly timing: boolean;
  /** Debug render view: quads, ao or light. */
  readonly view: string | null;
  /** Render distance in columns (else the `quality` preset's, else the setting). */
  readonly rd: number | null;
  /** Graphics preset: its pixel-ratio cap and, without `rd`, its render distance. */
  readonly quality: Quality | null;
  /** Cave culling (`?occlusion=0` turns it off). */
  readonly occlusion: boolean;
  /**
   * Benchmark to run once the world is up (`walk`, `fly`, `cave`, `mobs`, `dig`, `load`; fixed
   * drawing-buffer size; implies `skipMenu` and `noLock`).
   */
  readonly bench: string | null;
  readonly worldType: WorldType;
  /** Keyboard layout used for key labels (otherwise detected). */
  readonly kb: 'qwerty' | 'azerty' | 'qwertz' | null;
  /** 'serialize' routes commands and events through JSON. */
  readonly host: string | null;
  /** Hour of the day (0 ≤ hours < 24) the world clock is set to at boot. */
  readonly time: number | null;
  /** The world clock stands still. */
  readonly freezeTime: boolean;
  /**
   * Creatures spawn (`?spawns=0|1`; null: generated worlds only). Off in selftests unless asked, so
   * that no creature walks into the earlier milestones' cases.
   */
  readonly spawns: boolean | null;
  /** Ticks without hostile spawns at the start of a world (`?grace=0`; null: the pack's). */
  readonly grace: number | null;
  /**
   * The controls card and tips (`?onboarding=1`: shown as in a new browser, `0`: never; null: once
   * per browser, but never under automation). See app/onboarding.ts `onboardingMode`.
   */
  readonly onboarding: boolean | null;
}

export const DEFAULT_BOOT_PARAMS: BootParams = {
  seed: null,
  skipMenu: false,
  world: null,
  noLock: false,
  debug: false,
  storage: 'idb',
  forceNoWebGL: false,
  forceNoIdb: false,
  scene: null,
  freecam: false,
  fixedStep: false,
  selftest: null,
  mute: false,
  timing: true,
  view: null,
  rd: null,
  quality: null,
  occlusion: true,
  bench: null,
  worldType: 'default',
  kb: null,
  host: null,
  time: null,
  freezeTime: false,
  spawns: null,
  grace: null,
  onboarding: null,
};

function flag(params: URLSearchParams, name: string): boolean {
  const value = params.get(name);
  return value === '1' || value === 'true' || value === '';
}

/** An hour of the day (0 ≤ h < 24), or null when absent or out of range. */
function hours(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const h = Number(value);
  return Number.isFinite(h) && h >= 0 && h < 24 ? h : null;
}

/** A whole number of at least 0, or null when absent or malformed. */
function ticks(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Parses `location.search`. When `allowDebug` is false (production), every parameter is ignored. */
export function parseBootParams(search: string, allowDebug: boolean): BootParams {
  if (!allowDebug) return DEFAULT_BOOT_PARAMS;
  const params = new URLSearchParams(search);
  // Selftests and benchmarks run in a world, and cannot click through the menus or capture the mouse.
  const automated = params.has('selftest') || params.has('bench');
  const quality = parseQuality(params.get('quality'));
  return {
    seed: params.get('seed'),
    skipMenu: flag(params, 'skipMenu') || automated,
    world: params.get('world'),
    noLock: flag(params, 'noLock') || automated,
    debug: flag(params, 'debug'),
    storage: params.get('storage') === 'memory' ? 'memory' : 'idb',
    forceNoWebGL: flag(params, 'forceNoWebGL'),
    forceNoIdb: flag(params, 'forceNoIdb'),
    scene: params.get('scene'),
    // The fly benchmark flies the free camera.
    freecam: flag(params, 'freecam') || params.get('bench') === 'fly',
    fixedStep: flag(params, 'fixedStep'),
    selftest: params.get('selftest'),
    mute: flag(params, 'mute'),
    timing: params.get('timing') !== '0',
    view: params.get('view'),
    rd: params.has('rd')
      ? Math.max(2, Math.min(12, Number(params.get('rd')) || 6))
      : quality
        ? QUALITY_PRESETS[quality].renderDistance
        : null,
    quality,
    occlusion: params.get('occlusion') !== '0',
    bench: params.get('bench'),
    worldType: (['flat', 'arena'] as const).find((w) => w === params.get('worldType')) ?? 'default',
    kb: (['qwerty', 'azerty', 'qwertz'] as const).find((k) => k === params.get('kb')) ?? null,
    host: params.get('host'),
    time: hours(params.get('time')),
    freezeTime: flag(params, 'freezeTime'),
    spawns: params.has('spawns') ? flag(params, 'spawns') : params.has('selftest') ? false : null,
    grace: ticks(params.get('grace')),
    onboarding: params.has('onboarding') ? flag(params, 'onboarding') : null,
  };
}
