import { FACE_UP, type Registry, SHAPE_LIQUID } from '../content/registry.ts';
import { exploredKey } from '../sim/exploration.ts';
import type { PlayerState } from '../sim/player.ts';
import type { MapView } from '../ui/map.ts';
import type { Column } from '../world/Column.ts';
import { blockToColumn, SECTION_SIZE } from '../world/coords.ts';
import { topBlockAt } from '../world/gen/banks.ts';
import { FLAT_SURFACE } from '../world/gen/flat.ts';
import { flatBiome, type GenContext, isFlatWorld } from '../world/gen/generateColumn.ts';
import { biomeOf, heightAt, LatticeCache } from '../world/gen/sample.ts';
import type { VoxelWorld } from '../world/VoxelWorld.ts';

/*
 * What the maps draw (plan v3 « M27 », detailed at « M31 »: the HUD's minimap and the big map):
 * a colour for each block of the explored columns, one pixel each. A loaded column is read as it
 * stands (the top block's colour, its biome's tint, built blocks and trees too), shaded by its
 * relief (the reference game's: lighter where the ground rises northwards, darker where it
 * falls) and water darker with depth; it is kept as last seen once unloaded. A column explored
 * before this session and not loaded since is coloured from the generation (the terrain alone).
 */

const SIDE = SECTION_SIZE;
/** Relief shading: higher than the block to the north, lower, the same. */
const RISE = 1.12;
const FALL = 0.84;
/** Water darkens by this share per block of depth, down to WATER_FLOOR of its colour. */
const WATER_DEPTH = 0.07;
const WATER_FLOOR = 0.55;

const hex = (colour: string) => Number.parseInt(colour.slice(1), 16);

