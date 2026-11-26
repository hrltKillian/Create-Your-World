import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { renderPackTexture } from '../src/assets/procedural/packTexture.ts';
import { basePack } from '../src/content/packs/base/index.ts';

/**
 * Dev tool (plan v4 « M36 »): writes a contact sheet of the pack's textures, colour then
 * material normals, each tiled 2 × 2 and scaled up, to review them outside the game.
 * `node tools/textureSheet.ts out.png [word,word…]`.
 */

const out = process.argv[2] ?? 'textures.png';
// Keys containing any of the comma-separated words (all textures without).
const words = (process.argv[3] ?? '').split(',').filter(Boolean);
const size = basePack.manifest.textureSize;
const SCALE = 3;
const defs = basePack.textures.filter(
  (t) => words.length === 0 || words.some((w) => t.key.includes(w)),
);
const cell = size * 2 * SCALE + 4;
const columns = 8;
const rows = Math.ceil(defs.length / columns) * 2;
const width = columns * cell;
const height = rows * cell;
const image = new Uint8Array(width * height * 4).fill(40);

defs.forEach((def, index) => {
  const { color, material } = renderPackTexture(def, size);
  const cx = (index % columns) * cell;
  const cy = Math.floor(index / columns) * 2 * cell;
  for (const [layer, dy] of [
    [color, 0],
    [material, cell],
  ] as const) {
    for (let y = 0; y < size * 2 * SCALE; y++) {
      for (let x = 0; x < size * 2 * SCALE; x++) {
        const tx = Math.floor(x / SCALE) % size;
        const ty = size - 1 - (Math.floor(y / SCALE) % size);
        const i = (ty * size + tx) * 4;
        const o = ((cy + dy + y) * width + cx + x) * 4;
        const a = layer === color ? layer[i + 3]! / 255 : 1;
        for (let k = 0; k < 3; k++) image[o + k] = Math.round(layer[i + k]! * a + 90 * (1 - a));
        image[o + 3] = 255;
      }
    }
  }
});

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}
const header = new Uint8Array(13);
const hv = new DataView(header.buffer);
hv.setUint32(0, width);
hv.setUint32(4, height);
header.set([8, 6, 0, 0, 0], 8);
const raw = new Uint8Array((width * 4 + 1) * height);
for (let y = 0; y < height; y++)
  raw.set(image.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
const png = [
  new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', new Uint8Array()),
];
writeFileSync(out, Buffer.concat(png));
console.log(`${defs.length} textures → ${out} (${width}×${height})`);
