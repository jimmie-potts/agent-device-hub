import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8'));
const validator = new MessageValidator(); registerCoreFamilies(validator);
const card = {opportunity: fixtures.valid['companion-opportunity'].data, text: 'A synthetic coding question is waiting.',
  phrase: 0, presentedAtMs: Date.parse(fixtures.valid['companion-opportunity'].time), history: false, content: 'unavailable'};
const dispatch = {requestId: 'speech-request', candidateId: 'candidate-1', endpointId: 'endpoint-1'};
const examples = {
  'companion-speech-endpoint': {kind: 'command', type: 'org.bunny.companion-speech.endpoint.requested', subject: 'endpoint-1',
    data: {requestId: 'enable-request', action: 'enable', available: true}},
  'companion-speech-output': {kind: 'command', type: 'org.bunny.companion-speech.output.requested', subject: 'endpoint-1',
    data: {requestId: 'output-request', operationId: 'speech-request', action: 'speak', card}},
  'companion-speech-playback': {kind: 'occurrence', type: 'org.bunny.companion-speech.playback.observed', subject: 'endpoint-1',
    data: {operationId: 'speech-request', status: 'completed', started: true}},
  'companion-speech-lost': {kind: 'occurrence', type: 'org.bunny.companion-speech.endpoint-lost', subject: 'endpoint-1', data: {id: 'endpoint-1'}},
  'companion-speech-dispatch': {kind: 'command', type: 'org.bunny.companion-speech.dispatch.requested', subject: 'reachy', data: dispatch},
  'companion-speech-play': {kind: 'command', type: 'org.bunny.companion-speech.play.requested', subject: 'reachy', data: dispatch},
  'companion-speech-state': {kind: 'state', type: 'org.bunny.companion-speech-state.updated', subject: 'reachy',
    data: {id: 'reachy', revision: 1, endpointId: null, availability: 'off', playback: null, pending: false}},
};
function message(family, data = examples[family].data) {
  const value = {...structuredClone(fixtures.valid['companion-settings-set']), ...structuredClone(examples[family]),
    id: `msg-${family}`, dataschema: `https://bunny.invalid/events/${family}/2.0`, data: structuredClone(data)};
  if (value.kind !== 'command') delete value.expiresat;
  return value;
}
const valid = value => assert.equal(validator.validate(value).ok, true, JSON.stringify(validator.validate(value)));
const invalid = value => assert.equal(validator.validate(value).ok, false, JSON.stringify(value));

test('speech families are registered profile-2.0 messages with closed payloads', () => {
  for (const family of Object.keys(examples)) {
    valid(message(family));
    invalid(message(family, {...examples[family].data, voiceURI: 'unrequested-private-field'}));
    invalid({...message(family), type: 'org.bunny.other.requested'});
    invalid({...message(family), subject: examples[family].subject === 'reachy' ? 'different-target' : 'not.an.endpoint'});
  }
});

test('endpoint enablement declares availability explicitly and controls carry no arbitrary speech', () => {
  const family = 'companion-speech-endpoint';
  for (const action of ['mute', 'stop']) valid(message(family, {requestId: 'control-request', action}));
  invalid(message(family, {requestId: 'enable-request', action: 'enable'}));
  invalid(message(family, {requestId: 'enable-request', action: 'enable', available: false}));
  invalid(message(family, {requestId: 'control-request', action: 'stop', text: 'arbitrary output'}));
});

test('speech output admits a current live card and Stop, and refuses history, fixtures or a mismatched deadline', () => {
  const family = 'companion-speech-output', source = examples[family].data;
  valid(message(family, {requestId: 'stop-request', operationId: 'speech-request', action: 'stop'}));
  for (const changed of [{...card, history: true}, {...card, text: ' '}, {...card, text: 'x'.repeat(513)},
    {...card, opportunity: {...card.opportunity, context: 'scenario'}},
    {...card, opportunity: {...card.opportunity, category: 'simulated-social'}}]) {
    invalid(message(family, {...source, card: changed}));
  }
  invalid({...message(family), expiresat: new Date(card.opportunity.validUntilMs + 1).toISOString()});
  invalid(message(family, {...source, action: 'stop'}));
});

test('playback observations distinguish started, completed, stopped, refused and uncertain output', () => {
  const family = 'companion-speech-playback';
  for (const status of ['started', 'completed']) {
    valid(message(family, {operationId: 'speech-request', status, started: true}));
    invalid(message(family, {operationId: 'speech-request', status, started: false}));
  }
  for (const status of ['stopped', 'uncertain']) for (const started of [false, true]) valid(message(family, {operationId: 'speech-request', status, started}));
  valid(message(family, {operationId: 'speech-request', status: 'failed', started: false}));
  valid(message(family, {operationId: 'speech-request', status: 'not-started', started: false, reason: 'policy'}));
  for (const data of [{operationId: 'speech-request', status: 'failed', started: true},
    {operationId: 'speech-request', status: 'heard', started: true},
    {operationId: 'speech-request', status: 'succeeded', started: true},
    {operationId: 'speech-request', status: 'not-started', started: false, reason: 'raw browser error'}]) invalid(message(family, data));
});

test('internal speech requests carry candidate references and endpoint loss names only its own subject', () => {
  for (const family of ['companion-speech-dispatch', 'companion-speech-play']) {
    invalid(message(family, {...dispatch, text: 'arbitrary output'}));
    invalid(message(family, {...dispatch, endpointId: '*'}));
  }
  invalid(message('companion-speech-lost', {id: 'another-endpoint'}));
});

test('speech state cannot claim availability without an endpoint or queue behind uncertain output', () => {
  const family = 'companion-speech-state', initial = examples[family].data;
  valid(message(family, {...initial, endpointId: 'endpoint-1', availability: 'available'}));
  invalid(message(family, {...initial, availability: 'available'}));
  invalid(message(family, {...initial, endpointId: 'endpoint-1', availability: 'available',
    playback: {operationId: 'speech-request', status: 'uncertain', started: true}}));
  invalid(message(family, {...initial, pending: true}));
  invalid(message(family, {...initial, endpointId: 'endpoint-1', availability: 'unavailable', pending: true,
    playback: {operationId: 'speech-request', status: 'uncertain', started: true}}));
});
