import { describe, expect, it } from 'vitest';
import { streamDeflater } from '../../../src/workers/io/streamDeflater.ts';
import { zlibDeflater } from '../../helpers/save.ts';

describe('stream deflater', () => {
  it('writes and reads deflate-raw as zlib does', async () => {
    const raw = new Uint8Array(20_000);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) % 13 === 0 ? i & 0xff : 3;
    const packed = await streamDeflater.deflate(raw);
    expect(packed.length).toBeLessThan(raw.length / 4);
    expect(await zlibDeflater.inflate(packed)).toEqual(raw);
    expect(await streamDeflater.inflate(await zlibDeflater.deflate(raw))).toEqual(raw);
    expect(await streamDeflater.inflate(await streamDeflater.deflate(new Uint8Array()))).toEqual(
      new Uint8Array(),
    );
  });

  it('rejects data that is not deflate-raw', async () => {
    await expect(streamDeflater.inflate(new Uint8Array([0xff, 0xff, 0xff]))).rejects.toThrow();
  });
});
