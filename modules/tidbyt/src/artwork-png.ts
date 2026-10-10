import sharp from 'sharp';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {PlaybackArtwork} from '@jimmie-potts/event-contracts/v2/families';

sharp.cache(false);
sharp.concurrency(1);
export type ArtworkRgb = {status: 'ready'; rgb: Uint8Array} | {status: 'fallback'; code?: ErrorCode};
const fail = (code: ErrorCode): ArtworkRgb => ({status: 'fallback', code});
const MAX_BYTES = 65_536;
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Reject framing and animation before the first bounded decoder call. */
function framing(bytes: Buffer): ErrorCode | undefined {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) return 'invalid-request';
  let offset = 8, header = false, data = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (length > bytes.length - offset - 12) return 'invalid-request';
    if (!header && (type !== 'IHDR' || length !== 13)) return 'invalid-request';
    if (type === 'IHDR') {
      if (header) return 'invalid-request';
      header = true;
    }
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') return 'unsupported-capability';
    if (type === 'IDAT') data = true;
    offset += length + 12;
    if (type === 'IEND') return length === 0 && data && offset === bytes.length ? undefined : 'invalid-request';
  }
  return 'invalid-request';
}

/** Only fixed registry codes escape refusal; neither bytes nor native exceptions do. */
export async function decodeArtwork(artwork: PlaybackArtwork | undefined): Promise<ArtworkRgb> {
  if (artwork === undefined || artwork.status !== 'ready') return {status: 'fallback'};
  if (artwork.mediaType !== 'image/png' || !Number.isInteger(artwork.width) || !Number.isInteger(artwork.height)
    || artwork.width < 1 || artwork.width > 128 || artwork.height < 1 || artwork.height > 128) return fail('invalid-request');
  if (typeof artwork.base64 !== 'string' || artwork.base64.length === 0) return fail('invalid-request');
  if (artwork.base64.length > MAX_BASE64) return fail('too-large');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(artwork.base64)) return fail('invalid-request');
  const bytes = Buffer.from(artwork.base64, 'base64');
  if (bytes.length > MAX_BYTES) return fail('too-large');
  if (bytes.toString('base64') !== artwork.base64) return fail('invalid-request');
  const refused = framing(bytes);
  if (refused !== undefined) return fail(refused);
  try {
    const image = sharp(bytes, {limitInputPixels: 16_384, failOn: 'warning'});
    const metadata = await image.metadata();
    if (metadata.format !== 'png' || (metadata.pages !== undefined && metadata.pages !== 1)) return fail('unsupported-capability');
    if (metadata.width !== artwork.width || metadata.height !== artwork.height) return fail('invalid-request');
    const {data, info} = await image.resize(24, 24, {fit: 'contain', position: 'centre', background: {r: 0, g: 0, b: 0, alpha: 1}})
      .flatten({background: {r: 0, g: 0, b: 0}}).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject: true});
    if (info.width !== 24 || info.height !== 24 || info.channels !== 3 || data.length !== 24 * 24 * 3) return fail('invalid-request');
    return {status: 'ready', rgb: new Uint8Array(data)};
  } catch {
    return fail('invalid-request');
  }
}
