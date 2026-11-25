import { t } from '../../i18n/i18n.ts';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The HUD clock, « 07:30 · Day 1 », for an hour of the day (0 ≤ hour < 24, fractional). */
export function clockText(hour: number, day: number): string {
  // A tick is a whole number of game minutes away from float noise: never show 07:29 at 07:30.
  const minutes = Math.floor(hour * 60 + 1e-6);
  const time = t('hud.time', { h: pad2(Math.floor(minutes / 60) % 24), m: pad2(minutes % 60) });
  return t('hud.clock', { time, day });
}
