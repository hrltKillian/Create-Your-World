import { DEFAULT_BINDINGS, type KeyBindings, readBindings } from '../input/bindings.ts';
import { QUALITIES, QUALITY_PRESETS, type Quality, SHADOW_SIZES } from '../render/quality.ts';

/**
 * Player settings (docs « Settings »): graphics (render distance, field of view, resolution,
 * particles, shadows, bloom, view bob; a quality preset sets the render distance, the
 * resolution, the particles, the shadows and bloom at once), the controls (mouse, crouch mode, key bindings), the audio buses and the
 * interface scale. Kept in `localStorage` under SETTINGS_KEY as versioned JSON; a missing, blocked
 * or unreadable store gives the defaults, and every field is checked on its own: a bad or missing
 * value (a field an older version did not store) falls back to its default.
 */

export const SETTINGS_KEY = 'cyw.settings.v1';
export const SETTINGS_VERSION = 1;

/** Render distance presets (columns), shortest first. */
export const RENDER_DISTANCES: readonly number[] = [4, 6, 8, 10];
export const FOV_RANGE = { min: 60, max: 100 } as const;
/** Caps of the drawing buffer's pixel ratio (`min(devicePixelRatio, cap)`), lowest first. */
export const PIXEL_RATIOS: readonly number[] = [0.75, 1, 1.5, 2];
/** Mouse sensitivity: a factor of the input's base radians per pixel. */
export const SENSITIVITY_RANGE = { min: 0.25, max: 3 } as const;
/** Interface scale: a factor of the HUD, screens and menus (the `--ui-scale` CSS variable). */
export const UI_SCALE_RANGE = { min: 0.75, max: 1.5 } as const;

/** Window height (px) the interface is drawn for at its own size, and its largest growth. */
const UI_DESIGN_HEIGHT = 800;
const UI_MAX_GROWTH = 2;

/**
 * The interface's scale (plan v3 « M35 »): the player's setting times the window's height over
 * UI_DESIGN_HEIGHT (never below 1, at most UI_MAX_GROWTH: ×1.35 at 1080 pixels high), so the
 * HUD and screens read the same on a large screen.
 */
export function uiScaleFor(setting: number, height: number): number {
  // No window height (tests): the interface's own size.
  const growth = height > 0 ? height / UI_DESIGN_HEIGHT : 1;
  return setting * Math.min(UI_MAX_GROWTH, Math.max(1, growth));
}
export const CROUCH_MODES = ['hold', 'toggle'] as const;
export type CrouchMode = (typeof CROUCH_MODES)[number];
/** The quality presets, lowest first (the Settings screen lists them). */
export { QUALITIES, type Quality, SHADOW_SIZES };

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
  /** Resolution: the pixel-ratio cap, one of PIXEL_RATIOS. */
  readonly pixelRatio: number;
  readonly particles: boolean;
  /** The sun's shadow map: texels a side, 0 for none (one of SHADOW_SIZES). */
  readonly shadows: number;
  /** Bloom round what shines, with a multisampled frame (plan v4 « M40 »). */
  readonly bloom: boolean;
  readonly viewBob: boolean;
  /** Brightness of the dark (plan v3 « M28 »): 0 the plain light curve, 1 the brightest. */
  readonly gamma: number;
  readonly sensitivity: number;
  readonly invertY: boolean;
  /** Crouch while its key is held, or each press turns it on or off. */
  readonly crouch: CrouchMode;
  readonly bindings: KeyBindings;
  readonly volumes: Volumes;
  readonly uiScale: number;
}

const MEDIUM = QUALITY_PRESETS.medium;

/** The defaults: the Medium preset, the default keys. */
export const DEFAULT_SETTINGS: Settings = {
  renderDistance: MEDIUM.renderDistance,
  fov: 75,
  pixelRatio: MEDIUM.pixelRatio,
  particles: MEDIUM.particles,
  shadows: MEDIUM.shadows,
  bloom: MEDIUM.bloom,
  viewBob: true,
  gamma: 0,
  sensitivity: 1,
  invertY: false,
  crouch: 'hold',
  bindings: DEFAULT_BINDINGS,
  volumes: { master: 0.8, effects: 1, ambience: 1, ui: 1 },
  uiScale: 1,
};

