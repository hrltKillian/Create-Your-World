import { expect, type Page, test } from '@playwright/test';

async function selftest(page: Page, query: string): Promise<string> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Wall-clock thresholds are checked locally; CI runners render in software (SwiftShader).
  const timing = process.env.CI ? '&timing=0' : '';
  await page.goto(`/?storage=memory&noLock=1&${query}${timing}`);
  const banner = page.locator('#selftest-result');
  await expect(banner).toBeVisible({ timeout: process.env.CI ? 380_000 : 100_000 });
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

test('the player walks, animates and switches cameras on the flat world', async ({ page }) => {
  const query = 'seed=42&worldType=flat&skipMenu=1&fixedStep=1&rd=3&selftest=m0,m3';
  expect(await selftest(page, query)).toMatch(/^SELFTEST PASS/);
});

test('the player digs, builds, strikes and hears it on the flat world', async ({ page }) => {
  const query = 'seed=42&worldType=flat&skipMenu=1&fixedStep=1&mute=1&selftest=m0,m4';
  const text = await selftest(page, query);
  expect(text).toMatch(/^SELFTEST PASS/);
  // Every m4 case applies to this setup: none may be skipped.
  expect(text).not.toContain('skipped');
});

test('day and night, sky light, torches and the light view on the flat world', async ({ page }) => {
  const query = 'seed=42&worldType=flat&skipMenu=1&fixedStep=1&mute=1&selftest=m0,m5';
  const text = await selftest(page, query);
  expect(text).toMatch(/^SELFTEST PASS/);
  // Every m5 case applies to this setup: none may be skipped.
  expect(text).not.toContain('skipped');
});
