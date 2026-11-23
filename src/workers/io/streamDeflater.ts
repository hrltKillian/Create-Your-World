import type { Deflater } from '../../world/codec/columnRecord.ts';

/** Runs bytes through a compression or decompression stream. */
async function through(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** deflate-raw with the Compression Streams API (browsers, workers; Node has it too). */
export const streamDeflater: Deflater = {
  deflate: (raw) => through(raw, new CompressionStream('deflate-raw')),
  inflate: (packed) => through(packed, new DecompressionStream('deflate-raw')),
};
