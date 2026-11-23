import type { WorldType } from '../world/gen/generateColumn.ts';

/** URL parameters that drive deterministic boots for tests and debugging (dev and bench only). */
export interface BootParams {
  readonly seed: string | null;
  readonly skipMenu: boolean;
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
  /** Debug render view: quads, ao or light. */
  readonly view: string | null;
  /** Render distance in columns. */
  readonly rd: number | null;
  /** Benchmark run (fixed drawing-buffer size). */
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
}

export const DEFAULT_BOOT_PARAMS: BootParams = {
  seed: null,
  skipMenu: false,
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
  view: null,
  rd: null,
  bench: null,
  worldType: 'default',
  kb: null,
  host: null,
  time: null,
  freezeTime: false,
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

/** Parses `location.search`. When `allowDebug` is false (production), every parameter is ignored. */
export function parseBootParams(search: string, allowDebug: boolean): BootParams {
  if (!allowDebug) return DEFAULT_BOOT_PARAMS;
  const params = new URLSearchParams(search);
  return {
    seed: params.get('seed'),
    skipMenu: flag(params, 'skipMenu'),
    // Automated selftests cannot click to capture the mouse.
    noLock: flag(params, 'noLock') || params.has('selftest'),
    debug: flag(params, 'debug'),
    storage: params.get('storage') === 'memory' ? 'memory' : 'idb',
    forceNoWebGL: flag(params, 'forceNoWebGL'),
    forceNoIdb: flag(params, 'forceNoIdb'),
    scene: params.get('scene'),
    freecam: flag(params, 'freecam'),
    fixedStep: flag(params, 'fixedStep'),
    selftest: params.get('selftest'),
    mute: flag(params, 'mute'),
    view: params.get('view'),
    rd: params.has('rd') ? Math.max(2, Math.min(12, Number(params.get('rd')) || 6)) : null,
    bench: params.get('bench'),
    worldType: (['flat', 'arena'] as const).find((w) => w === params.get('worldType')) ?? 'default',
    kb: (['qwerty', 'azerty', 'qwertz'] as const).find((k) => k === params.get('kb')) ?? null,
    host: params.get('host'),
    time: hours(params.get('time')),
    freezeTime: flag(params, 'freezeTime'),
  };
}
