import { i18nMissing } from '../i18n/i18n.ts';
import type { Action } from '../input/bindings.ts';
import type { Settings } from '../platform/settings.ts';
import { rigDegrees } from '../render/rigs.ts';
import { DEBUG_VIEWS, type DebugView } from '../render/voxelMaterial.ts';
import type { CameraPose } from '../render/WorldView.ts';
import { serializeInventory } from '../sim/inventory.ts';
import { Column } from '../world/Column.ts';
import { findBiome, findStructure } from '../world/gen/find.ts';
import { columnHash, generateColumn } from '../world/gen/generateColumn.ts';
import { pointInfo } from '../world/gen/sample.ts';
import type { App } from './App.ts';
import {
  blockKey,
  clock,
  fill,
  freezeTime,
  give,
  hotbarView,
  lightAt,
  look,
  nextFrame,
  press,
  reloadWorld,
  saveNow,
  setBlock,
  setTime,
  teleport,
  waitForChunks,
  yieldTask,
} from './automation.ts';
import { byLastPlayed, deleteClosedWorld } from './worlds.ts';

/**
 * Dev-only automation API (`window.__game`). Loaded through a dynamic import guarded by
 * `__DEBUG_HOOK__`, so it never ships in production builds.
 */
export function installDebugHook(app: App): void {
  /** The player's (or free camera's) block column, the default origin of searches. */
  const playerPlace = () => {
    const pose = app.freecam?.pose ?? app.session?.player.body;
    return pose ? { x: Math.floor(pose.x), z: Math.floor(pose.z) } : null;
  };
  /** The game's save storage (IndexedDB, or memory); throws in the developer scenes. */
  const saves = () => {
    const storage = app.game?.backend.storage;
    if (!storage) throw new Error('No save storage (developer scene)');
    return storage;
  };
  const api = {
    version: 7,
    params: app.params,
    ready: () => app.ready(),
    errors: () => [...app.errors],
    state: () => app.state,
    capabilities: () => app.capabilities,
    selftest: async (selection = 'all') => {
      const { runSelftests } = await import('./selftest/runner.ts');
      return runSelftests(app, selection);
    },
    workers: {
      size: () => app.workers?.size ?? 0,
      ping: async () => {
        if (!app.workers) throw new Error('Workers are not running');
        return app.workers.ping();
      },
    },
    perf: {
      fps: () => app.frames.fps(),
      snapshot: () => ({ ...app.frames.snapshot(), spans: app.frames.spanP95() }),
      pool: () => app.workers?.stats() ?? null,
      mesh: () => app.session?.scheduler.stats() ?? null,
      /** Time (ms) from the first edit of the last mesh batch to the swap of its meshes. */
      editToMeshMs: () => app.session?.scheduler.editToMeshMs ?? null,
      /**
       * Flies the camera in a straight line for `seconds` (pane must be visible) and returns frame
       * statistics: CPU work p95, share of intervals over 20 ms, subsystem p95.
       */
      benchmark: async (kind: 'fly' = 'fly', seconds = 10) => {
        const cam = app.freecam;
        if (!cam) throw new Error('No camera');
        const start = { ...cam.pose };
        cam.set({ y: Math.max(start.y, 110), pitch: -0.2, yaw: -Math.PI / 2 });
        const t0 = performance.now();
        await new Promise<void>((resolve) => {
          const tick = () => {
            const t = (performance.now() - t0) / 1000;
            cam.set({ x: start.x + t * 20 });
            if (t >= seconds) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        return { kind, seconds, ...app.frames.snapshot(), spans: app.frames.spanP95() };
      },
    },
    camera: {
      get: (): CameraPose | null =>
        app.freecam ? { ...app.freecam.pose } : app.session ? { ...app.session.rig.pose } : null,
      set: (pose: Partial<CameraPose>) => app.freecam?.set(pose),
      /** Mode ('first' | 'third') and current third-person distance. */
      mode: () =>
        app.session ? { mode: app.session.rig.mode, distance: app.session.rig.distance } : null,
      toggle: () => app.session?.rig.toggleMode(),
    },
    sim: {
      /** Advances n ticks now (use with ?fixedStep=1). */
      step: (n = 1) => app.session?.step(n),
      tick: () => app.session?.host.view.tick() ?? 0,
      hash: () => app.session?.host.view.hash() ?? null,
    },
    time: {
      /** The world clock: ticks, hour (0–24), day number, phase, daylight and the freeze flag. */
      get: () => clock(app),
      /** Moves the clock to an hour (0 ≤ hours < 24) of the current day, now; returns the clock. */
      set: (hours: number) => {
        setTime(app, hours);
        return clock(app);
      },
      /** Stops (or, with false, restarts) the clock, now; returns the clock. */
      freeze: (frozen = true) => {
        freezeTime(app, frozen);
        return clock(app);
      },
    },
    input: {
      /** Sets the view angles (radians). */
      look: (yaw: number, pitch: number) => look(app, yaw, pitch),
      /** Holds an action for `ticks` ticks; in fixed-step mode it also advances those ticks. */
      press: (action: Action, ticks = 1) => press(app, action, ticks),
      release: () => app.input?.releaseAll(),
      keyLabel: (action: Action) => app.input?.keyLabel(action) ?? null,
    },
    player: {
      get: () => {
        const p = app.session?.player;
        if (!p) return null;
        const b = p.body;
        return {
          x: b.x,
          y: b.y,
          z: b.z,
          vx: b.vx,
          vy: b.vy,
          vz: b.vz,
          onGround: b.onGround,
          inWater: b.inWater,
          crouching: b.crouching,
          stamina: p.stamina,
          exhausted: p.exhausted,
          yaw: p.yaw,
          pitch: p.pitch,
        };
      },
      teleport: (x: number, y: number | 'surface', z: number) => teleport(app, x, y, z),
      setStamina: (value: number) =>
        app.session?.host.send({ type: 'debug.setStat', stat: 'stamina', value }),
      /** A copy of the 32 slots (0–7 hotbar, 8–31 bag): null or { item, count, durability? }. */
      inventory: () => {
        const p = app.session?.player;
        return p ? serializeInventory(p.inventory) : null;
      },
      /** Adds items by key (e.g. a flint tool); what does not fit drops at the player's feet. */
      give: (item: string, count = 1) => give(app, item, count),
    },
    world: {
      /** Text key of the block state at a position (or null outside the loaded world). */
      block: (x: number, y: number, z: number) => blockKey(app, x, y, z),
      /** Sets one block from a state key, e.g. the key `block` returns. */
      setBlock: (x: number, y: number, z: number, state: string) => setBlock(app, x, y, z, state),
      /** Sky and block light (0–15 each) at a position; unloaded cells are dark. */
      light: (x: number, y: number, z: number) => lightAt(app, x, y, z),
      voxelBytes: () => app.world?.voxelBytes() ?? 0,
      seed: () => app.session?.seed ?? null,
      spawn: () => app.session?.spawn ?? null,
      /** Biome key and surface height at a block column (analytic, no generation needed). */
      biome: (x: number, z: number) => {
        const session = app.session;
        if (!session) return null;
        const info = pointInfo(session.host.view.gen, Math.floor(x), Math.floor(z));
        return { biome: session.host.view.gen.biomes[info.biome]!.def.key, height: info.height };
      },
      /**
       * Nearest column of a biome (key, e.g. from `biome`) within `maxRadius` blocks of a point
       * (default: the player): { x, z, distance } or null. Analytic, sampled every 16 blocks.
       */
      findBiome: (biome: string, maxRadius = 3000, from = playerPlace()) => {
        const session = app.session;
        return session && from ? findBiome(session.host.view.gen, biome, from, maxRadius) : null;
      },
      /** Nearest structure of a kind (its key) within `maxRadius` blocks: { x, y, z, distance }. */
      findStructure: (structure: string, maxRadius = 3000, from = playerPlace()) => {
        const session = app.session;
        return session && from
          ? findStructure(session.host.view.gen, structure, from, maxRadius)
          : null;
      },
      /** Hash of a column generated on the main thread (compare with the Node golden tests). */
      genHash: (cx: number, cz: number) => {
        const session = app.session;
        if (!session || !app.registry) return null;
        const column = new Column(cx, cz, app.registry.air);
        generateColumn(session.host.view.gen, column);
        return columnHash(session.host.view.gen, column);
      },
      /**
       * Resolves once every column within `radius` of the camera is meshed. Returns the wait and the
       * time since the session started. While the page is hidden (no animation frames), it steps the
       * world itself so automation keeps working.
       */
      waitForChunks: async ({
        radius,
        timeout = 20_000,
      }: {
        radius?: number;
        timeout?: number;
      } = {}) => {
        const session = app.session;
        if (!session) throw new Error('No world session');
        const t0 = performance.now();
        await waitForChunks(app, radius ?? session.loadingRadius(), timeout);
        const now = performance.now();
        return { ms: now - t0, sinceStart: now - session.startedAt };
      },
      /** Steps the world for `ms` of wall time without rendering (useful when the pane is hidden). */
      pump: async (ms = 1000) => {
        const session = app.session;
        if (!session) return;
        const end = performance.now() + ms;
        while (performance.now() < end) {
          session.pumpOnce(document.hidden);
          await yieldTask();
        }
      },
      /** Fills a box (inclusive corners) with a block state key, e.g. the key `world.block` returns. */
      fill: (
        x0: number,
        y0: number,
        z0: number,
        x1: number,
        y1: number,
        z1: number,
        state: string,
      ) => fill(app, x0, y0, z0, x1, y1, z1, state),
      setRenderDistance: (rd: number) => app.session?.setRenderDistance(rd),
      memory: () => ({
        voxelBytes: app.world?.voxelBytes() ?? 0,
        geometries: app.renderer?.webgl.info.memory.geometries ?? 0,
        geometryBytes: app.view?.chunks.stats().geometryBytes ?? 0,
      }),
      stateCount: () => app.registry?.tables.stateCount ?? 0,
    },
    render: {
      info: () => {
        const info = app.renderer?.webgl.info;
        return info
          ? {
              calls: info.render.calls,
              triangles: info.render.triangles,
              geometries: info.memory.geometries,
              textures: info.memory.textures,
              programs: info.programs?.length ?? 0,
            }
          : null;
      },
      chunks: () => app.view?.chunks.stats() ?? null,
      /** Animation angles (degrees) and head pivot height of an entity's rig. */
      rig: (who: 'player' | number = 'player') => {
        const session = app.session;
        if (!session) return null;
        const rig = session.entities.rig(who === 'player' ? session.player.id : who);
        return rig
          ? { angles: rigDegrees(rig), headPivotY: rig.headPivotY, strike: rig.strike }
          : null;
      },
      /** The block under the crosshair (null: none) and the placement ghost (null: none). */
      target: () => {
        const aim = app.session?.aim;
        if (!aim) return null;
        const { hit, ghost } = aim;
        return {
          block: hit.hit
            ? { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz }
            : null,
          ghost: ghost.state >= 0 ? { x: ghost.x, y: ghost.y, z: ghost.z } : null,
        };
      },
      /** Crack stage shown on the mined block (−1: none). */
      crack: () => app.session?.play.overlay.crackStage ?? -1,
      /** First-person hand view: drawn this frame, stroke progress (0 at rest), boxes. */
      hand: () => {
        const hand = app.session?.play.hand;
        return hand ? { visible: hand.visible, swing: hand.swing, boxes: hand.batch.size } : null;
      },
      /** Boxes in the world batch this frame and live break particles. */
      boxes: () => {
        const play = app.session?.play;
        return play ? { boxes: play.batch.size, particles: play.particles.alive() } : null;
      },
      /** Sections whose mesh on screen is older than their data (0 once edits are visible). */
      sectionVersionLag: () => app.session?.scheduler.sectionVersionLag() ?? null,
      debugView: (view?: DebugView) => {
        if (view !== undefined) {
          if (!DEBUG_VIEWS.includes(view))
            throw new Error(`Unknown view "${view}" (${DEBUG_VIEWS.join(', ')})`);
          app.setDebugView(view);
        }
        return app.debugView;
      },
      /** Renders the current view off-screen and returns colour statistics. */
      capture: () => app.view?.capture() ?? null,
      nextFrame,
    },
    ui: {
      i18nMissing,
      text: (selector: string) => document.querySelector(selector)?.textContent ?? null,
      toggleDebug: () => app.overlay?.toggle(),
      /** Opens or closes the bag like its key does (no argument: toggles); returns whether it is open. */
      bag: (open?: boolean) => {
        const inventory = app.inventory;
        if (!inventory) return false;
        if (open === undefined || open !== inventory.bag.isOpen()) inventory.toggleBag();
        return inventory.bag.isOpen();
      },
      /**
       * The open screen: 'bag', a menu ('main', 'worlds', 'newWorld', 'settings', 'pause'), or null
       * while playing.
       */
      screen: () => (app.inventory?.bag.isOpen() ? 'bag' : (app.game?.menus.screen() ?? null)),
      /** What the hotbar shows: the selected slot and each slot's count text. */
      hotbar: () => hotbarView(app),
    },
    settings: {
      /** The settings in use (as stored under `cyw.settings.v1`); null in developer scenes. */
      get: () => app.game?.settings ?? null,
      /** Changes settings like the Settings screen does (applied at once and stored). */
      set: (patch: Partial<Settings>) => {
        const game = app.game;
        if (!game) return null;
        game.changeSettings({ ...game.settings, ...patch });
        return game.settings;
      },
    },
    save: {
      /** Saves the open world now (deflated, one transaction); resolves with the save's success. */
      now: () => saveNow(app),
      /** Save & quit, then the same world opened again; resolves once its loading radius is meshed. */
      reload: () => reloadWorld(app),
      /** The stored worlds, most recently played first. */
      worlds: async () =>
        byLastPlayed(await saves().listWorlds()).map(({ id, name, seed, savedAt }) => ({
          id,
          name,
          seed,
          savedAt,
        })),
      /** Records of a world (default: the open one) in each store: { worlds, players, columns }. */
      inspect: async (id = app.game?.open?.info.id) => {
        if (!id) throw new Error('No open world: pass a world id');
        return saves().inspect(id);
      },
      /** Deletes every stored world no tab has open (this tab's open world is kept). */
      wipeAll: async () => {
        const storage = saves();
        let deleted = 0;
        let kept = 0;
        for (const { id } of await storage.listWorlds()) {
          if (await deleteClosedWorld(storage, id)) deleted++;
          else kept++;
        }
        return { deleted, kept };
      },
    },
    audio: {
      /** Keys of the sounds played (oldest first), logged even when muted or not yet resumed. */
      log: () => app.audio?.log() ?? [],
      state: () => app.audio?.state() ?? null,
    },
  };
  window.__game = api;
}
