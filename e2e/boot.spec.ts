import { expect, type Page, test } from '@playwright/test';

async function selftest(page: Page, query: string): Promise<string> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/?storage=memory&noLock=1&${query}`);
  const banner = page.locator('#selftest-result');
  await expect(banner).toBeVisible({ timeout: 100_000 });
  const text = (await banner.textContent()) ?? '';
  expect(errors, 'uncaught page errors').toEqual([]);
  return text;
}

test('WebGL 2 with texture arrays is available', async ({ page }) => {
  await page.goto('/?scene=title');
  const layers = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    return gl ? (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number) : 0;
  });
  expect(layers).toBeGreaterThanOrEqual(256);
});

test('the test scene passes its selftests', async ({ page }) => {
  expect(await selftest(page, 'scene=testchunk&selftest=m0,m1')).toMatch(/^SELFTEST PASS/);
});

test('the generated world streams and passes its selftests', async ({ page }) => {
  expect(await selftest(page, 'seed=7&rd=3&selftest=m0,m2')).toMatch(/^SELFTEST PASS/);
});
