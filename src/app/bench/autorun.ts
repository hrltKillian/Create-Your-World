import type { App } from '../App.ts';
import { waitUntil } from '../automation.ts';
import { BENCH_KINDS, type BenchKind, runBenchmark } from '../benchmarks.ts';

/** Longest wait for the render distance to be meshed before a benchmark starts. */
const LOAD_MS = 90_000;

/**
 * `?bench=<kind>` (dev and bench builds; it opens a new world without the menu): once the world's
 * render distance is meshed (`load` times that itself), runs the benchmark and shows the result in
 * a banner, `#bench-result` (« BENCH <kind> » or « BENCH FAIL <kind> », then the result as JSON,
 * also in its `data-result`), and in the console.
 */
export async function runBenchFromUrl(app: App, kind: string): Promise<void> {
  let result: unknown;
  let ok = false;
  try {
    if (!BENCH_KINDS.includes(kind as BenchKind))
      throw new Error(`Unknown benchmark "${kind}" (${BENCH_KINDS.join(', ')})`);
    await app.ready();
    const session = app.session;
    if (!session) throw new Error('No world session');
    if (kind !== 'load')
      await waitUntil(() => !session.loading && session.chunksReady(session.renderDistance), {
        timeoutMs: LOAD_MS,
        label: `render distance ${session.renderDistance} not meshed`,
        pollMs: 50,
      });
    result = await runBenchmark(app, kind as BenchKind);
    ok = true;
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  showBanner(kind, ok, result);
}

function showBanner(kind: string, ok: boolean, result: unknown): void {
  const json = JSON.stringify(result, null, 2);
  console.info(`[bench] ${kind}`, json);
  document.getElementById('bench-result')?.remove();
  const banner = document.createElement('pre');
  banner.id = 'bench-result';
  // The selftest banner's look.
  banner.className = ok ? 'selftest pass' : 'selftest fail';
  banner.dataset.result = JSON.stringify(result);
  banner.textContent = `BENCH ${ok ? '' : 'FAIL '}${kind}\n${json}`;
  document.body.append(banner);
}
