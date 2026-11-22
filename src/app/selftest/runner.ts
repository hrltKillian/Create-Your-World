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

/** Runs the suites named by `?selftest=` ("m0", "m0,m1" or "all") and shows a result banner. */
export async function runSelftests(app: App, selection: string): Promise<SelftestReport> {
  const names =
    selection === 'all' ? Object.keys(SUITES) : selection.split(',').map((s) => s.trim());
  const cases: SelftestCase[] = [];
  for (const name of names) {
    const suite = SUITES[name];
    if (!suite) throw new Error(`Unknown selftest suite "${name}"`);
    cases.push(...suite);
  }
  const results: SelftestResult[] = [];
  for (const test of cases) {
    try {
      await test.run(app);
      results.push({ name: test.name, ok: true });
    } catch (error) {
      results.push({
        name: test.name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const passed = results.filter((r) => r.ok).length;
  showBanner(passed, results.length, results);
  return { passed, total: results.length, results };
}

function showBanner(passed: number, total: number, results: readonly SelftestResult[]): void {
  const banner = document.createElement('pre');
  banner.id = 'selftest-result';
  banner.className = passed === total ? 'selftest pass' : 'selftest fail';
  const failures = results.filter((r) => !r.ok).map((r) => `✗ ${r.name}: ${r.detail ?? ''}`);
  banner.textContent = [
    `SELFTEST ${passed === total ? 'PASS' : 'FAIL'} ${passed}/${total}`,
    ...failures,
  ].join('\n');
  document.body.append(banner);
}
