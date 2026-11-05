import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';
import {commandSupported, registerDeviceFamilies} from '../dist/v2/devices.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8'));
const devices = JSON.parse(readFileSync(new URL('../fixtures/v2/devices.json', import.meta.url), 'utf8'));
const validator = new MessageValidator(); registerCoreFamilies(validator); registerDeviceFamilies(validator);
const base = structuredClone(fixtures.valid['moment-play']);
const now = Date.parse(base.time), compositionId = 'b'.repeat(64);
const notice = {kind: 'rain-forecast', likelihood: 'chance', forecastStartAtMs: now + 3_600_000,
  forecastEndAtMs: now + 7_200_000, forecastUpdatedAtMs: now - 60_000,
  observedAtMs: now - 1000, staleAtMs: now + 2_699_000, weatherRevision: 3};
const moment = (data = {}) => ({...structuredClone(base), dataschema: 'https://bunny.invalid/events/moment-play/2.2',
  data: {...base.data, startAtMs: now + 1000, durationMs: 30_000, toleranceMs: 1000, art: {compositionId}, notice, ...data}});
const check = message => validator.validate(message, {nowMs: Date.parse(message.time)});
const valid = message => {const result = check(message); assert.equal(result.ok, true, JSON.stringify(result));};
const invalid = message => assert.equal(check(message).ok, false, JSON.stringify(message.data));
const automatic = data => ({...structuredClone(fixtures.valid['art-auto']), dataschema: 'https://bunny.invalid/events/art-auto/2.2', data});
const ambient = {requestId: 'ambient-1', action: 'ambient', artworkId: 'art-1', compositionId, target: 'desk-display', authorization: 'opportunity-1'};

test('rain notice uses the closed new minor and keeps old art and plain moments unchanged', () => {
  valid(moment());
  valid({...moment(), data: {...base.data, art: {compositionId}}});
  valid(base);
  invalid({...moment(), dataschema: 'https://bunny.invalid/events/moment-play/2.1'});
  invalid({...moment(), dataschema: 'https://bunny.invalid/events/moment-play/2.0'});
  const withoutArt = moment(); delete withoutArt.data.art; invalid(withoutArt);
});

test('rain notice refuses free text, unsafe numbers and contradictory or exhausted evidence', () => {
  for (const change of [{text: 'private location'}, {location: 'private'}, {kind: 'meeting'}, {likelihood: 'certain'},
    {weatherRevision: -1}, {weatherRevision: 1.5}, {observedAtMs: now + 1}, {forecastUpdatedAtMs: now + 1},
    {staleAtMs: now + 31_999}, {forecastEndAtMs: notice.forecastStartAtMs},
    {forecastStartAtMs: now + 7_200_001}, {observedAtMs: Number.MAX_SAFE_INTEGER + 1}]) invalid(moment({notice: {...notice, ...change}}));
  valid(moment({notice: {...notice, staleAtMs: now + 32_000}}));
});

test('device notice capability is explicit, additive and closed', () => {
  const device = structuredClone(devices.valid['device-nanoleaf']);
  device.dataschema = 'https://bunny.invalid/events/device/2.3';
  device.data.capabilities.moments = {supported: true, moods: ['celebrate', 'setback', 'reminder'], maxDurationMs: 60_000, coversStatus: true,
    art: {formats: ['gif'], maxBytes: 163_840, notices: ['rain-forecast']}};
  valid(device);
  assert.equal(commandSupported(device.data.capabilities, {family: 'moment-play', data: moment().data}), true);
  invalid({...device, dataschema: 'https://bunny.invalid/events/device/2.2'});
  delete device.data.capabilities.moments.art.notices;
  valid(device);
  assert.equal(commandSupported(device.data.capabilities, {family: 'moment-play', data: moment().data}), false);
  assert.equal(commandSupported(device.data.capabilities, {family: 'moment-play', data: {...base.data, art: {compositionId}}}), true);
  device.data.capabilities.moments.art.notices = ['meeting']; invalid(device);
});

test('automatic starts can explicitly omit weather without changing older start contracts', () => {
  for (const weatherUse of ['current', 'omit']) valid(automatic({...fixtures.valid['art-auto'].data, weatherUse}));
  valid(automatic(fixtures.valid['art-auto'].data));
  valid(fixtures.valid['art-auto']);
  invalid({...automatic({...fixtures.valid['art-auto'].data, weatherUse: 'omit'}), dataschema: 'https://bunny.invalid/events/art-auto/2.1'});
  invalid(automatic({...fixtures.valid['art-auto'].data, weatherUse: 'calendar'}));
});

test('saved ambient admission binds exact identities and a one-use opportunity reference', () => {
  valid(automatic(ambient));
  for (const field of ['artworkId', 'compositionId', 'target', 'authorization']) {
    const data = {...ambient}; delete data[field]; invalid(automatic(data));
  }
  for (const change of [{text: 'new image'}, {weatherUse: 'current'}, {target: 'Desk Display'}, {authorization: '../grant'}]) invalid(automatic({...ambient, ...change}));
  invalid({...automatic(ambient), dataschema: 'https://bunny.invalid/events/art-auto/2.1'});
});

test('only initial ambient dispatch can carry an opportunity authorization', () => {
  const dispatch = {...structuredClone(fixtures.valid['art-dispatch']), dataschema: 'https://bunny.invalid/events/art-dispatch/2.1',
    data: {requestId: 'ambient-1', family: 'art-ambient-set', target: 'desk-display', data: {compositionId}, authorization: 'opportunity-1'}};
  valid(dispatch);
  invalid({...dispatch, dataschema: 'https://bunny.invalid/events/art-dispatch/2.0'});
  invalid({...dispatch, data: {...dispatch.data, data: {compositionId: null}}});
  const old = structuredClone(fixtures.valid['art-dispatch']); valid(old);
  invalid({...old, dataschema: dispatch.dataschema, data: {...old.data, authorization: 'opportunity-1'}});
});
