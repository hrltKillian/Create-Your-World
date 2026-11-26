import { expect, type Page } from '@playwright/test';

/** Shared steps of the e2e specs (this file holds no test). */

/**
 * CI renders in software (SwiftShader): wall-clock thresholds are checked locally only
 * (?timing=0), selftest waits stretch ×4, so e2e waits do too, and the canvas draws a quarter of
 * its pixels (?renderScale=0.5: every pixel costs in software).
 */
export const CI_FACTOR = process.env.CI ? 4 : 1;
const TIMING = process.env.CI ? '&timing=0&renderScale=0.5' : '';

/** The parts of `window.__game` the specs use (src/app/debugHook.ts). */
export interface Hook {
  ready(): Promise<void>;
  state(): string;
  errors(): string[];
  sim: { step(n: number): void };
  input: { look(yaw: number, pitch: number): void; keyLabel(action: string): string | null };
  player: {
    get(): { x: number; y: number; z: number } | null;
    give(item: string, count?: number): unknown;
  };
  world: {
    block(x: number, y: number, z: number): string | null;
    waitForChunks(options?: { radius?: number; timeout?: number }): Promise<unknown>;
  };
  render: { target(): { block: { x: number; y: number; z: number } | null } | null };
  ui: {
    screen(): string | null;
    hotbar(): { selected: number } | null;
    i18nMissing(): string[];
    hudLayout(): { outside: string[]; over: string[] };
    bag(open?: boolean): unknown;
  };
  save: { now(): Promise<boolean> };
  bot: { run(kind: string, seconds: number): Promise<{ ticks: number; errors: string[] }> };
}

/** One case of a selftest run, as the result banner lists it (src/app/selftest/runner.ts). */
export interface SelftestResult {
  readonly name: string;
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly detail?: string;
  readonly ms?: number;
}

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

/** Waits for the debug hook (installed by an async module), then for the first screen. */
export async function gameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => (window.__game as Hook).ready());
}

/**
 * Opens the game with `query` (plus `noLock=1` and the storage), waits for the in-browser selftest
 * banner and returns its text and every case's result; fails on an uncaught page error.
 */
export async function selftest(
  page: Page,
  query: string,
  { timeout = 100_000, storage = 'memory' }: SelftestOptions = {},
): Promise<{ text: string; results: SelftestResult[] }> {
  const errors = pageErrors(page);
  await page.goto(`/?storage=${storage}&noLock=1&${query}${TIMING}`);
  const banner = page.locator('#selftest-result');
  await expect(banner).toBeVisible({ timeout: timeout * CI_FACTOR });
  const text = (await banner.textContent()) ?? '';
  const results = JSON.parse((await banner.getAttribute('data-results')) ?? '[]');
  expect(errors, 'uncaught page errors').toEqual([]);
  return { text, results };
}
