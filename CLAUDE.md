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
    share; a roll set never draws an entry twice); the progression proof `content/reachability.ts`
    (`reachable(pack, { hostiles })`);
  - creature content (docs « Créatures et combat »): `content/packs/base/creatures.ts` (`CreatureDef`,
    `content/creatureSchema.ts`: category, brain, telegraphed attack, senses (`hearing` scales the
    player's noise radii), the traits that parametrise the brains, spawn entries,
    `HOSTILE_MAX_LIGHT`); box models and skins `creatureModels.ts` (legs named by `GAIT_LEGS`,
    `emissive` parts glow, `stride` in rad/block), voices `creatureSfx.ts` (`voicesOf`);
    `registry.creature(key)`/`registry.model(key)`; the bare hand `balance.combat.hand` (items carry
    `weapon`), the hostile grace `balance.creatures.spawnGraceTicks`;
  - creatures in the sim: records `sim/creatures.ts` (`CreatureState` in `sim.entities`, `mode`
    and timers, `spawnCreature`, `isAlert` (the stealth rule), `isGone`, `reachGap`,
    `hostileNear`, `dormant`; `parkCreature`/`unparkCreatures`: the creatures of an unloaded column
    wait in `sim.parked`, saved with it, and come back in id order when it loads), bodies
    `sim/creatureBody.ts`; `sim/ai/`: senses `senses.ts`
    (`NOISE`, `noiseOf`, `targetable`, `unawareOf` (stealth), `lineOfSight` (the raycast with
    `RAY_OPAQUE`), `refreshSenses` every 10 ticks), the five brains `brains.ts` (`think`, `alarm` when hurt), what they are made of
    `behaviours.ts` (`BRAIN` numbers, `plan` (≤ 2 A* a tick), `graze`, `flee`, `fight`, `windUp`),
    A* `pathfind.ts` (`findPath`, `ASTAR` budgets, `lastSearch`), tick steps 5–6
    `creatureStep.ts` (swarmer zigzag, wall stun); tick step 8 `sim/combat.ts`
    (`COMBAT`, `strike` a creature's blow, `hurtCreature` with front armour, knockback and loot,
    `armorFactor`, `escalation`, `frontFactor`); the player's attacks at tick step 7
    `sim/melee.ts` (`MELEE`, `stepMelee`: primary on a creature in reach before mining, the blow on
    the release, charged after 15 ticks held (`player.charge`, `attackCooldown`), `meleeDamage`,
    `meleeKnockback`, `weaponOf`, `meleeTarget`: creatures are tested first, only solid blocks
    stop a blow (`blowReach`), the hitbox test `creatureOnRay` shared with `app/ClientAim.ts`,
    whose `creature` the HUD names); no placement or closing gate into a player or a creature
    (`bodyInCell`, sim/placement.ts); blows sound `sounds.combat.hit`/`hurt`; the
    dying time `DYING_TICKS` and the body geometry `CREATURE_EYE_SHARE`, `centreY`, `feetCell`
    (`core/creatures.ts`, shared with the renderer); drawn by `render/CreatureView.ts` (posed
    models, glow, red flash, death fall and shrink; only within the render distance `WorldView.reach`
    of the camera, drawn last into the batch's `room`, the nearest first: `nthSmallest`,
    `render/nearest.ts`, shared with DropView) animated by `render/creatureRig.ts`
    (`animateCreature`: gait legs, wind-up, look, hit freeze of the pose only); BoxBatch boxes take
    `glow` and `flash`; spawns, departures (`departs`: every rule of who leaves, each
    tick from `stepCreatures`), herds and `sim.spawnLog`
    `sim/spawning.ts` (`SPAWN`; `sim.rules`: `hostiles`, `spawns` (off in flat and arena worlds
    unless asked: dev `?spawns=0|1`), `graceTicks` (`?grace=`)); the effective light
    `effectiveLight` (`world/light.ts`); `debug.spawn` places one (facing the player),
    `debug.killCreature` kills one not already dying, burrowing too (a death with its loot);
    `creatureCensus` (sim/creatures.ts) counts the living ones (the hook, `runBot` and the headless
    runner); `SimView.spawnLog`;
  - slot arrays (inventory, chests, stations): `sim/inventory.ts` (`addToRange`, `roomFor`,
    `moveStack`, `moveInto`, `countMatching`/`takeMatching` for item-or-tag ingredients,
    `freshStack`, `spendUses` (a stack's `durability` is its uses left: a tool's, gear's wear, a
    filled container's charges), `readStack`/`savedStack`); block entities `sim/blockEntities.ts`
    (`Simulation.blockEntities` by `cellKey`, `blockEntityAt` creates a generated chest with its
    `structureLootAt` loot, `removeBlockEntity` spills (and drops a pack's grave markers),
    `withinReach`; kinds container, station, grave; a bedroll is `blockEntity: 'bed'` with no
    record); their screens
    `sim/blockEntityCommands.ts`; station ticks and catch-up `sim/stations.ts` (`stepStation`,
    `advanceStation`, `SIM_RADIUS`, `MAX_REPLAY_TICKS`); the craft queue `sim/craftQueue.ts`
    (`enqueueCraft`, `stationNear`, `noteSeen`); durations `ticksOf` (`sim/clock.ts`);
  - survival (docs « Survie »): every rule number in the pack's `balance.ts` (`registry.pack.balance`,
    typed by `content/balanceSchema.ts`; per-content numbers stay on biomes, blocks and items, block
    heat in `tables.heat`/`heatRadius`); gauges, damage (`hurt`, `fallDamage`), `thermalStatus`,
    stamina limits, timed effects (`addEffect`, `hasEffect`) and tick step 11 `stepSurvival` in
    `sim/survival.ts` (the player's `survival`, `equipment`, `respawn`, `graves`, `objectives`);
    the thermal model, worn gear (`wornGear`), heat sources, contact and `sampleEnvironment` in
    `sim/environment.ts`; the shelter test `sim/shelter.ts` (`shelterAt`); `debug.setStat` sets
    any gauge, `debug.kill` takes all health for a cause, `debug.god` stops damage (`survival.god`,
    kept across a respawn); balance tests compute their expectations from the balance
    (`tests/unit/sim/survival.test.ts`); gauge changes of food, drinks and sleep `adjustGauges`
    (survival.ts);
  - secondary held (docs « Priorité des actions »): interactive blocks in `sim/interaction.ts`
    (`usesAimedBlock`, `useAimed`), then `holdUse` in `sim/consume.ts` (eat or drink the held item,
    `interaction.useItem`/`useTicks`: the action the press started), sips and fills in
    `sim/water.ts` (`aimedLiquid`: the sim's own liquid ray); boiling keeps the charges left
    (`stations.ts` passes an input's uses on); worn items `sim/equipment.ts` (`equip.move`: slots
    32–36, `wearSlotOf`, `wearFilters`); sleeping `sim/sleep.ts` (`sleepOn`, `forgetBed`); death,
    Abandoned Pack (`registry.grave`), `player.respawn` and `recoverPack` in `sim/death.ts` (tick
    step 14 `stepDeaths`; `survival.dead` until the respawn); the clock's messages (`sunset`,
    `nightSurvived`) `clockEvents` and `withinHours`/`nextHour`/`passedHour`/`nightsSurvived` in
    `sim/time.ts`;
  - objectives (docs « Objectifs jusqu'au fer »): the chain in data `content/packs/base/
    objectives.ts` (`ObjectiveDef`, `content/objectiveSchema.ts`: items seen, stations within
    crafting reach, an enclosed shelter, nights survived; a `compass` point), checked once a second
    at tick step 16 (`stepObjectives`, `conditionHolds` in `sim/objectives.ts`; event
    `objectiveDone`, the keys in `player.objectives`);
  - the survival HUD `ui/hud/hud.ts` (`Vitals`, `StaminaArc`, `Compass` with `bearingOf`/
    `headingOf`/`compassOffset`, `clockText`/`durationText`, `ObjectivesPanel` with
    `objectiveProgress`, `EffectList`, `Vignettes` with `vignetteLevels`, `Flash` banners
    (`replay` restarts a `.play` animation), `CombatMarks` (`#hud-hit`, `#hud-damage`,
    `damageBearing`)) and the death screen `ui/screens/death.ts`; `app/HudBridge.ts` refreshes them
    (compass every frame, the rest at 10 Hz) and hands the gate over to the death screen; what needs
    the sim's rules (`hudEffects`, `targetText`) is in `app/hudModel.ts`; the sun on the compass
    `sunBearing`/`aboveHorizon` (`render/Sky.ts`); styles `ui/styles/hud.css`;
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
  - browser automation (waits, `teleport`, `fill`): `app/automation.ts`; its survival part (gauges,
    `kill`, `god`, `equip`, `shelterHere`, `playerStats`): `app/survivalAutomation.ts`; its
    creature part (`placeCreature`, `killCreature`, `creatureList`, `census`, `spawnLog`, applied
    at once without a tick): `app/creatureAutomation.ts`; the benchmarks (`flyBenchmark`,
    `mobsBenchmark` and its scene `MOBS`, timed by `GameSession.tickMs`): `app/benchmarks.ts`;
  - headless simulations: `sim/testing/` (`createInlineSim`, `runBot`, bots);
  - tests: `tests/helpers/` (`registry`, `flatWorld`/`emptyWorld`, `createTestSim`; `playerTestSim`
    with player 1's `send`/`give`/`put`/`fill`/`block`, `eventsOf`, `rejections`; `FakeTarget`,
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
  world clock), `freezeTime`, `spawns=0|1` (natural creature spawns and herds; by default only in
  generated worlds, never in selftests unless given), `grace` (ticks without hostile spawns,
  `grace=0`) — more arrive with later milestones.
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
  block; the Bag with its Logbook stays `'bag'`); Logbook rows carry `data-recipe`, tabs `data-tab`,
  its buttons `data-action` (`craft-1`, `craft-5`, `craft-max`), queue entries `data-queue` (a click
  cancels); the Container screen has `take-all`/`store-all`; every slot carries `data-slot` (0–31
  the inventory, 32+ the open chest or station: inputs, fuel, outputs; in the Bag 32–36 the worn
  items, head to feet, moved with `equip.move`).
- M8 hook entries (version 8): `craft.enqueue(recipe, count?)` (applied at once in fixed steps) and
  `craft.queue()` (`{ recipe, count, progress }`), `container.contents(x, y, z)` (`{ kind, slots }`,
  a station adds `station`, `lit` (its fire burns), `flame` (fuel left), `progress`, `process`;
  an Abandoned Pack adds `worn`, head to feet; null until a generated chest is first opened), `ui.open(x?, y?, z?)` (no argument: the bag; a
  cell: its chest or station through `debug.open`, like secondary on it within 5 blocks but without
  aiming, applied at once in fixed steps; returns `ui.screen()`), `ui.click(selector)`,
  `ui.drag(from, to)` (pointer events like the mouse, on `data-slot` numbers) and `ui.close()`.
  `container.open` needs the cell in sight of the eye (`cellInSight`, sim/targeting.ts).
- M9 screens: `ui.screen()` also names `'death'` (`#screen-death`, `data-action="respawn"`; it
  follows `survival.dead`, so a world saved dead opens on it). HUD ids: `#hud-vitals`,
  `#hud-stamina`, `#hud-compass`, `#hud-clock`, `#hud-target`, `#hud-objectives`, `#hud-effects`
  (rows carry `data-effect`), `#hud-banner`, `#hud-sleep`.
- M9 hook entries (version 9): `player.setStat(stat, value)` (any gauge, now; `setStamina` is gone),
  `player.stats()` (gauges, the effects as the HUD lists them, shelter, felt °C and target, death and
  cause, `god`, bedroll, packs, objectives, worn items), `player.kill(cause = 'fall')` (the death
  at once in fixed steps), `player.god(on = true)`, `player.equip(slot)` (Shift+click in the Bag: a
  wearable on, a worn item 32–36 off), `world.shelter()` (the test at the player's head, now);
  `ui.text(selector)` reads the HUD (`#hud-clock`, `#hud-effects`…).
- M10 hook entries (version 10): `entities.spawn(creature, x, y | 'surface', z)` (`debug.spawn`,
  applied at once without a tick, facing the player; returns the id, null when refused),
  `entities.list()` (`{ id, creature, x, y, z, yaw, health, mode, target, sees, watched, herd,
  cave }`, dying ones too), `entities.kill(id)` (`debug.killCreature`, burrowing ones too: it
  falls over, its loot drops), `entities.census()` (the living: `total`, `surfaceHostiles`,
  `caveHostiles`, `byCreature`), `entities.spawnLog()` (hostile spawns: tick, creature, feet,
  effective light, cave); `perf.benchmark('mobs', seconds = 10)`: 25 creatures of every kind
  around the player, the clock frozen at 23:00 and the player immune, a 60-tick warm-up, then the
  simulation tick alone (`GameSession.tickMs`): `{ creatures, ticks, tickMedian, tickP95,
  tickMax }`; the clock, the immunity, the toxicity and the creature count are put back (the
  creatures are killed: their loot stays).
- Creature checks (`selftest/m10.ts`, `e2e/creatures.spec.ts`), two setups since the creature
  rules are fixed when a world opens: `?worldType=flat&fixedStep=1&selftest=m0,m10` (the Prowler
  hunt, stealthy and plain spear blows on Trotters trapped in pits, a Trotter's loot, the mobs
  benchmark; the spawn cases skipped) and, for the spawn cases (none at noon, at least 3 hostiles
  by night in the dark and beyond Manhattan 9 of the torches; the combat cases skipped),
  `?worldType=flat&rd=4&fixedStep=1&spawns=1&grace=0&selftest=m0,m10`. Creatures and the spear
  come from the pack's data (the stalker, the grazer, the weapon that reaches farthest).
- Survival checks: `?seed=7&rd=4&fixedStep=1&selftest=m0,m9` (`selftest/m9.ts`, its scenes in
  `selftest/survivalScenes.ts`; `e2e/survival.spec.ts`): the generated world with fixed steps; the
  tundra and the marsh are the coldest biome by night and the most toxic one by day, the cabin, pads
  and pool are debug fills of the arena cabin's wall and pond water; its reload case needs IndexedDB
  (skipped with `?storage=memory`).
- Item checks: `?worldType=arena&fixedStep=1&selftest=m0,m8` (`selftest/m8.ts`); its chest case
  saves and reloads, so it needs IndexedDB (skipped with `?storage=memory`). The arena's workshop
  row (the pack's `arena.workshop`: workbench, kiln, campfire, chest, from `ARENA_WORKSHOP`) and its
  cabin door (`ARENA_DOOR`) are in `world/gen/arena.ts`; the cases find their items through the pack
  (arena log, ore wall, gravel; the start recipe of an axe), never by content key.
- Save checks (IndexedDB, the default storage): `?worldType=flat&fixedStep=1&selftest=m0,m7`; with
  `&forceNoIdb=1` the banner case runs instead of the IndexedDB ones. m7 drives the menus by clicks
  (`selftest/menuSteps.ts`), deletes the worlds it made and ends on the Worlds screen. The second
  tab's lock message is only in `e2e/saves.spec.ts` (two pages of one context share IndexedDB and
  Web Locks; every test gets an empty context). `e2e/selftest.ts` holds the shared e2e steps.
- Generated-world checks: `?seed=7&rd=4&selftest=m0,m2,m6` (real ticks: m6 waits in wall time;
  skipped in flat/arena worlds and with `?freecam`).
- `src/app/automation.ts` holds the waits (`nextFrame`, `frameOrFail`, `withinFrames`, `framesFor`,
  `yieldTask`, `waitUntil`, `waitForChunks`), the debug commands (`teleport`, `fill`, `setBlock`,
  `give`, `setTime`, `freezeTime`), `press`, `look`, `blockKey`, `lightAt`, `clock`, `hotbarView`,
  crafting and block entities (`craft`, `craftQueue`, `blockEntityContents`), the screens (`click`,
  `dragSlot`) and `saveNow`/`reloadWorld`, shared by `debugHook.ts` and the selftests;
  `selftest/support.ts` has the case type, `playerSession`, `needsFlatPlayer`/`needsArenaPlayer`/
  `needsGeneratedPlayer`, `needsIdb`, `standAt` (flat surface by default), `aimAt` (a block's side,
  or a low block's top), `lookAt`, `slotsAt`, `arenaOf`, `stateKey`, `emitterOf` and
  `TORCH_LIGHT` (the torch without naming it), `PLAY_SCENES`, `SETTLE_MS`, `SEARCH_RADIUS`,
  `readClock`/`keepingClock` and `drawsCase` (≤ 400 draws), one file per large suite
  (`selftest/m4.ts` … `m10.ts`), and every suite ends with `noErrorsCase()`.

## Originality checklist

No 3×3 crafting grid and no 9-slot hotbar (we use 8); no heart or drumstick icons (vials); round
sun and moon; our own palette, grass and crack styles; human-proportioned avatar; the Prowler is
low and four-legged with amber eyes; debug overlay styled as our own panel; no block, item or
creature names from the reference games; synthesized sounds.

Creatures (reviewed at M10): five of our own, Trotter, Shagback, Prowler, Swarmling, Shellback,
with original behaviours (a grazer that bolts, a six-legged herd that defends itself, a light-shy
stalker slowed by the player's gaze, zigzagging toxic packs, an armoured rammer); box models with
our own skins on the block patterns and procedural gaits (four or six legs); the Prowler low
and four-legged with emissive amber eyes (`tests/unit/content/creatures.test.ts`); synthesized
voices; loot and weapons named by us (Prowler Sinew, Flint Spear…); a hit marker and damage arcs
in our HUD style.
