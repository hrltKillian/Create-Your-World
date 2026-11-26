import { expect, test } from '@playwright/test';
import { gameReady, type Hook, pageErrors } from './selftest.ts';

/**
 * The HUD's layout (plan v3 « M35 »), at 1024×768, 1280×720 and 1920×1080: every HUD element shown
 * at once, the transient ones with long texts, lies inside the window and overlaps no other one
 * (`__game.ui.hudLayout()`: src/app/hudLayout.ts, also run by selftest m35 at the window's size).
 */

const FLAT = '/?storage=memory&noLock=1&skipMenu=1&seed=42&worldType=flat&fixedStep=1&mute=1';
const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

for (const size of SIZES) {
  test(`the HUD fits ${size.width}×${size.height}, no element over another`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.setViewportSize(size);
    await page.goto(FLAT);
    await gameReady(page);
    const layout = await page.evaluate(async () => {
      const game = window.__game as Hook;
      await game.world.waitForChunks();
      return game.ui.hudLayout();
    });
    expect(layout).toEqual({ outside: [], over: [] });
    expect(errors).toEqual([]);
  });
}
