/**
 * Minimal lossless WebP (VP8L) encoder for opaque RGB images.
 *
 * It writes no transforms, color cache or backward references. Each channel uses
 * a one- or two-symbol "simple" prefix code when it holds at most two values,
 * otherwise a complete fixed 8-bit code. See the WebP lossless bitstream
 * specification (RFC 9649, section 3).
 */

class BitWriter {
  private bytes: number[] = [];
  private accumulator = 0;
  private used = 0;
  write(value: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.accumulator |= ((value >>> i) & 1) << this.used;
      if (++this.used === 8) { this.bytes.push(this.accumulator); this.accumulator = 0; this.used = 0; }
    }
  }
  finish(): Uint8Array {
    if (this.used) this.bytes.push(this.accumulator);
    return Uint8Array.from(this.bytes);
  }
}

const REVERSED = Uint8Array.from({ length: 256 }, (_, v) => {
  let r = 0;
  for (let i = 0; i < 8; i++) r |= ((v >>> i) & 1) << (7 - i);
  return r;
});

// The code-length code writes lengths in this fixed order (RFC 9649 section 3.7.2.1.2).
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8];

type ChannelCode = { kind: 'one' } | { kind: 'two'; high: number } | { kind: 'fixed' };

function writeSimple(w: BitWriter, symbols: number[]): void {
  w.write(1, 1); // simple code
  w.write(symbols.length - 1, 1);
  const wide = symbols.length === 2 || symbols[0] > 1;
  w.write(wide ? 1 : 0, 1);
  w.write(symbols[0], wide ? 8 : 1);
  if (symbols.length === 2) w.write(symbols[1], 8);
}

/** Symbols 0-255 get length 8; any remaining alphabet entries get length 0. */
function writeFixed(w: BitWriter, alphabetSize: number): void {
  w.write(0, 1); // normal code
  w.write(CODE_LENGTH_ORDER.length - 4, 4);
  // Code-length symbols 0 and 8 each get a one-bit code: 0 -> "0", 8 -> "1".
  for (const symbol of CODE_LENGTH_ORDER) w.write(symbol === 0 || symbol === 8 ? 1 : 0, 3);
  w.write(0, 1); // no max_symbol: read lengths for the whole alphabet
  for (let symbol = 0; symbol < alphabetSize; symbol++) w.write(symbol < 256 ? 1 : 0, 1);
}

function channelCode(w: BitWriter, values: Set<number>, alphabetSize: number): ChannelCode {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length <= 2) {
    writeSimple(w, sorted);
    return sorted.length === 1 ? { kind: 'one' } : { kind: 'two', high: sorted[1] };
  }
  writeFixed(w, alphabetSize);
  return { kind: 'fixed' };
}

function writeSymbol(w: BitWriter, code: ChannelCode, value: number): void {
  if (code.kind === 'two') w.write(value === code.high ? 1 : 0, 1);
  else if (code.kind === 'fixed') w.write(REVERSED[value], 8);
}

/** Encode `width`×`height` packed RGB bytes. Callers validate dimensions and length. */
export function encodeLosslessRgb(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.write(0x2f, 8); // VP8L signature
  w.write(width - 1, 14);
  w.write(height - 1, 14);
  w.write(0, 1); // alpha_is_used: every pixel is opaque
  w.write(0, 3); // version
  w.write(0, 1); // no transforms
  w.write(0, 1); // no color cache
  w.write(0, 1); // no meta prefix codes
  const channels = [new Set<number>(), new Set<number>(), new Set<number>()];
  for (let i = 0; i < rgb.length; i += 3) {
    channels[0].add(rgb[i]); channels[1].add(rgb[i + 1]); channels[2].add(rgb[i + 2]);
  }
  // Prefix code order: green (256 literals + 24 length codes), red, blue, alpha, distance.
  const green = channelCode(w, channels[1], 280);
  const red = channelCode(w, channels[0], 256);
  const blue = channelCode(w, channels[2], 256);
  channelCode(w, new Set([255]), 256);
  channelCode(w, new Set([0]), 40);
  for (let i = 0; i < rgb.length; i += 3) {
    writeSymbol(w, green, rgb[i + 1]);
    writeSymbol(w, red, rgb[i]);
    writeSymbol(w, blue, rgb[i + 2]);
  }
  const data = w.finish();
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
