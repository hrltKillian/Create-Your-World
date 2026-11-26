import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../../../src/input/bindings.ts';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  PIXEL_RATIOS,
  patchSettings,
  QUALITIES,
  qualityOf,
  RENDER_DISTANCES,
  readSettings,
  SETTINGS_KEY,
  type Settings,
  type SettingsStore,
  SHADOW_SIZES,
  saveSettings,
  withQuality,
  writeSettings,
} from '../../../src/platform/settings.ts';
import { DEFAULT_QUALITY, QUALITY_PRESETS } from '../../../src/render/quality.ts';

/** An in-memory `localStorage`. */
function memoryStore(): SettingsStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

/** A store that refuses everything (blocked site data, private mode, full quota). */
const blocked: SettingsStore = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
};

const CUSTOM: Settings = {
  renderDistance: 10,
  fov: 92,
  pixelRatio: 0.75,
  particles: false,
  shadows: 2048,
  viewBob: false,
  gamma: 0.6,
  sensitivity: 1.35,
  invertY: true,
  crouch: 'toggle',
  bindings: { ...DEFAULT_BINDINGS, jump: ['KeyK'], inventory: ['KeyI', 'Tab'], pause: ['KeyP'] },
  volumes: { master: 0.5, effects: 0.25, ambience: 0, ui: 0.75 },
  uiScale: 1.25,
};

/** What M7 to M10 stored: the fields before M11 only. */
const OLDER = {
  version: 1,
  renderDistance: 8,
  fov: 90,
  sensitivity: 2,
  invertY: true,
  volumes: { master: 0.4, effects: 0.5, ambience: 0.6, ui: 0.7 },
};

describe('settings', () => {
  it('round trips through localStorage under cyw.settings.v1 with a schema version', () => {
    const store = memoryStore();
    expect(saveSettings(CUSTOM, store)).toBe(true);
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!)).toMatchObject({ version: 1, fov: 92 });
    expect(loadSettings(store)).toEqual(CUSTOM);
    expect(readSettings(JSON.parse(writeSettings(DEFAULT_SETTINGS)))).toEqual(DEFAULT_SETTINGS);
  });

  it('loads settings stored before the M11 fields, with their defaults', () => {
    const store = memoryStore();
    store.setItem(SETTINGS_KEY, JSON.stringify(OLDER));
    const { version: _, ...older } = OLDER;
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, ...older });
  });

  it('gives the defaults without saved settings, for bad JSON and for another version', () => {
    expect(loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    const store = memoryStore();
    store.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ ...CUSTOM, version: 2 })).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('survives blocked storage: defaults on load, false on save', () => {
    expect(loadSettings(blocked)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(CUSTOM, blocked)).toBe(false);
    expect(saveSettings(CUSTOM, null)).toBe(false);
  });

  it('checks each field on its own: out of range clamped, unusable ones back to default', () => {
    const settings = readSettings({
      version: 1,
      renderDistance: 7,
      fov: 140.4,
      pixelRatio: 3,
      particles: 'off',
      viewBob: 0,
      sensitivity: 0.01,
      invertY: 'yes',
      crouch: 'sticky',
      bindings: { ...DEFAULT_BINDINGS, jump: ['AltLeft'], drop: ['KeyQ'] },
      volumes: { master: 2, effects: -1, ambience: 'loud' },
      uiScale: 9,
    });
    expect(settings).toEqual({
      ...DEFAULT_SETTINGS,
      fov: 100,
      sensitivity: 0.25,
      bindings: { ...DEFAULT_BINDINGS, drop: ['KeyQ'] },
      volumes: { master: 1, effects: 0, ambience: 1, ui: 1 },
      uiScale: 1.5,
    });
    expect(readSettings({ version: 1, fov: 61.6 }).fov).toBe(62);
    expect(readSettings({ version: 1, uiScale: 0.1 }).uiScale).toBe(0.75);
    expect(readSettings({ version: 1, gamma: 4 }).gamma).toBe(1);
    expect(readSettings({ version: 1, gamma: 'bright' }).gamma).toBe(0);
    expect(readSettings({ version: 1, shadows: 512 }).shadows).toBe(DEFAULT_SETTINGS.shadows);
    expect(readSettings({ version: 1, shadows: 0 }).shadows).toBe(0);
  });

  it('starts on the Medium preset; each preset is a choice of the screen and found again', () => {
    expect(qualityOf(DEFAULT_SETTINGS)).toBe(DEFAULT_QUALITY);
    for (const quality of QUALITIES) {
      const preset = QUALITY_PRESETS[quality];
      expect(RENDER_DISTANCES).toContain(preset.renderDistance);
      expect(PIXEL_RATIOS).toContain(preset.pixelRatio);
      expect(SHADOW_SIZES).toContain(preset.shadows);
      const settings = withQuality(CUSTOM, quality);
      expect(settings).toEqual({ ...CUSTOM, ...preset });
      expect(qualityOf(settings)).toBe(quality);
    }
    // A render distance no preset has: none.
    expect(qualityOf({ ...withQuality(CUSTOM, 'high'), renderDistance: 10 })).toBeNull();
    // Shadows off on the medium preset (plan v4 « M37 »): none either; the low preset has none.
    expect(qualityOf({ ...withQuality(CUSTOM, 'medium'), shadows: 0 })).toBeNull();
    expect(QUALITY_PRESETS.low.shadows).toBe(0);
  });

  it('patches settings like the debug hook: volumes and bindings by entry, each field checked', () => {
    const patched = patchSettings(CUSTOM, {
      fov: 70,
      volumes: { ui: 0.1 },
      bindings: { drop: ['KeyQ'] },
    });
    expect(patched).toEqual({
      ...CUSTOM,
      fov: 70,
      volumes: { ...CUSTOM.volumes, ui: 0.1 },
      bindings: { ...CUSTOM.bindings, drop: ['KeyQ'] },
    });
    expect(patchSettings(CUSTOM, { renderDistance: 5 }).renderDistance).toBe(
      DEFAULT_SETTINGS.renderDistance,
    );
    // A key another action holds: the bindings go back to the defaults.
    expect(patchSettings(CUSTOM, { bindings: { drop: ['KeyK'] } }).bindings).toBe(DEFAULT_BINDINGS);
  });
});
