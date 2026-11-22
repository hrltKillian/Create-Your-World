import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkArchitecture } from './checker.ts';

const ROOT = join(import.meta.dirname, '..', '..');

function collect(dir: string, out: Record<string, string>): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(path, out);
    else if (name.endsWith('.ts'))
      out[relative(ROOT, path).split('\\').join('/')] = readFileSync(path, 'utf8');
  }
}

describe('architecture boundaries', () => {
  it('src respects the layer table and the bans', () => {
    const files: Record<string, string> = {};
    collect(join(ROOT, 'src'), files);
    expect(Object.keys(files).length).toBeGreaterThan(5);
    expect(checkArchitecture(files)).toEqual([]);
  });
});
