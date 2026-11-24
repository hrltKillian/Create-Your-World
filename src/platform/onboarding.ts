import { browserStore, type SettingsStore } from './settings.ts';

/**
 * What the player has already been shown (docs « Prise en main »): the controls card and each
 * contextual tip, once per browser. Kept in `localStorage` under ONBOARDING_KEY as versioned JSON,
 * apart from the settings; a missing, blocked or unreadable store means nothing was seen yet.
 */

export const ONBOARDING_KEY = 'cyw.onboarding.v1';
export const ONBOARDING_VERSION = 1;

/** The controls card, then the tips: first bag, first mining, thirst, first dusk. */
export const TIPS = ['controls', 'bag', 'mine', 'drink', 'dusk'] as const;
export type Tip = (typeof TIPS)[number];

/** Nothing shown yet (a new browser). */
export const DEFAULT_SEEN: readonly Tip[] = [];

/** The tips seen, from parsed JSON: none for another version; unknown entries are dropped. */
export function readSeen(data: unknown): Tip[] {
  const d = (data ?? {}) as { version?: unknown; seen?: unknown };
  if (d.version !== ONBOARDING_VERSION || !Array.isArray(d.seen)) return [...DEFAULT_SEEN];
  return TIPS.filter((tip) => (d.seen as unknown[]).includes(tip));
}

/** The stored text (with the schema version), in TIPS order. */
export function writeSeen(seen: readonly Tip[]): string {
  return JSON.stringify({
    version: ONBOARDING_VERSION,
    seen: TIPS.filter((tip) => seen.includes(tip)),
  });
}

/** The tips seen in this browser (none when the store is missing, blocked or unreadable). */
export function loadSeen(store: SettingsStore | null = browserStore()): Tip[] {
  try {
    const text = store?.getItem(ONBOARDING_KEY);
    return text ? readSeen(JSON.parse(text)) : [...DEFAULT_SEEN];
  } catch {
    return [...DEFAULT_SEEN];
  }
}

/** Saves the tips seen; false when the store is blocked or full (they still count in this page). */
export function saveSeen(
  seen: readonly Tip[],
  store: SettingsStore | null = browserStore(),
): boolean {
  try {
    if (!store) return false;
    store.setItem(ONBOARDING_KEY, writeSeen(seen));
    return true;
  } catch {
    return false;
  }
}

/** The tips seen, saved each time one is marked (only kept in memory when `store` is null). */
export class SeenTips {
  private readonly seen: Set<Tip>;
  private readonly store: SettingsStore | null;

  constructor(store: SettingsStore | null) {
    this.store = store;
    this.seen = new Set(loadSeen(store));
  }

  has(tip: Tip): boolean {
    return this.seen.has(tip);
  }

  /** Marks a tip seen; false when it already was. */
  mark(tip: Tip): boolean {
    if (this.seen.has(tip)) return false;
    this.seen.add(tip);
    if (this.store) saveSeen([...this.seen], this.store);
    return true;
  }

  /** The tips seen, in TIPS order. */
  list(): Tip[] {
    return TIPS.filter((tip) => this.seen.has(tip));
  }
}
