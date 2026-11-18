// Music lighting session families (#1272, #722; #40 first-trial policy): closed, additive and light-addressed.
import assert from 'node:assert/strict';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';
import {LIGHTING_END_REASONS, LIGHTING_RESTORATIONS, musicLightingFamilies} from '../dist/v2/music-lighting.js';

const validator = new MessageValidator();
registerCoreFamilies(validator);
const at = Date.parse('2026-11-05T00:00:00.000Z');
const generation = '5f0c2a8e-1b2c-4d3e-8f40-0123456789ab';
const capture = {endpointId: 'endpoint-1', generation: '6a1b3c9d-2e3f-4a5b-9c60-123456789abc'};
const message = (family, kind, type, data, subject = 'lines', source = 'bunny/core') => ({
  specversion: '1.0', bunnyprofile: '2.0', id: `test-${family}`, source, type, subject, time: new Date(at).toISOString(), kind,
  datacontenttype: 'application/json', dataschema: `https://bunny.invalid/events/${family}/2.0`,
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data,
  ...(kind === 'command' ? {expiresat: new Date(at + 5000).toISOString()} : {}),
});
const control = (data, subject) => message('music-lighting-control', 'command', 'org.bunny.music-lighting.control.requested', data, subject);
const work = data => message('music-lighting-work', 'command', 'org.bunny.music-lighting.work.requested', data);
const state = (data, subject) => message('music-lighting-state', 'state', 'org.bunny.music-lighting.updated', data, subject);
const device = (data, subject) => message('music-lighting-device', 'state', 'org.bunny.music-lighting-device.updated', data, subject, 'bunny/modules/nanoleaf');
const check = value => validator.validate(value, {nowMs: at});
const valid = value => assert.equal(check(value).ok, true, JSON.stringify(check(value)));
const invalid = value => assert.equal(check(value).ok, false, JSON.stringify(value.data));
const start = {requestId: 'req-1', expectedRevision: 0, action: 'start', capture, presetId: 'preset-warm'};

test('lighting families are new 2.0 commands and states registered with the core families', () => {
  assert.deepEqual(musicLightingFamilies.map(({family, kind}) => `${family}:${kind}`),
    ['music-lighting-control:command', 'music-lighting-state:state', 'music-lighting-work:command', 'music-lighting-device:state']);
  assert.ok(musicLightingFamilies.every(family => family.dataschema.endsWith('/2.0')));
  assert.deepEqual([...LIGHTING_END_REASONS], ['stopped', 'alert', 'manual', 'source-lost', 'device', 'restart', 'expired', 'refused', 'completed']);
  assert.deepEqual([...LIGHTING_RESTORATIONS], ['restored', 'skipped', 'none', 'uncertain']);
});

test('control names a saved preset and the current Music capture, never a mode or a recipe', () => {
  valid(control(start));
  valid(control({requestId: 'req-2', expectedRevision: 3, action: 'stop'}));
  for (const patch of [{mode: 'free'}, {recipe: {effect: 'level-glow'}}, {presetId: 'warm'}, {presetId: `preset-${'a'.repeat(64)}`},
    {capture: {...capture, generation: 'nope'}}, {capture: {...capture, endpointId: 'Endpoint 1'}}, {capture: {...capture, input: 'microphone'}},
    {expectedRevision: -1}, {action: 'resume'}]) invalid(control({...start, ...patch}));
  invalid(control({requestId: 'req-2', expectedRevision: 3, action: 'stop', presetId: 'preset-warm'}));
  invalid(control(start, 'Lines'));
});

test('work carries the core session generation and nothing that could pick another mode or input', () => {
  valid(work({requestId: 'req-3', generation, action: 'start', capture, presetId: 'preset-warm'}));
  valid(work({requestId: 'req-4', generation, action: 'stop'}));
  invalid(work({requestId: 'req-3', action: 'start', capture, presetId: 'preset-warm'}));
  invalid(work({requestId: 'req-4', generation, action: 'stop', fallback: 'microphone'}));
});

