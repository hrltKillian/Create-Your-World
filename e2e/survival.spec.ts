import { expect, test } from '@playwright/test';
import { CI_FACTOR, selftest } from './selftest.ts';

test('survival in the generated world: cold, shelter, toxic air, water, sleep and a death across a reload', async ({
  page,
}) => {
  // Far teleports (tundra, marsh, the respawn) and some 27 000 fixed ticks: more time than most.
  test.setTimeout(240_000 * CI_FACTOR);
  // IndexedDB (a fresh one per test), so the pack's marker is checked across a real reload.
  const query = 'seed=7&rd=4&fixedStep=1&mute=1&selftest=m0,m9';
  const text = await selftest(page, query, { storage: 'idb', timeout: 230_000 });
  expect(text).toMatch(/^SELFTEST PASS/);
  // Every m9 case applies to this setup: none may be skipped.
  expect(text).not.toContain('skipped');
});
