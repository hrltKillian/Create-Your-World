import { expect, test } from '@playwright/test';
import { selftest } from './selftest.ts';

test('creatures on the flat world: a Prowler hunt, stealthy spear blows, loot and the mobs benchmark', async ({
  page,
}) => {
  const query = 'seed=42&worldType=flat&fixedStep=1&mute=1&selftest=m0,m10';
  const text = await selftest(page, query);
  expect(text).toMatch(/^SELFTEST PASS/);
  // Only the two natural-spawn cases are skipped: they need ?spawns=1&grace=0 (the next test).
  expect(text).toContain('(2 skipped)');
});

test('natural spawns on the flat world: hostiles in the dark only, away from torches, none at noon', async ({
  page,
}) => {
  // Two runs of 3 600 fixed ticks once the spawn ring (rd 4: 64 blocks) is loaded.
  const query = 'seed=42&worldType=flat&rd=4&fixedStep=1&mute=1&spawns=1&grace=0&selftest=m0,m10';
  const text = await selftest(page, query);
  expect(text).toMatch(/^SELFTEST PASS/);
  // Only the four combat cases are skipped: natural spawns would join in.
  expect(text).toContain('(4 skipped)');
});
