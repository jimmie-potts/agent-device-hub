// How the simulated Tidbyt shows a tile to a person (Hub #930): a frame as 32 rows of 64 characters, one per pixel, and
// a decoder for the lossless WebP subset the module's encoder writes, so the simulated cloud can show what it was sent.
// The decoder is a convenience for the simulated device, not a check of the encoder: the golden test decodes with an
// independent libwebp build (`sharp`). It reads only images without transforms, a color cache, meta prefix codes or
// backward references, and answers undefined for anything else.
import {FRAME_HEIGHT, FRAME_WIDTH} from './render.js';

/**
 * One character per pixel: `.` for black, otherwise a letter for the color's family (`A` amber or orange, `R` red, `G`
 * green, `B` blue, `W` white or grey), upper case when bright and lower case when dimmed.
 */
export function picture(rgb: Uint8Array, width = FRAME_WIDTH, height = FRAME_HEIGHT): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let row = '';
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 3;
      row += pixel(rgb[at] ?? 0, rgb[at + 1] ?? 0, rgb[at + 2] ?? 0);
    }
    rows.push(row);
  }
  return rows;
}

function pixel(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === 0) return '.';
  let letter: string;
  if (max - min < 30) letter = 'W';
  else if (r === max) letter = g > b ? 'A' : 'R';
  else if (g === max) letter = 'G';
  else letter = 'B';
  return max >= 128 ? letter : letter.toLowerCase();
}

class BitReader {
  readonly #bytes: Uint8Array;
  #position = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  read(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = this.#bytes[this.#position >>> 3];
      if (byte === undefined) throw new RangeError('the image ends early');
      value |= ((byte >>> (this.#position & 7)) & 1) << i;
      this.#position += 1;
    }
    return value;
  }
}

// The code-length code's lengths come in this fixed order (RFC 9649 section 3.7.2.1.2).
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

/** A canonical prefix code: each code as `<length>:<code>`, with its symbol. One symbol takes no bits. */
type PrefixCode = {single: number} | {codes: ReadonlyMap<string, number>};

function canonical(lengths: readonly number[]): PrefixCode {
  const used = lengths.flatMap((length, symbol) => length > 0 ? [symbol] : []);
  const [only] = used;
  if (only !== undefined && used.length === 1) return {single: only};
  const codes = new Map<string, number>();
  let code = 0;
  for (let length = 1; length <= 15; length += 1) {
    for (const [symbol, given] of lengths.entries()) {
      if (given !== length) continue;
      codes.set(`${length}:${code}`, symbol);
      code += 1;
    }
    code <<= 1;
  }
  return {codes};
}

function decodeSymbol(reader: BitReader, code: PrefixCode): number {
  if ('single' in code) return code.single;
  let value = 0;
  for (let length = 1; length <= 15; length += 1) {
    value = (value << 1) | reader.read(1);
    const symbol = code.codes.get(`${length}:${value}`);
    if (symbol !== undefined) return symbol;
  }
  throw new RangeError('the image holds an invalid code');
}

function readCode(reader: BitReader, alphabetSize: number): PrefixCode {
  const lengths = new Array<number>(alphabetSize).fill(0);
  if (reader.read(1) === 1) {
    const count = reader.read(1) + 1;
    const first = reader.read(reader.read(1) === 1 ? 8 : 1);
    lengths[first] = 1;
    if (count === 2) lengths[reader.read(8)] = 1;
    return canonical(lengths);
  }
  const lengthLengths = new Array<number>(19).fill(0);
  const count = reader.read(4) + 4;
  for (const symbol of CODE_LENGTH_ORDER.slice(0, count)) lengthLengths[symbol] = reader.read(3);
  if (reader.read(1) === 1) throw new RangeError('the image limits its code lengths');
  const lengthCode = canonical(lengthLengths);
  let previous = 8;
  for (let symbol = 0; symbol < alphabetSize;) {
    const read = decodeSymbol(reader, lengthCode);
    if (read < 16) {
      lengths[symbol] = read;
      if (read !== 0) previous = read;
      symbol += 1;
      continue;
    }
    const [repeat, value] = read === 16 ? [3 + reader.read(2), previous] : read === 17 ? [3 + reader.read(3), 0] : [11 + reader.read(7), 0];
    for (let i = 0; i < repeat && symbol < alphabetSize; i += 1, symbol += 1) lengths[symbol] = value;
  }
  return canonical(lengths);
}

const ascii = (bytes: Uint8Array, from: number, length: number): string => Buffer.from(bytes.subarray(from, from + length)).toString('latin1');

/** The RGB pixels of a lossless WebP in the encoder's subset, with its size, or undefined for any other image. */
export function decodeLossless(webp: Uint8Array): {width: number; height: number; rgb: Uint8Array} | undefined {
  try {
    if (ascii(webp, 0, 4) !== 'RIFF' || ascii(webp, 8, 8) !== 'WEBPVP8L') return undefined;
    const reader = new BitReader(webp.subarray(20));
    if (reader.read(8) !== 0x2f) return undefined;
    const width = reader.read(14) + 1, height = reader.read(14) + 1;
    reader.read(1);
    if (reader.read(3) !== 0 || reader.read(1) !== 0 || reader.read(1) !== 0 || reader.read(1) !== 0) return undefined;
    const [green, red, blue, alpha] = [readCode(reader, 280), readCode(reader, 256), readCode(reader, 256), readCode(reader, 256)];
    readCode(reader, 40);
    const rgb = new Uint8Array(width * height * 3);
    for (let at = 0; at < rgb.length; at += 3) {
      const g = decodeSymbol(reader, green);
      if (g >= 256) return undefined;
      rgb[at] = decodeSymbol(reader, red);
      rgb[at + 1] = g;
      rgb[at + 2] = decodeSymbol(reader, blue);
      decodeSymbol(reader, alpha);
    }
    return {width, height, rgb};
  } catch {
    return undefined;
  }
}
