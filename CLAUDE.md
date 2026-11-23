# Create Your World — agent guide

Original voxel survival-adventure sandbox for the browser (Chrome first). The full spec is
`docs/conception.md` (in French): follow it, milestone by milestone (M0–M11).

## Commands

| Command                      | Use                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`                | Vite dev server on :5173 (launch config `game-dev`)                           |
| `npm run verify`             | typecheck (`tsc -b`) + Biome + Vitest + build — must be green before every PR |
| `npm run lint:fix`           | format and apply safe fixes                                                   |
| `npm run test:perf`          | perf thresholds under Node (local only)                                       |
| `npm run test:slow`          | long determinism bots                                                         |
| `npm run headless -- --ping` | run pure code under plain Node                                                |
| `npm run bench`              | minified build with the debug hook, on :4174 (`game-bench`)                   |
| `npm run e2e`                | Playwright smoke tests (from M2)                                              |

Never run `vitest` without `run` (watch mode never exits) and never `tsc` without `-b`.

## Verification protocol (every milestone)

1. `npm run verify` green.
2. Dev server in the browser pane: `await __game.ready()`, `__game.errors()` empty, no error in the
   server log (Vite forwards browser console errors).
3. `?selftest=mN` shows `SELFTEST PASS n/n`; earlier suites stay green.
4. Screenshots taken and reviewed. Performance numbers only with the pane visible (a hidden pane
   throttles requestAnimationFrame) and on `game-bench` from M2.
5. From M4: `__game.ui.i18nMissing()` empty.
6. README "Try this milestone" updated; originality checklist at M1, M3, M4, M8, M10.

Deterministic boot URL: `http://localhost:5173/?seed=42&storage=memory&noLock=1&debug=1`.

## Git and PRs

- One branch per milestone: `claude/mN-<topic>`, from an up-to-date `main`.
- Commits and PR text in English. Open the PR with `gh pr create`; squash-merge it yourself once
  CI is green and the milestone review is done (the user authorized this). Never force-push `main`.
- No large downloads without asking the user (npm packages of the stack are fine).

## Architecture rules (enforced by `tests/architecture/boundaries.test.ts`)

- Layers and allowed imports: see the table in `tests/architecture/checker.ts` (`LAYERS`).
  `core`, `content`, `world`, `sim` are pure: no DOM, no `Math.random`, `Date`, `performance.now`,
  timers or `console` (log through `core/log.ts`).
- `three` only under `src/render`; `simplex-noise` only in `src/core/noise.ts` (always with a seeded
  PRNG); `idb` only under `src/workers`.
- Never import a `*.worker.ts` file; create workers only with the literal
  `new Worker(new URL('…', import.meta.url), { type: 'module' })` pattern in `src/platform`.
  `self` only inside `*.worker.ts` entries — worker logic lives in pure modules with a `WorkerPort`.
- No `Math.sin/cos/tan/exp/log/pow/atan2/hypot/cbrt` or `**` in world generation, noise, rng, hash.
- Engine code never names content: no `'block:…'`-style literals outside `src/content/packs`.
- All UI text goes through `t()` (English strings, i18n keys); no literal text passed to `h()`.
- TypeScript: erasable syntax only (no enums, namespaces, parameter properties), `import type` for
  types, relative imports with `.ts` extensions, `arr[i]!` in hot loops.
- Zero allocations in hot loops; budgets are in nodes/ticks inside the sim, never milliseconds.
- Every persistent state comes with a serializer, a default and a round-trip test. Bump
  `GEN_VERSION` when generation output changes and `SAVE_VERSION` when the save format changes.

## Code principles (KISS, DRY, SRP)

Decision 12 of `docs/conception.md` (« Principes de code »), for code, tests and tooling alike.
They never override the rules above (determinism, zero allocations in hot loops, layers, i18n).

- **KISS**: the simplest solution that meets the spec and its tests; no abstraction, option or
  parameter "for later"; short functions with a linear flow; a hot loop stays readable, every
  trick commented; no new dependency when a few lines do.
- **DRY**: each rule, constant or computation lives in one place; extract duplicated logic at its
  third occurrence at the latest, at the second if it carries a game rule.
