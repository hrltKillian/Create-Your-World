import { expect, type Page, test } from '@playwright/test';
import { pageErrors } from './selftest.ts';

/**
 * Performance on the bench build (docs « Mesure de performance », M11 « Fait quand »): local only,
 * with `npm run e2e:perf`, which builds the bench build and serves it on :4174 (a `npm run bench`
 * already running is reused: restart it after a change). Skipped on CI (software rendering) and in
 * the plain `npm run e2e`. Preset Medium (RD 6), seed 42.
 */
test.skip(Boolean(process.env.CI) || !process.env.PERF, 'local only: npm run e2e:perf');

const BOOT = 'seed=42&storage=memory&mute=1&quality=medium';
/** Boot, the render distance meshed, then the run (a CPU slowed ×1.7 loads slower too). */
const BENCH_TIMEOUT_MS = 150_000;

/** « `walk` : travail p95 ≤ 9 ms et moins de 1 % d'intervalles > 20 ms ». */
const WALK_P95_MS = 9;
const MAX_LONG_FRAMES = 0.01;
/** « CPU ralenti ×1,7 (Playwright) : travail p95 ≤ 15 ms » (an M1 stand-in). */
const SLOW_CPU = 1.7;
const SLOW_WALK_P95_MS = 15;
const MAX_CAVE_DRAWS = 150;
// −10 % since M16 (connected caves), as in src/app/selftest/m11perf.ts.
const MIN_CAVE_SAVED = 0.1;
const EDIT_TO_MESH_P95_MS = 50;
const PLAYABLE_MS = 3000;

/** Opens the bench build on `?bench=<kind>` and returns the benchmark's result (its banner). */
async function bench(page: Page, kind: string): Promise<Record<string, number>> {
  const errors = pageErrors(page);
  await page.goto(`/?${BOOT}&bench=${kind}`);
  const banner = page.locator('#bench-result');
  await expect(banner).toBeVisible({ timeout: BENCH_TIMEOUT_MS });
  expect(await banner.textContent()).toMatch(new RegExp(`^BENCH ${kind}\\n`));
  expect(errors, 'uncaught page errors').toEqual([]);
  const result = JSON.parse((await banner.getAttribute('data-result')) ?? 'null');
  console.info(`${kind}: ${JSON.stringify(result)}`);
  return result;
}

test(`walk: frame work p95 ≤ ${WALK_P95_MS} ms, under ${MAX_LONG_FRAMES * 100} % of intervals over 20 ms`, async ({
  page,
}) => {
  const walk = await bench(page, 'walk');
  expect(walk.frames).toBeGreaterThan(0);
  expect(walk.workP95).toBeLessThanOrEqual(WALK_P95_MS);
  expect(walk.longFrames).toBeLessThan(MAX_LONG_FRAMES);
});

test(`walk with the CPU slowed ×${SLOW_CPU}: frame work p95 ≤ ${SLOW_WALK_P95_MS} ms`, async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW_CPU });
  const walk = await bench(page, 'walk');
  expect(walk.frames).toBeGreaterThan(0);
  expect(walk.workP95).toBeLessThanOrEqual(SLOW_WALK_P95_MS);
});

test(`cave: ≤ ${MAX_CAVE_DRAWS} draws underground, ${MIN_CAVE_SAVED * 100} % fewer than with ?occlusion=0`, async ({
  page,
}) => {
  const cave = await bench(page, 'cave');
  expect(cave.draws).toBeLessThanOrEqual(MAX_CAVE_DRAWS);
  expect(cave.saved).toBeGreaterThanOrEqual(MIN_CAVE_SAVED);
});

test(`dig: an edit is on screen within ${EDIT_TO_MESH_P95_MS} ms p95`, async ({ page }) => {
  const dig = await bench(page, 'dig');
  expect(dig.edits).toBeGreaterThan(0);
  expect(dig.editToMeshP95).toBeLessThanOrEqual(EDIT_TO_MESH_P95_MS);
});

test(`load: the world is playable within ${PLAYABLE_MS / 1000} s of the navigation`, async ({
  page,
}) => {
  const load = await bench(page, 'load');
  expect(load.playableMs).toBeGreaterThan(0);
  expect(load.playableMs).toBeLessThanOrEqual(PLAYABLE_MS);
});
