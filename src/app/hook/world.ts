import { Column } from '../../world/Column.ts';
import { findBiome, findStructure } from '../../world/gen/find.ts';
import { columnHash, generateColumn } from '../../world/gen/generateColumn.ts';
import { pointInfo } from '../../world/gen/sample.ts';
import type { App } from '../App.ts';
import { blockKey, fill, lightAt, setBlock, waitForChunks, yieldTask } from '../automation.ts';

/** The player's (or free camera's) block column, the default origin of searches. */
function playerPlace(app: App): { x: number; z: number } | null {
  const pose = app.freecam?.pose ?? app.session?.player.body;
  return pose ? { x: Math.floor(pose.x), z: Math.floor(pose.z) } : null;
}

/** `__game.world`: blocks, light, generation queries, streaming waits and memory. */
export function worldHook(app: App) {
  return {
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
    findBiome: (biome: string, maxRadius = 3000, from = playerPlace(app)) => {
      const session = app.session;
      return session && from ? findBiome(session.host.view.gen, biome, from, maxRadius) : null;
    },
    /** Nearest structure of a kind (its key) within `maxRadius` blocks: { x, y, z, distance }. */
    findStructure: (structure: string, maxRadius = 3000, from = playerPlace(app)) => {
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
    fill: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, state: string) =>
      fill(app, x0, y0, z0, x1, y1, z1, state),
    setRenderDistance: (rd: number) => app.session?.setRenderDistance(rd),
    memory: () => ({
      voxelBytes: app.world?.voxelBytes() ?? 0,
      geometries: app.renderer?.webgl.info.memory.geometries ?? 0,
      geometryBytes: app.view?.chunks.stats().geometryBytes ?? 0,
    }),
    stateCount: () => app.registry?.tables.stateCount ?? 0,
  };
}
