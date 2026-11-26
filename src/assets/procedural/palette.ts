/** sRGB palettes of the pack textures and icons. */

export function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Writes the colour at `tone` (a palette position: 2.25 is a quarter of the way from colour 2 to
 * colour 3) into `out` at `o`. A whole tone is that colour exactly (icons, seams, accents).
 */
export function writeTone(
  colors: readonly (readonly [number, number, number])[],
  tone: number,
  out: Uint8Array,
  o: number,
): void {
  const last = colors.length - 1;
  const t = Math.min(last, Math.max(0, tone));
  const i = Math.floor(t);
  const f = t - i;
  const a = colors[i]!;
  const b = colors[i < last ? i + 1 : i]!;
  out[o] = Math.round(a[0] + (b[0] - a[0]) * f);
  out[o + 1] = Math.round(a[1] + (b[1] - a[1]) * f);
  out[o + 2] = Math.round(a[2] + (b[2] - a[2]) * f);
}
