import type { Registry } from '../../content/registry.ts';

/** The avatar seen from the front: its RGBA pixels (rows from the top) and their size. */
export interface Figure {
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

/**
 * The avatar seen from the front (plan v5 « M51 »: the Bag's figure), from the very texels its
 * parts' front faces show in the world: each part where it stands, the nearest in front, at the
 * world's density (a model with `pixels`: `size / 16` texels a unit, its front face in the bottom
 * right corner of its texture). Pure: `layers` are the pack textures (rows bottom-up). Null for a
 * model without such skins.
 */
export function figurePixels(
  registry: Registry,
  layers: readonly Uint8Array[],
  size: number,
): Figure | null {
  const key = registry.pack.manifest.bindings.avatarModel;
  const model = key ? registry.model(key) : undefined;
  if (!model?.pixels) return null;
  const k = size / 16;
  let minX = 0;
  let maxX = 0;
  let maxY = 0;
  for (const part of model.parts) {
    minX = Math.min(minX, part.from[0]);
    maxX = Math.max(maxX, part.to[0]);
    maxY = Math.max(maxY, part.to[1]);
  }
  const width = Math.ceil((maxX - minX) * k);
  const height = Math.ceil(maxY * k);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const depth = new Float32Array(width * height).fill(Number.POSITIVE_INFINITY);
  for (const part of model.parts) {
    const layer = layers[registry.textureKeys.indexOf(part.faces?.front ?? part.texture)];
    if (!layer) continue;
    const w = Math.round((part.to[0] - part.from[0]) * k);
    const h = Math.round((part.to[1] - part.from[1]) * k);
    // Seen from the front, the model's right (+x) is on the viewer's left.
    const left = Math.round((maxX - part.to[0]) * k);
    const top = Math.round((maxY - part.to[1]) * k);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const t = ((h - 1 - ty) * size + (size - w + tx)) * 4;
        if (layer[t + 3]! < 128) continue;
        const x = left + tx;
        const y = top + ty;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const d = y * width + x;
        if (part.from[2] >= depth[d]!) continue;
        depth[d] = part.from[2];
        for (let c = 0; c < 4; c++) pixels[d * 4 + c] = layer[t + c]!;
      }
    }
  }
  return { pixels, width, height };
}

/** The figure as a data URL (browser only; '' without one). */
export function createFigure(
  registry: Registry,
  layers: readonly Uint8Array[],
  size: number,
): string {
  const figure = figurePixels(registry, layers, size);
  if (!figure) return '';
  const canvas = document.createElement('canvas');
  canvas.width = figure.width;
  canvas.height = figure.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(new ImageData(figure.pixels, figure.width, figure.height), 0, 0);
  return canvas.toDataURL();
}
