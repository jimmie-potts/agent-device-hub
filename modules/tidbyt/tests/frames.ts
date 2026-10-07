// Deterministic 64x32 RGB frames for the renderer tests and the golden fixtures (Hub #930). Copied from
// controllers/tidbyt/tests/frames.mjs at main 627e3fe3. The status and now-playing frames are drawn here from the 2.0
// records that hold what the 1.x fixtures held, so the same golden bytes show the module draws what the runner drew.
import {sessionEntityId, type Identity, type PlaybackState, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {nowPlayingFrame, nowPlayingView} from '../src/nowplaying.js';
import {statusFrame, statusView} from '../src/status.js';

export const WIDTH = 64;
export const HEIGHT = 32;

function frame(pixel: (x: number, y: number) => readonly number[]): Uint8Array {
  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) rgb.set(pixel(x, y), (y * WIDTH + x) * 3);
  }
  return rgb;
}

// A small linear congruential generator keeps the noise case reproducible.
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) >>> 24;
}

/**
 * The 1.x `status-titles.json` snapshot's four Codex Desktop sessions as `session/2.0` records: a user label over a
 * title, a title, a project's display name, and none, so the last shows its neutral hashed ID.
 */
export function titleSessions(): SessionRecord[] {
  const extras: readonly Partial<SessionRecord>[] = [
    {label: {value: 'My choice', origin: 'user'}, title: {value: 'Hidden title', source: 'provider'}, project: 'Device hub'},
    {title: {value: 'Launch review', source: 'provider'}, project: 'Device hub'},
    {project: 'Device hub'},
    {},
  ];
  return extras.map((extra, index): SessionRecord => {
    const identity: Identity = {provider: 'codex', client: 'desktop', hostId: 'host', sourceId: 'source', sessionId: `preview-${index}`};
    const at = 1000 - index;
    return {
      id: sessionEntityId(identity), revision: 2, generation: 1, identity, parent: {status: 'unknown'}, turn: {status: 'known', id: 'turn'}, activity: 'active',
      attention: [], notices: [], read: 'unknown', unavailable: [], ordering: {status: 'unknown'}, observedAtMs: at, lastEvidenceAtMs: at, freshness: 'current',
      restartUncertain: false, children: {active: 0, uncertain: 0}, ...extra,
    };
  });
}

/** The 1.x golden now-playing snapshot as a `playback/2.0` record. */
export const goldenPlayback: PlaybackState = {
  id: 'golden', revision: 1, availability: 'available', observedAtMs: 0,
  playback: {status: 'known', player: 'playing', title: 'Don\'t Stop Me Now', artist: 'Queen & Beyoncé', controls: []},
};

export const goldenFrames: Readonly<Record<string, () => Uint8Array>> = {
  'status-titles': () => statusFrame(statusView({synced: true, sessions: titleSessions()})).rgb,
  black: () => frame(() => [0, 0, 0]),
  'two-tone': () => frame((x, y) => ((x + y) % 2 === 1 ? [255, 0, 12] : [0, 0, 200])),
  'red-gradient': () => frame((x, y) => [(x * 4 + y) & 255, 7, 7]),
  'status-bar': () => frame((x, y) => (y < 8 ? [0, 160, 255] : x < 32 ? [255, 200, 0] : [30, 30, 30])),
  noise: () => {
    const next = noise(16);
    return frame(() => [next(), next(), next()]);
  },
  // The drawn now-playing card, so a drawing change shows up as a golden diff.
  'now-playing': () => {
    const view = nowPlayingView({record: goldenPlayback, following: true, lostForMs: 0});
    if (!view.card) throw new Error('the golden playback record shows no card');
    return nowPlayingFrame(view).rgb;
  },
};
