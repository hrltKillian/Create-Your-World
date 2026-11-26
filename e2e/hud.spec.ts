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

/**
 * The hovered item's bubble (plan v5 « M46 », M48 fixes): to the right of the pointer, clear of
 * the cursor, at every size, the interface's zoom included (1920×1080 zooms it by 1.35); flipped
 * to its left by the window's right edge.
 */
for (const size of SIZES) {
  test(`the item bubble sits right of the pointer at ${size.width}×${size.height}`, async ({
    page,
  }) => {
    const errors = pageErrors(page);
    await page.setViewportSize(size);
    await page.goto(FLAT);
    await gameReady(page);
    await page.evaluate(() => {
      const game = window.__game as Hook;
      game.player.give('item:stick', 3);
      game.ui.bag(true);
    });
    const slot = (await page.locator('#screen-bag [data-slot="0"]').boundingBox())!;
    const x = slot.x + slot.width / 2;
    const y = slot.y + slot.height / 2;
    await page.mouse.move(x - 40, y - 40);
    await page.mouse.move(x, y, { steps: 4 });
    const bubble = page.locator('#ui-tooltip .tooltip');
    await expect(bubble).toBeVisible();
    const box = (await bubble.boundingBox())!;
    // Right of the pointer by the cursor's width at least, its top about the pointer's height.
    expect(box.x - x).toBeGreaterThanOrEqual(24);
    expect(box.x - x).toBeLessThanOrEqual(40);
    expect(Math.abs(box.y - y)).toBeLessThanOrEqual(16);
    expect(errors).toEqual([]);
  });
}
