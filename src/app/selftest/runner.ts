import type { App } from '../App.ts';
import { type SelftestCase, SUITES } from './suites.ts';

export interface SelftestResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface SelftestReport {
  readonly passed: number;
  readonly total: number;
  readonly results: readonly SelftestResult[];
}

/** A case that takes longer than this fails with "timeout" instead of blocking the run. */
export const CASE_TIMEOUT_MS = 15_000;

/** Runs the suites named by `?selftest=` ("m0", "m0,m1" or "all") and always shows a result banner. */
export async function runSelftests(app: App, selection: string): Promise<SelftestReport> {
  const names =
    selection === 'all' ? Object.keys(SUITES) : selection.split(',').map((s) => s.trim());
  const results: SelftestResult[] = [];
  for (const name of names) {
    const suite: readonly SelftestCase[] | undefined = SUITES[name];
    if (!suite) {
      results.push({ name: `suite ${name}`, ok: false, detail: 'unknown suite' });
      continue;
    }
    for (const test of suite) results.push(await runCase(app, `${name}: ${test.name}`, test));
  }
  const passed = results.filter((r) => r.ok).length;
  showBanner(passed, results.length, results);
  return { passed, total: results.length, results };
}

async function runCase(app: App, name: string, test: SelftestCase): Promise<SelftestResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout after ${CASE_TIMEOUT_MS} ms`)),
      CASE_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([Promise.resolve().then(() => test.run(app)), timeout]);
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function showBanner(passed: number, total: number, results: readonly SelftestResult[]): void {
  document.getElementById('selftest-result')?.remove();
  const banner = document.createElement('pre');
  banner.id = 'selftest-result';
  const ok = total > 0 && passed === total;
  banner.className = ok ? 'selftest pass' : 'selftest fail';
  const failures = results.filter((r) => !r.ok).map((r) => `✗ ${r.name}: ${r.detail ?? ''}`);
  banner.textContent = [`SELFTEST ${ok ? 'PASS' : 'FAIL'} ${passed}/${total}`, ...failures].join(
    '\n',
  );
  document.body.append(banner);
}
