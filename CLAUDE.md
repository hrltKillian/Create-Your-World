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

Deterministic boot URL: `http://localhost:5173/?seed=42&storage=memory&noLock=1&debug=1&skipMenu=1`
(without `skipMenu` the main menu shows first).

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
  (column pipeline, command rules, players, debug commands); `App` composes, `Game` runs the menus
  and the open world (`OpenWorld`), `GameSession` loops.
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
  - world generation queries without generating (always the same arithmetic as the bulk pass):
    `world/gen/sample.ts` (`LatticeCache`, `heightAt`, `biomeOf`, `pointInfo`), `caveAt`
    (`world/gen/caves.ts`), `bankAt`/`topBlockAt` (`world/gen/banks.ts`), structure sites
    (`world/gen/structures.ts`: `siteIn`, `regionOf`, `nearSite`); searches `world/gen/find.ts`
    (`spiral`, `findBiome`, `findStructure`, `biomesWithin`) and the spawn `world/gen/spawn.ts`; a
    generation step reads the padded `heights` (`PADDED` rows) and writes only its own column
    (decoration: `world/gen/decor.ts`);
  - angles: `core/angles.ts`; player constants shared by sim, render and input (eye heights,
    `HOTBAR_SLOTS`): `core/player.ts`;
  - box-vs-voxel collision: `sim/collision.ts`; block-state expansion: `content/blockStates.ts`;
    pack texture sets: `content/validate.ts` (`textureSets`);
  - items and crafting data: `content/items.ts` (`packItems`, `blockItemKey`, `harvests`: the
    harvest rule), `registry.item(key)`, `registry.crafting` (`content/crafting.ts`: recipes,
    processes and stations by key, `matches` for item-or-tag ingredients, `burnSeconds` for the
    fuel rules, `revealed` for the Logbook reveal; station slot layout `fuelSlotOf`,
    `outputSlotOf`, `stationSlotCount`); loot rolls `sim/loot.ts` (`rollLoot`, with the `empty`
    share); the progression proof `content/reachability.ts` (`reachable(pack, { hostiles })`);
  - slot arrays (inventory, chests, stations): `sim/inventory.ts` (`addToRange`, `roomFor`,
    `moveStack`, `moveInto`, `countMatching`/`takeMatching` for item-or-tag ingredients,
    `freshStack`, `readStack`/`savedStack`); block entities `sim/blockEntities.ts`
    (`Simulation.blockEntities` by `cellKey`, `blockEntityAt` creates a generated chest with its
    `structureLootAt` loot, `removeBlockEntity` spills, `withinReach`); their screens
    `sim/blockEntityCommands.ts`; station ticks and catch-up `sim/stations.ts` (`stepStation`,
    `advanceStation`, `SIM_RADIUS`, `MAX_REPLAY_TICKS`); the craft queue `sim/craftQueue.ts`
    (`enqueueCraft`, `stationNear`, `noteSeen`); durations `ticksOf` (`sim/clock.ts`);
  - saves: records and snapshots `sim/persistence.ts` (`snapshotSim`, `compressBatch`,
    `restoreSim`), the `Storage` port `sim/storage.ts` (`MemoryStorage`); in the browser
    `platform/IdbStorage.ts` (`openSaveBackend`: io.worker, or memory as the fallback),
    `platform/SaveManager.ts` (autosave, `onEvent`, `watchPage`, `close`), `platform/worldLock.ts`,
    `platform/exportWorld.ts`; IndexedDB tests stub `indexedDB` with fake-indexeddb's `IDBFactory`;
  - app states and menu navigation (pure): `app/appState.ts` (`nextState`, `MenuNav`); worlds to
    play (lock, new or restored simulation, opening errors, deleting one no tab holds):
    `app/worlds.ts` (`createWorld`, `loadWorld`, `newWorld`, `WorldOpenError`,
    `deleteClosedWorld`); one open world (session, saves, play layer, `close()`):
    `app/OpenWorld.ts`; the menu layer: `app/Menus.ts`, its screens in `ui/screens/` with
    `menuButton`/`menuPanel`/`slider` in `ui/screens/menuParts.ts`; player settings
    (`localStorage` `cyw.settings.v1`): `platform/settings.ts` (`loadSettings`, `saveSettings`);
  - slot screens (Bag with the Logbook, Container, Station): `app/inventoryUi.ts` opens and closes
    them (the bag on its key, chests and stations on `blockEntityOpened`/`blockEntityClosed`),
    `app/UiBridge.ts` refreshes them (`queueView`, `stationStatus`); `ui/slotBoard.ts`
    (`SlotBoard`: drag and drop, hover caption, hotkeys; `ScreenDeps`), the gesture commands
    `ui/inventoryGestures.ts` (`SlotContext`: block entity slots from 32), the pure Logbook
    `ui/logbook.ts` (`logbookRows`, `batchCount`); item and tag names and icons `ui/itemSlot.ts`
    (`ingredientName`, `itemIcon`; a tag's name is the pack string `tagNameKey`, `content/items.ts`);
    DOM tests use `tests/helpers/fakeDom.ts` (`dispatch`, `findAll`);
  - browser automation (waits, `teleport`, `fill`): `app/automation.ts`;
  - headless simulations: `sim/testing/` (`createInlineSim`, `runBot`, bots);
  - tests: `tests/helpers/` (`registry`, `flatWorld`/`emptyWorld`, `createTestSim`, `FakeTarget`,
    `litWorld`/`edit` for light, `generate`/`blockIn`/`biomeIndex`/`findColumn` in `gen.ts`);
    `test:perf` runs on native Node imports (Vite's module runner slows hot loops several times);
    only `*.test.ts` files run, and `tsconfig.node.json` type-checks the helpers.

## Automation

- `window.__game` exists only when `__DEBUG_HOOK__` is true (dev, bench, tests) and is loaded by a
  dynamic import: it must never appear in `dist/**/*.js` of a production build.
- URL params (dev/bench only): `seed`, `storage=memory|idb`, `noLock`, `debug`, `forceNoWebGL`,
  `forceNoIdb`, `scene`, `freecam`, `fixedStep`, `selftest` (implies `noLock` and `skipMenu`),
  `timing=0` (selftests skip wall-clock thresholds and stretch waits; set by e2e on CI), `mute`
  (sounds are still logged), `skipMenu` (a new world, no menu), `world=<id>` (opens a saved world),
  `worldType=flat|arena`, `rd`, `view`, `kb`, `host=serialize`, `bench`, `time` (hour 0–24 of the
  world clock), `freezeTime` — more arrive with later milestones.
- Player checks: `?worldType=flat&fixedStep=1&selftest=m3,m4,m5`; `__game.input.press(action, ticks)`
  steps the simulation in fixed-step mode. Without `noLock` the game stays paused until a click.
- M4 hook entries: `player.inventory()`/`give(item, count)`, `world.setBlock(x, y, z, stateKey)`,
  `render.target()`/`crack()`/`hand()`/`sectionVersionLag()`, `perf.editToMeshMs()`, `audio.log()`,
  `ui.screen()`/`bag(open?)`/`hotbar()`.
- M5 hook entries (version 5): `time.get()` (ticks, hour, day, phase, daylight, frozen),
  `time.set(hours)` and `time.freeze(frozen?)` (`debug.setTime`/`debug.freezeTime`, applied without
  a tick; both return the clock), `world.light(x, y, z)` (`{ sky, block }`, 0–15).
  `render.capture()` gives `avgLuma` and `uniqueColors`.
- M6 hook entries (version 6): `world.findBiome(key, maxRadius?, from?)` (`{ x, z, distance }`,
  sampled every 16 blocks) and `world.findStructure(key, maxRadius?, from?)` (`{ x, y, z,
  distance }`), both from the player by default; `render.debugView('xray')` (or `?view=xray`)
  meshes terrain blocks as faint ghosts so ores and caves show (`MeshScheduler.setXray`).
- M7 hook entries (version 7): `state()` adds `'menu'`, `'paused'` and `'quitting'`; `ui.screen()`
  also names the menu screens (`'main'`, `'worlds'`, `'newWorld'`, `'settings'`, `'pause'`), whose
  buttons carry `data-action` (`play`, `worlds`, `settings`, `new-world`, `create`, `resume`,
  `save-quit`…); `settings.get()`/`set(patch)` (applied and stored like the Settings screen);
  `save.now()` (resolves with the save's success), `save.reload()` (save & quit, then the same
  world opened again; resolves once its loading radius is meshed), `save.worlds()` (`{ id, name,
  seed, savedAt }`, last played first), `save.inspect(id?)` (records per store, the open world by
  default) and `save.wipeAll()` (deletes every world no tab holds: `{ deleted, kept }`).
- M8 screens: `ui.screen()` also names `'container'` and `'station'` (opened by secondary on the
  block); Logbook rows carry `data-recipe`, tabs `data-tab`, its buttons `data-action`
  (`craft-1`, `craft-5`, `craft-max`), queue entries `data-queue` (a click cancels); the Container
  screen has `take-all`/`store-all`; every slot carries `data-slot` (0–31 the inventory, 32+ the
  open chest or station: inputs, fuel, outputs).
- Save checks (IndexedDB, the default storage): `?worldType=flat&fixedStep=1&selftest=m0,m7`; with
  `&forceNoIdb=1` the banner case runs instead of the IndexedDB ones. m7 drives the menus by clicks
  (`selftest/menuSteps.ts`), deletes the worlds it made and ends on the Worlds screen. The second
  tab's lock message is only in `e2e/saves.spec.ts` (two pages of one context share IndexedDB and
  Web Locks; every test gets an empty context). `e2e/selftest.ts` holds the shared e2e steps.
- Generated-world checks: `?seed=7&rd=4&selftest=m0,m2,m6` (real ticks: m6 waits in wall time;
  skipped in flat/arena worlds and with `?freecam`).
- `src/app/automation.ts` holds the waits (`nextFrame`, `frameOrFail`, `withinFrames`, `framesFor`,
  `yieldTask`, `waitUntil`, `waitForChunks`), the debug commands (`teleport`, `fill`, `setBlock`,
  `give`, `setTime`, `freezeTime`), `press`, `look`, `blockKey`, `lightAt`, `clock`, `hotbarView`
  and `saveNow`/`reloadWorld`, shared by `debugHook.ts` and the selftests; `selftest/support.ts` has
  the case type, `playerSession`, `needsFlatPlayer`/`needsGeneratedPlayer`, `standAt`, `stateKey`,
  `PLAY_SCENES`, `SETTLE_MS`, `readClock`/`keepingClock` and `drawsCase` (≤ 400 draws), one file per
  large suite (`selftest/m4.ts`, `m5.ts`, `m6.ts`, `m7.ts`), and every suite ends with
  `noErrorsCase()`.

## Originality checklist

No 3×3 crafting grid and no 9-slot hotbar (we use 8); no heart or drumstick icons (vials); round
sun and moon; our own palette, grass and crack styles; human-proportioned avatar; the Prowler is
low and four-legged with amber eyes; debug overlay styled as our own panel; no block, item or
creature names from the reference games; synthesized sounds.
