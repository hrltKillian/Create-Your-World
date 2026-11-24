import type { App } from '../App.ts';
import { scaleWaits } from '../automation.ts';
import { SUITES } from './suites.ts';
import { type SelftestCase, slowFactor } from './support.ts';

export interface SelftestResult {
  readonly name: string;
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly detail?: string;
  /** Wall time the case ran (ms; none when skipped). */
  readonly ms?: number;
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
  // Inner waits stretch with the case timeouts on slow CI renderers (?timing=0).
  scaleWaits(slowFactor(app));
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
  if (test.scenes) {
    // Wait for the boot so the scene is known, then skip cases that do not apply to it.
    await Promise.race([
      app.ready().catch(() => {}),
      new Promise((r) => setTimeout(r, CASE_TIMEOUT_MS)),
    ]);
    if (!test.scenes.includes(app.state))
      return { name, ok: true, skipped: true, detail: `not in ${app.state}` };
  }
  const skip = test.skip?.(app);
  if (skip) return { name, ok: true, skipped: true, detail: skip };
  const limit = (test.timeoutMs ?? CASE_TIMEOUT_MS) * slowFactor(app);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${limit} ms`)), limit);
  });
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  try {
    await Promise.race([Promise.resolve().then(() => test.run(app)), timeout]);
    return { name, ok: true, ms: ms() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { name, ok: false, detail, ms: ms() };
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
  const skipped = results.filter((r) => r.skipped).length;
  const head = `SELFTEST ${ok ? 'PASS' : 'FAIL'} ${passed}/${total}${skipped ? ` (${skipped} skipped)` : ''}`;
  banner.textContent = [head, ...failures].join('\n');
  // Every case with its outcome, for e2e/selftest.spec.ts (which checks each case ran somewhere).
  banner.dataset.results = JSON.stringify(results);
  document.body.append(banner);
}
