import { expect, test } from '@playwright/test';
import { selftest } from './selftest.ts';

test('the arena: Logbook craft, tool speed, kiln, door and a chest across a reload', async ({
  page,
}) => {
  // IndexedDB (a fresh one per test), so the chest case saves and reloads for real.
  const query = 'worldType=arena&skipMenu=1&fixedStep=1&mute=1&selftest=m0,m8';
  const text = await selftest(page, query, { storage: 'idb' });
  expect(text).toMatch(/^SELFTEST PASS/);
  // Every m8 case applies to this setup: none may be skipped.
  expect(text).not.toContain('skipped');
});
