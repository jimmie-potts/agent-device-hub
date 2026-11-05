import assert from 'node:assert/strict';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';

const validator = new MessageValidator();
registerCoreFamilies(validator);
const generation = '9df02246-518e-44f2-9412-a942735e63cd';
const at = Date.parse('2026-11-05T00:00:00.000Z');
const frame = () => ({generation, input: 'music', sequence: 1, sampleRateHz: 48000, channels: 2, frameCount: 4800,
  startMonotonicMs: 1000, endMonotonicMs: 1100, emittedMonotonicMs: 1102,
  observedAtMs: at, validUntilMs: at + 400, rms: 0.25, peak: 0.5, clippedFraction: 0,
  bands: {bass: 0.2, mid: 0.1, treble: 0.05}, onset: {strength: 0.1, confidence: 0.5}, discontinuity: true});
const message = (family, kind, type, data, subject = 'endpoint-1') => ({
  specversion: '1.0', bunnyprofile: '2.0', id: `test-${family}`, source: 'bunny/parts/music-producer',
  type, subject, time: new Date(at).toISOString(), kind, datacontenttype: 'application/json',
  dataschema: `https://bunny.invalid/events/${family}/2.0`,
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data,
  ...(kind === 'command' ? {expiresat: new Date(at + 5000).toISOString()} : {}),
});
const feature = data => message('music-capture-features', 'occurrence', 'org.bunny.music-capture.features.observed', data);
const valid = value => assert.equal(validator.validate(value, {nowMs: at}).ok, true, JSON.stringify(validator.validate(value, {nowMs: at})));
const invalid = value => assert.equal(validator.validate(value, {nowMs: at}).ok, false);

test('capture features accept measured bounded windows without an occurrence expiry attribute', () => {
  valid(feature(frame()));
  valid(feature({...frame(), rms: 0, peak: 0, bands: {bass: 0, mid: 0, treble: 0}, onset: {strength: 0, confidence: 0}}));
  valid(feature({...frame(), rms: 16, peak: 16, clippedFraction: 1, bands: {bass: 32, mid: 32, treble: 32}}));
  invalid({...feature(frame()), expiresat: new Date(at + 400).toISOString()});
});

test('capture features reject private content, nonfinite values, invalid bounds and contradictory measurements', () => {
  for (const patch of [{pcm: [0.2]}, {token: 'synthetic'}, {title: 'synthetic'}, {rms: NaN}, {peak: Infinity},
    {rms: -1}, {peak: 17}, {rms: 0.8}, {channels: 3}, {sampleRateHz: 7999}, {sampleRateHz: 192010},
    {sampleRateHz: 44101}, {sequence: 0}, {frameCount: 4799}, {generation: 'not-a-generation'},
    {clippedFraction: 1.1}, {bands: {bass: 0, mid: -1, treble: 0}}, {onset: {strength: 2, confidence: 0}},
    {endMonotonicMs: 999}, {endMonotonicMs: 1110}, {emittedMonotonicMs: 1099},
    {validUntilMs: at + 401}, {validUntilMs: at - 1}]) invalid(feature({...frame(), ...patch}));
});

test('capture work distinguishes start input from stop and carries generation responsibility', () => {
  const work = data => message('music-capture-work', 'command', 'org.bunny.music-capture.work.requested', data);
  const common = {requestId: 'request-1', operationId: 'operation-1', generation};
  valid(work({...common, action: 'start', input: 'music'}));
  valid(work({...common, action: 'stop'}));
  invalid(work({...common, action: 'start', input: 'microphone'}));
  invalid(work({...common, action: 'stop', input: 'music'}));
  invalid(work({...common, action: 'start'}));
});

test('lifecycle observations retain definitive and uncertain stop evidence separately from features', () => {
  const progress = data => message('music-capture-progress', 'occurrence', 'org.bunny.music-capture.progress.observed', data);
  const common = {operationId: 'operation-1', generation};
  valid(progress({...common, status: 'started'}));
  valid(progress({...common, status: 'stopped'}));
  valid(progress({...common, status: 'failed', error: {code: 'forbidden', retryable: false}}));
  valid(progress({...common, status: 'uncertain', error: {code: 'uncertain-result', retryable: false}}));
  invalid(progress({...common, status: 'failed'}));
  invalid(progress({...common, status: 'failed', error: {code: 'internal', retryable: false, detail: 'untrusted source text'}}));
  invalid(progress({...common, status: 'stopped', error: {code: 'internal', retryable: false}}));
});

test('endpoint registration advertises capability without a session and loss works before capture', () => {
  const endpoint = data => message('music-capture-endpoint', 'command', 'org.bunny.music-capture.endpoint.requested', data);
  valid(endpoint({requestId: 'enable-1', action: 'enable', input: 'music'}));
  valid(endpoint({requestId: 'disable-1', action: 'disable'}));
  invalid(endpoint({requestId: 'enable-1', action: 'enable', input: 'microphone'}));
  valid(message('music-capture-lost', 'occurrence', 'org.bunny.music-capture.endpoint-lost', {id: 'endpoint-1'}));
  invalid(message('music-capture-lost', 'occurrence', 'org.bunny.music-capture.endpoint-lost', {id: 'different'}));
});
