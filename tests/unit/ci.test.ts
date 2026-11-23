import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The lines of one job of the CI workflow (from its `name:` line to the next job). */
function job(name: string): string {
  const url = new URL('../../.github/workflows/ci.yml', import.meta.url);
  const lines = readFileSync(url, 'utf8').split('\n');
  const start = lines.indexOf(`  ${name}:`);
  expect(start).toBeGreaterThanOrEqual(0);
  let end = start + 1;
  while (end < lines.length && !/^ {2}\S/.test(lines[end]!)) end++;
  return lines.slice(start, end).join('\n');
}

describe('CI workflow', () => {
  it('gives the e2e job an hour and keeps its report when it fails or is cancelled', () => {
    const e2e = job('e2e');
    const minutes = Number(/timeout-minutes: (\d+)/.exec(e2e)?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(60);
    const upload = e2e.slice(e2e.indexOf('actions/upload-artifact'));
    expect(/if: (.*)/.exec(upload)?.[1]).toBe('failure() || cancelled()');
  });
});
