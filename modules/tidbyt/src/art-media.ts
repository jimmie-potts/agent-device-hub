import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {MAX_ART_BYTES, type ArtStageContent} from '@jimmie-potts/event-contracts/v2/art';
import {encodeLosslessRgb} from './webp.js';
import {ART_PROFILE} from './art-profile.js';

sharp.cache(false);
sharp.concurrency(1);
export type PreparedArt = {ok: true; webp: Uint8Array; delays: number[]} | {ok: false; code: ErrorCode};
const fail = (code: ErrorCode): PreparedArt => ({ok: false, code});
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Check complete framing before libvips; it otherwise accepts some truncated or trailing data. */
function pngFraming(bytes: Buffer): ErrorCode | undefined {
  if (!bytes.subarray(0, 8).equals(PNG)) return 'invalid-request';
  let at = 8, header = false, data = false;
  while (at + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(at), kind = bytes.toString('ascii', at + 4, at + 8);
    if (size > bytes.length - at - 12 || (!header && (kind !== 'IHDR' || size !== 13))) return 'invalid-request';
    if (kind === 'IHDR') {if (header) return 'invalid-request'; header = true;}
    if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') return 'unsupported-capability';
    if (kind === 'IDAT') data = true;
    at += size + 12;
    if (kind === 'IEND') return size === 0 && data && at === bytes.length ? undefined : 'invalid-request';
  }
  return 'invalid-request';
}

/** Full GIF sub-block framing, frame bounds and unrounded declared delays. Pixels remain the decoder's responsibility. */
function gifDelays(bytes: Buffer): number[] | undefined {
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) || bytes.readUInt16LE(6) !== 64 || bytes.readUInt16LE(8) !== 32) return;
  const packed = bytes[10] ?? 0;
  let at = 13 + ((packed & 128) === 0 ? 0 : 3 * 2 ** ((packed & 7) + 1));
  let delay: number | undefined;
  const delays: number[] = [];
  const blocks = (): boolean => {
    while (at < bytes.length) {
      const size = bytes[at++] ?? 0;
      if (size === 0) return true;
      if (size > bytes.length - at) return false;
      at += size;
    }
    return false;
  };
  while (at < bytes.length) {
    const kind = bytes[at++];
    if (kind === 0x3b) return at === bytes.length && delays.length > 0 ? delays : undefined;
    if (kind === 0x21) {
      const extension = bytes[at++];
      if (extension === 0xf9) {
        if (at + 6 > bytes.length || bytes[at] !== 4 || bytes[at + 5] !== 0) return;
        const flags = bytes[at + 1] ?? 0;
        if ((flags & 0xe2) !== 0 || ((flags >> 2) & 7) > 3) return;
        delay = bytes.readUInt16LE(at + 2) * 10;
        at += 6;
      } else {
        // Plain text introduces another graphic whose timing cannot be represented by this profile.
        if (extension !== 0xff && extension !== 0xfe) return;
        if (!blocks()) return;
      }
    } else if (kind === 0x2c) {
      if (at + 9 > bytes.length || delay === undefined || delays.length === ART_PROFILE.maxFrames) return;
      const x = bytes.readUInt16LE(at), y = bytes.readUInt16LE(at + 2), width = bytes.readUInt16LE(at + 4), height = bytes.readUInt16LE(at + 6);
      if (width === 0 || height === 0 || x + width > 64 || y + height > 32) return;
      const flags = bytes[at + 8] ?? 0;
      if ((flags & 0x18) !== 0) return;
      at += 9 + ((flags & 128) === 0 ? 0 : 3 * 2 ** ((flags & 7) + 1));
      const codeSize = bytes[at++];
      if (codeSize === undefined || codeSize < 2 || codeSize > 8 || !blocks()) return;
      delays.push(delay);
      delay = undefined;
    } else return;
  }
  return;
}

function chunk(kind: string, bytes: Uint8Array): Buffer {
  const out = Buffer.alloc(8 + bytes.length + (bytes.length & 1));
  out.write(kind, 0, 4, 'ascii');
  out.writeUInt32LE(bytes.length, 4);
  out.set(bytes, 8);
  return out;
}

