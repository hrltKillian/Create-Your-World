import { expect, type Page } from '@playwright/test';

/** Shared steps of the e2e specs (this file holds no test). */

/**
 * CI renders in software (SwiftShader): wall-clock thresholds are checked locally only
 * (?timing=0), and selftest waits stretch ×4, so e2e waits do too.
 */
export const CI_FACTOR = process.env.CI ? 4 : 1;
const TIMING = process.env.CI ? '&timing=0' : '';

export interface SelftestOptions {
  /** Longest wait for the result banner (ms). */
  readonly timeout?: number;
  /** Where the page saves: memory (nothing outlives the page) or IndexedDB. */
  readonly storage?: 'memory' | 'idb';
}

/** Collects the uncaught errors of a page. */
export function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/**
 * Opens the game with `query` (plus `noLock=1` and the storage), waits for the in-browser selftest
 * banner and returns its text; fails on an uncaught page error.
 */
export async function selftest(
  page: Page,
  query: string,
  { timeout = 100_000, storage = 'memory' }: SelftestOptions = {},
): Promise<string> {
  const errors = pageErrors(page);
  await page.goto(`/?storage=${storage}&noLock=1&${query}${TIMING}`);
  const banner = page.locator('#selftest-result');
  await expect(banner).toBeVisible({ timeout: timeout * CI_FACTOR });
  const text = (await banner.textContent()) ?? '';
  expect(errors, 'uncaught page errors').toEqual([]);
  return text;
}
