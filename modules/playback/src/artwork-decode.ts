/** Runs only in an isolated decoder worker in production. */
import sharp from 'sharp';
import {ARTWORK_INPUT_BYTES, artworkFailure, type ArtworkResult} from './artwork-fetch.js';
export const ARTWORK_PIXELS = 4_000_000;
export const ARTWORK_EDGE = 128;
export const ARTWORK_OUTPUT_BYTES = 65_536;
export {ARTWORK_DECODE_MS} from './artwork-fetch.js';
export type ArtworkThumbnail = {mediaType: 'image/png'; width: number; height: number; base64: string};
export type ArtworkDecode = (bytes: Uint8Array, signal: AbortSignal) => Promise<ArtworkResult<ArtworkThumbnail>>;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Reject PNG animation and invalid chunk framing before decoding. */
function stillPng(bytes: Buffer): boolean {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + size + 12 > bytes.length || kind === 'acTL') return false;
    offset += size + 12;
    if (kind === 'IEND') return size === 0 && offset === bytes.length;
  }
  return false;
}

export async function decodeArtwork(input: Uint8Array): Promise<ArtworkResult<ArtworkThumbnail>> {
  if (input.byteLength === 0) return artworkFailure('invalid-response');
  if (input.byteLength > ARTWORK_INPUT_BYTES) return artworkFailure('capacity');
  const bytes = Buffer.from(input);
  const png = bytes.subarray(0, 8).equals(PNG);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((!png && !jpeg) || (png && !stillPng(bytes))) return artworkFailure('unsupported');
  try {
    // Header-only inspection classifies capacity without exposing libvips exception text.
    const header = await sharp(bytes, {limitInputPixels: false, failOn: 'warning'}).metadata();
    if (header.width * header.height > ARTWORK_PIXELS) return artworkFailure('capacity');
    if ((header.format !== 'jpeg' && header.format !== 'png') || (header.pages !== undefined && header.pages !== 1)) return artworkFailure('unsupported');
    const {data, info} = await sharp(bytes, {limitInputPixels: ARTWORK_PIXELS, failOn: 'warning'})
      .autoOrient().resize(ARTWORK_EDGE, ARTWORK_EDGE, {fit: 'inside', withoutEnlargement: true})
      .toColourspace('srgb').png().toBuffer({resolveWithObject: true});
    if (info.width < 1 || info.height < 1 || info.width > ARTWORK_EDGE || info.height > ARTWORK_EDGE || data.byteLength > ARTWORK_OUTPUT_BYTES) return artworkFailure('capacity');
    return {ok: true, value: {mediaType: 'image/png', width: info.width, height: info.height, base64: data.toString('base64')}};
  } catch {
    return artworkFailure('invalid-response');
  }
}
