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

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Bytes as KB/MB/GB with one decimal. */
export function fmtBytes(bytes: number): string {
  if (bytes >= GB) return `${fmtNumber(bytes / GB, 1)} GB`;
  if (bytes >= MB) return `${fmtNumber(bytes / MB, 1)} MB`;
  return `${fmtNumber(bytes / 1024, 1)} KB`;
}

let dates: Intl.DateTimeFormat | null = null;

/** A date and time (milliseconds since 1970), medium date and short time. */
export function fmtDate(ms: number): string {
  dates ??= new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  return dates.format(ms);
}
