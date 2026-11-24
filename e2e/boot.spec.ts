import { expect, test } from '@playwright/test';
import { CI_FACTOR, gameReady, type Hook, pageErrors } from './selftest.ts';

/** The boot: the capability gate's WebGL, the main menu into a first world, a bot playing it. */

test('WebGL 2 with texture arrays is available', async ({ page }) => {
  await page.goto('/?scene=title');
  const layers = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    return gl ? (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number) : 0;
  });
  expect(layers).toBeGreaterThanOrEqual(256);
});

test('Play and Create world open a first world, where the controls card of a first launch shows', async ({
  page,
}) => {
  const errors = pageErrors(page);
  // ?onboarding=1: as in a new browser (Playwright counts as automation, which turns it off).
  await page.goto('/?storage=memory&noLock=1&seed=42&mute=1&onboarding=1');
  await gameReady(page);
  expect(await page.evaluate(() => (window.__game as Hook).state())).toBe('menu');
  // No world yet: Play opens the New world form.
  await page.locator('#screen-main [data-action="play"]').click();
  await page.locator('#screen-new-world [data-action="create"]').click();
  const card = page.locator('#onboarding-card');
  // It shows as the world opens, over the loading screen, and stays.
  await expect(card).toBeVisible({ timeout: 30_000 * CI_FACTOR });
  const state = () => page.evaluate(() => (window.__game as Hook).state());
  await expect.poll(state, { timeout: 30_000 * CI_FACTOR }).toBe('world');
  await expect(card).toBeVisible();
  // The card names the keys of this keyboard (forward: W on QWERTY, Z on AZERTY).
  const forward = await page.evaluate(() => (window.__game as Hook).input.keyLabel('forward'));
  await expect(card.locator('kbd', { hasText: forward ?? '?' }).first()).toBeVisible();
  await card.locator('[data-action="onboarding-close"]').click();
  await expect(card).toBeHidden();
  const hook = await page.evaluate(() => {
    const game = window.__game as Hook;
    return { errors: game.errors(), missing: game.ui.i18nMissing() };
  });
  expect(hook).toEqual({ errors: [], missing: [] });
  expect(errors, 'uncaught page errors').toEqual([]);
});

/**
 * M11 « un bot wanderMineBuild tourne 5 min dans le navigateur → errors() vide », in fixed steps
 * (the driver advances 8 ticks a frame). Local only: with software rendering the 9 000 ticks and
 * the streaming they need take too long for CI, which plays the bot's minute of the m11 suite.
 */
test('the wanderMineBuild bot plays five game minutes in the generated world without an error', async ({
  page,
}) => {
  test.skip(Boolean(process.env.CI), 'local only: the m11 suite plays a minute on CI');
  test.setTimeout(300_000);
  const errors = pageErrors(page);
  await page.goto('/?storage=memory&noLock=1&skipMenu=1&seed=7&rd=4&fixedStep=1&mute=1');
  await gameReady(page);
  const run = await page.evaluate(async () => {
    const game = window.__game as Hook;
    await game.world.waitForChunks();
    const report = await game.bot.run('wanderMineBuild', 300);
    return { ticks: report.ticks, errors: report.errors, all: game.errors() };
  });
  expect(run).toEqual({ ticks: 9000, errors: [], all: [] });
  expect(errors, 'uncaught page errors').toEqual([]);
});
