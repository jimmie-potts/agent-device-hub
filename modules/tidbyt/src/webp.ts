// A minimal lossless WebP (VP8L) encoder for opaque RGB images (Hub #930). Copied from controllers/tidbyt/src/webp.ts
// at main 627e3fe3 and converted to the strict profile; the bytes it writes are unchanged, as the golden frames show.
//
// It writes no transforms, color cache or backward references. Each channel uses a one- or two-symbol "simple" prefix
// code when it holds at most two values, otherwise a complete fixed 8-bit code. See the WebP lossless bitstream
// specification (RFC 9649, section 3).

class BitWriter {
  readonly #bytes: number[] = [];
  #accumulator = 0;
  #used = 0;

  write(value: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.#accumulator |= ((value >>> i) & 1) << this.#used;
      this.#used += 1;
      if (this.#used === 8) {
        this.#bytes.push(this.#accumulator);
        this.#accumulator = 0;
        this.#used = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.#used > 0) this.#bytes.push(this.#accumulator);
    return Uint8Array.from(this.#bytes);
  }
}

/** Each byte with its bits in reverse order, so a fixed 8-bit code writes its most significant bit first. */
const REVERSED = Uint8Array.from({length: 256}, (_, value) => {
  let reversed = 0;
  for (let i = 0; i < 8; i += 1) reversed |= ((value >>> i) & 1) << (7 - i);
  return reversed;
});

// The code-length code writes lengths in this fixed order (RFC 9649 section 3.7.2.1.2).
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8] as const;

type ChannelCode = {kind: 'one'} | {kind: 'two'; high: number} | {kind: 'fixed'};

function writeSimple(writer: BitWriter, symbols: readonly number[]): void {
  const [first = 0, second] = symbols;
  writer.write(1, 1); // simple code
  writer.write(symbols.length - 1, 1);
  const wide = second !== undefined || first > 1;
  writer.write(wide ? 1 : 0, 1);
  writer.write(first, wide ? 8 : 1);
  if (second !== undefined) writer.write(second, 8);
}

/** Symbols 0-255 get length 8; any remaining alphabet entries get length 0. */
function writeFixed(writer: BitWriter, alphabetSize: number): void {
  writer.write(0, 1); // normal code
  writer.write(CODE_LENGTH_ORDER.length - 4, 4);
  // Code-length symbols 0 and 8 each get a one-bit code: 0 -> "0", 8 -> "1".
  for (const symbol of CODE_LENGTH_ORDER) writer.write(symbol === 0 || symbol === 8 ? 1 : 0, 3);
  writer.write(0, 1); // no max_symbol: read lengths for the whole alphabet
  for (let symbol = 0; symbol < alphabetSize; symbol += 1) writer.write(symbol < 256 ? 1 : 0, 1);
}

function channelCode(writer: BitWriter, values: ReadonlySet<number>, alphabetSize: number): ChannelCode {
  const sorted = [...values].sort((a, b) => a - b);
  const [, high] = sorted;
  if (sorted.length <= 2) {
    writeSimple(writer, sorted);
    return high === undefined ? {kind: 'one'} : {kind: 'two', high};
  }
  writeFixed(writer, alphabetSize);
  return {kind: 'fixed'};
}

function writeSymbol(writer: BitWriter, code: ChannelCode, value: number): void {
  switch (code.kind) {
    case 'one':
      return;
    case 'two':
      writer.write(value === code.high ? 1 : 0, 1);
      return;
    case 'fixed':
      writer.write(REVERSED[value] ?? 0, 8);
      return;
  }
}

/** Encodes `width`×`height` packed RGB bytes. Callers check the dimensions and the length. */
export function encodeLosslessRgb(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const writer = new BitWriter();
  writer.write(0x2f, 8); // VP8L signature
  writer.write(width - 1, 14);
  writer.write(height - 1, 14);
  writer.write(0, 1); // alpha_is_used: every pixel is opaque
  writer.write(0, 3); // version
  writer.write(0, 1); // no transforms
  writer.write(0, 1); // no color cache
  writer.write(0, 1); // no meta prefix codes
  const red = new Set<number>(), green = new Set<number>(), blue = new Set<number>();
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    red.add(rgb[i] ?? 0);
    green.add(rgb[i + 1] ?? 0);
    blue.add(rgb[i + 2] ?? 0);
  }
  // Prefix code order: green (256 literals + 24 length codes), red, blue, alpha, distance.
  const greenCode = channelCode(writer, green, 280);
  const redCode = channelCode(writer, red, 256);
  const blueCode = channelCode(writer, blue, 256);
  channelCode(writer, new Set([255]), 256);
  channelCode(writer, new Set([0]), 40);
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    writeSymbol(writer, greenCode, rgb[i + 1] ?? 0);
    writeSymbol(writer, redCode, rgb[i] ?? 0);
    writeSymbol(writer, blueCode, rgb[i + 2] ?? 0);
  }
  const data = writer.finish();
  const padded = data.length + (data.length & 1);
  const out = new Uint8Array(20 + padded);
  const view = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, 12 + padded, true);
  out.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c], 8); // WEBPVP8L
  view.setUint32(16, data.length, true);
  out.set(data, 20);
  return out;
}
