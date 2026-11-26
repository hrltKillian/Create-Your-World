import { describe, expect, it } from 'vitest';
import { createGenContext } from '../../src/world/gen/generateColumn.ts';
import { findSpawn } from '../../src/world/gen/spawn.ts';
import { registry } from '../helpers/registry.ts';

/**
 * The spawn search runs on the main thread when a world starts. Apple M4: seeds 1–300 take at most
 * about 0.13 s with the surfaces memoized (up to 0.6 s before); the colony's ruins (plan v3
 * « M26 ») add a structure check to the columns it reads: about 0.48 s at worst.
 */
const SPAWN_WORST_MS = 600;
const SEEDS = 300;

describe('spawn performance', () => {
  it(`finds the spawn of seeds 1–${SEEDS} in ≤ ${SPAWN_WORST_MS} ms each`, () => {
    let worst = 0;
    let worstSeed = '';
    for (let i = 1; i <= SEEDS; i++) {
      const ctx = createGenContext(String(i), registry);
      const t0 = performance.now();
      findSpawn(ctx);
      const ms = performance.now() - t0;
      if (ms > worst) {
        worst = ms;
        worstSeed = String(i);
      }
    }
    console.info(`spawn worst ${worst.toFixed(0)} ms (seed ${worstSeed})`);
    expect(worst).toBeLessThanOrEqual(SPAWN_WORST_MS);
  }, 120_000);
});
