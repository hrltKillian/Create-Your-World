/** Moves `from` towards `to` by at most `step` (a linear ease, frame by frame). */
export function approach(from: number, to: number, step: number): number {
  return from < to ? Math.min(to, from + step) : Math.max(to, from - step);
}
