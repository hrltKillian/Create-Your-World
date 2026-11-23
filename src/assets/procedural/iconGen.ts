import {
  FACE_NORTH,
  FACE_UP,
  FACE_WEST,
  PASS_OPAQUE,
  packTints,
  type Registry,
  SHAPE_CUBE,
  SHAPE_LIQUID,
  TINT_NONE,
} from '../../content/registry.ts';
import { parseHex } from './textureGen.ts';

/** Side of an item icon in pixels: block cubes are drawn at this size, masks scaled up to it. */
export const ICON_SIZE = 32;

/** Brightness of the visible cube faces (the voxel shader's face shading). */
const TOP_SHADE = 1;
const LEFT_SHADE = 0.8;
const RIGHT_SHADE = 0.68;
/** Coverage below this alpha is a hole in cutout textures (the shader's cutout threshold). */
const CUTOUT_ALPHA = 90;

/** One texture face as the icon samples it: layer bytes, tint and shading. */
interface FaceArt {
  layer: Uint8Array;
  tint: readonly [number, number, number] | null;
  /** Opaque layers use alpha as the tint mask; others use it as coverage. */
  opaque: boolean;
  shade: number;
}

/**
 * RGBA pixels (rows from the top, canvas order) of an item's icon: an isometric cube for a cube or
 * liquid block, the block's side for other shapes, else the item's own texture (a pixel mask).
 * Pure: `layers` are the pack textures (rows bottom-up, `size` pixels square).
 */
export function itemIconPixels(
  registry: Registry,
  itemId: number,
  layers: readonly Uint8Array[],
  size: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(ICON_SIZE * ICON_SIZE * 4);
  const icon = registry.items[itemId]!.icon;
  if (typeof icon === 'string') {
    const layer = layers[registry.textureKeys.indexOf(icon)]!;
    drawFlat(out, { layer, tint: null, opaque: false, shade: 1 }, size);
    return out;
  }
  const state = registry.defaultState(icon.block);
  const shape = registry.tables.shape[state];
  const face = (f: number, shade: number) => faceArt(registry, layers, state, f, shade);
  if (shape === SHAPE_CUBE || shape === SHAPE_LIQUID) {
    drawCube(
      out,
      face(FACE_UP, TOP_SHADE),
      face(FACE_WEST, LEFT_SHADE),
      face(FACE_NORTH, RIGHT_SHADE),
      size,
    );
  } else {
    drawFlat(out, face(FACE_NORTH, 1), size);
  }
  return out;
}

function faceArt(
  registry: Registry,
  layers: readonly Uint8Array[],
  state: number,
  face: number,
  shade: number,
): FaceArt {
  const tables = registry.tables;
  const channel = tables.faceTint[state * 6 + face]!;
  const hex = channel === TINT_NONE ? null : packTints(registry.pack)[channel]!;
  return {
    layer: layers[tables.faceLayer[state * 6 + face]!]!,
    tint: hex ? parseHex(hex) : null,
    opaque: tables.pass[state] === PASS_OPAQUE,
    shade,
  };
}

/** Writes the texel (u, v ∈ [0, 1), v from the top) of a face into icon pixel `o`. */
function sample(
  out: Uint8ClampedArray,
  o: number,
  art: FaceArt,
  u: number,
  v: number,
  size: number,
) {
  const x = Math.min(size - 1, Math.floor(u * size));
  const y = size - 1 - Math.min(size - 1, Math.floor(v * size));
  const t = (y * size + x) * 4;
  const layer = art.layer;
  const alpha = layer[t + 3]!;
  if (!art.opaque && alpha < CUTOUT_ALPHA) return;
  // Opaque faces mix the tint in by their alpha mask; cutout and translucent faces take it whole.
  const mix = art.opaque ? alpha / 255 : 1;
  for (let c = 0; c < 3; c++) {
    const tint = art.tint ? 1 + (art.tint[c]! / 255 - 1) * mix : 1;
    out[o + c] = layer[t + c]! * tint * art.shade;
  }
  out[o + 3] = 255;
}

/** A texture face filling the whole icon (nearest-neighbour scaling). */
function drawFlat(out: Uint8ClampedArray, art: FaceArt, size: number): void {
  for (let py = 0; py < ICON_SIZE; py++) {
    for (let px = 0; px < ICON_SIZE; px++) {
      sample(out, (py * ICON_SIZE + px) * 4, art, px / ICON_SIZE, py / ICON_SIZE, size);
    }
  }
}

/**
 * An isometric cube: the top is a diamond (left, top, right and bottom corners at mid-height,
 * top edge, right edge and centre), the two sides hang below it. Each pixel centre is mapped back
 * to texture coordinates through the inverse of its face's affine map.
 */
function drawCube(
  out: Uint8ClampedArray,
  top: FaceArt,
  left: FaceArt,
  right: FaceArt,
  size: number,
) {
  const w = ICON_SIZE / 2;
  const q = ICON_SIZE / 4;
  for (let py = 0; py < ICON_SIZE; py++) {
    for (let px = 0; px < ICON_SIZE; px++) {
      const x = px + 0.5;
      const y = py + 0.5;
      const o = (py * ICON_SIZE + px) * 4;
      // Top: (0, q) + u·(w, −q) + v·(w, q).
      const a = x / w;
      const b = (y - q) / q;
      const tu = (a - b) / 2;
      const tv = (a + b) / 2;
      if (tu >= 0 && tu < 1 && tv >= 0 && tv < 1) {
        sample(out, o, top, tu, tv, size);
        continue;
      }
      if (x < w) {
        // Left side: (0, q) + u·(w, q) + v·(0, w).
        const u = x / w;
        const v = (y - q - u * q) / w;
        if (v >= 0 && v < 1) sample(out, o, left, u, v, size);
      } else {
        // Right side: (w, w) + u·(w, −q) + v·(0, w).
        const u = (x - w) / w;
        const v = (y - w + u * q) / w;
        if (v >= 0 && v < 1) sample(out, o, right, u, v, size);
      }
    }
  }
}

/**
 * Blob URLs of every item's icon, by numeric item id (browser only). Shown with
 * `image-rendering: pixelated`, so the 32 px art stays crisp at any slot size.
 */
export async function createItemIcons(
  registry: Registry,
  layers: readonly Uint8Array[],
  size: number,
): Promise<string[]> {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const urls: string[] = [];
  for (let id = 0; id < registry.items.length; id++) {
    const pixels = itemIconPixels(registry, id, layers, size);
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    ctx.putImageData(new ImageData(pixels, ICON_SIZE, ICON_SIZE), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
    urls.push(blob ? URL.createObjectURL(blob) : '');
  }
  return urls;
}
