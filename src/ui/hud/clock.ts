import { t } from '../../i18n/i18n.ts';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The HUD clock, « 07:30 · Day 1 », for an hour of the day (0 ≤ hour < 24, fractional). */
export function clockText(hour: number, day: number): string {
  // A tick is a whole number of game minutes away from float noise: never show 07:29 at 07:30.
  const minutes = Math.floor(hour * 60 + 1e-6);
  const time = t('hud.time', { h: pad2(Math.floor(minutes / 60) % 24), m: pad2(minutes % 60) });
  return t('hud.clock', { time, day });
}

/** Time left of an effect, « 1:05 », rounded up so that a running effect never shows 0:00. */
export function durationText(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return t('hud.duration', { m: Math.floor(whole / 60), s: pad2(whole % 60) });
}
