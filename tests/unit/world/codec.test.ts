import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/core/rng.ts';
import { ByteReader, ByteWriter } from '../../../src/core/varint.ts';
import { persistedSections } from '../../../src/world/Column.ts';
import {
  compressPayload,
  type Deflater,
  expandPayload,
  packSections,
  unpackSections,
} from '../../../src/world/codec/columnRecord.ts';
import { readSection, writeSection } from '../../../src/world/codec/sectionCodec.ts';
import { SECTION_VOLUME } from '../../../src/world/coords.ts';
import { createGenContext } from '../../../src/world/gen/generateColumn.ts';
import type { SavedSection } from '../../../src/world/protocol.ts';
import { generate } from '../../helpers/gen.ts';
import { registry } from '../../helpers/registry.ts';
import { zlibDeflater } from '../../helpers/save.ts';

const same = (id: number) => id;

/** Every voxel of a saved section. */
function voxels(section: SavedSection): Uint16Array {
  return section.blocks ?? new Uint16Array(SECTION_VOLUME).fill(section.uniformBlock);
}

/** A random section: uniform, an array of one id, runs of a few ids, or noise over a palette. */
function randomSection(rng: Rng, sy: number): SavedSection {
  const id = () => rng.int(0x10000);
  switch (rng.int(4)) {
    case 0:
      return { sy, uniformBlock: id(), blocks: null };
    case 1:
      return { sy, uniformBlock: 0, blocks: new Uint16Array(SECTION_VOLUME).fill(id()) };
    case 2: {
      const palette = Array.from({ length: rng.intRange(2, 12) }, id);
      const blocks = new Uint16Array(SECTION_VOLUME);
      for (let i = 0; i < SECTION_VOLUME; ) {
        const end = Math.min(SECTION_VOLUME, i + rng.intRange(1, 3000));
        blocks.fill(palette[rng.int(palette.length)]!, i, end);
        i = end;
      }
      return { sy, uniformBlock: 0, blocks };
    }
    default: {
      const palette = Array.from({ length: rng.intRange(2, 400) }, id);
      const blocks = new Uint16Array(SECTION_VOLUME);
      for (let i = 0; i < SECTION_VOLUME; i++) blocks[i] = palette[rng.int(palette.length)]!;
      return { sy, uniformBlock: 0, blocks };
    }
  }
}

describe('varints', () => {
  it('round-trips integers below 2^32 and rejects truncated or overlong data', () => {
    const values = [0, 1, 127, 128, 300, 16_383, 16_384, 65_535, 2 ** 31, 2 ** 32 - 1];
    const writer = new ByteWriter();
    for (const v of values) writer.varint(v);
    writer.u16(0xbeef);
    const reader = new ByteReader(writer.toBytes());
    expect(values.map(() => reader.varint())).toEqual(values);
    expect(reader.u16()).toBe(0xbeef);
    expect(reader.done).toBe(true);
    expect(() => reader.u8()).toThrow(RangeError);
    expect(() => new ByteReader(new Uint8Array([0x80, 0x80])).varint()).toThrow(RangeError);
    const sixBytes = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
    expect(() => new ByteReader(sixBytes).varint()).toThrow(RangeError);
  });
});

describe('section codec', () => {
  it('round-trips 1000 random sections; a uniform one takes at most 6 bytes', () => {
    const rng = Rng.fromSeed('codec', 'sections');
    const writer = new ByteWriter();
    let uniform = 0;
    for (let n = 0; n < 1000; n++) {
      const section = randomSection(rng, n % 8);
      writer.reset();
      writeSection(writer, section);
      const bytes = writer.toBytes();
      const read = readSection(new ByteReader(bytes), same);
      expect(read.sy).toBe(section.sy);
      const expected = voxels(section);
      const isUniform = expected.every((v) => v === expected[0]);
      if (isUniform) {
        uniform++;
        expect(bytes.length, `section ${n}`).toBeLessThanOrEqual(6);
        expect(read).toEqual({ sy: section.sy, uniformBlock: expected[0], blocks: null });
      } else {
        expect(voxels(read)).toEqual(expected);
      }
    }
    expect(uniform).toBeGreaterThan(400);
  });

  it('maps every palette entry through the remap table', () => {
    const blocks = new Uint16Array(SECTION_VOLUME).fill(7);
    blocks.fill(9, 100, 5000);
    const raw = packSections([
      { sy: 5, uniformBlock: 3, blocks: null },
      { sy: 1, uniformBlock: 0, blocks },
    ]);
    const [low, high] = unpackSections(raw, (id) => id * 10);
    expect(high).toEqual({ sy: 5, uniformBlock: 30, blocks: null });
    expect(low!.sy).toBe(1);
    expect(low!.blocks![99]).toBe(70);
    expect(low!.blocks![100]).toBe(90);
    expect(low!.blocks![4999]).toBe(90);
    expect(low!.blocks![5000]).toBe(70);
  });

  it('rejects corrupt payloads', () => {
    const raw = packSections([{ sy: 2, uniformBlock: 4, blocks: null }]);
    expect(() => unpackSections(raw.subarray(0, raw.length - 1), same)).toThrow(RangeError);
    expect(() => unpackSections(new Uint8Array([...raw, 0]), same)).toThrow(RangeError);
    const twice = packSections([
      { sy: 2, uniformBlock: 4, blocks: null },
      { sy: 2, uniformBlock: 5, blocks: null },
    ]);
    expect(() => unpackSections(twice, same)).toThrow(RangeError);
    // Height 9, then a palette of 2 whose run points past the palette.
    expect(() => unpackSections(new Uint8Array([1, 9, 1, 0, 0]), same)).toThrow(RangeError);
    expect(() => unpackSections(new Uint8Array([1, 0, 2, 1, 0, 2, 0, 5, 0]), same)).toThrow(
      RangeError,
    );
  });
});

describe('column record payload', () => {
  const ctx = createGenContext('codec', registry);
  const column = generate(ctx, 3, -2);
  column.persisted = 0xff;
  const sections = persistedSections(column);
  const raw = packSections(sections);

  it('packs a generated column into a few KB, deflated once, and reads it back', async () => {
    const { codec, payload } = await compressPayload(raw, zlibDeflater);
    expect(codec).toBe('deflate-raw');
    expect(payload.length).toBeLessThan(raw.length);
    expect(raw.length / sections.length).toBeLessThan(6000);
    const back = unpackSections(await expandPayload(codec, payload, zlibDeflater), same);
    expect(back.map((s) => s.sy)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    back.forEach((s, sy) => {
      expect(voxels(s), `section ${sy}`).toEqual(voxels(sections[sy]!));
    });
  });

  it('keeps the raw payload when deflate is not smaller', async () => {
    const tiny = packSections([{ sy: 0, uniformBlock: 1, blocks: null }]);
    expect(tiny.length).toBe(5);
    expect(await compressPayload(tiny, zlibDeflater)).toEqual({ codec: 'raw', payload: tiny });
    const sameSize: Deflater = { ...zlibDeflater, deflate: async (b) => b.slice() };
    expect((await compressPayload(raw, sameSize)).codec).toBe('raw');
    expect(await expandPayload('raw', tiny, zlibDeflater)).toBe(tiny);
  });
});