/** Full opaque VP8L frames: no blend/disposal, and no coalescing of identical consecutive frames. */
export function encodeArtAnimation(rgb: Buffer, delays: readonly number[]): Uint8Array {
  const extended = Buffer.alloc(10);
  extended[0] = 2;
  extended.writeUIntLE(63, 4, 3);
  extended.writeUIntLE(31, 7, 3);
  const parts = [chunk('VP8X', extended), chunk('ANIM', Buffer.alloc(6))];
  for (const [index, delay] of delays.entries()) {
    const header = Buffer.alloc(16);
    header.writeUIntLE(63, 6, 3);
    header.writeUIntLE(31, 9, 3);
    header.writeUIntLE(delay, 12, 3);
    header[15] = 2;
    const frame = encodeLosslessRgb(64, 32, rgb.subarray(index * 6144, (index + 1) * 6144));
    parts.push(chunk('ANMF', Buffer.concat([header, frame.subarray(12)])));
  }
  const body = Buffer.concat(parts), header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

/** Bounded private worker input. No decoder error or input bytes escape this boundary. */
export async function prepareArt(stage: ArtStageContent): Promise<PreparedArt> {
  if (stage.width !== 64 || stage.height !== 32 || !Number.isInteger(stage.frames) || stage.frames < 1 || stage.frames > ART_PROFILE.maxFrames
    || !Number.isInteger(stage.durationMs) || stage.durationMs < 0 || stage.durationMs > ART_PROFILE.maxDurationMs) return fail('unsupported-capability');
  if (typeof stage.base64 !== 'string' || stage.base64.length > Math.ceil(MAX_ART_BYTES / 3) * 4) return fail('too-large');
  const bytes = Buffer.from(stage.base64, 'base64');
  if (bytes.length > MAX_ART_BYTES) return fail('too-large');
  if (bytes.length === 0 || bytes.toString('base64') !== stage.base64 || createHash('sha256').update(bytes).digest('hex') !== stage.sha256) return fail('invalid-request');
  let delays: number[];
  if (stage.format === 'png') {
    const refused = pngFraming(bytes);
    if (refused !== undefined) return fail(refused);
    if (stage.frames !== 1 || stage.durationMs !== 0) return fail('unsupported-capability');
    delays = [];
  } else if (stage.format === 'gif') {
    const parsed = gifDelays(bytes);
    if (parsed === undefined) return fail('invalid-request');
    if (parsed.some(delay => delay < ART_PROFILE.minDelayMs || delay > ART_PROFILE.maxDelayMs)) return fail('unsupported-capability');
    if (parsed.length !== stage.frames || parsed.reduce((sum, delay) => sum + delay, 0) !== stage.durationMs) return fail('invalid-request');
    delays = parsed;
  } else return fail('unsupported-capability');
  try {
    const image = sharp(bytes, {animated: true, limitInputPixels: 64 * 32 * ART_PROFILE.maxFrames, failOn: 'warning'});
    const metadata = await image.metadata();
    if (metadata.format !== stage.format || metadata.width !== 64 || (metadata.pageHeight ?? metadata.height) !== 32 || (metadata.pages ?? 1) !== stage.frames
      || (stage.format === 'gif' && JSON.stringify(metadata.delay) !== JSON.stringify(delays))) return fail('invalid-request');
    const {data, info} = await image.flatten({background: {r: 0, g: 0, b: 0}}).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject: true});
    if (info.width !== 64 || info.height !== stage.frames * 32 || info.channels !== 3 || data.length !== 6144 * stage.frames) return fail('invalid-request');
    const webp = stage.format === 'png' ? encodeLosslessRgb(64, 32, data) : encodeArtAnimation(data, delays);
    return webp.length <= MAX_ART_BYTES ? {ok: true, webp, delays} : fail('too-large');
  } catch {
    return fail('invalid-request');
  }
}
