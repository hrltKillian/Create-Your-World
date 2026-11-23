/**
 * Player settings (docs « Settings »): render distance, field of view, mouse, audio buses. Kept in
 * `localStorage` under SETTINGS_KEY as versioned JSON; a missing, blocked or unreadable store gives
 * the defaults, and every field is checked on its own (a bad value falls back to its default).
 */

export const SETTINGS_KEY = 'cyw.settings.v1';
export const SETTINGS_VERSION = 1;

/** Render distance presets (columns), shortest first. */
export const RENDER_DISTANCES: readonly number[] = [4, 6, 8, 10];
export const FOV_RANGE = { min: 60, max: 100 } as const;
/** Mouse sensitivity: a factor of the input's base radians per pixel. */
export const SENSITIVITY_RANGE = { min: 0.25, max: 3 } as const;

/** Linear gains (0–1) of the four audio buses. */
export interface Volumes {
  readonly master: number;
  readonly effects: number;
  readonly ambience: number;
  readonly ui: number;
}

export interface Settings {
  /** Columns, one of RENDER_DISTANCES. */
  readonly renderDistance: number;
  /** Vertical field of view in degrees. */
  readonly fov: number;
  readonly sensitivity: number;
  readonly invertY: boolean;
  readonly volumes: Volumes;
}

export const DEFAULT_SETTINGS: Settings = {
  renderDistance: 6,
  fov: 75,
  sensitivity: 1,
  invertY: false,
  volumes: { master: 0.8, effects: 1, ambience: 1, ui: 1 },
};

/** The part of the Web Storage API settings need (`localStorage`, or a fake in tests). */
export type SettingsStore = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

function clamped(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** Settings from parsed JSON: defaults for another version, and for each unusable field. */
export function readSettings(data: unknown): Settings {
  const d = (data ?? {}) as Partial<Record<keyof Settings | 'version', unknown>>;
  if (d.version !== SETTINGS_VERSION) return DEFAULT_SETTINGS;
  const def = DEFAULT_SETTINGS;
  const v = (d.volumes ?? {}) as Partial<Record<keyof Volumes, unknown>>;
  return {
    renderDistance: RENDER_DISTANCES.includes(d.renderDistance as number)
      ? (d.renderDistance as number)
      : def.renderDistance,
    fov: Math.round(clamped(d.fov, FOV_RANGE.min, FOV_RANGE.max, def.fov)),
    sensitivity: clamped(
      d.sensitivity,
      SENSITIVITY_RANGE.min,
      SENSITIVITY_RANGE.max,
      def.sensitivity,
    ),
    invertY: typeof d.invertY === 'boolean' ? d.invertY : def.invertY,
    volumes: {
      master: clamped(v.master, 0, 1, def.volumes.master),
      effects: clamped(v.effects, 0, 1, def.volumes.effects),
      ambience: clamped(v.ambience, 0, 1, def.volumes.ambience),
      ui: clamped(v.ui, 0, 1, def.volumes.ui),
    },
  };
}

/** The stored text of the settings (with the schema version). */
export function writeSettings(settings: Settings): string {
  return JSON.stringify({ version: SETTINGS_VERSION, ...settings });
}

/** `localStorage`, or null where it is blocked (reading the property itself may throw). */
export function browserStore(): SettingsStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The saved settings, or the defaults when there are none or they cannot be read. */
export function loadSettings(store: SettingsStore | null = browserStore()): Settings {
  try {
    const text = store?.getItem(SETTINGS_KEY);
    return text ? readSettings(JSON.parse(text)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Saves the settings; false when the store is blocked or full (they still apply to this page). */
export function saveSettings(
  settings: Settings,
  store: SettingsStore | null = browserStore(),
): boolean {
  try {
    if (!store) return false;
    store.setItem(SETTINGS_KEY, writeSettings(settings));
    return true;
  } catch {
    return false;
  }
}
