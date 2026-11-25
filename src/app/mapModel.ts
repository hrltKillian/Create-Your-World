import { exploredKey } from '../sim/exploration.ts';
import type { PlayerState } from '../sim/player.ts';
import type { MapView } from '../ui/map.ts';
import { MAP_CELLS } from '../ui/map.ts';
import { blockToColumn, SECTION_SIZE } from '../world/coords.ts';
import { FLAT_SURFACE } from '../world/gen/flat.ts';
import { flatBiome, type GenContext, isFlatWorld } from '../world/gen/generateColumn.ts';
import { LatticeCache, pointInfo } from '../world/gen/sample.ts';

/*
 * What the maps draw (plan v3 « M27 »: the HUD's minimap and the big map): the explored columns
 * around the player, each coloured from the world's own generation (analytic: no column needs to
 * be loaded) in MAP_CELLS × MAP_CELLS cells of its biome's grass or water tint, shaded by height
 * (flat test worlds: their biome's grass at their one height).
 */

/** Blocks per map cell. */
const CELL = SECTION_SIZE / MAP_CELLS;

const hex = (colour: string) => Number.parseInt(colour.slice(1), 16);

/** RGB of one map cell: the biome's water under the sea, else its grass shaded by height. */
function cellColour(gen: GenContext, cache: LatticeCache, x: number, z: number): number {
  const info = isFlatWorld(gen.worldType)
    ? { biome: flatBiome(gen), height: FLAT_SURFACE }
    : pointInfo(gen, x, z, cache);
  const tints = gen.biomes[info.biome]!.def.tints;
  const sea = gen.def.seaLevel;
  if (info.height < sea) return hex(tints.water);
  // Higher ground is lighter: up to +35 % at 60 blocks over the sea.
  const k = 0.85 + Math.min(0.5, (info.height - sea) / 120);
  const c = hex(tints.grass);
  const channel = (shift: number) => Math.min(255, Math.round(((c >> shift) & 255) * k));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** The colours of each column, computed once (the world's generation never changes). */
export class MapModel {
  private readonly columns = new Map<string, Uint32Array>();
  private readonly cache = new LatticeCache();
  private readonly gen: GenContext;

  constructor(gen: GenContext) {
    this.gen = gen;
  }

  private column(cx: number, cz: number): Uint32Array {
    const key = exploredKey(cx, cz);
    let colours = this.columns.get(key);
    if (!colours) {
      colours = new Uint32Array(MAP_CELLS * MAP_CELLS);
      for (let j = 0; j < MAP_CELLS; j++)
        for (let i = 0; i < MAP_CELLS; i++)
          colours[i + j * MAP_CELLS] = cellColour(
            this.gen,
            this.cache,
            cx * SECTION_SIZE + i * CELL + CELL / 2,
            cz * SECTION_SIZE + j * CELL + CELL / 2,
          );
      this.columns.set(key, colours);
    }
    return colours;
  }

  /**
   * The map around a player within `radius` columns of theirs: their explored columns, where they
   * stand and face, their waypoints.
   */
  view(player: Readonly<PlayerState>, radius: number): MapView {
    const pcx = blockToColumn(player.body.x);
    const pcz = blockToColumn(player.body.z);
    const columns: MapView['columns'][number][] = [];
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (player.explored[exploredKey(pcx + dx, pcz + dz)] !== true) continue;
        columns.push({ dx, dz, colours: this.column(pcx + dx, pcz + dz) });
      }
    const origin = (v: number, c: number) => v / SECTION_SIZE - c;
    return {
      columns,
      player: { x: origin(player.body.x, pcx), z: origin(player.body.z, pcz), yaw: player.yaw },
      waypoints: player.waypoints.map((w) => ({
        name: w.name,
        x: origin(w.x + 0.5, pcx),
        z: origin(w.z + 0.5, pcz),
      })),
    };
  }
}
