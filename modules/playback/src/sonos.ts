// The Sonos Move UPnP AVTransport source (Hub #233), qualified in docs/iphone-apple-music-qualification.md (Sonos Move
// check, and play and resume check). Copied from the old Hub's `apps/hub/src/sonos.ts` at main 483d3a93 for Hub #929 and
// converted to the strict profile. The HTTP call moved to `transport.ts` and its polling to the module; the endpoint and
// raw SOAP replies stay in this file and the transport, and never reach a message.
import {exact, object, privateHttpEndpoint, text} from './common.js';
import type {PlaybackAction, PlaybackObservation, PlaybackStatus} from './playback.js';
import type {Deadline, SpeakerSource} from './sources.js';
import type {SpeakerTransport} from './transport.js';

export type SonosConfiguration = {kind: 'sonos'; endpoint: string};

export const CONTROL_PATH = '/MediaRenderer/AVTransport/Control';
/** The three reads every poll makes, in order. */
export const SONOS_READS = ['GetTransportInfo', 'GetPositionInfo', 'GetCurrentTransportActions'] as const;
// The Move labels the AirPlay session's track with this URI scheme; any other URI is another input.
const AIRPLAY_SCHEME = 'x-sonos-vli:';
const STATES: Readonly<Record<string, PlaybackStatus>> = {PLAYING: 'playing', PAUSED_PLAYBACK: 'paused', STOPPED: 'stopped'};
export const SONOS_ACTIONS: Readonly<Record<PlaybackAction, string>> = {play: 'Play', pause: 'Pause', next: 'Next', previous: 'Previous'};
// Pause, next and previous were qualified while playing (#158); play while paused (#242). Next and previous while paused follow
// the Move's own action list and the HT-A9 precedent until the #233 live check confirms them.
const BY_STATUS: Readonly<Partial<Record<PlaybackStatus, readonly PlaybackAction[]>>> = {
  playing: ['pause', 'next', 'previous'], paused: ['play', 'next', 'previous'],
};

/** `{kind: "sonos", endpoint: "http://<private IPv4>:1400/MediaRenderer/AVTransport/Control"}`, the exact control URL, or undefined. */
export function sonosConfiguration(value: unknown): SonosConfiguration | undefined {
  if (!object(value) || !exact(value, ['kind', 'endpoint']) || value.kind !== 'sonos') return undefined;
  const endpoint = privateHttpEndpoint(value.endpoint, CONTROL_PATH);
  return endpoint === undefined ? undefined : {kind: 'sonos', endpoint};
}

const ENTITIES: Readonly<Record<string, string>> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: '\''};
/** Decodes the XML character references one layer deep; the SOAP body and the DIDL-Lite metadata inside it are each decoded once. */
export const decode = (value: string): string => value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (match, reference: string) => {
  if (!reference.startsWith('#')) return ENTITIES[reference] ?? match;
  const code = reference.startsWith('#x') ? parseInt(reference.slice(2), 16) : parseInt(reference.slice(1), 10);
  return code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF) ? match : String.fromCodePoint(code);
});
const NAME = '(?:[A-Za-z_][\\w.-]*:)?';
/** The decoded text of the first element with this local name. Every element read here holds text only, so nested markup never matches. */
function element(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${NAME}${name}(?:\\s[^>]*)?>([^<]*)</${NAME}${name}>`).exec(xml);
  const inner = match?.[1];
  return inner === undefined ? undefined : decode(inner);
}
export const hasElement = (xml: string, name: string): boolean => new RegExp(`<${NAME}${name}[\\s>]`).test(xml);

/** Normalizes one complete read: the transport state, the track URI and metadata, and the advertised actions. */
export function sonosObservation(transport: string, position: string, actions: string): PlaybackObservation {
  const state = element(transport, 'CurrentTransportState');
  if (state === undefined || !hasElement(position, 'GetPositionInfoResponse') || !hasElement(actions, 'GetCurrentTransportActionsResponse')) {
    throw new Error('invalid-response');
  }
  if (!(element(position, 'TrackURI') ?? '').startsWith(AIRPLAY_SCHEME)) return {status: 'inactive', controls: []};
  const status = Object.hasOwn(STATES, state) ? STATES[state] ?? 'unknown' : 'unknown';
  // TrackMetaData is DIDL-Lite XML, or NOT_IMPLEMENTED. Only its title, artist and album are read; artwork URIs, position and duration are not copied.
  const metadata = element(position, 'TrackMetaData') ?? '';
  const didl = metadata.startsWith('<') ? metadata : '';
  const field = (name: string): string | undefined => didl === '' ? undefined : text(element(didl, name));
  const title = field('title'), artist = field('creator'), album = field('album');
  const advertised = new Set((element(actions, 'Actions') ?? '').split(',').map(item => item.trim()));
  const controls = (BY_STATUS[status] ?? []).filter(action => advertised.has(SONOS_ACTIONS[action]));
  return {
    status, ...(title === undefined ? {} : {title}), ...(artist === undefined ? {} : {artist}), ...(album === undefined ? {} : {album}), controls,
  };
}

/** The Sonos source: each call goes through `transport` within its own `deadline`. */
export function sonosSource(config: SonosConfiguration, transport: SpeakerTransport, deadline: Deadline): SpeakerSource {
  const call = (action: string, args = '') => deadline(signal => transport.sonos(config.endpoint, action, args, signal));
  /** A read action's body, which must be a 200 carrying that action's response element. */
  const read = async (action: string): Promise<string> => {
    const reply = await call(action);
    if (reply.status !== 200 || !hasElement(reply.body, `${action}Response`)) throw new Error('invalid-response');
    return reply.body;
  };
  return {
    kind: 'sonos',
    async read() {
      // In sequence; any failed call fails the whole read, which reports nothing.
      const [transportInfo, position, actions] = SONOS_READS;
      const state = await read(transportInfo);
      const track = await read(position);
      return sonosObservation(state, track, await read(actions));
    },
    async command(action) {
      const reply = await call(SONOS_ACTIONS[action], action === 'play' ? '<Speed>1</Speed>' : '');
      if (reply.status === 200) return 'sent';
      // A SOAP fault is the Move refusing a command it heard; any other reply leaves the result uncertain.
      if (reply.status === 500 && hasElement(reply.body, 'Fault')) return 'refused';
      throw new Error('invalid-response');
    },
  };
}
