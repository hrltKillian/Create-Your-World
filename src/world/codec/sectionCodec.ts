import type { ByteReader, ByteWriter } from '../../core/varint.ts';
import { SECTION_VOLUME, SECTIONS_PER_COLUMN } from '../coords.ts';
import type { SavedSection } from '../protocol.ts';

/**
 * Save codec of one section (docs « Sauvegarde »): its height index `sy` (u8), the palette size
 * (varint) and the palette (u16 state ids in order of first appearance), then, unless the palette
 * has a single entry, the voxels in index order as runs of (palette index, run length − 1) varints.
 * A uniform section takes 4 bytes. State ids are those of the registry that wrote them: the reader
 * maps every palette entry through `remap` (the world's `stateKeys`, docs « Encodage »).
 */

/** Palette index of each state id while a section is written (−1: not in the palette yet). */
const paletteIndex = new Int32Array(0x10000).fill(-1);
const palette: number[] = [];

export function writeSection(out: ByteWriter, section: SavedSection): void {
  out.u8(section.sy);
  const blocks = section.blocks;
  if (!blocks) {
    out.varint(1);
    out.u16(section.uniformBlock);
    return;
  }
  palette.length = 0;
  for (let i = 0; i < SECTION_VOLUME; i++) {
    const id = blocks[i]!;
    if (paletteIndex[id] === -1) {
      paletteIndex[id] = palette.length;
      palette.push(id);
    }
  }
  out.varint(palette.length);
  for (let p = 0; p < palette.length; p++) out.u16(palette[p]!);
  if (palette.length > 1) {
    let current = blocks[0]!;
    let extra = 0;
    for (let i = 1; i < SECTION_VOLUME; i++) {
      const id = blocks[i]!;
      if (id === current) {
        extra++;
        continue;
      }
      out.varint(paletteIndex[current]!);
      out.varint(extra);
      current = id;
      extra = 0;
    }
    out.varint(paletteIndex[current]!);
    out.varint(extra);
  }
  for (let p = 0; p < palette.length; p++) paletteIndex[palette[p]!] = -1;
}

/** Reads one section, mapping its palette through `remap`; throws a RangeError on corrupt data. */
export function readSection(input: ByteReader, remap: (savedId: number) => number): SavedSection {
  const sy = input.u8();
  if (sy >= SECTIONS_PER_COLUMN) throw new RangeError(`Bad section height ${sy}`);
  const size = input.varint();
  if (size < 1 || size > SECTION_VOLUME) throw new RangeError(`Bad palette size ${size}`);
  const ids = new Uint16Array(size);
  for (let p = 0; p < size; p++) ids[p] = remap(input.u16());
  if (size === 1) return { sy, uniformBlock: ids[0]!, blocks: null };
  const blocks = new Uint16Array(SECTION_VOLUME);
  let i = 0;
  while (i < SECTION_VOLUME) {
    const index = input.varint();
    const end = i + input.varint() + 1;
    if (index >= size || end > SECTION_VOLUME) throw new RangeError('Corrupt section runs');
    blocks.fill(ids[index]!, i, end);
    i = end;
  }
  return { sy, uniformBlock: ids[0]!, blocks };
}
