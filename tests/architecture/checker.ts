/**
 * Static architecture checker: layer import rules, banned packages, determinism bans,
 * content-key literals and hard-coded UI text. Works on an in-memory map of files so it can
 * be unit-tested on fixtures. The lexer is intentionally simple (comments, strings and
 * template literals); regex literals containing quotes would confuse it.
 */

export interface Violation {
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

export type Layer =
  | 'core'
  | 'content'
  | 'world'
  | 'sim'
  | 'workers'
  | 'i18n'
  | 'assets'
  | 'input'
  | 'platform'
  | 'render'
  | 'audio'
  | 'ui'
  | 'app';

interface LayerRule {
  /** Layers (or `layer/sub/path` prefixes) importable as values. `*` = anything. */
  readonly values: readonly string[];
  /** Extra layers importable with `import type` only. */
  readonly types: readonly string[];
}

/** The allowed dependency table (see docs/conception.md, « Couches et dépendances »). */
export const LAYERS: Readonly<Record<Layer, LayerRule>> = {
  core: { values: [], types: [] },
  content: { values: ['core'], types: [] },
  world: { values: ['core', 'content'], types: [] },
  sim: { values: ['core', 'content', 'world'], types: [] },
  workers: { values: ['core', 'content', 'world'], types: [] },
  i18n: { values: ['core', 'content'], types: [] },
  assets: { values: ['core', 'content'], types: [] },
  input: { values: ['core', 'content', 'i18n'], types: ['sim'] },
  // The settings store and check the key bindings and the quality presets (pure data modules).
  platform: {
    values: ['core', 'content', 'world', 'sim', 'input/bindings', 'render/quality'],
    types: [],
  },
  render: { values: ['core', 'content', 'world', 'assets'], types: ['sim', 'input'] },
  audio: { values: ['core', 'content', 'assets', 'platform/settings'], types: ['sim'] },
  ui: {
    values: [
      'core',
      'content',
      'i18n',
      'assets',
      'input/keyLabels',
      'input/bindings',
      'platform/settings',
    ],
    types: ['sim'],
  },
  app: { values: ['*'], types: ['*'] },
};

/** Packages allowed in src, and where. */
const PACKAGES: Readonly<Record<string, (file: string) => boolean>> = {
  three: (file) => file.startsWith('src/render/'),
  'simplex-noise': (file) => file === 'src/core/noise.ts',
  idb: (file) => file.startsWith('src/workers/'),
};

const PURE_LAYERS: ReadonlySet<Layer> = new Set(['core', 'content', 'world', 'sim']);

const BANNED_IN_PURE: readonly [RegExp, string][] = [
  [/(?<![.\w$])Math\.random\b/, 'Math.random'],
  [/(?<![.\w$])Date\b/, 'Date'],
  [/(?<![.\w$])performance\.now\b/, 'performance.now'],
  [
    /(?<![.\w$])(setTimeout|setInterval|clearTimeout|clearInterval|requestAnimationFrame|queueMicrotask|setImmediate)\b/,
    'timers',
  ],
  [/(?<![.\w$])console\./, 'console'],
];

const TRANSCENDENTAL = /(?<![.\w$])Math\.(sin|cos|tan|exp|log|pow|atan2|hypot|cbrt)\b/;

const CONTENT_KEY =
  /^(block|item|tag|recipe|process|station|creature|biome|loot|tex|sfx|model|objective):[a-z0-9_]/;

export interface Lexed {
  /** Comments blanked, strings kept. */
  readonly noComments: string;
  /** Comments and string/template contents blanked. */
  readonly codeOnly: string;
  readonly strings: readonly { value: string; start: number; end: number }[];
}

export function lex(source: string): Lexed {
  const noComments = source.split('');
  const codeOnly = source.split('');
  const strings: { value: string; start: number; end: number }[] = [];
  const n = source.length;
  const blank = (arr: string[], from: number, to: number) => {
    for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };
  /** Brace depth of each open `${…}` expression; non-empty while inside a template substitution. */
  const exprDepth: number[] = [];

  /** Scans a template literal from just after a backtick or a closing `}`; returns the next index. */
  const scanTemplate = (from: number): number => {
    let j = from;
    while (j < n) {
      const c = source[j]!;
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '`') {
        strings.push({ value: source.slice(from, j), start: from - 1, end: j + 1 });
        blank(codeOnly, from, j);
        return j + 1;
      }
      if (c === '$' && source[j + 1] === '{') {
        strings.push({ value: source.slice(from, j), start: from - 1, end: j });
        blank(codeOnly, from, j);
        exprDepth.push(0);
        return j + 2;
      }
      j++;
    }
    blank(codeOnly, from, n);
    return n;
  };

