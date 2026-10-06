import { parseGIF, decompressFrame } from 'gifuct-js';
import { MediaError, type MediaLimits, type MediaProfile } from './contracts.js';

interface Patch { x: number; y: number; width: number; height: number; delay: number | null; disposal: number; transparent: number | undefined }
export interface GifInfo { width: number; height: number; patches: Patch[] }
const invalid = () => { throw new MediaError('invalid-input'); };

/** Validate LZW code lengths/counts before the permissive dependency can pad damaged pixels. */
function validateLzw(data: Buffer, minimum: number, expected: number): void {
  if (minimum < 2 || minimum > 8) invalid();
  const clear = 1 << minimum, end = clear + 1;
  const lengths = new Uint32Array(4096);
  let size = minimum + 1, next = end + 1, previous = 0, bit = 0, count = 0, cleared = false;
  while (bit + size <= data.length * 8) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i;
    if (code === clear) { size = minimum + 1; next = end + 1; previous = 0; cleared = true; continue; }
    if (!cleared) invalid();
    if (code === end) { if (count !== expected) invalid(); return; }
    const length = code < clear ? 1 : code < next ? lengths[code]! : code === next && previous ? previous + 1 : 0;
    if (!length || count + length > expected) invalid();
    count += length;
    if (previous && next < 4096) {
      lengths[next++] = previous + 1;
      if (next === (1 << size) && size < 12) size++;
    }
    previous = length;
  }
  invalid();
}

export function inspectGif(bytes: Buffer, limits: MediaLimits, profile: MediaProfile): GifInfo {
  let pos = 6;
  const take = (count: number) => { if (pos + count > bytes.length) invalid(); const b = bytes.subarray(pos, pos + count); pos += count; return b; };
  const byte = () => take(1)[0]!;
  const word = () => take(2).readUInt16LE();
  const width = word(), height = word(), packed = byte(); byte(); byte();
  if (!width || !height) invalid();
  if (width * height > limits.maxSourcePixels) throw new MediaError('pixel-limit');
  if (packed & 128) take(3 * (1 << ((packed & 7) + 1)));
  const blocks = () => { const parts: Buffer[] = []; let size; while ((size = byte())) parts.push(take(size)); return Buffer.concat(parts); };
  const patches: Patch[] = [];
  let gce: { delay: number; disposal: number; transparent: number | undefined } | undefined;
  while (pos < bytes.length) {
    const tag = byte();
    if (tag === 0x3b) { if (!patches.length || pos !== bytes.length || gce) invalid(); return { width, height, patches }; }
    if (tag === 0x21) {
      const label = byte();
      if (label === 0xf9) {
        if (gce || byte() !== 4) invalid();
        const flags = byte(), delay = word(), index = byte();
        if (byte() !== 0 || (flags & 0xe0)) invalid();
        const disposal = (flags >> 2) & 7;
        if (disposal > 3 || (flags & 2)) throw new MediaError('unsupported');
        gce = { delay: delay * 10, disposal, transparent: flags & 1 ? index : undefined };
      } else if (label === 0xff || label === 0xfe) blocks();
      else throw new MediaError('unsupported'); // Plain-text rendering would silently omit content.
      continue;
    }
    if (tag !== 0x2c) invalid();
    const x = word(), y = word(), w = word(), h = word(), flags = byte();
    if (!w || !h || x + w > width || y + h > height || (flags & 0x18)) invalid();
    if (flags & 128) take(3 * (1 << ((flags & 7) + 1)));
    patches.push({ x, y, width: w, height: h, delay: gce?.delay ?? null, disposal: gce?.disposal ?? 0, transparent: gce?.transparent });
    if (patches.length > profile.maxFrames) throw new MediaError('profile-limit');
    if (width * height * patches.length > limits.maxSourcePixels) throw new MediaError('pixel-limit');
    const minimum = byte(); validateLzw(blocks(), minimum, w * h); gce = undefined;
  }
  return invalid();
}

export function* compositeGif(bytes: Buffer, info: GifInfo): Generator<Buffer> {
  const parsed = parseGIF(Uint8Array.from(bytes).buffer);
  const frames = parsed.frames.filter(f => 'image' in f);
  if (frames.length !== info.patches.length) invalid();
  let canvas = Buffer.alloc(info.width * info.height * 4);
  const bg = parsed.gct?.[parsed.lsd.backgroundColorIndex];
  const background = (transparent: boolean) => transparent || !bg ? [0,0,0,0] : [...bg,255];
  const fill = (p: Pick<Patch, 'x'|'y'|'width'|'height'>, color: number[]) => {
    for (let y = p.y; y < p.y + p.height; y++) for (let x = p.x; x < p.x + p.width; x++) canvas.set(color, (y * info.width + x) * 4);
  };
  fill({ x:0, y:0, width:info.width, height:info.height }, background(info.patches[0]!.transparent !== undefined));
  for (let index = 0; index < frames.length; index++) {
    const p = info.patches[index]!, frame = frames[index]!;
    const decoded = decompressFrame(frame, parsed.gct, false);
    if (!decoded.colorTable?.length || decoded.pixels.some(n => n >= decoded.colorTable.length)) invalid();
    const previous = p.disposal === 3 ? Buffer.from(canvas) : undefined;
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      const colorIndex = decoded.pixels[y * p.width + x]!, to = ((y + p.y) * info.width + x + p.x) * 4;
      // Control extensions can be separated from images by comments in the dependency parser.
      // The strict inspector preserves their scope, so it owns transparency and disposal.
      if (colorIndex !== p.transparent) {
        const color = decoded.colorTable[colorIndex]!;
        canvas[to]=color[0]; canvas[to+1]=color[1]; canvas[to+2]=color[2]; canvas[to+3]=255;
      }
    }
    yield Buffer.from(canvas);
    if (p.disposal === 2) fill(p, background(p.transparent !== undefined));
    else if (previous) canvas = previous;
  }
}
