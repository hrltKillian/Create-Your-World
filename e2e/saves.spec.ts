import { expect, type Page, test } from '@playwright/test';
import { pageErrors, selftest } from './selftest.ts';

/**
 * M7 saves in the browser. Every test has a fresh context, so its IndexedDB starts empty; the
 * pages of one test share it (and the Web Locks), like the tabs of one browser.
 */

/** The parts of `window.__game` these tests use. */
interface Hook {
  ready(): Promise<void>;
  state(): string;
  save: { now(): Promise<boolean> };
}

/** The flat world in fixed steps, where the m7 cases play. */
const FLAT = 'seed=42&worldType=flat&fixedStep=1&mute=1';

/** Waits for the debug hook (installed by an async module), then for the first screen. */
async function gameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => (window.__game as Hook).ready());
}

test('IndexedDB: a world made in the menus comes back whole, exports, imports and deletes', async ({
  page,
}) => {
  const text = await selftest(page, `${FLAT}&selftest=m0,m7`, { storage: 'idb' });
  expect(text).toMatch(/^SELFTEST PASS/);
  // Only the ?forceNoIdb=1 case may be skipped.
  expect(text).toContain('(1 skipped)');
});

test('without IndexedDB (?forceNoIdb=1) the banner shows and the world still plays', async ({
  page,
}) => {
  const text = await selftest(page, `forceNoIdb=1&${FLAT}&selftest=m0,m7`, { storage: 'idb' });
  expect(text).toMatch(/^SELFTEST PASS/);
  // The banner case ran; the four IndexedDB cases were skipped.
  expect(text).toContain('(4 skipped)');
  await expect(page.locator('#banner-saving')).toBeVisible();
  expect(await page.evaluate(() => (window.__game as Hook).state())).toBe('world');
});

test('a second tab on the same world gets a message instead of the world', async ({ context }) => {
  const first = await context.newPage();
  const firstErrors = pageErrors(first);
  await first.goto('/?storage=idb&noLock=1&skipMenu=1&seed=42&worldType=flat&mute=1');
  await gameReady(first);
  // Stored now, so the second tab's main menu offers it (« Continue »).
  expect(await first.evaluate(() => (window.__game as Hook).save.now())).toBe(true);

  const second = await context.newPage();
  const secondErrors = pageErrors(second);
  await second.goto('/?storage=idb&noLock=1&mute=1');
  await gameReady(second);
  await second.locator('#screen-main [data-action="play"]').click();
  await expect(second.locator('#menus .menu-notice')).toHaveText(/already open in another tab/);
  expect(await second.evaluate(() => (window.__game as Hook).state())).toBe('menu');
  // The first tab keeps playing it.
  expect(await first.evaluate(() => (window.__game as Hook).state())).not.toBe('menu');
  expect([...firstErrors, ...secondErrors], 'uncaught page errors').toEqual([]);
});
