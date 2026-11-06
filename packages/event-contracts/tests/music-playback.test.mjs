import assert from 'node:assert/strict';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';

const now = Date.parse('2026-11-05T00:00:00Z');
const epoch = '9df02246-518e-44f2-9412-a942735e63cd';
const interval = {earliestAtMs: now - 30, latestAtMs: now};
const field = value => ({status: 'observed', value, interval});
const missing = {status: 'unavailable', error: {code: 'unavailable', retryable: true}, interval};
const sample = () => ({sequence: 1, interval, clockUncertaintyMs: 50, discontinuity: true,
  status: 'sample', processEpoch: epoch, libraryScopeId: 'synthetic-library', state: field('paused'), position: field(0),
  item: field('0123456789ABCDEF'), itemAssociation: {status: 'bounded-match', interval},
  metadata: {title: field('Synthetic song'), artist: missing, album: missing, durationSeconds: field(120)},
  outputSelection: {status: 'observed', provenance: 'music-declared-selection', interval, selectionInterval: interval,
    airPlayEnabled: field(true), devices: [{ordinal: 0, name: field('Synthetic output'), kind: field('airplay-device'),
      active: field(false), available: field(true), selected: field(true)}]}});
const validator = new MessageValidator();
registerCoreFamilies(validator);
function message(family, kind, type, data, subject = 'endpoint-1') {
  return {specversion: '1.0', bunnyprofile: '2.0', id: `test-${family}`, source: 'bunny/parts/music-playback',
    type, subject, time: new Date(now).toISOString(), kind, datacontenttype: 'application/json',
    dataschema: `https://bunny.invalid/events/${family}/2.0`,
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data,
    ...(kind === 'command' ? {expiresat: new Date(now + 5000).toISOString()} : {})};
}
const observation = data => message('music-playback-observation', 'occurrence', 'org.bunny.music-playback.observed', data);
const valid = value => assert.equal(validator.validate(value, {nowMs: now}).ok, true, JSON.stringify(validator.validate(value, {nowMs: now})));
const invalid = value => assert.equal(validator.validate(value, {nowMs: now}).ok, false);

test('Music observation preserves zero, partial fields, local identity and declared selection', () => {
  valid(observation(sample()));
  valid(observation({...sample(), position: missing, item: missing, itemAssociation: {status: 'unavailable'}}));
  valid(observation({sequence: 2, interval, clockUncertaintyMs: 50, discontinuity: true,
    status: 'unavailable', error: {code: 'forbidden', retryable: false}}));
});

test('Music observations refuse invented recording IDs, extra native data and invalid intervals', () => {
  for (const patch of [{recordingId: 'synthetic'}, {sourceInstance: '0'.repeat(64)}, {sequence: 0}, {clockUncertaintyMs: 101},
    {position: field(NaN)}, {position: field(-1)}, {interval: {earliestAtMs: now, latestAtMs: now - 1}},
    {state: {...field('playing'), interval: {earliestAtMs: now - 100, latestAtMs: now}}},
    {metadata: {...sample().metadata, title: field('🐇'.repeat(65))}},
    {item: field('not-hex')}, {itemAssociation: {status: 'bounded-match', interval}, item: missing},
    {outputSelection: {...sample().outputSelection, devices: Array.from({length: 9}, (_, ordinal) => ({...sample().outputSelection.devices[0], ordinal}))}},
    {outputSelection: {...sample().outputSelection, devices: [{...sample().outputSelection.devices[0], ordinal: 1}]}}]) invalid(observation({...sample(), ...patch}));
});

test('endpoint and work stay narrow and results preserve known transmission evidence', () => {
  const endpoint = data => message('music-playback-endpoint', 'command', 'org.bunny.music-playback.endpoint.requested', data);
  valid(endpoint({requestId: 'enable', action: 'enable', libraryScopeId: 'synthetic-library'}));
  valid(endpoint({requestId: 'disable', action: 'disable'}));
  invalid(endpoint({requestId: 'enable', action: 'enable', libraryScopeId: 'synthetic-library', input: 'microphone'}));
  const work = data => message('music-playback-work', 'command', 'org.bunny.music-playback.work.requested', data);
  const common = {operationId: 'operation-1', processEpoch: epoch, action: 'next'};
  valid(work({requestId: 'request-1', ...common}));
  invalid(work({requestId: 'request-1', ...common, action: 'seek', seconds: 10}));
  const result = data => message('music-playback-result', 'occurrence', 'org.bunny.music-playback.result.observed', data);
  valid(result({...common, status: 'sent'}));
  valid(result({...common, status: 'unsent', error: {code: 'expired', retryable: false}}));
  invalid(result({...common, status: 'sent', error: {code: 'unavailable', retryable: true}}));
  invalid(result({...common, status: 'uncertain', error: {code: 'uncertain-result', retryable: true}}));
});
