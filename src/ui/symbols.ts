import { fmtNumber } from '../i18n/fmt.ts';
import { t } from '../i18n/i18n.ts';
import { h } from './h.ts';

/*
 * The gauges in their own unit (plan v3 « M30 »): a symbol is a tenth of a gauge, as its row on
 * the HUD draws it (10 vital cells of health, 10 ration pods of food…). Every number of a gauge
 * the player reads (a food, a blow, a skill) is counted in its symbols and shown with one.
 */

/** Symbols in a gauge's row on the HUD: each a tenth of the gauge. */
export const ROW_ICONS = 10;

/** The gauges drawn as rows of symbols, each with its own symbol. */
export type GaugeSymbol = 'health' | 'hunger' | 'thirst' | 'toxicity' | 'breath';

/** `points` of a gauge of `max` points, in its symbols. */
export function inSymbols(points: number, max: number): number {
  return (points / max) * ROW_ICONS;
}

/** A count of symbols, one decimal at most (« 1.5 », « 3 », « 0.4 »). */
export function symbolCount(n: number): string {
  const r = Math.round(n * 10) / 10;
  return fmtNumber(r, Number.isInteger(r) ? 0 : 1);
}

/** A line with a gauge's symbol drawn after `text`, then `after` (« Food +1.5 ⬢ »). */
export interface SymbolLine {
  readonly text: string;
  readonly symbol: GaugeSymbol;
  readonly after?: string;
}

/** A line of a description: plain text, or text with a symbol. */
export type InfoLine = string | SymbolLine;

/** The plain text of a line (labels, tests): the symbol named. */
export function lineText(line: InfoLine): string {
  if (typeof line === 'string') return line;
  return `${line.text} ${t(`symbol.${line.symbol}`)}${line.after ?? ''}`;
}

/** A gauge's symbol drawn small, inline. */
export function miniSymbol(symbol: GaugeSymbol): HTMLElement {
  return h('span', {
    class: `mini-icon gauge-${symbol}`,
    attrs: { role: 'img', 'aria-label': t(`symbol.${symbol}`) },
  });
}

/** A line's element: its text, its symbol, the rest. */
export function lineElement(line: InfoLine, className: string): HTMLElement {
  if (typeof line === 'string') return h('span', { class: className }, line);
  return h(
    'span',
    { class: className },
    line.text,
    miniSymbol(line.symbol),
    ...(line.after ? [line.after] : []),
  );
}
