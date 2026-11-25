import { FLAG_SOLID } from '../../content/registry.ts';
import type { DebugView } from '../../render/voxelMaterial.ts';
import type { CaptureStats } from '../../render/WorldView.ts';
import { COLUMN_LIT } from '../../sim/ColumnPipeline.ts';
import { Column } from '../../world/Column.ts';
import {
  blockToColumn,
  columnIndex,
  SECTION_BITS,
  SECTION_SIZE,
  SECTIONS_PER_COLUMN,
  toColumn,
  toLocal,
  WORLD_HEIGHT,
} from '../../world/coords.ts';
import { findBiome, type Place, spiral } from '../../world/gen/find.ts';
import { type GenContext, generateColumn } from '../../world/gen/generateColumn.ts';
import { LatticeCache, pointInfo } from '../../world/gen/sample.ts';
import type { App } from '../App.ts';
import { framesFor, freezeTime, lightAt, look, setTime, waitUntil } from '../automation.ts';
import { teleportAndWait } from '../bench/stage.ts';
import {
  assert,
  chunksMeshed,
  drawsCase,
  keepingClock,
  needsRealTimeGeneratedPlayer,
  noErrorsCase,
  PLAY_SCENES,
  playerSession,
  SEARCH_RADIUS,
  SETTLE_MS,
  type SelftestCase,
  stateKey,
} from './support.ts';

/**
 * M6 « Fait quand » browser checks in the generated world with real ticks (any seed; skipped in
 * the flat and arena worlds and with ?fixedStep=1): the spawn stands on solid ground of a spawn biome with its feet and head free,
 * findBiome finds every biome near the spawn where generation agrees, an underground glowing
 * block (magma, dawn crystal) lights the open cell next to it, the 'xray' view renders and
 * changes the picture and the surface view keeps to the draw budget (structures come back with
 * the lost colony's, plan v3 « M26 »). The first case teleports back to the spawn, so the suite
 * can run again on the same page. Commands wait for the next
 * tick: waits are wall time.
 */

/** Longest wait for a teleport to land and the loading radius around it to be meshed. */
const VISIT_MS = 30_000;
/** Longest wait for the shown sections to be meshed again after a view switch. */
const REMESH_MS = 30_000;
/** Render distance of the xray case (columns). */
const XRAY_DISTANCE = 1;
/** Looking down at the ground, so the xray view has the most to show. */
const GROUND_PITCH = -0.6;

const NEIGHBOURS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

function gen(app: App): GenContext {
  return app.session!.host.view.gen;
}

function biomeKey(ctx: GenContext, index: number): string {
  return ctx.biomes[index]?.def.key ?? `#${index}`;
}

/** The spawn's block column, where the searches start. */
function spawnPlace(app: App): Place {
  const spawn = app.session!.spawn;
  return { x: Math.floor(spawn.x), z: Math.floor(spawn.z) };
}

/** Teleports the player and waits until it landed and the loading radius around it is meshed. */
async function visit(app: App, x: number, y: number | 'surface', z: number): Promise<void> {
  await teleportAndWait(app, x, y, z);
  await chunksMeshed(app, app.session!.loadingRadius(), VISIT_MS);
}

/**
 * Switches the debug view, waits until every section of the loading radius is meshed for it (the
 * nearest first: the farther ones may still be meshing on a slow renderer), and captures it.
 */
async function captureWith(app: App, view: DebugView): Promise<CaptureStats> {
  const session = app.session!;
  app.setDebugView(view);
  await waitUntil(() => session.chunksReady(session.loadingRadius()), {
    timeoutMs: REMESH_MS,
    label: `the sections were not meshed again for the '${view}' view`,
    pump: () => session.pumpOnce(false),
    pollMs: 50,
  });
  await framesFor(SETTLE_MS);
  return app.view!.capture();
}

interface Glow {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly state: number;
  /** The open neighbour (light filter 0) and its block light. */
  readonly open: readonly [number, number, number];
  readonly light: number;
}

