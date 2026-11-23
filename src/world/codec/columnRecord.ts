import { ByteReader, ByteWriter } from '../../core/varint.ts';
import type { SavedSection } from '../protocol.ts';
import { readSection, writeSection } from './sectionCodec.ts';

/** How a column record's payload is stored. */
export type ColumnCodec = 'raw' | 'deflate-raw';

/** deflate-raw backend: CompressionStream in browsers and workers, zlib under Node (tests). */
export interface Deflater {
  deflate(raw: Uint8Array): Promise<Uint8Array>;
  inflate(packed: Uint8Array): Promise<Uint8Array>;
}

const writer = new ByteWriter();

/** Raw payload of a column record: the section count, then every section (sectionCodec). */
export function packSections(sections: readonly SavedSection[]): Uint8Array {
  writer.reset();
  writer.varint(sections.length);
  for (const section of sections) writeSection(writer, section);
  return writer.toBytes();
}

/**
 * Sections of a raw payload, sorted by height, palettes mapped through `remap`. Throws a RangeError
 * on corrupt data (truncated, trailing bytes, a height twice).
 */
export function unpackSections(
  raw: Uint8Array,
  remap: (savedId: number) => number,
): SavedSection[] {
  const input = new ByteReader(raw);
  const count = input.varint();
  const sections: SavedSection[] = [];
  let seen = 0;
  for (let i = 0; i < count; i++) {
    const section = readSection(input, remap);
    if ((seen & (1 << section.sy)) !== 0) throw new RangeError(`Section ${section.sy} twice`);
    seen |= 1 << section.sy;
    sections.push(section);
  }
  if (!input.done) throw new RangeError('Trailing bytes after the sections');
  return sections.sort((a, b) => a.sy - b.sy);
}

/** One deflate-raw over a whole raw payload, kept only when it is smaller. */
export async function compressPayload(
  raw: Uint8Array,
  deflater: Deflater,
): Promise<{ codec: ColumnCodec; payload: Uint8Array }> {
  const packed = await deflater.deflate(raw);
  return packed.length < raw.length
    ? { codec: 'deflate-raw', payload: packed }
    : { codec: 'raw', payload: raw };
}

/** The raw payload of a stored one. */
export function expandPayload(
  codec: ColumnCodec,
  payload: Uint8Array,
  deflater: Deflater,
): Promise<Uint8Array> {
  return codec === 'raw' ? Promise.resolve(payload) : deflater.inflate(payload);
}
