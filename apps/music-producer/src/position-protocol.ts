import {Ajv2020} from 'ajv/dist/2020.js';
import type {ErrorDetail} from '@jimmie-potts/event-contracts/v2';

export type ReadInterval = {startedMonotonicMs: number; endedMonotonicMs: number};
export type MusicPlayerState = 'stopped' | 'playing' | 'paused' | 'fast-forwarding' | 'rewinding';
export type PositionObservation = {status: 'observed'; seconds: number; interval: ReadInterval} |
  {status: 'unavailable'; error: ErrorDetail; interval: ReadInterval};
export type PositionSample = {schema: 'music-position-read/1.0'; status: 'sample'; sourceInstance: string; interval: ReadInterval;
  state: {value: MusicPlayerState; interval: ReadInterval}; position: PositionObservation};
export type PositionRecord = PositionSample | {schema: 'music-position-read/1.0'; status: 'unavailable'; error: ErrorDetail; interval: ReadInterval};
export const MAX_POSITION_BYTES = 4096;
const closed = (properties: Record<string, object>) => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const number = (maximum: number) => ({type: 'number', minimum: 0, maximum});
const interval = closed({startedMonotonicMs: number(Number.MAX_SAFE_INTEGER), endedMonotonicMs: number(Number.MAX_SAFE_INTEGER)});
const errors = [
  ['unavailable', true, 'The selected Music process or read is unavailable.'],
  ['forbidden', false, 'Music automation permission is unavailable without prompting.'],
  ['invalid-message', false, 'Music returned an invalid state or position descriptor.'],
  ['invalid-request', false, 'Use --clock, --self-test or explicitly select --read-existing-music.'],
] as const;
const error = {oneOf: errors.map(([code, retryable, detail]) => closed({code: {const: code}, retryable: {const: retryable}, detail: {const: detail}}))};
const schema = {const: 'music-position-read/1.0'};
const validate = new Ajv2020({strict: true}).compile<PositionRecord>({oneOf: [
  closed({schema, status: {const: 'sample'}, sourceInstance: {type: 'string', pattern: '^[a-f0-9]{64}$'}, interval,
    state: closed({value: {enum: ['stopped', 'playing', 'paused', 'fast-forwarding', 'rewinding']}, interval}),
    position: {oneOf: [closed({status: {const: 'observed'}, seconds: number(Number.MAX_SAFE_INTEGER / 1000), interval}),
      closed({status: {const: 'unavailable'}, error, interval})]}}),
  closed({schema, status: {const: 'unavailable'}, error, interval}),
]});

export function parsePositionRecord(bytes: Uint8Array): PositionRecord | undefined {
  if (bytes.byteLength > MAX_POSITION_BYTES) return undefined;
  let value: unknown;
  try {value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));} catch {return undefined;}
  if (!validate(value)) return undefined;
  const {startedMonotonicMs: start, endedMonotonicMs: end} = value.interval;
  if (end < start || end - start > 5000) return undefined;
  if (value.status === 'sample') {
    const first = value.state.interval, second = value.position.interval;
    if (first.startedMonotonicMs < start || first.endedMonotonicMs < first.startedMonotonicMs ||
      second.startedMonotonicMs < first.endedMonotonicMs || second.endedMonotonicMs < second.startedMonotonicMs || second.endedMonotonicMs > end) return undefined;
  }
  return value;
}
