import { describe, expect, it } from 'vitest';
import { checkArchitecture, extractImports, lex } from './checker.ts';

const rules = (files: Record<string, string>) => checkArchitecture(files).map((v) => v.rule);

describe('architecture checker', () => {
  it('accepts allowed edges, same-layer imports and type-only imports', () => {
    expect(
      rules({
        'src/world/a.ts': "import { x } from '../core/b.ts';\nimport { y } from './c.ts';",
        'src/render/a.ts': "import type { Sim } from '../sim/s.ts';\nimport { Mesh } from 'three';",
        'src/ui/a.ts': "import { load } from '../platform/settings.ts';\nh('p', null, t('k'));",
      }),
    ).toEqual([]);
  });

  it('flags forbidden layer edges, value imports of type-only layers and sub-path misses', () => {
    expect(rules({ 'src/core/a.ts': "import { w } from '../world/w.ts';" })).toEqual(['layer']);
    expect(rules({ 'src/render/a.ts': "import { Sim } from '../sim/s.ts';" })).toEqual(['layer']);
    expect(rules({ 'src/ui/a.ts': "import { save } from '../platform/SaveManager.ts';" })).toEqual([
      'layer',
    ]);
  });

  it('flags packages outside their layer and unknown packages', () => {
    expect(rules({ 'src/world/a.ts': "import { Mesh } from 'three';" })).toEqual(['package']);
    expect(rules({ 'src/core/rng.ts': "import { createNoise2D } from 'simplex-noise';" })).toEqual([
      'package',
    ]);
    expect(rules({ 'src/app/a.ts': "import _ from 'lodash';" })).toEqual(['package']);
  });

  it('flags worker imports and worker globals outside entries', () => {
    expect(rules({ 'src/app/a.ts': "import '../workers/world.worker.ts';" })).toEqual([
      'worker-import',
    ]);
    expect(rules({ 'src/workers/runtime.ts': 'self.postMessage(1);' })).toEqual(['worker-global']);
    expect(rules({ 'src/workers/world.worker.ts': 'self.postMessage(1);' })).toEqual([]);
  });

  it('flags non-deterministic APIs in pure layers only', () => {
    expect(rules({ 'src/sim/a.ts': 'const r = Math.random();' })).toEqual(['determinism']);
    expect(rules({ 'src/world/a.ts': 'const d = Date.now();' })).toEqual(['determinism']);
    expect(rules({ 'src/core/a.ts': 'console.log(1);' })).toEqual(['determinism']);
    expect(rules({ 'src/app/a.ts': 'const r = Math.random();' })).toEqual([]);
    // Mentions in comments and strings are fine.
    expect(rules({ 'src/sim/a.ts': "// Math.random\nconst s = 'Date';" })).toEqual([]);
  });

  it('flags engine-dependent maths in generation code', () => {
    expect(rules({ 'src/world/gen/a.ts': 'const v = Math.sin(1);' })).toEqual(['transcendental']);
    expect(rules({ 'src/core/noise.ts': 'const v = 2 ** 3;' })).toEqual(['transcendental']);
    expect(rules({ 'src/world/mesh/a.ts': 'const v = Math.sin(1);' })).toEqual([]);
  });

  it('flags content keys outside packs and literal UI text', () => {
    expect(rules({ 'src/sim/a.ts': "const k = 'block:stone';" })).toEqual(['content-key']);
    expect(rules({ 'src/content/packs/base/a.ts': "const k = 'block:stone';" })).toEqual([]);
    expect(rules({ 'src/ui/a.ts': "h('p', null, 'Hello world');" })).toEqual(['ui-text']);
    expect(rules({ 'src/ui/a.ts': "h('p', { class: 'x' }, t('k'));" })).toEqual([]);
  });

  it('lexes comments and strings and reads type-only clauses', () => {
    const lexed = lex("const a = 'x // y'; // comment\n/* block */ const b = `t`;");
    expect(lexed.codeOnly).not.toContain('comment');
    expect(lexed.strings.map((s) => s.value)).toEqual(['x // y', 't']);
    expect(extractImports("import { type A, type B } from './a.ts';")[0]?.typeOnly).toBe(true);
    expect(extractImports("import { type A, B } from './a.ts';")[0]?.typeOnly).toBe(false);
  });
});
