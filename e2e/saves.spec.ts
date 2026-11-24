import { expect, test } from '@playwright/test';
import { gameReady, type Hook, pageErrors } from './selftest.ts';

/**
 * M7 saves across tabs (the m7 suite itself runs in e2e/selftest.spec.ts, with IndexedDB and with
 * ?forceNoIdb=1). Every test has a fresh context, so its IndexedDB starts empty; the pages of one
 * test share it (and the Web Locks), like the tabs of one browser.
 */

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
