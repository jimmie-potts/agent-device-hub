import {Ajv2020} from 'ajv/dist/2020.js';
import type {ErrorDetail} from '@jimmie-potts/event-contracts/v2';

export type PlaybackInterval = {startedMonotonicMs: number; endedMonotonicMs: number};
export type PlaybackField<T> = {status: 'observed'; value: T; interval: PlaybackInterval} |
  {status: 'unavailable'; error: ErrorDetail; interval: PlaybackInterval};
export type NativePlayerState = 'playing' | 'paused' | 'stopped' | 'fast-forwarding' | 'rewinding';
export type NativePlaybackAction = 'play' | 'pause' | 'next' | 'previous';
export type NativeOutputKind = 'computer' | 'airport-express' | 'apple-tv' | 'airplay-device' | 'bluetooth' | 'homepod' | 'tv' | 'unknown';
export type NativeOutputSelection = {status: 'unavailable'; error: ErrorDetail; interval: PlaybackInterval} | {
  status: 'observed'; provenance: 'music-declared-selection'; interval: PlaybackInterval; selectionInterval: PlaybackInterval;
  airPlayEnabled: PlaybackField<boolean>; devices: {ordinal: number; name: PlaybackField<string>; kind: PlaybackField<NativeOutputKind>;
    active: PlaybackField<boolean>; available: PlaybackField<boolean>; selected: PlaybackField<boolean>}[];
};
export type NativePlaybackSample = {schema: 'music-playback-read/1.0'; status: 'sample'; sourceInstance: string; interval: PlaybackInterval;
  state: PlaybackField<NativePlayerState>; position: PlaybackField<number>; item: PlaybackField<string>;
  itemAssociation: {status: 'bounded-match'; interval: PlaybackInterval} | {status: 'unavailable'};
  metadata: {title: PlaybackField<string>; artist: PlaybackField<string>; album: PlaybackField<string>; durationSeconds: PlaybackField<number>};
  outputSelection: NativeOutputSelection;
};
export type NativePlaybackRead = NativePlaybackSample | {schema: 'music-playback-read/1.0'; status: 'unavailable'; error: ErrorDetail; interval: PlaybackInterval};
export type NativePlaybackControl = {schema: 'music-playback-control/1.0'; action: NativePlaybackAction; expectedSourceInstance: string;
  interval: PlaybackInterval; sendInterval: PlaybackInterval | null} & ({status: 'sent'} | {status: 'unsent' | 'refused' | 'uncertain'; error: ErrorDetail});
export type NativePlaybackClock = {schema: 'music-playback-clock/1.0'; monotonicMs: number};
export type NativePlaybackRecord = NativePlaybackRead | NativePlaybackControl | NativePlaybackClock;
export const MAX_PLAYBACK_BYTES = 16_384;
export const MAX_PLAYBACK_STDERR_BYTES = 4096;

