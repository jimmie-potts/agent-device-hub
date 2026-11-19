import {isObject} from './compat.js';
import {MIN_MUSIC_CUE_MS, prepareMusicTimeline, type MusicTimeline} from './music-timeline.js';

type MeasuredSpan = {offsetMs: number; durationMs: number};

export const MAX_STYLE_LENGTH = 500;
const MAX_CUES = 32;
const GENERIC_DURATION_MS = 30_000;

/** Accept only semantic cues whose timing fits the chosen source. */
export function prepareAuthoredTimeline(input: unknown, spans: readonly MeasuredSpan[] | null): MusicTimeline {
  if (!isObject(input) || Object.keys(input).length !== 1 || !Array.isArray(input.cues)
      || input.cues.length < 1 || input.cues.length > MAX_CUES) throw new TypeError('Invalid generated cues.');

  const measuredEnds = new Map(spans?.map(span => [span.offsetMs, span.offsetMs + span.durationMs]));
  let durationMs = 0;
  const cues = input.cues.map((cue: unknown, index: number) => {
    if (!isObject(cue) || Object.keys(cue).length !== 5 || typeof cue.startMs !== 'number' || typeof cue.endMs !== 'number'
        || !Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs)
        || cue.startMs < durationMs || cue.endMs - cue.startMs < MIN_MUSIC_CUE_MS
        || typeof cue.effect !== 'string' || !Array.isArray(cue.palette) || typeof cue.intensity !== 'number') {
      throw new TypeError('Invalid generated cue.');
    }
    if (spans === null) {
      if ((index === 0 && cue.startMs !== 0) || cue.endMs > GENERIC_DURATION_MS) throw new TypeError('Invalid generic cue timing.');
    } else {
      let edge = cue.startMs;
      while (edge < cue.endMs) {
        const next = measuredEnds.get(edge);
        if (next === undefined || next <= edge || next > cue.endMs) throw new TypeError('Cue timing is outside the measured excerpt.');
        edge = next;
      }
    }
    durationMs = cue.endMs;
    return {id: `authored-${index + 1}`, offsetMs: cue.startMs, durationMs: cue.endMs - cue.startMs,
      recipe: {pattern: cue.effect, colors: cue.palette}, intensity: cue.intensity};
  });
  return prepareMusicTimeline({version: 1, durationMs, cues});
}
