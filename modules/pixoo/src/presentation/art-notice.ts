import {rainNoticeLines, type RainNotice} from '@jimmie-potts/event-contracts/v2/art-notice';
import {drawText} from './pixel-font.js';

/** A separate forecast band accompanies a fitted copy; the staged composition stays untouched. */
export function artNoticeFrames(frames: readonly Uint8Array[], notice: RainNotice): Uint8Array[] {
  if (frames.length < 1 || frames.length > 20 || frames.some(frame => frame.length !== 64 * 64 * 3)) throw new Error('invalid notice art');
  const lines = rainNoticeLines(notice);
  return frames.map(source => {
    const rgb = new Uint8Array(64 * 64 * 3);
    for (let y = 0; y < 48; y += 1) for (let x = 0; x < 48; x += 1) {
      const at = (Math.floor(y * 64 / 48) * 64 + Math.floor(x * 64 / 48)) * 3;
      rgb.set(source.subarray(at, at + 3), (y * 64 + x + 8) * 3);
    }
    lines.forEach((line, index) => { drawText(rgb, line, Math.floor((64 - (line.length * 4 - 1)) / 2), 50 + index * 7, [255, 255, 255]); });
    return rgb;
  });
}
