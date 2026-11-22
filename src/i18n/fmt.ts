import { currentLocale } from './i18n.ts';

const formats = new Map<string, Intl.NumberFormat>();

/** Locale-aware number formatting (cached formatters). */
export function fmtNumber(value: number, fractionDigits = 0): string {
  const key = `${currentLocale()}:${fractionDigits}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(currentLocale(), {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formats.set(key, format);
  }
  return format.format(value);
}

/** Bytes as KB/MB with one decimal. */
export function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${fmtNumber(bytes / (1024 * 1024), 1)} MB`;
  return `${fmtNumber(bytes / 1024, 1)} KB`;
}
