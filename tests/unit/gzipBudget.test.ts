import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { JS_GZIP_BUDGET, scriptSizes } from '../../tools/gzipBudget.ts';

let dir = '';

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('JS gzip budget', () => {
  it('measures every script of a build, workers included, and nothing else', () => {
    dir = mkdtempSync(join(tmpdir(), 'cyw-gzip-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'index.js'), 'console.log("x");'.repeat(500));
    writeFileSync(join(dir, 'assets', 'world.worker.js'), 'self.onmessage = () => {};');
    writeFileSync(join(dir, 'assets', 'index.css'), 'body { margin: 0 }');
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    const sizes = scriptSizes(dir);
    expect(sizes.map((s) => s.file).sort()).toEqual([
      join('assets', 'index.js'),
      join('assets', 'world.worker.js'),
    ]);
    const index = sizes.find((s) => s.file.endsWith('index.js'))!;
    expect(index.gzip).toBe(gzipSync(readFileSync(join(dir, 'assets', 'index.js'))).length);
  });

  it('is the documented 500 kB (plan v4, decision 31; plan v5 « M50 », « M52 »: the drawn art)', () => {
    expect(JS_GZIP_BUDGET).toBe(500_000);
  });
});
