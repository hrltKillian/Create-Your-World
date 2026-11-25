import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { CI_FACTOR, type SelftestResult, selftest } from './selftest.ts';

/**
 * `?selftest=all` in each setup the suites need (docs M11 « Fait quand »: 0 failures). Every boot
 * runs every suite; the cases meant for another setup are skipped, and none may fail. The last
 * test checks that every case ran (not skipped) in at least one setup, from the results each boot
 * leaves in test-results/selftest-coverage/.
 */

interface Setup {
  /** Its results file. */
  readonly key: string;
  readonly title: string;
  readonly query: string;
  readonly storage?: 'memory' | 'idb';
  /** Longest wait for the result banner (s, locally: ×4 on CI). */
  readonly seconds: number;
  /** A check of the page once the suites are done. */
  readonly after?: (page: Page) => Promise<void>;
}

const FLAT = 'seed=42&worldType=flat&fixedStep=1&mute=1';

const SETUPS: readonly Setup[] = [
  {
    key: 'testchunk',
    title: 'the test chunk scene: the voxel core (m1)',
    query: 'scene=testchunk',
    seconds: 60,
  },
  {
    key: 'generated',
    title: 'the generated world in real time: streaming, underground, culling and benchmarks',
    query: 'seed=7&rd=4&mute=1',
    seconds: 360,
  },
  {
    key: 'freecam',
    title: 'the generated world from the free camera: streaming and the fly benchmark',
    query: 'seed=7&rd=4&mute=1&freecam=1',
    seconds: 120,
  },
  {
    key: 'generated-fixed',
    title: 'the generated world in fixed steps: survival, the objectives walk and the bot',
    query: 'seed=7&rd=4&fixedStep=1&mute=1',
    storage: 'idb',
    seconds: 600,
  },
  {
    key: 'flat-idb',
    title: 'the flat world with IndexedDB: the player, mining, light, saves and menus',
    query: FLAT,
    storage: 'idb',
    seconds: 180,
  },
  {
    key: 'flat-no-idb',
    title: 'the flat world without IndexedDB: the banner, combat, onboarding tips and feel',
    query: `forceNoIdb=1&${FLAT}`,
    storage: 'idb',
    seconds: 180,
    after: async (page) => {
      await expect(page.locator('#banner-saving')).toBeVisible();
    },
  },
  {
    key: 'flat-spawns',
    title: 'the flat world with natural spawns: hostiles in the dark only',
    query: `${FLAT}&rd=4&spawns=1&grace=0`,
    seconds: 120,
  },
  {
    key: 'arena',
    title: 'the arena: items, stations, chests across a reload and sounds',
    query: 'worldType=arena&fixedStep=1&mute=1',
    storage: 'idb',
    seconds: 180,
  },
];

const COVERAGE_DIR = 'test-results/selftest-coverage';
const coverageFile = (key: string) => `${COVERAGE_DIR}/${key}.json`;

for (const setup of SETUPS) {
  test(`selftest=all in ${setup.title}`, async ({ page }) => {
    test.setTimeout((setup.seconds + 30) * 1000 * CI_FACTOR);
    const { text, results } = await selftest(page, `${setup.query}&selftest=all`, {
      timeout: setup.seconds * 1000,
      storage: setup.storage,
    });
    mkdirSync(COVERAGE_DIR, { recursive: true });
    writeFileSync(coverageFile(setup.key), JSON.stringify(results));
    const ran = results.filter((r) => !r.skipped).length;
    console.info(`${setup.key}: ${ran} of ${results.length} cases ran`);
    expect(text).toMatch(/^SELFTEST PASS/);
    await setup.after?.(page);
  });
}

test('every selftest case ran in at least one setup', () => {
  const runs = SETUPS.map((setup) => {
    let results: SelftestResult[] | null = null;
    try {
      results = JSON.parse(readFileSync(coverageFile(setup.key), 'utf8'));
    } catch {
      // That setup did not run (filtered out, or it crashed before its banner).
    }
    return { setup: setup.key, results };
  });
  const missing = runs.filter((r) => !r.results).map((r) => r.setup);
  expect(missing, 'setups without results (run the whole spec)').toEqual([]);
  const cases = new Map<string, boolean>();
  for (const { results } of runs) {
    for (const r of results ?? []) cases.set(r.name, (cases.get(r.name) ?? false) || !r.skipped);
  }
  const never = [...cases].filter(([, ran]) => !ran).map(([name]) => name);
  expect(cases.size).toBeGreaterThan(0);
  expect(never, 'cases skipped in every setup').toEqual([]);
});
