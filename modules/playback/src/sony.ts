// The Sony HT-A9 Audio Control API source (Hub #175), qualified in docs/iphone-apple-music-qualification.md. Copied from
// the old Hub's `apps/hub/src/sony.ts` at main 483d3a93 for Hub #929 and converted to the strict profile. The HTTP call
// moved to `transport.ts` and its polling to the module; the endpoint and raw replies stay in this file and the
// transport, and never reach a message.
import {exact, object, privateHttpEndpoint, text} from './common.js';
import type {PlaybackAction, PlaybackObservation, PlaybackStatus} from './playback.js';
import type {Deadline, SpeakerSource} from './sources.js';
import type {SpeakerTransport} from './transport.js';

export type SonyConfiguration = {kind: 'sony'; endpoint: string};

const AIRPLAY = 'extInput:airPlay';
const STATES: Readonly<Record<string, PlaybackStatus>> = {PLAYING: 'playing', PAUSED: 'paused', STOPPED: 'stopped'};
/** The JSON-RPC method and version of each action the HT-A9 takes. It has no play: it cannot resume a paused AirPlay session (#242). */
export const SONY_METHODS: Readonly<Partial<Record<PlaybackAction, readonly [string, string]>>> = {
  pause: ['pausePlayingContent', '1.1'], next: ['setPlayNextContent', '1.0'], previous: ['setPlayPreviousContent', '1.0'],
};
/** The read every poll makes. */
export const SONY_READ = ['getPlayingContentInfo', '1.2'] as const;

/** `{kind: "sony", endpoint: "http://<private IPv4>:<port>/sony"}`, or undefined; the Audio Control API listens on port 10000. */
export function sonyConfiguration(value: unknown): SonyConfiguration | undefined {
  if (!object(value) || !exact(value, ['kind', 'endpoint']) || value.kind !== 'sony') return undefined;
  const endpoint = privateHttpEndpoint(value.endpoint, '/sony');
  return endpoint === undefined ? undefined : {kind: 'sony', endpoint};
}

/** Normalizes a getPlayingContentInfo result: a list of per-output entries, possibly wrapped in one more list. */
export function sonyObservation(result: readonly unknown[]): PlaybackObservation {
  const entry = result.flat().find((item): item is Record<string, unknown> => object(item) && item.source === AIRPLAY);
  if (entry === undefined) return {status: 'inactive', controls: []};
  const state = object(entry.stateInfo) ? entry.stateInfo.state : undefined;
  const status = typeof state === 'string' && Object.hasOwn(STATES, state) ? STATES[state] ?? 'unknown' : 'unknown';
  const title = text(entry.title), artist = text(entry.artist), album = text(entry.albumName);
  // Pause, next and previous were qualified while playing (#158). The owner's 2026-09-25 live check (#37) qualified next and previous
  // while paused: the phone changes track without resuming, but the receiver keeps reporting the old title. Play/resume is not qualified.
  const controls: PlaybackAction[] = status === 'playing' ? ['pause', 'next', 'previous'] : status === 'paused' ? ['next', 'previous'] : [];
  return {
    status, ...(title === undefined ? {} : {title}), ...(artist === undefined ? {} : {artist}), ...(album === undefined ? {} : {album}), controls,
  };
}

/** The Sony source: each call goes through `transport` within `deadline`. */
export function sonySource(config: SonyConfiguration, transport: SpeakerTransport, deadline: Deadline): SpeakerSource {
  const call = (method: string, version: string) => deadline(signal => transport.sony(config.endpoint, method, version, signal));
  return {
    kind: 'sony',
    async read() {
      const reply = await call(...SONY_READ);
      // A JSON-RPC error is a failed read: it reports nothing, so the observation ages.
      if (!('result' in reply)) throw new Error('invalid-response');
      return sonyObservation(reply.result);
    },
    async command(action) {
      const method = SONY_METHODS[action];
      // An action the receiver has no method for never reaches it.
      if (method === undefined) return 'failed';
      const reply = await call(...method);
      return 'result' in reply ? 'sent' : 'failed';
    },
  };
}
