/** Hashing helpers that only use integer operations (identical on every JS engine). */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit hash of a string (UTF-16 code units, low byte then high byte when > 0xff). */
export function fnv1aString(str: string, seed: number = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    h ^= code & 0xff;
    h = Math.imul(h, FNV_PRIME);
    if (code > 0xff) {
      h ^= code >>> 8;
      h = Math.imul(h, FNV_PRIME);
    }
  }
  return h >>> 0;
}

/** FNV-1a 32-bit hash of bytes. */
export function fnv1aBytes(bytes: ArrayLike<number>, seed: number = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]! & 0xff;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Folds one 32-bit integer into a running FNV-1a hash (4 bytes, little endian). */
export function fnv1aU32(h: number, value: number): number {
  let x = h >>> 0;
  for (let i = 0; i < 4; i++) {
    x ^= (value >>> (i * 8)) & 0xff;
    x = Math.imul(x, FNV_PRIME);
  }
  return x >>> 0;
}

/** Final avalanche step (murmur3 fmix32). */
export function fmix32(value: number): number {
  let h = value | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hashes up to four integers (e.g. a seed and block coordinates) into a 32-bit value. */
export function hash32(a: number, b = 0, c = 0, d = 0): number {
  let h = fmix32(a ^ 0x9e3779b9);
  h = fmix32(h ^ Math.imul(b | 0, 0x85ebca6b));
  h = fmix32(h ^ Math.imul(c | 0, 0xc2b2ae35));
  h = fmix32(h ^ Math.imul(d | 0, 0x27d4eb2f));
  return h;
}

/** `hash32` mapped to a float in [0, 1). */
export function hashUnit(a: number, b = 0, c = 0, d = 0): number {
  return hash32(a, b, c, d) / 4294967296;
}