test('core state reports the authorized session and the last observed ending under the light\'s own key', () => {
  const active = {status: 'active', generation, operationId: 'req-1', capture, presetId: 'preset-warm', startedAtMs: at};
  valid(state({id: 'lines', revision: 0, session: {status: 'idle'}, last: null}));
  valid(state({id: 'lines', revision: 4, session: active, last: {generation, reason: 'source-lost', restoration: 'skipped', atMs: at}}));
  for (const status of ['starting', 'stopping', 'uncertain']) valid(state({id: 'lines', revision: 1, session: {...active, status}, last: null}));
  invalid(state({id: 'lines', revision: 1, session: {...active, status: 'paused'}, last: null}));
  invalid(state({id: 'lines', revision: 1, session: {status: 'idle'}, last: {generation, reason: 'resumed', restoration: 'none', atMs: at}}));
  invalid(state({id: 'lines', revision: 1, session: {status: 'idle'}}));
  invalid(state({id: 'panels', revision: 1, session: {status: 'idle'}, last: null}));
});

test('device state ties an ending to its own session generation', () => {
  const ended = {generation, reason: 'manual', restoration: 'none', atMs: at};
  valid(device({id: 'lines', revision: 0, session: null}));
  valid(device({id: 'lines', revision: 1, session: {generation, status: 'playing'}}));
  valid(device({id: 'lines', revision: 2, session: {generation, status: 'ended', ended}}));
  valid(device({id: 'lines', revision: 3, session: {generation, status: 'ended', ended: {...ended, reason: 'refused', code: 'invalid-state'}}}));
  valid(device({id: 'lines', revision: 3, session: {generation, status: 'ended', ended: {...ended, reason: 'alert', restoration: 'uncertain'}}}));
  invalid(device({id: 'lines', revision: 3, session: {generation, status: 'ended', ended: {...ended, code: 'not-a-code'}}}));
  invalid(device({id: 'lines', revision: 2, session: {generation, status: 'ended', ended: {...ended, generation: capture.generation}}}));
  invalid(device({id: 'lines', revision: 2, session: {generation, status: 'playing', ended}}));
  invalid(device({id: 'lines', revision: 2, session: {generation, status: 'ended'}}));
  invalid(device({id: 'panels', revision: 0, session: null}));
});

test('prepared work carries bounded standalone timing and requires a generation for pause, resume and seek', () => {
  const base = {requestId: 'show-start', expectedRevision: 0, action: 'start-show', showId: 'show-almond', version: 2, positionMs: 0, startDelayMs: 30_000};
  valid(control(base));
  for (const patch of [{showId: 'almond'}, {version: 0}, {version: 257}, {positionMs: 1_800_001}, {positionMs: 0.5},
    {startDelayMs: 30_001}, {startDelayMs: -1}, {capture}, {generation}, {acceptedAtMs: at}]) {
    invalid(control({...base, ...patch}));
  }
  const {expectedRevision, ...startWork} = base;
  valid(work({...startWork, generation}));
  invalid(work(startWork));
  for (const transport of [{action: 'pause-show'}, {action: 'resume-show'}, {action: 'seek-show', positionMs: 700}]) {
    valid(control({requestId: 'show-control', expectedRevision, generation, ...transport}));
    invalid(control({requestId: 'show-control', expectedRevision, ...transport}));
    valid(work({requestId: 'show-work', generation, ...transport}));
  }
  valid(control({requestId: 'show-stop', expectedRevision, generation, action: 'stop'}));
  invalid(control({requestId: 'show-seek', expectedRevision, generation, action: 'seek-show'}));
  invalid(work({requestId: 'show-pause', generation, action: 'pause-show', positionMs: 0}));
});

test('prepared session records and endings carry bounded scheduling evidence', () => {
  const show = {showId: 'show-almond', version: 2, positionMs: 350, missedCues: 256};
  const paused = {generation, status: 'paused', show};
  const session = {...paused, operationId: 'show-pause', startedAtMs: at};
  valid(state({id: 'lines', revision: 4, session, last: null}));
  valid(device({id: 'lines', revision: 5, session: paused}));
  invalid(state({id: 'lines', revision: 4, session: {...session, capture, presetId: 'preset-warm'}, last: null}));
  invalid(device({id: 'lines', revision: 5, session: {generation, status: 'paused'}}));
  invalid(device({id: 'lines', revision: 5, session: {...paused, show: {...show, missedCues: 257}}}));
  const ended = {generation, reason: 'completed', restoration: 'restored', atMs: at, missedCues: 256};
  valid(device({id: 'lines', revision: 6, session: {generation, status: 'ended', ended}}));
  valid(state({id: 'lines', revision: 6, session: {status: 'idle'}, last: ended}));
  invalid(state({id: 'lines', revision: 6, session: {status: 'idle'}, last: {...ended, missedCues: -1}}));
});