/** Some settings to change: the volumes and the bindings one entry at a time. */
export type SettingsPatch = Partial<Omit<Settings, 'volumes' | 'bindings'>> & {
  readonly volumes?: Partial<Volumes>;
  readonly bindings?: Partial<KeyBindings>;
};

/** The part of the Web Storage API settings need (`localStorage`, or a fake in tests). */
export type SettingsStore = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

function clamped(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function oneOf<T>(values: readonly T[], value: unknown, fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Settings from parsed JSON: defaults for another version, and for each unusable field. */
export function readSettings(data: unknown): Settings {
  const d = (data ?? {}) as Partial<Record<keyof Settings | 'version', unknown>>;
  if (d.version !== SETTINGS_VERSION) return DEFAULT_SETTINGS;
  const def = DEFAULT_SETTINGS;
  const v = (d.volumes ?? {}) as Partial<Record<keyof Volumes, unknown>>;
  return {
    renderDistance: oneOf(RENDER_DISTANCES, d.renderDistance, def.renderDistance),
    fov: Math.round(clamped(d.fov, FOV_RANGE.min, FOV_RANGE.max, def.fov)),
    pixelRatio: oneOf(PIXEL_RATIOS, d.pixelRatio, def.pixelRatio),
    particles: flag(d.particles, def.particles),
    shadows: oneOf(SHADOW_SIZES, d.shadows, def.shadows),
    bloom: flag(d.bloom, def.bloom),
    viewBob: flag(d.viewBob, def.viewBob),
    gamma: clamped(d.gamma, 0, 1, def.gamma),
    sensitivity: clamped(
      d.sensitivity,
      SENSITIVITY_RANGE.min,
      SENSITIVITY_RANGE.max,
      def.sensitivity,
    ),
    invertY: flag(d.invertY, def.invertY),
    crouch: oneOf(CROUCH_MODES, d.crouch, def.crouch),
    bindings: readBindings(d.bindings),
    volumes: {
      master: clamped(v.master, 0, 1, def.volumes.master),
      effects: clamped(v.effects, 0, 1, def.volumes.effects),
      ambience: clamped(v.ambience, 0, 1, def.volumes.ambience),
      ui: clamped(v.ui, 0, 1, def.volumes.ui),
    },
    uiScale: clamped(d.uiScale, UI_SCALE_RANGE.min, UI_SCALE_RANGE.max, def.uiScale),
  };
}

/** The settings with a patch applied, every field checked as when read from the store. */
export function patchSettings(settings: Settings, patch: SettingsPatch): Settings {
  return readSettings({
    ...settings,
    ...patch,
    version: SETTINGS_VERSION,
    volumes: { ...settings.volumes, ...patch.volumes },
    bindings: { ...settings.bindings, ...patch.bindings },
  });
}

/** The quality preset the settings' graphics match, else null. */
export function qualityOf(settings: Settings): Quality | null {
  return (
    QUALITIES.find((quality) => {
      const preset = QUALITY_PRESETS[quality];
      return (
        preset.renderDistance === settings.renderDistance &&
        preset.pixelRatio === settings.pixelRatio &&
        preset.particles === settings.particles &&
        preset.shadows === settings.shadows &&
        preset.bloom === settings.bloom
      );
    }) ?? null
  );
}

/** The settings with a quality preset's graphics: distance, resolution, particles, shadows, bloom. */
export function withQuality(settings: Settings, quality: Quality): Settings {
  const { renderDistance, pixelRatio, particles, shadows, bloom } = QUALITY_PRESETS[quality];
  return { ...settings, renderDistance, pixelRatio, particles, shadows, bloom };
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
