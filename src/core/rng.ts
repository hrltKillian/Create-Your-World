/**
 * Deterministic pseudo-random numbers.
 *
 * - `xmur3` hashes a string into a stream of 32-bit seeds.
 * - `sfc32` is a small, fast generator whose whole state is four 32-bit integers,
 *   so it can be stored in the simulation state and saved.
 *
 * Both algorithms are public domain (bryc's PRNG notes).
 */

export type RngState = [number, number, number, number];

/** String hash producing successive 32-bit unsigned seeds. */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** Builds the initial state of a stream identified by a seed and a salt. */
export function seedState(seed: string, salt: string): RngState {
  const h = xmur3(`${seed}:${salt}`);
  const state: RngState = [h(), h(), h(), h()];
  // Warm up so that close seeds diverge quickly.
  for (let i = 0; i < 12; i++) sfc32Next(state);
  return state;
}

/** Advances `s` in place and returns a float in [0, 1). */
export function sfc32Next(s: RngState): number {
  const a = s[0] | 0;
  const b = s[1] | 0;
  const c = s[2] | 0;
  const d = s[3] | 0;
  const t = (((a + b) | 0) + d) | 0;
  s[3] = (d + 1) | 0;
  s[0] = b ^ (b >>> 9);
  s[1] = (c + (c << 3)) | 0;
  const c2 = (c << 21) | (c >>> 11);
  s[2] = (c2 + t) | 0;
  return (t >>> 0) / 4294967296;
}

/** A serializable random stream. */
export class Rng {
  private readonly s: RngState;

  constructor(state: RngState) {
    this.s = [state[0], state[1], state[2], state[3]];
  }

  static fromSeed(seed: string, salt: string): Rng {
    return new Rng(seedState(seed, salt));
  }

  /** Float in [0, 1). */
  next(): number {
    return sfc32Next(this.s);
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] (inclusive). */
  intRange(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Copy of the internal state, for saving. */
  state(): RngState {
    return [this.s[0], this.s[1], this.s[2], this.s[3]];
  }
}

/** A plain `() => number` generator, the shape simplex-noise expects. */
export function rngFor(seed: string, salt: string): () => number {
  const state = seedState(seed, salt);
  return () => sfc32Next(state);
}