  let i = 0;
  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(noComments, i, stop);
      blank(codeOnly, i, stop);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(noComments, i, stop);
      blank(codeOnly, i, stop);
      i = stop;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') {
        if (source[j] === '\\') j++;
        j++;
      }
      const end = Math.min(n, j + 1);
      strings.push({ value: source.slice(i + 1, j), start: i, end });
      blank(codeOnly, i + 1, j);
      i = end;
    } else if (c === '`') {
      i = scanTemplate(i + 1);
    } else if (exprDepth.length > 0 && c === '{') {
      exprDepth[exprDepth.length - 1]!++;
      i++;
    } else if (exprDepth.length > 0 && c === '}') {
      if (exprDepth[exprDepth.length - 1] === 0) {
        exprDepth.pop();
        i = scanTemplate(i + 1);
      } else {
        exprDepth[exprDepth.length - 1]!--;
        i++;
      }
    } else {
      i++;
    }
  }
  return { noComments: noComments.join(''), codeOnly: codeOnly.join(''), strings };
}

interface ImportRef {
  readonly spec: string;
  readonly typeOnly: boolean;
}

export function extractImports(noComments: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const fromRe = /(?:^|[\s;}])(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of noComments.matchAll(fromRe)) {
    const clause = m[3] ?? '';
    const spec = m[4]!;
    let typeOnly = Boolean(m[2]);
    if (!typeOnly) {
      const braces = /^\{([\s\S]*)\}$/.exec(clause.trim());
      if (braces) {
        const names = braces[1]!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        typeOnly = names.length > 0 && names.every((name) => name.startsWith('type '));
      }
    }
    refs.push({ spec, typeOnly });
  }
  for (const m of noComments.matchAll(/(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g)) {
    refs.push({ spec: m[1]!, typeOnly: false });
  }
  for (const m of noComments.matchAll(/(?<![.\w$])import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    refs.push({ spec: m[1]!, typeOnly: false });
  }
  return refs;
}

export function layerOf(file: string): Layer | 'types' | null {
  if (file === 'src/main.ts') return 'app';
  const m = /^src\/([^/]+)\//.exec(file);
  if (!m) return null;
  const name = m[1]!;
  if (name === 'types') return 'types';
  return name in LAYERS ? (name as Layer) : null;
}

function resolveRelative(from: string, spec: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const segment of spec.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

function matchesTarget(entry: string, targetLayer: Layer, targetPath: string): boolean {
  if (entry === '*') return true;
  if (!entry.includes('/')) return entry === targetLayer;
  return targetPath.startsWith(`src/${entry}`);
}

/** Checks every file of the map (paths relative to the repository root). */
export function checkArchitecture(files: Readonly<Record<string, string>>): Violation[] {
  const violations: Violation[] = [];
  for (const [file, source] of Object.entries(files)) {
    if (!file.endsWith('.ts')) continue;
    const layer = layerOf(file);
    if (layer === null) {
      violations.push({ file, rule: 'unknown-layer', detail: 'file is outside every known layer' });
      continue;
    }
    if (layer === 'types') continue;
    const lexed = lex(source);
    const add = (rule: string, detail: string) => violations.push({ file, rule, detail });

    for (const ref of extractImports(lexed.noComments)) {
      if (ref.spec.startsWith('.')) {
        const target = resolveRelative(file, ref.spec);
        if (target.endsWith('.worker.ts')) add('worker-import', ref.spec);
        const targetLayer = layerOf(target);
        if (targetLayer === null || targetLayer === 'types') {
          if (!target.startsWith('src/')) add('outside-src', ref.spec);
          continue;
        }
        if (targetLayer === layer) continue;
        const rule = LAYERS[layer];
        const allowedValue = rule.values.some((e) => matchesTarget(e, targetLayer, target));
        const allowedType = rule.types.some((e) => matchesTarget(e, targetLayer, target));
        if (!(allowedValue || (ref.typeOnly && allowedType))) {
          add('layer', `${layer} → ${targetLayer} (${ref.spec}${ref.typeOnly ? ', type' : ''})`);
        }
      } else {
        const pkg = ref.spec.startsWith('@')
          ? ref.spec.split('/').slice(0, 2).join('/')
          : ref.spec.split('/')[0]!;
        const allowed = PACKAGES[pkg];
        if (!allowed) add('package', `unknown package ${pkg}`);
        else if (!allowed(file)) add('package', `${pkg} is not allowed here`);
      }
    }

    if (
      !file.endsWith('.worker.ts') &&
      /(?<![.\w$])(self|DedicatedWorkerGlobalScope)\b/.test(lexed.codeOnly)
    ) {
      add('worker-global', 'self / DedicatedWorkerGlobalScope outside a worker entry');
    }

    if (PURE_LAYERS.has(layer)) {
      for (const [re, name] of BANNED_IN_PURE) {
        if (re.test(lexed.codeOnly)) add('determinism', name);
      }
    }

    const strictMath =
      file.startsWith('src/world/gen/') ||
      file === 'src/core/noise.ts' ||
      file === 'src/core/rng.ts' ||
      file === 'src/core/hash.ts';
    if (strictMath) {
      if (TRANSCENDENTAL.test(lexed.codeOnly))
        add('transcendental', 'engine-dependent Math function');
      if (lexed.codeOnly.includes('**')) add('transcendental', 'exponent operator');
    }

    if (!file.startsWith('src/content/packs/')) {
      for (const s of lexed.strings) {
        if (CONTENT_KEY.test(s.value)) add('content-key', s.value);
      }
    }

    if (file.startsWith('src/ui/')) {
      for (const literal of hTextLiterals(lexed.noComments)) add('ui-text', literal);
    }
  }
  return violations;
}

/**
 * Literal text passed as children (3rd argument onwards) of `h(...)` calls, including text hidden
 * in expressions (ternaries, `||`…). Strings inside nested `h(…)` and `t(…)` calls are ignored:
 * nested `h` calls are checked on their own, and `t('key')` is the allowed way to show text.
 */
function hTextLiterals(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/(?<![.\w$])h\(/g)) {
    const args = splitArgs(code, m.index! + m[0].length);
    for (const arg of args.slice(2)) {
      const stripped = stripCalls(stripCalls(arg, 'h'), 't');
      for (const literal of lex(stripped).strings) {
        if (/[A-Za-z]/.test(literal.value)) found.push(literal.value);
      }
    }
  }
  return found;
}

/** Replaces every `name(…)` call (balanced parentheses) with spaces. */
function stripCalls(code: string, name: string): string {
  const re = new RegExp(`(?<![.\\w$])${name}\\(`, 'g');
  let out = code;
  for (;;) {
    re.lastIndex = 0;
    const m = re.exec(out);
    if (!m) return out;
    const open = m.index + m[0].length;
    const args = splitArgs(out, open);
    const length = m[0].length + args.join(',').length + 1;
    out = out.slice(0, m.index) + ' '.repeat(length) + out.slice(m.index + length);
  }
}

function splitArgs(code: string, start: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = start; i < code.length; i++) {
    const c = code[i]!;
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== c) {
        if (code[j] === '\\') j++;
        j++;
      }
      current += code.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) {
        args.push(current);
        return args;
      }
      depth--;
    }
    if (c === ',' && depth === 0) {
      args.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  return args;
}
