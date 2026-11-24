/**
 * The n-th smallest (1-based, n ≥ 1) of the first `count` values, by insertion into a sorted
 * prefix of `sorted` (room for at least n values): the squared distance up to which the n nearest
 * things are drawn (DropView's detailed drops, CreatureView's creatures). No allocation.
 */
export function nthSmallest(
  values: Float64Array,
  count: number,
  n: number,
  sorted: Float64Array,
): number {
  let size = 0;
  for (let i = 0; i < count; i++) {
    const v = values[i]!;
    if (size === n && v >= sorted[n - 1]!) continue;
    let j = size < n ? size++ : n - 1;
    while (j > 0 && sorted[j - 1]! > v) {
      sorted[j] = sorted[j - 1]!;
      j--;
    }
    sorted[j] = v;
  }
  return sorted[n - 1]!;
}