/**
 * The first light-emitting block under the natural ground (so magma or a glowing ore, not a
 * glowcap or a glowbloom on the surface) with an open neighbour, among the lit columns within
 * `radius` columns of the player, nearest columns first.
 */
function findGlow(app: App, radius: number): Glow | null {
  const session = app.session!;
  const view = session.host.view;
  const cache = new LatticeCache();
  const ccx = blockToColumn(session.player.body.x);
  const ccz = blockToColumn(session.player.body.z);
  let found = null as Glow | null;
  spiral(radius, (dx, dz) => {
    const column = view.world.getColumn(ccx + dx, ccz + dz);
    if (!column || view.columnState(ccx + dx, ccz + dz) < COLUMN_LIT) return false;
    found = glowIn(app, column, cache);
    return found !== null;
  });
  return found;
}

/**
 * `findGlow` in one column. Cells on the column's x/z edges are left out, so the neighbour's light
 * comes from the same, lit column.
 */
function glowIn(app: App, column: Column, cache: LatticeCache): Glow | null {
  const world = app.world!;
  const { emit, lightFilter } = app.registry!.tables;
  for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
    // Uniform sections (air, stone…) hold no emitter in a generated world.
    const blocks = column.sections[sy]!.blocks;
    if (!blocks) continue;
    for (let i = 0; i < blocks.length; i++) {
      const state = blocks[i]!;
      if (emit[state] === 0) continue;
      const lx = i & 31;
      const lz = (i >> 5) & 31;
      const y = (sy << SECTION_BITS) | (i >> 10);
      if (lx === 0 || lx === 31 || lz === 0 || lz === 31 || y === 0 || y === WORLD_HEIGHT - 1)
        continue;
      const x = column.cx * SECTION_SIZE + lx;
      const z = column.cz * SECTION_SIZE + lz;
      const open = NEIGHBOURS.find(
        ([ox, oy, oz]) => lightFilter[world.getBlock(x + ox, y + oy, z + oz)] === 0,
      );
      if (!open || y >= pointInfo(gen(app), x, z, cache).height) continue;
      const [ox, oy, oz] = [x + open[0], y + open[1], z + open[2]];
      return { x, y, z, state, open: [ox, oy, oz], light: lightAt(app, ox, oy, oz)!.block };
    }
  }
  return null;
}

