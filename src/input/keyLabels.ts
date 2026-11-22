import { t } from '../i18n/i18n.ts';

export type LayoutPreset = 'qwerty' | 'azerty' | 'qwertz';

/** Letters that differ from QWERTY, by physical code. */
const PRESETS: Readonly<Record<LayoutPreset, Readonly<Record<string, string>>>> = {
  qwerty: {},
  azerty: {
    KeyQ: 'A',
    KeyW: 'Z',
    KeyA: 'Q',
    KeyZ: 'W',
    KeyM: ',',
    Semicolon: 'M',
    Backquote: '@',
    IntlBackslash: '<',
  },
  qwertz: { KeyY: 'Z', KeyZ: 'Y', Backquote: '^' },
};

/** Codes whose label is a word rather than the printed character. */
const NAMED: Readonly<Record<string, string>> = {
  Space: 'key.space',
  ShiftLeft: 'key.shift',
  ShiftRight: 'key.shift',
  Tab: 'key.tab',
  Escape: 'key.escape',
  Enter: 'key.enter',
  Mouse0: 'key.mouseLeft',
  Mouse1: 'key.mouseMiddle',
  Mouse2: 'key.mouseRight',
};

/** Guesses the layout from the browser language (fr-FR/fr-BE: AZERTY, fr-CH/de: QWERTZ). */
export function presetFromLanguage(language: string): LayoutPreset {
  const lang = language.toLowerCase();
  if (lang === 'fr-ch' || lang.startsWith('de')) return 'qwertz';
  if (lang.startsWith('fr') && lang !== 'fr-ca') return 'azerty';
  return 'qwerty';
}

/**
 * Labels for physical keys. Order of preference: the browser's layout map (Chrome), keys learned
 * from real key presses, an explicit or language-based preset, then QWERTY.
 */
export class KeyLabels {
  private layoutMap: ReadonlyMap<string, string> | null = null;
  private readonly learned = new Map<string, string>();
  private preset: LayoutPreset;
  private forced: LayoutPreset | null = null;

  constructor(language = 'en-US') {
    this.preset = presetFromLanguage(language);
  }

  /** Loads `navigator.keyboard.getLayoutMap()` when available (Chromium, secure context). */
  async loadLayoutMap(
    keyboard: { getLayoutMap(): Promise<ReadonlyMap<string, string>> } | undefined,
  ): Promise<void> {
    if (!keyboard) return;
    try {
      this.layoutMap = await keyboard.getLayoutMap();
    } catch {
      this.layoutMap = null;
    }
  }

  /** Forces a preset (settings or `?kb=`), overriding the layout map and learned keys. */
  force(preset: LayoutPreset | null): void {
    this.forced = preset;
  }

  /** Records what a physical key printed (from a real keydown). */
  learn(code: string, key: string): void {
    if (key.length === 1 && /\p{L}|\p{N}|[@^<,;]/u.test(key))
      this.learned.set(code, key.toUpperCase());
  }

  label(code: string): string {
    const named = NAMED[code];
    if (named) return t(named);
    if (code.startsWith('Digit')) return code.slice(5);
    if (/^F\d+$/.test(code)) return code;
    if (this.forced) return PRESETS[this.forced][code] ?? fallback(code);
    const mapped = this.layoutMap?.get(code);
    if (mapped) return mapped.toUpperCase();
    const learned = this.learned.get(code);
    if (learned) return learned;
    return PRESETS[this.preset][code] ?? fallback(code);
  }
}

function fallback(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  return code;
}
