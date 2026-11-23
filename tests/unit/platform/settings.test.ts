import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  readSettings,
  SETTINGS_KEY,
  type Settings,
  type SettingsStore,
  saveSettings,
  writeSettings,
} from '../../../src/platform/settings.ts';

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
  sensitivity: 1.35,
  invertY: true,
  volumes: { master: 0.5, effects: 0.25, ambience: 0, ui: 0.75 },
};

describe('settings', () => {
  it('round trips through localStorage under cyw.settings.v1 with a schema version', () => {
    const store = memoryStore();
    expect(saveSettings(CUSTOM, store)).toBe(true);
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!)).toMatchObject({ version: 1, fov: 92 });
    expect(loadSettings(store)).toEqual(CUSTOM);
    expect(readSettings(JSON.parse(writeSettings(DEFAULT_SETTINGS)))).toEqual(DEFAULT_SETTINGS);
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
      sensitivity: 0.01,
      invertY: 'yes',
      volumes: { master: 2, effects: -1, ambience: 'loud' },
    });
    expect(settings).toEqual({
      renderDistance: DEFAULT_SETTINGS.renderDistance,
      fov: 100,
      sensitivity: 0.25,
      invertY: false,
      volumes: { master: 1, effects: 0, ambience: 1, ui: 1 },
    });
    expect(readSettings({ version: 1, fov: 61.6 }).fov).toBe(62);
  });
});