export const M6_SUITE: readonly SelftestCase[] = [
  {
    name: 'the spawn stands on solid ground of a spawn biome, its feet and head cells free',
    scenes: PLAY_SCENES,
    timeoutMs: 40_000,
    skip: needsRealTimeGeneratedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const ctx = gen(app);
      const spawn = session.spawn;
      await visit(app, spawn.x, spawn.y, spawn.z);
      const { x, z } = spawnPlace(app);
      const biome = pointInfo(ctx, x, z).biome;
      const homes = [...ctx.spawnBiomes].map((b) => biomeKey(ctx, b)).join(', ');
      assert(
        ctx.spawnBiomes.has(biome),
        `the spawn (${x}, ${z}) lies in ${biomeKey(ctx, biome)}, not in a spawn biome (${homes})`,
      );
      const solid = (state: number) => (app.registry!.tables.flags[state]! & FLAG_SOLID) !== 0;
      const ground = app.world!.getBlock(x, spawn.y - 1, z);
      assert(
        solid(ground),
        `the block under the spawn feet (${x}, ${spawn.y - 1}, ${z}) is ${stateKey(app, ground)}, not solid`,
      );
      // No trunk, boulder or canopy where the player stands.
      for (const [part, y] of [
        ['feet', spawn.y],
        ['head', spawn.y + 1],
      ] as const) {
        const state = app.world!.getBlock(x, y, z);
        assert(
          !solid(state),
          `the spawn ${part} cell (${x}, ${y}, ${z}) holds ${stateKey(app, state)}, which is solid`,
        );
      }
    },
  },
  {
    name: `findBiome finds every biome within ${SEARCH_RADIUS} blocks of the spawn, where generation agrees`,
    scenes: PLAY_SCENES,
    skip: needsRealTimeGeneratedPlayer,
    run: async (app) => {
      await playerSession(app);
      const ctx = gen(app);
      const from = spawnPlace(app);
      const cache = new LatticeCache();
      ctx.biomes.forEach((biome, index) => {
        const key = biome.def.key;
        const hit = findBiome(ctx, key, from, SEARCH_RADIUS);
        assert(hit, `no ${key} within ${SEARCH_RADIUS} blocks of the spawn (${from.x}, ${from.z})`);
        const where = `findBiome('${key}') gave (${hit.x}, ${hit.z})`;
        const analytic = pointInfo(ctx, hit.x, hit.z, cache).biome;
        assert(analytic === index, `${where}, whose analytic biome is ${biomeKey(ctx, analytic)}`);
        // The same column generated on the main thread, as the workers do.
        const column = new Column(toColumn(hit.x), toColumn(hit.z), app.registry!.air);
        generateColumn(ctx, column);
        const generated = column.biomes[columnIndex(toLocal(hit.x), toLocal(hit.z))]!;
        assert(generated === index, `${where}, generated as ${biomeKey(ctx, generated)}`);
      });
    },
  },
  {
    name: 'an underground glowing block (magma, glowing ore) lights the open cell next to it',
    scenes: PLAY_SCENES,
    skip: needsRealTimeGeneratedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const radius = session.loadingRadius();
      const glow = findGlow(app, radius);
      assert(
        glow,
        `no light-emitting block with an open neighbour under the ground of the lit columns within ${radius} columns of the player`,
      );
      // The light rule: one level lost per step into an open (filter 0) cell.
      const emitted = app.registry!.tables.emit[glow.state]!;
      const expected = Math.max(1, emitted - 1);
      const [ox, oy, oz] = glow.open;
      assert(
        glow.light >= expected,
        `${stateKey(app, glow.state)} at (${glow.x}, ${glow.y}, ${glow.z}) emits ${emitted}, but the open cell (${ox}, ${oy}, ${oz}) next to it has block light ${glow.light} (< ${expected})`,
      );
    },
  },
  {
    name: "the 'xray' view renders without errors and changes the picture",
    scenes: PLAY_SCENES,
    timeoutMs: 90_000,
    skip: needsRealTimeGeneratedPlayer,
    run: async (app) => {
      const session = await playerSession(app);
      const errors = app.errors.length;
      const previous = app.debugView;
      // The xray view draws every terrain face: on a software renderer (CI) a frame of the full
      // render distance takes seconds, and the remesh never ends in time. One column around.
      const distance = session.renderDistance;
      session.setRenderDistance(XRAY_DISTANCE);
      look(app, 0, GROUND_PITCH);
      await keepingClock(app, async () => {
        // Noon and a still clock; two textured captures measure what animation alone changes.
        setTime(app, 12);
        freezeTime(app, true);
        try {
          const before = await captureWith(app, 'none');
          const textured = await captureWith(app, 'none');
          const xray = await captureWith(app, 'xray');
          const noise = Math.abs(textured.uniqueColors - before.uniqueColors);
          const change = Math.abs(xray.uniqueColors - textured.uniqueColors);
          assert(
            change > noise,
            `the xray view shows ${xray.uniqueColors} colours, the textured view ${textured.uniqueColors} (${before.uniqueColors} a moment earlier)`,
          );
        } finally {
          app.setDebugView(previous);
          session.setRenderDistance(distance);
        }
      });
      await captureWith(app, previous);
      const added = app.errors.slice(errors);
      assert(added.length === 0, `errors with the xray view: ${added.join(' | ')}`);
    },
  },
  drawsCase(needsRealTimeGeneratedPlayer),
  noErrorsCase('no errors and no missing strings after the m6 checks'),
];
