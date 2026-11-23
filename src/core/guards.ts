/**
 * Guards for data read back from saves, which are never trusted (docs « Sauvegarde »): a stored
 * field is used only once it has the shape the game expects.
 */

/** An integer of at least `min`. */
export function isWhole(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** An object whose x, y and z are finite numbers. */
export function isPoint(value: unknown): value is { x: number; y: number; z: number } {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y, z } = value as Partial<Record<'x' | 'y' | 'z', unknown>>;
  return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z);
}
