// Private media-worker exchange. No installation paths or public event contracts cross back from the decoder.
import {MediaError, type MediaLimits, type MediaProfile, type MediaSource, type TimingWarning} from './contracts.js';

export interface RenderHeader {source: MediaSource; warnings: TimingWarning[]}
export interface RenderFrame {index: number; rgb: Buffer; preview: Buffer; delayMs: number | null}
export function invalidTransfer(): MediaError { return new MediaError('decode-failed'); }
function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return value !== null && typeof value === 'object' && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function readHeader(value: unknown, profile: MediaProfile, limits: MediaLimits): RenderHeader {
  try {
    const header = value as RenderHeader;
    if (!exactKeys(header, ['source', 'warnings']) || !exactKeys(header.source, ['format', 'width', 'height', 'frameCount', 'delaysMs', 'durationMs'])) throw invalidTransfer();
    const {source, warnings} = header;
    if (!['png', 'jpeg', 'gif'].includes(source.format) || !Number.isSafeInteger(source.width) || source.width < 1 ||
      !Number.isSafeInteger(source.height) || source.height < 1 || source.width * source.height > limits.maxSourcePixels ||
      (source.format === 'gif' && (source.width * source.height > limits.maxGifCanvasPixels || source.width * source.height * source.frameCount > limits.maxSourcePixels)) ||
      !Number.isSafeInteger(source.frameCount) || source.frameCount < 1 || source.frameCount > profile.maxFrames ||
      !Array.isArray(source.delaysMs) || source.delaysMs.length !== source.frameCount || !Array.isArray(warnings)) throw invalidTransfer();
    const expected: TimingWarning[] = [];
    let total: number | null = 0;
    let first: number | null = null;
    for (const [index, delay] of source.delaysMs.entries()) {
      if (delay !== null && (!Number.isSafeInteger(delay) || delay < 0 || delay > 655350)) throw invalidTransfer();
      if (source.format === 'gif') {
        const effective = delay === null || delay === 0 ? 100 : delay;
        if (effective < profile.minDelayMs || effective > profile.maxDelayMs || (index > 0 && profile.uniformTiming && effective !== first)) throw invalidTransfer();
        first ??= effective;
        if (delay === null || delay === 0) expected.push({frame: index, code: delay === null ? 'missing-delay' : 'zero-delay', effectiveDelayMs: 100});
      } else if (source.frameCount !== 1 || delay !== null) throw invalidTransfer();
      total = total === null || delay === null ? null : total + delay;
    }
    if (source.durationMs !== total || JSON.stringify(warnings) !== JSON.stringify(expected)) throw invalidTransfer();
    return {source, warnings};
  } catch { throw invalidTransfer(); }
}
export function readFrame(value: unknown, header: RenderHeader, index: number): RenderFrame {
  const frame = value as RenderFrame | null;
  const sourceDelay = header.source.delaysMs[index];
  const delay = header.source.format === 'gif' && (sourceDelay === null || sourceDelay === 0) ? 100 : sourceDelay;
  if (!exactKeys(frame, ['index', 'rgb', 'preview', 'delayMs']) || frame === null || frame === undefined || frame.index !== index || index >= header.source.frameCount ||
    !Buffer.isBuffer(frame.rgb) || frame.rgb.length !== 12288 || !Buffer.isBuffer(frame.preview) || frame.preview.length === 0 ||
    frame.preview.length > 65536 || frame.delayMs !== delay) throw invalidTransfer();
  return frame;
}