function shade(rgb: number, k: number): number {
  const c = (shift: number) => Math.min(255, Math.round(((rgb >> shift) & 255) * k));
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

function tinted(rgb: number, tint: number): number {
  const c = (shift: number) => Math.round((((rgb >> shift) & 255) * ((tint >> shift) & 255)) / 255);
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

/** The relief's shade of a block from its height and the height of the block to its north. */
function relief(h: number, north: number): number {
  return h > north ? RISE : h < north ? FALL : 1;
}

/** The water's shade at a depth (blocks). */
function depthShade(depth: number): number {
  return Math.max(WATER_FLOOR, 1 - WATER_DEPTH * (depth - 1));
}

interface Cached {
  readonly colours: Uint32Array;
  /** The column's content when read (sum of its sections' versions); −1 from the generation. */
  readonly stamp: number;
}

/** The map colours of a world (one per open world: InventoryUi.maps). */
export class MapModel {
  private readonly columns = new Map<string, Cached>();
  private readonly cache = new LatticeCache();
  private readonly gen: GenContext;
  private readonly world: VoxelWorld;
  private readonly registry: Registry;
  private readonly layers: readonly Uint8Array[];
  /** Average colour of each state's top face (−1: not computed yet). */
  private readonly top: Int32Array;

  /** `layers`: the pack's textures (RGBA bytes, the texture array's layers). */
  constructor(
    gen: GenContext,
    world: VoxelWorld,
    registry: Registry,
    layers: readonly Uint8Array[],
  ) {
    this.gen = gen;
    this.world = world;
    this.registry = registry;
    this.layers = layers;
    this.top = new Int32Array(registry.tables.blockOf.length).fill(-1);
  }

  /** A block state's colour in a biome: its top face's average, tinted as the chunks tint it. */
  colourOf(state: number, biome: number): number {
    const tables = this.registry.tables;
    const face = state * 6 + FACE_UP;
    let rgb = this.top[state]!;
    if (rgb < 0) {
      rgb = averageColour(this.layers[tables.faceLayer[face]!]);
      this.top[state] = rgb;
    }
    const channel = tables.faceTint[face]!;
    const tints = this.gen.biomes[biome]?.def.tints;
    if (channel === 0 || !tints) return rgb;
    const tint = channel === 1 ? tints.grass : channel === 2 ? tints.foliage : tints.water;
    return tinted(rgb, hex(tint));
  }

  /** The colours of a column: read again if loaded and changed, else as last seen or generated. */
  private column(cx: number, cz: number): Uint32Array {
    const key = exploredKey(cx, cz);
    const known = this.columns.get(key);
    const column = this.world.getColumn(cx, cz);
    if (column) {
      const stamp = stampOf(column);
      if (known?.stamp === stamp) return known.colours;
      const colours = known?.colours ?? new Uint32Array(SIDE * SIDE);
      this.readColumn(column, cx, cz, colours);
      this.columns.set(key, { colours, stamp });
      return colours;
    }
    if (known) return known.colours;
    const colours = this.generatedColumn(cx, cz);
    this.columns.set(key, { colours, stamp: -1 });
    return colours;
  }

  private readColumn(column: Column, cx: number, cz: number, out: Uint32Array): void {
    const tables = this.registry.tables;
    const north = this.world.getColumn(cx, cz - 1);
    for (let lz = 0; lz < SIDE; lz++)
      for (let lx = 0; lx < SIDE; lx++) {
        const cell = lx | (lz << 5);
        const h = column.heightmap[cell]! - 1;
        const state = h >= 0 ? column.getBlock(lx, h, lz) : this.registry.air;
        let rgb = this.colourOf(state, column.biomes[cell]!);
        if (tables.shape[state] === SHAPE_LIQUID) {
          // Water darkens with depth, its surface flat.
          let depth = 1;
          while (depth < 8 && h - depth >= 0 && column.getBlock(lx, h - depth, lz) === state)
            depth++;
          rgb = shade(rgb, depthShade(depth));
        } else {
          const n =
            lz > 0
              ? column.heightmap[lx | ((lz - 1) << 5)]!
              : (north?.heightmap[lx | ((SIDE - 1) << 5)] ?? h + 1);
          rgb = shade(rgb, relief(h + 1, n));
        }
        out[lx + lz * SIDE] = rgb;
      }
  }

  /** A column never seen loaded: its terrain from the generation (no feature, no build). */
  private generatedColumn(cx: number, cz: number): Uint32Array {
    const out = new Uint32Array(SIDE * SIDE);
    const gen = this.gen;
    const flat = isFlatWorld(gen.worldType);
    const sea = gen.def.seaLevel;
    const heightOf = (x: number, z: number) =>
      flat ? FLAT_SURFACE : heightAt(gen, this.cache, x, z);
    for (let lz = 0; lz < SIDE; lz++)
      for (let lx = 0; lx < SIDE; lx++) {
        const x = cx * SIDE + lx;
        const z = cz * SIDE + lz;
        const h = heightOf(x, z);
        const index = flat ? flatBiome(gen) : biomeOf(gen, this.cache, x, z);
        const biome = gen.biomes[index]!;
        if (h < sea) {
          out[lx + lz * SIDE] = shade(this.colourOf(biome.liquid, index), depthShade(sea - h));
          continue;
        }
        const state = flat ? biome.surface : topBlockAt(gen, x, z, h, biome);
        out[lx + lz * SIDE] = shade(this.colourOf(state, index), relief(h, heightOf(x, z - 1)));
      }
    return out;
  }

  /**
   * The map around `centreX`, `centreZ` (blocks; the player's feet by default): the player's
   * explored columns within `radius` columns, where they stand and face, their waypoints.
   */
  view(
    player: Readonly<PlayerState>,
    radius: number,
    centreX = Math.floor(player.body.x),
    centreZ = Math.floor(player.body.z),
  ): MapView {
    const ccx = blockToColumn(centreX);
    const ccz = blockToColumn(centreZ);
    const columns: MapView['columns'][number][] = [];
    for (let cz = ccz - radius; cz <= ccz + radius; cz++)
      for (let cx = ccx - radius; cx <= ccx + radius; cx++) {
        if (player.explored[exploredKey(cx, cz)] !== true) continue;
        columns.push({ cx, cz, colours: this.column(cx, cz) });
      }
    return {
      centreX,
      centreZ,
      columns,
      player: { x: player.body.x, z: player.body.z, yaw: player.yaw },
      waypoints: player.waypoints,
    };
  }
}

/** The content of a column: its sections' versions summed (any change raises it). */
function stampOf(column: Column): number {
  let stamp = 0;
  for (const section of column.sections) stamp += section.version;
  return stamp;
}

/** The average colour of a texture's covered texels (all of them when none is). */
function averageColour(texels: Uint8Array | undefined): number {
  if (!texels) return 0x808080;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let pass = 0; pass < 2 && n === 0; pass++)
    for (let o = 0; o + 3 < texels.length; o += 4) {
      if (pass === 0 && texels[o + 3]! < 128) continue;
      r += texels[o]!;
      g += texels[o + 1]!;
      b += texels[o + 2]!;
      n++;
    }
  if (n === 0) return 0x808080;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}
