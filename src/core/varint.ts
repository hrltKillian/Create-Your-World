/** Byte buffers for the save codec: little-endian u16 and unsigned LEB128 varints. */

/** Growable output buffer, reusable after `reset`. */
export class ByteWriter {
  private buffer = new Uint8Array(1024);
  length = 0;

  reset(): void {
    this.length = 0;
  }

  u8(value: number): void {
    if (this.length === this.buffer.length) {
      const grown = new Uint8Array(this.buffer.length * 2);
      grown.set(this.buffer);
      this.buffer = grown;
    }
    this.buffer[this.length++] = value;
  }

  u16(value: number): void {
    this.u8(value & 0xff);
    this.u8((value >>> 8) & 0xff);
  }

  /** Unsigned integer below 2^32: 7 bits per byte, low bits first, high bit = more bytes. */
  varint(value: number): void {
    let v = value >>> 0;
    while (v >= 0x80) {
      this.u8((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.u8(v);
  }

  /** Copy of the bytes written so far. */
  toBytes(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

/** Reads what a ByteWriter wrote; throws a RangeError on truncated or malformed data. */
export class ByteReader {
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** Every byte has been read. */
  get done(): boolean {
    return this.offset === this.bytes.length;
  }

  u8(): number {
    if (this.offset >= this.bytes.length) throw new RangeError('Unexpected end of data');
    return this.bytes[this.offset++]!;
  }

  u16(): number {
    const low = this.u8();
    return low | (this.u8() << 8);
  }

  varint(): number {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) {
        if (value > 0xffffffff) break;
        return value;
      }
      scale *= 128;
    }
    throw new RangeError('Malformed varint');
  }
}
