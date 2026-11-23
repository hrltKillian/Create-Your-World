import { type EngineStringKey, en } from './en.ts';

/** Keys known at compile time. Content packs extend this set with their own keys. */
export type I18nKey = EngineStringKey;

export type I18nParams = Readonly<Record<string, string | number>>;

const active: Record<string, string> = { ...en };
const missing = new Set<string>();
/** Only English ships for now; number formatting follows this locale. */
const LOCALE = 'en';

/** Adds or overrides strings (used by content packs and future translations). */
export function addStrings(strings: Readonly<Record<string, string>>): void {
  Object.assign(active, strings);
}

export function currentLocale(): string {
  return LOCALE;
}

/** Translates a key, replacing `{name}` placeholders. Unknown keys are recorded and returned as-is. */
export function t(key: I18nKey | (string & {}), params?: I18nParams): string {
  const template = active[key];
  if (template === undefined) {
    missing.add(key);
    return key;
  }
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Keys that were requested but have no string, for the debug hook and tests. */
export function i18nMissing(): string[] {
  return [...missing].sort();
}