- **SRP**: one module or class, one reason to change. `Simulation` orders the tick and delegates
  (column pipeline, command rules, players, debug commands); `App` composes, `GameSession` loops.
  Split a file past ~400 lines or mixing reasons to change, unless it is the core of a hot loop
  (then say why in a comment at its top).
- Shared helpers, to import rather than copy:
  - game numbers: `PHYSICS` (`sim/physics.ts`), `STAMINA` (`sim/player.ts`);
  - coordinates: `world/coords.ts` (`blockToColumn`, `columnIndex`, `sectionKey`/`sectionKeyParts`,
    `insideBorder`); packed light and the light rule: `world/light.ts` (`skyOf`, `blockOf`,
    `FULL_SKY`, `passLight`); light propagation: `world/light/` (`columnLight`, `LightEngine`);
  - voxel edits (heightmap, light, remesh): `sim/edits.ts` (`writeBlock`, `editBlock`);
  - time of day: `sim/time.ts` (`hourOf`, `dayOf`, `phaseOf`, `daylightAt`, `HOUR_TICKS`); sky palette,
    sun and moon: `render/Sky.ts`;
  - angles: `core/angles.ts`; player constants shared by sim, render and input (eye heights,
    `HOTBAR_SLOTS`): `core/player.ts`;
  - box-vs-voxel collision: `sim/collision.ts`; block-state expansion: `content/blockStates.ts`;
    pack texture sets: `content/validate.ts` (`textureSets`);
  - browser automation (waits, `teleport`, `fill`): `app/automation.ts`;
  - headless simulations: `sim/testing/` (`createInlineSim`, `runBot`, bots);
  - tests: `tests/helpers/` (`registry`, `flatWorld`/`emptyWorld`, `createTestSim`, `FakeTarget`,
    `litWorld`/`edit` for light);
    only `*.test.ts` files run, and `tsconfig.node.json` type-checks the helpers.

## Automation

- `window.__game` exists only when `__DEBUG_HOOK__` is true (dev, bench, tests) and is loaded by a
  dynamic import: it must never appear in `dist/**/*.js` of a production build.
- URL params (dev/bench only): `seed`, `storage=memory|idb`, `noLock`, `debug`, `forceNoWebGL`,
  `forceNoIdb`, `scene`, `freecam`, `fixedStep`, `selftest` (implies `noLock`), `mute` (sounds are
  still logged), `skipMenu`, `worldType=flat|arena`, `rd`, `view`, `kb`, `host=serialize`, `bench`,
  `time` (hour 0–24 of the world clock), `freezeTime` — more arrive with later milestones.
- Player checks: `?worldType=flat&fixedStep=1&selftest=m3,m4`; `__game.input.press(action, ticks)`
  steps the simulation in fixed-step mode. Without `noLock` the game stays paused until a click.
- M4 hook entries: `player.inventory()`/`give(item, count)`, `world.setBlock(x, y, z, stateKey)`,
  `render.target()`/`crack()`/`hand()`/`sectionVersionLag()`, `perf.editToMeshMs()`, `audio.log()`,
  `ui.screen()`/`bag(open?)`/`hotbar()`.
- M5 hook entries: `sim.time()` (ticks, hour, day, phase, daylight, frozen), `sim.setTime(hours)` and
  `sim.freezeTime(frozen?)` (the `debug.setTime`/`debug.freezeTime` commands, applied without a tick).
- `src/app/automation.ts` holds the waits (`nextFrame`, `frameOrFail`, `withinFrames`, `framesFor`,
  `yieldTask`, `waitUntil`, `waitForChunks`), the debug commands (`teleport`, `fill`, `setBlock`,
  `give`) and `press`, `look`, `blockKey`, `hotbarView`, shared by `debugHook.ts` and the
  selftests; `selftest/support.ts` has the case type and `playerSession`/`needsFlatPlayer`, one
  file per large suite (`selftest/m4.ts`), and every suite ends with `noErrorsCase()`.

## Originality checklist

No 3×3 crafting grid and no 9-slot hotbar (we use 8); no heart or drumstick icons (vials); round
sun and moon; our own palette, grass and crack styles; human-proportioned avatar; the Prowler is
low and four-legged with amber eyes; debug overlay styled as our own panel; no block, item or
creature names from the reference games; synthesized sounds.
