import sharp from 'sharp';
import {MAX_ART_BYTES} from '@jimmie-potts/event-contracts/v2/art';
import {rainNoticeLines, type RainNotice} from '@jimmie-potts/event-contracts/v2/art-notice';
import {encodeArtAnimation, type PreparedArt} from './art-media.js';
import {ART_PROFILE} from './art-profile.js';
import {text, textWidth} from './draw.js';
import {encodeLosslessRgb} from './webp.js';

/** The input is a private retained native copy; decoding and output remain within the qualified art envelope. */
export async function artNotice(webp: Uint8Array, delays: readonly number[], notice: RainNotice): Promise<PreparedArt> {
  const count = Math.max(1, delays.length);
  if (webp.length > MAX_ART_BYTES || count > ART_PROFILE.maxFrames || delays.some(delay => !Number.isInteger(delay)
    || delay < ART_PROFILE.minDelayMs || delay > ART_PROFILE.maxDelayMs)) return {ok: false, code: 'invalid-request'};
  try {
    const image = sharp(webp, {animated: true, limitInputPixels: 64 * 32 * ART_PROFILE.maxFrames, failOn: 'warning'});
    const metadata = await image.metadata();
    if (metadata.format !== 'webp' || metadata.width !== 64 || (metadata.pageHeight ?? metadata.height) !== 32
      || (metadata.pages ?? 1) !== count || (delays.length > 0 && JSON.stringify(metadata.delay) !== JSON.stringify(delays))) return {ok: false, code: 'invalid-request'};
    const {data, info} = await image.removeAlpha().raw().toBuffer({resolveWithObject: true});
    if (info.channels !== 3 || data.length !== count * 6144) return {ok: false, code: 'invalid-request'};
    const output = Buffer.alloc(count * 6144), lines = rainNoticeLines(notice);
    for (let frame = 0; frame < count; frame += 1) {
      const rgb = output.subarray(frame * 6144, (frame + 1) * 6144);
      for (let y = 0; y < 18; y += 1) for (let x = 0; x < 36; x += 1) {
        const at = frame * 6144 + (Math.floor(y * 32 / 18) * 64 + Math.floor(x * 64 / 36)) * 3;
        rgb.set(data.subarray(at, at + 3), (y * 64 + x + 14) * 3);
      }
      lines.forEach((line, index) => { text(rgb, Math.floor((64 - textWidth(line)) / 2), 20 + index * 6, line, [255, 255, 255]); });
    }
    const encoded = delays.length === 0 ? encodeLosslessRgb(64, 32, output) : encodeArtAnimation(output, delays);
    return encoded.length <= MAX_ART_BYTES ? {ok: true, webp: encoded, delays: [...delays]} : {ok: false, code: 'too-large'};
  } catch { return {ok: false, code: 'invalid-request'}; }
}