export const playbackNativeErrors = [
  ['unavailable', true, 'The selected Music process or requested field is unavailable.'],
  ['forbidden', false, 'Music automation permission is unavailable without prompting.'],
  ['invalid-message', false, 'Music returned an invalid playback descriptor.'],
  ['invalid-request', false, 'Use a supported explicit Music playback helper command.'],
  ['capacity', true, 'Music playback data exceeds the helper\'s fixed limits.'],
  ['expired', false, 'The Music playback operation deadline passed before transmission.'],
  ['invalid-state', false, 'Music refused the requested playback action.'],
  ['unsupported-capability', false, 'Music does not support the requested playback operation.'],
  ['uncertain-result', false, 'The Music playback action has no qualified definitive reply.'],
] as const;
const closed = (properties: Record<string, object>) => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const number = (maximum: number) => ({type: 'number', minimum: 0, maximum});
const intervalSchema = closed({startedMonotonicMs: number(Number.MAX_SAFE_INTEGER), endedMonotonicMs: number(Number.MAX_SAFE_INTEGER)});
const error = {oneOf: playbackNativeErrors.map(([code, retryable, detail]) => closed({code: {const: code}, retryable: {const: retryable}, detail: {const: detail}}))};
const unavailable = closed({status: {const: 'unavailable'}, error, interval: intervalSchema});
const field = (value: object) => ({oneOf: [closed({status: {const: 'observed'}, value, interval: intervalSchema}), unavailable]});
const string = (maxLength: number) => ({type: 'string', maxLength, pattern: '^[^\\u0000]*$'});
const seconds = number(Number.MAX_SAFE_INTEGER / 1000);
const nativeInstance = {type: 'string', pattern: '^[a-f0-9]{64}$'};
const action = {enum: ['play', 'pause', 'next', 'previous']};
const readBase = {schema: {const: 'music-playback-read/1.0'}, interval: intervalSchema};
const controlBase = {schema: {const: 'music-playback-control/1.0'}, action, expectedSourceInstance: nativeInstance, interval: intervalSchema};
const validate = new Ajv2020({strict: true}).compile<NativePlaybackRecord>({oneOf: [
  closed({schema: {const: 'music-playback-clock/1.0'}, monotonicMs: number(Number.MAX_SAFE_INTEGER)}),
  closed({...readBase, status: {const: 'unavailable'}, error}),
  closed({...readBase, status: {const: 'sample'}, sourceInstance: nativeInstance,
    state: field({enum: ['playing', 'paused', 'stopped', 'fast-forwarding', 'rewinding']}), position: field(seconds),
    item: field({type: 'string', pattern: '^[A-F0-9]{1,128}$'}),
    itemAssociation: {oneOf: [closed({status: {const: 'bounded-match'}, interval: intervalSchema}), closed({status: {const: 'unavailable'}})]},
    metadata: closed({title: field(string(256)), artist: field(string(256)), album: field(string(256)), durationSeconds: field(seconds)}),
    outputSelection: {oneOf: [unavailable, closed({status: {const: 'observed'}, provenance: {const: 'music-declared-selection'}, interval: intervalSchema,
      selectionInterval: intervalSchema, airPlayEnabled: field({type: 'boolean'}), devices: {type: 'array', maxItems: 8,
        items: closed({ordinal: {type: 'integer', minimum: 0, maximum: 7}, name: field(string(128)),
          kind: field({enum: ['computer', 'airport-express', 'apple-tv', 'airplay-device', 'bluetooth', 'homepod', 'tv', 'unknown']}),
          active: field({type: 'boolean'}), available: field({type: 'boolean'}), selected: field({type: 'boolean'})})}})]}}),
  closed({...controlBase, status: {const: 'sent'}, sendInterval: intervalSchema}),
  closed({...controlBase, status: {const: 'unsent'}, sendInterval: {type: 'null'}, error}),
  closed({...controlBase, status: {enum: ['refused', 'uncertain']}, sendInterval: intervalSchema, error}),
]});

export const intervalWithin = (value: PlaybackInterval, outer: PlaybackInterval): boolean =>
  value.startedMonotonicMs >= outer.startedMonotonicMs && value.endedMonotonicMs >= value.startedMonotonicMs && value.endedMonotonicMs <= outer.endedMonotonicMs;
const validText = (value: PlaybackField<string>, maximum: number): boolean => value.status !== 'observed' || Buffer.byteLength(value.value, 'utf8') <= maximum;

/** The sole native JSON boundary. No arbitrary error detail or undeclared field leaves it. */
export function parsePlaybackRecord(bytes: Uint8Array): NativePlaybackRecord | undefined {
  if (bytes.byteLength >= MAX_PLAYBACK_BYTES) return undefined;
  let value: unknown;
  try {value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));} catch {return undefined;}
  if (!validate(value)) return undefined;
  if (value.schema === 'music-playback-clock/1.0') return value;
  const whole = value.interval;
  if (whole.endedMonotonicMs < whole.startedMonotonicMs) return undefined;
  if (value.schema === 'music-playback-control/1.0') {
    return value.sendInterval === null || intervalWithin(value.sendInterval, whole) ? value : undefined;
  }
  if (whole.endedMonotonicMs - whole.startedMonotonicMs > 5000) return undefined;
  if (value.status === 'unavailable') return value;
  const metadata = Object.values(value.metadata);
  if (![value.state, value.position, value.item, ...metadata, value.outputSelection].every(part => intervalWithin(part.interval, whole)) ||
    value.state.interval.endedMonotonicMs > value.position.interval.startedMonotonicMs ||
    ![value.metadata.title, value.metadata.artist, value.metadata.album].every(part => validText(part, 256))) return undefined;
  if (value.itemAssociation.status === 'bounded-match') {
    const bound = value.itemAssociation.interval;
    if (value.item.status !== 'observed' || !intervalWithin(bound, whole) || !intervalWithin(value.item.interval, bound) ||
      ![value.position, ...metadata].every(part => part.status !== 'observed' || intervalWithin(part.interval, bound))) return undefined;
  } else if (value.item.status === 'observed') return undefined;
  const output = value.outputSelection;
  if (output.status === 'observed' && (!intervalWithin(output.selectionInterval, output.interval) ||
    !intervalWithin(output.airPlayEnabled.interval, output.interval) || output.devices.some((device, ordinal) => device.ordinal !== ordinal ||
      !validText(device.name, 128) || ![device.name, device.kind, device.active, device.available, device.selected].every(part => intervalWithin(part.interval, output.interval))))) return undefined;
  return value;
}
