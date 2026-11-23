/**
 * Time of day (docs/conception.md « Jour/nuit »): one day is 36 000 ticks (20 min), one game hour
 * 1 500 ticks (50 s), and a world starts at 07:00 of its first day. Pure numbers only: the
 * daylight curve is polynomial, so every machine computes the same value.
 */

export const DAY_TICKS = 36_000;
export const HOUR_TICKS = DAY_TICKS / 24;
/** Hour of the day a new world starts at. */
export const START_HOUR = 7;
/** Sky light factor at night (`uDaylight`, effective light rule). */
export const NIGHT_DAYLIGHT = 0.12;

/** Phase boundaries (hours): dawn 04:30–06:00, day until 18:30, dusk until 20:30, then night. */
const DAWN_START = 4.5;
const DAY_START = 6;
const DUSK_START = 18.5;
const NIGHT_START = 20.5;

export type DayPhase = 'day' | 'dusk' | 'night' | 'dawn';

/** The world clock, part of the simulation state (hashed and saved). */
export interface TimeState {
  /** Ticks since 00:00 of the first day (whole number). */
  ticks: number;
  /** `debug.freezeTime`: the clock stands still while the world keeps ticking. */
  frozen: boolean;
}

/** A new world's clock: 07:00 of day 1, running. */
export function createTime(): TimeState {
  return { ticks: START_HOUR * HOUR_TICKS, frozen: false };
}

/** Tick step 3 (« Temps et phase du jour »): the clock advances one tick unless frozen. */
export function stepTime(time: TimeState): void {
  if (!time.frozen) time.ticks++;
}

/** Hour of the day, 0 ≤ hour < 24 (fractional). */
export function hourOf(ticks: number): number {
  return (ticks % DAY_TICKS) / HOUR_TICKS;
}

/** Day number, 1 on the world's first day. */
export function dayOf(ticks: number): number {
  return Math.floor(ticks / DAY_TICKS) + 1;
}

export function phaseOf(hour: number): DayPhase {
  if (hour >= DAY_START && hour < DUSK_START) return 'day';
  if (hour >= DUSK_START && hour < NIGHT_START) return 'dusk';
  if (hour >= DAWN_START && hour < DAY_START) return 'dawn';
  return 'night';
}

/** Smooth 0→1 ramp over a phase (smoothstep: no kink at either end). */
function ramp(hour: number, from: number, to: number): number {
  const t = (hour - from) / (to - from);
  return t * t * (3 - 2 * t);
}

/** Sky light factor: 1 by day, NIGHT_DAYLIGHT at night, smooth through dusk and dawn. */
export function daylightAt(hour: number): number {
  const span = 1 - NIGHT_DAYLIGHT;
  switch (phaseOf(hour)) {
    case 'day':
      return 1;
    case 'night':
      return NIGHT_DAYLIGHT;
    case 'dusk':
      return 1 - span * ramp(hour, DUSK_START, NIGHT_START);
    case 'dawn':
      return NIGHT_DAYLIGHT + span * ramp(hour, DAWN_START, DAY_START);
  }
}

/**
 * `debug.setTime`: moves the clock to `hours` (0 ≤ hours < 24) of the current day, to the nearest
 * tick but never past the day's last one. Returns false, leaving the clock alone, when `hours` is
 * out of range.
 */
export function setHour(time: TimeState, hours: number): boolean {
  if (!Number.isFinite(hours) || hours < 0 || hours >= 24) return false;
  const tick = Math.min(DAY_TICKS - 1, Math.round(hours * HOUR_TICKS));
  time.ticks = (dayOf(time.ticks) - 1) * DAY_TICKS + tick;
  return true;
}

/** Copy for saving (plain JSON). */
export function serializeTime(time: Readonly<TimeState>): TimeState {
  return { ticks: time.ticks, frozen: time.frozen };
}

/** Reads a saved clock; a malformed one becomes a new world's clock (07:00, running). */
export function deserializeTime(data: unknown): TimeState {
  const time = createTime();
  if (!data || typeof data !== 'object') return time;
  const saved = data as Partial<TimeState>;
  if (typeof saved.ticks === 'number' && Number.isInteger(saved.ticks) && saved.ticks >= 0)
    time.ticks = saved.ticks;
  if (typeof saved.frozen === 'boolean') time.frozen = saved.frozen;
  return time;
}
