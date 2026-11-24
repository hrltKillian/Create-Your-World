import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEEN,
  loadSeen,
  ONBOARDING_KEY,
  readSeen,
  SeenTips,
  saveSeen,
  TIPS,
  writeSeen,
} from '../../../src/platform/onboarding.ts';
import { SETTINGS_KEY, type SettingsStore } from '../../../src/platform/settings.ts';

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

describe('onboarding store', () => {
  it('round trips the tips seen under its own key, apart from the settings', () => {
    const store = memoryStore();
    expect(saveSeen(['dusk', 'controls'], store)).toBe(true);
    expect([...store.data.keys()]).toEqual([ONBOARDING_KEY]);
    expect(ONBOARDING_KEY).not.toBe(SETTINGS_KEY);
    expect(JSON.parse(store.data.get(ONBOARDING_KEY)!)).toEqual({
      version: 1,
      seen: ['controls', 'dusk'],
    });
    expect(loadSeen(store)).toEqual(['controls', 'dusk']);
    expect(readSeen(JSON.parse(writeSeen(TIPS)))).toEqual([...TIPS]);
    expect(readSeen(JSON.parse(writeSeen(DEFAULT_SEEN)))).toEqual([]);
  });

  it('has seen nothing without a store, for bad JSON, another version or unknown entries', () => {
    expect(DEFAULT_SEEN).toEqual([]);
    expect(loadSeen(memoryStore())).toEqual([]);
    expect(loadSeen(null)).toEqual([]);
    const store = memoryStore();
    store.setItem(ONBOARDING_KEY, '{not json');
    expect(loadSeen(store)).toEqual([]);
    expect(readSeen({ version: 2, seen: ['controls'] })).toEqual([]);
    expect(readSeen({ version: 1, seen: 'controls' })).toEqual([]);
    expect(readSeen({ version: 1, seen: ['mine', 'teleport', 3, 'mine'] })).toEqual(['mine']);
    expect(readSeen(null)).toEqual([]);
  });

  it('survives blocked storage: nothing seen on load, false on save', () => {
    expect(loadSeen(blocked)).toEqual([]);
    expect(saveSeen(['bag'], blocked)).toBe(false);
    expect(saveSeen(['bag'], null)).toBe(false);
  });

  it('marks each tip once and saves it at once; a null store keeps them in memory', () => {
    const store = memoryStore();
    const seen = new SeenTips(store);
    expect(seen.has('mine')).toBe(false);
    expect(seen.mark('mine')).toBe(true);
    expect(seen.mark('mine')).toBe(false);
    expect(seen.mark('controls')).toBe(true);
    expect(seen.list()).toEqual(['controls', 'mine']);
    // Another page of the same browser sees them.
    expect(new SeenTips(store).list()).toEqual(['controls', 'mine']);
    const memory = new SeenTips(null);
    expect(memory.mark('bag')).toBe(true);
    expect(memory.has('bag')).toBe(true);
    expect(new SeenTips(null).has('bag')).toBe(false);
    // A blocked store still counts the tips in this page.
    const page = new SeenTips(blocked);
    expect(page.mark('drink')).toBe(true);
    expect(page.has('drink')).toBe(true);
  });
});
