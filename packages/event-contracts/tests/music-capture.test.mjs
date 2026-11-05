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
const v21 = value => ({...value, dataschema: value.dataschema.replace('/2.0', '/2.1')});

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

test('selected microphone versions preserve Music and require public source provenance', () => {
  const selection = {input: 'microphone', microphoneId: 'studio-mic'};
  const registration = message('music-capture-endpoint', 'command', 'org.bunny.music-capture.endpoint.requested',
    {requestId: 'enable-mic', action: 'enable', input: 'music', microphone: {id: selection.microphoneId}});
  const work = message('music-capture-work', 'command', 'org.bunny.music-capture.work.requested',
    {requestId: 'start-mic', operationId: 'start-mic', generation, action: 'start', ...selection});
  const control = message('music-capture-control', 'command', 'org.bunny.music-capture.control.requested',
    {requestId: 'start-mic', expectedRevision: 2, endpointId: 'endpoint-1', action: 'start', ...selection}, 'music');
  const state = message('music-capture-state', 'state', 'org.bunny.music-capture.updated',
    {id: 'music', revision: 3, endpointId: 'endpoint-1', availability: 'available', microphone: {id: selection.microphoneId},
      session: {status: 'starting', generation, operationId: 'start-mic', ...selection}}, 'music');
  for (const value of [registration, work, control, state, feature({...frame(), ...selection})]) {
    invalid(value);
    valid(v21(value));
    invalid({...v21(value), data: {...value.data, uid: 'synthetic-private-device'}});
  }
  valid(v21(feature(frame())));
  valid(v21({...registration, data: {requestId: 'enable-music', action: 'enable', input: 'music'}}));
  valid(v21({...state, data: {id: 'music', revision: 0, endpointId: null, availability: 'off', session: {status: 'idle'}}}));
  for (const microphoneId of ['', 'x'.repeat(65), 'room mic', 'bad/alias', 'studio-mic\n']) invalid(v21(feature({...frame(), ...selection, microphoneId})));
  invalid(v21(feature({...frame(), input: 'microphone'})));
  invalid(v21(feature({...frame(), microphoneId: 'studio-mic'})));
  invalid(v21({...registration, data: {...registration.data, microphone: {id: 'studio-mic', present: true}}}));
  invalid({...v21(work), dataschema: work.dataschema.replace('/2.0', '/2.2')});
});

const binding = {endpointId: 'endpoint-1', generation, microphoneId: 'studio-mic', sampleRateHz: 48000, channels: 2};
const settings = {sensitivity: 1, smoothingMs: 100, emphasis: {bass: 1, mid: 1, treble: 1}, gate: {mode: 'off'}};
const v22 = value => ({...value, dataschema: value.dataschema.replace('/2.0', '/2.2')});
const tuning = data => v22(message('music-capture-control', 'command', 'org.bunny.music-capture.control.requested',
  {requestId: 'tuning-one', expectedRevision: 1, ...data}, 'music'));

test('2.2 calibration and tuning have explicit source binding and closed finite settings', () => {
  valid(tuning({action: 'calibrate', binding}));
  valid(tuning({action: 'cancel-calibration', binding, operationId: 'calibration-one'}));
  valid(tuning({action: 'apply-tuning', expectedSettingsRevision: 0, binding, settings}));
  valid(tuning({action: 'apply-tuning', expectedSettingsRevision: 0, binding, settings: {...settings, gate: {mode: 'manual', threshold: 0.02}}}));
  valid(tuning({action: 'apply-tuning', expectedSettingsRevision: 0, binding, settings: {...settings, gate: {mode: 'calibrated', threshold: 0.02, calibrationId: 'calibration-one'}}}));
  invalid(tuning({action: 'calibrate'}));
  invalid(tuning({action: 'calibrate', binding: {...binding, uid: 'private'}}));
  invalid(tuning({action: 'cancel-calibration', binding}));
  for (const patch of [{sensitivity: 0}, {sensitivity: 8.1}, {smoothingMs: -1}, {smoothingMs: 2001},
    {emphasis: {bass: 5, mid: 1, treble: 1}}, {gate: {mode: 'manual', threshold: NaN}},
    {gate: {mode: 'manual', threshold: 16.1}}, {gate: {mode: 'off', threshold: 0}},
    {gate: {mode: 'calibrated', threshold: 0.02}}, {pcm: [0]}])
    invalid(tuning({action: 'apply-tuning', expectedSettingsRevision: 0, binding, settings: {...settings, ...patch}}));
  for (const version of ['2.0', '2.1']) invalid({...tuning({action: 'calibrate', binding}), dataschema: `https://bunny.invalid/events/music-capture-control/${version}`});
});

test('2.2 state carries bounded persisted response evidence while old state shapes remain valid', () => {
  const data = {id: 'music', revision: 1, endpointId: null, availability: 'off', session: {status: 'idle'}};
  const state = message('music-capture-state', 'state', 'org.bunny.music-capture.updated', data, 'music');
  valid(state); valid(v21(state)); invalid(v22(state));
  const response = {settingsRevision: 0, settings, appliedTo: null, calibration: {status: 'idle'}, evidence: null};
  valid({...v22(state), data: {...data, response}});
  invalid({...state, data: {...data, response}});
  invalid({...v21(state), data: {...data, response}});
  const evidence = {id: 'calibration-one', binding, windowCount: 50, startedAtMs: at, endedAtMs: at + 5000,
    sourceDurationMs: 5000, percentileRms: 0.01, maximumRms: 0.02, suggestedThreshold: 0.02};
  valid({...v22(state), data: {...data, response: {...response, evidence}}});
  invalid({...v22(state), data: {...data, response: {...response, evidence: {...evidence, windowCount: 49}}}});
  invalid({...v22(state), data: {...data, response: {...response, evidence: {...evidence, rawAudio: []}}}});
});
