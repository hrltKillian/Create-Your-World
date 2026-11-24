/**
 * JS size budget (docs « Mesure de performance »: JS gzip ≤ 400 Ko): the gzip size of every
 * script of a build (the page, its chunks and the workers), summed. Run after the production
 * build by `npm run verify`:
 *   node tools/gzipBudget.ts [dist]
 * Prints one line per script and the total; exits with 1 over the budget or without any script.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/** 400 kB, in Vite's units (1 kB = 1 000 bytes, as its build report prints them). */
export const JS_GZIP_BUDGET = 400_000;

export interface ScriptSize {
  readonly file: string;
  readonly gzip: number;
}

/** Every `.js` file under `dir` (recursively) and its gzip size (default level), largest first. */
export function scriptSizes(dir: string): ScriptSize[] {
  const sizes: ScriptSize[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.js'))
        sizes.push({ file: relative(dir, full), gzip: gzipSync(readFileSync(full)).length });
    }
  };
  visit(dir);
  return sizes.sort((a, b) => b.gzip - a.gzip);
}

function main(dir: string): number {
  const sizes = scriptSizes(dir);
  const total = sizes.reduce((sum, s) => sum + s.gzip, 0);
  const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;
  for (const { file, gzip } of sizes) console.log(`${kb(gzip).padStart(10)}  ${file}`);
  console.log(`${kb(total).padStart(10)}  JS gzip in total (budget ${kb(JS_GZIP_BUDGET)})`);
  if (sizes.length === 0) {
    console.error(`No script under ${dir}: run the build first.`);
    return 1;
  }
  if (total > JS_GZIP_BUDGET) {
    console.error(`Over the JS gzip budget by ${kb(total - JS_GZIP_BUDGET)}.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv[2] ?? 'dist'));
