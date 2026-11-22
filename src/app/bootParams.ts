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
};

function flag(params: URLSearchParams, name: string): boolean {
  const value = params.get(name);
  return value === '1' || value === 'true' || value === '';
}

/** Parses `location.search`. When `allowDebug` is false (production), every parameter is ignored. */
export function parseBootParams(search: string, allowDebug: boolean): BootParams {
  if (!allowDebug) return DEFAULT_BOOT_PARAMS;
  const params = new URLSearchParams(search);
  return {
    seed: params.get('seed'),
    skipMenu: flag(params, 'skipMenu'),
    noLock: flag(params, 'noLock'),
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
  };
}
