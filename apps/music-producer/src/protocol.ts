import {Ajv2020} from 'ajv/dist/2020.js';
import {errorBody, type ErrorDetail} from '@jimmie-potts/event-contracts/v2';
import type {CaptureFeatures} from '@jimmie-potts/event-contracts/v2/music-capture';

export type NativeFrame = Omit<CaptureFeatures, 'generation' | 'input' | 'observedAtMs' | 'validUntilMs'>;
export type NativeFailure = Pick<ErrorDetail, 'code' | 'retryable'>;
export type NativeRecord = ({schema: 'music-native-frame/1.0'} & NativeFrame) |
  {schema: 'music-native-clock/1.0'; monotonicMs: number} |
  {schema: 'music-native-terminal/1.0' | 'music-native-terminal/1.1'; error: ErrorDetail};
export const MAX_NATIVE_LINE_BYTES = 2048;
const number = (maximum: number) => ({type: 'number', minimum: 0, maximum});
const integer = (minimum: number, maximum: number) => ({type: 'integer', minimum, maximum});
const closed = (properties: Record<string, object>) => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const time = number(Number.MAX_SAFE_INTEGER);
const ajv = new Ajv2020({strict: true});
const errors = [
  ['invalid-request', false, 'Use --clock, --self-test or explicitly select --capture.'],
  ['invalid-request', false, 'The Music capture control input is invalid.'],
  ['invalid-message', false, 'Music capture contains invalid sample values.'],
  ['invalid-message', false, 'Music capture timestamps are invalid.'],
  ['unsupported-capability', false, 'Music capture format is unsupported or changed.'],
  ['capacity', true, 'Music capture requires lock-free transfer.'],
  ['unavailable', true, 'The selected Music audio process is unavailable.'],
  ['unavailable', true, 'The selected Music output route changed or is unavailable.'],
  ['unavailable', true, 'Music capture could not be opened or continued.'],
  ['unavailable', true, 'Music capture cleanup did not complete.'],
  ['unavailable', true, 'The Music feature consumer is unavailable.'],
] as const;
const microphoneErrors = [
  ['invalid-request', false, 'The microphone capture selection or control input is invalid.'],
  ['invalid-message', false, 'Microphone capture contains invalid sample values.'],
  ['invalid-message', false, 'Microphone capture timestamps are invalid.'],
  ['unsupported-capability', false, 'Microphone capture format is unsupported or changed.'],
  ['capacity', true, 'Microphone capture requires lock-free transfer.'],
  ['unavailable', true, 'The selected microphone is unavailable.'],
  ['unavailable', true, 'Microphone permission is not granted.'],
  ['unavailable', true, 'Microphone capture could not be opened or continued.'],
  ['unavailable', true, 'Microphone capture cleanup did not complete.'],
  ['unavailable', true, 'The microphone feature consumer is unavailable.'],
] as const;
const validate = ajv.compile<NativeRecord>({oneOf: [
  closed({schema: {const: 'music-native-frame/1.0'}, sequence: integer(1, Number.MAX_SAFE_INTEGER),
    sampleRateHz: {...integer(8000, 192000), multipleOf: 10}, channels: {enum: [1, 2]}, frameCount: integer(800, 19200),
    startMonotonicMs: time, endMonotonicMs: time, emittedMonotonicMs: time, rms: number(16), peak: number(16), clippedFraction: number(1),
    bands: closed({bass: number(32), mid: number(32), treble: number(32)}),
    onset: closed({strength: number(1), confidence: number(1)}), discontinuity: {type: 'boolean'}}),
  closed({schema: {const: 'music-native-clock/1.0'}, monotonicMs: time}),
  closed({schema: {const: 'music-native-terminal/1.0'}, error: {oneOf: errors.map(([code, retryable, detail]) =>
    closed({code: {const: code}, retryable: {const: retryable}, detail: {const: detail}}))}}),
  closed({schema: {const: 'music-native-terminal/1.1'}, error: {oneOf: microphoneErrors.map(([code, retryable, detail]) =>
    closed({code: {const: code}, retryable: {const: retryable}, detail: {const: detail}}))}}),
]});

export function parseNativeRecord(line: Uint8Array): NativeRecord | undefined {
  if (line.byteLength > MAX_NATIVE_LINE_BYTES) return undefined;
  let value: unknown;
  try {value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(line));} catch {return undefined;}
  if (!validate(value)) return undefined;
  if (value.schema === 'music-native-frame/1.0' && (value.frameCount * 1000 !== value.sampleRateHz * 100 ||
    Math.abs(value.endMonotonicMs - value.startMonotonicMs - 100) > 0.01 || value.emittedMonotonicMs < value.endMonotonicMs ||
    value.rms > value.peak + 1e-12)) return undefined;
  return value;
}

/** Retains only one bounded incomplete line, never a history of native output. */
export class NativeLines {
  #pending = Buffer.alloc(0);
  #failed = false;
  constructor(readonly record: (value: NativeRecord) => void, readonly invalid: () => void) {}
  push(bytes: Uint8Array): void {
    if (this.#failed) return;
    if (bytes.byteLength > 65_536) {this.#fail(); return;}
    let start = 0, count = 0;
    for (let index = 0; index < bytes.byteLength; index += 1) {
      if (bytes[index] !== 10) continue;
      if (++count > 128 || this.#pending.length + index - start > MAX_NATIVE_LINE_BYTES) {this.#fail(); return;}
      const line = Buffer.concat([this.#pending, bytes.subarray(start, index)]);
      this.#pending = Buffer.alloc(0);
      const value = parseNativeRecord(line);
      if (value === undefined) {this.#fail(); return;}
      this.record(value);
      if (this.#failed) return;
      start = index + 1;
    }
    if (this.#pending.length + bytes.byteLength - start > MAX_NATIVE_LINE_BYTES) {this.#fail(); return;}
    this.#pending = Buffer.concat([this.#pending, bytes.subarray(start)]);
  }
  finish(): void {if (this.#pending.length !== 0) this.#fail();}
  #fail(): void {if (!this.#failed) {this.#failed = true; this.#pending = Buffer.alloc(0); this.invalid();}}
}
export const nativeFailure = (code: NativeFailure['code']): NativeFailure => {
  const {retryable} = errorBody(code).error;
  return {code, retryable};
};
