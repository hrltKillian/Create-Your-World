import { Matrix4 } from 'three';
import {
  FACE_DOWN,
  FACE_SOUTH,
  FACE_UP,
  type Registry,
  SHAPE_BOXES,
  SHAPE_CROSS,
} from '../content/registry.ts';
import type { BoxBatch, BoxSkin } from './BoxBatch.ts';

/** Boxes an item extruded from its icon may use (docs/conception.md « BoxBatch »). */
export const MAX_ITEM_BOXES = 32;

/** One box of an item model: its unit-box transform in item space, and its skin. */
export interface ItemPart {
  readonly box: Matrix4;
  readonly skin: BoxSkin;
}

/**
 * The boxes that draw an item, in item space: the model fits the cube −0.5…0.5 around its centre.
 * Block items are the block (a cube, or its boxes); other items are their icon extruded one pixel
 * thick in the xy plane (`sprite`). `far` is the single box drawn for distant drops.
 */
export interface ItemModel {
  readonly sprite: boolean;
  readonly parts: readonly ItemPart[];
  readonly far: ItemPart;
}

/** A rectangle of pixels (x, y from the bottom-left, rows bottom-up like the textures). */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Covers the opaque pixels of a size × size mask with rectangles, greedily: from each uncovered
 * opaque pixel (bottom row first) a run as wide as possible, grown upwards while the whole run
 * stays opaque. At most `max` rectangles; pixels left over are dropped.
 */
export function maskRects(
  opaque: (x: number, y: number) => boolean,
  size: number,
  max: number,
): PixelRect[] {
  const covered = new Uint8Array(size * size);
  const free = (x: number, y: number) => opaque(x, y) && covered[y * size + x] === 0;
  const rects: PixelRect[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!free(x, y) || rects.length >= max) continue;
      let w = 1;
      while (x + w < size && free(x + w, y)) w++;
      let h = 1;
      for (; y + h < size; h++) {
        let row = true;
        for (let i = 0; i < w && row; i++) row = free(x + i, y + h);
        if (!row) break;
      }
      for (let j = 0; j < h; j++) covered.fill(1, (y + j) * size + x, (y + j) * size + x + w);
      rects.push({ x, y, w, h });
    }
  }
  return rects;
}

function part(x: number, y: number, z: number, w: number, h: number, d: number, skin: BoxSkin) {
  return { box: new Matrix4().makeScale(w, h, d).setPosition(x, y, z), skin };
}

/** A block box in 1/16 (block space 0…16) as an item part centred on the block. */
function blockPart(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  layers: readonly [number, number, number],
): ItemPart {
  const [side, top, bottom] = layers;
  const skin: BoxSkin = {
    side,
    top,
    bottom,
    ox: x0 / 16,
    oy: y0 / 16,
    oz: z0 / 16,
    sx: (x1 - x0) / 16,
    sy: (y1 - y0) / 16,
    sz: (z1 - z0) / 16,
    sprite: false,
  };
  return part(
    x0 / 16 - 0.5,
    y0 / 16 - 0.5,
    z0 / 16 - 0.5,
    (x1 - x0) / 16,
    (y1 - y0) / 16,
    (z1 - z0) / 16,
    skin,
  );
}

/** An icon layer extruded into boxes (one per pixel rectangle), one pixel thick. */
function spriteModel(layer: number, pixels: Uint8Array, size: number): ItemModel {
  const base = layer * size * size * 4;
  const opaque = (x: number, y: number) => pixels[base + (y * size + x) * 4 + 3]! > 127;
  const spritePart = (r: PixelRect): ItemPart => {
    const skin: BoxSkin = {
      side: layer,
      top: layer,
      bottom: layer,
      ox: r.x / size,
      oy: r.y / size,
      oz: 0,
      sx: r.w / size,
      sy: r.h / size,
      sz: 0,
      sprite: true,
    };
    return part(
      r.x / size - 0.5,
      r.y / size - 0.5,
      -0.5 / size,
      r.w / size,
      r.h / size,
      1 / size,
      skin,
    );
  };
  const rects = maskRects(opaque, size, MAX_ITEM_BOXES);
  let x0 = size;
  let y0 = size;
  let x1 = 0;
  let y1 = 0;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  const bounds =
    rects.length > 0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: size, h: size };
  const parts = rects.map(spritePart);
  return { sprite: true, parts, far: spritePart(bounds) };
}

/** The model of a block item: its default state's boxes, or a cube; plants are sprites. */
function blockModel(
  registry: Registry,
  state: number,
  pixels: Uint8Array,
  size: number,
): ItemModel {
  const tables = registry.tables;
  const layer = (face: number) => tables.faceLayer[state * 6 + face]!;
  const layers = [layer(FACE_SOUTH), layer(FACE_UP), layer(FACE_DOWN)] as const;
  const shape = tables.shape[state];
  if (shape === SHAPE_CROSS) return spriteModel(layers[0], pixels, size);
  const boxes =
    shape === SHAPE_BOXES
      ? tables.boxShapes[tables.boxShape[state]!]!
      : [[0, 0, 0, 16, 16, 16] as const];
  const parts = boxes
    .slice(0, MAX_ITEM_BOXES)
    .map(([x0, y0, z0, x1, y1, z1]) => blockPart(x0, y0, z0, x1, y1, z1, layers));
  return { sprite: false, parts, far: parts[0]! };
}

/**
 * The model of every item, by item id. `pixels` holds the RGBA bytes of every texture layer of
 * the pack, in layer order (`size` × `size` each): icons are extruded from their alpha.
 */
export function buildItemModels(registry: Registry, pixels: Uint8Array, size: number): ItemModel[] {
  return registry.items.map((item) => {
    if (typeof item.icon !== 'string')
      return blockModel(registry, registry.defaultState(item.icon.block), pixels, size);
    return spriteModel(Math.max(0, registry.textureKeys.indexOf(item.icon)), pixels, size);
  });
}

const scratch = new Matrix4();

/**
 * Adds an item's boxes to a batch: `base` maps item space to the world, `detailed` picks every
 * part or the single far box. No allocation.
 */
export function drawItem(
  batch: BoxBatch,
  model: ItemModel,
  base: Matrix4,
  sky: number,
  block: number,
  detailed: boolean,
): void {
  if (!detailed) {
    batch.add(scratch.multiplyMatrices(base, model.far.box), model.far.skin, sky, block);
    return;
  }
  const parts = model.parts;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    batch.add(scratch.multiplyMatrices(base, p.box), p.skin, sky, block);
  }
}
