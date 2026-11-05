import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';
import {registerArtStateFamily} from '../dist/v2/art-state.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8'));
const validator = new MessageValidator(); registerCoreFamilies(validator); registerArtStateFamily(validator);
const compositionId = 'b'.repeat(64);
const automatic = data => ({...structuredClone(fixtures.valid['art-auto']), dataschema: 'https://bunny.invalid/events/art-auto/2.1', data});
const check = message => validator.validate(message, {nowMs: Date.parse(message.time)});
const valid = message => {const result = check(message); assert.equal(result.ok, true, JSON.stringify(result));};
const invalid = message => assert.equal(check(message).ok, false, JSON.stringify(message.data));
const prepare = {requestId: 'prepare-1', action: 'prepare', artworkId: 'art-1', compositionId, target: 'desk-display'};
const present = {requestId: 'present-1', action: 'present', artworkId: 'art-1', compositionId};
const provider = name => ({provider: name, available: false, ceilingMicros: 1, paceMicros: 1, spentMicros: 0,
  reservedMicros: 0, uncertainMicros: 0, remainingMicros: 1, todayMicros: 0, excessMicros: 0, earlierUncertainMicros: 0});
const state20 = () => ({id: 'art', revision: 1, month: '2026-11', day: '2026-11-05', providers: [provider('openai'), provider('anthropic')],
  guard: {calls: 0, limit: 30, windowMs: 3_600_000}, gifs: {accepted: 0, rejected: 0}, jobs: [], artworks: [], candidates: [],
  retention: {recentLimit: 200, recent: 0, favorites: 0, retained: []}});
const state = data => ({...structuredClone(fixtures.valid['assistant-state']), source: 'bunny/modules/art',
  type: 'org.bunny.art.updated', subject: 'art', dataschema: 'https://bunny.invalid/events/art/2.1', data});

test('saved-art 2.1 admits exact preparation and browser selection beside unchanged automatic start', () => {
  valid(automatic(prepare));
  valid(automatic(present));
  valid(automatic(fixtures.valid['art-auto'].data));
  valid(fixtures.valid['art-auto']);
  invalid({...automatic(prepare), dataschema: 'https://bunny.invalid/events/art-auto/2.0'});
  invalid({...automatic(present), dataschema: 'https://bunny.invalid/events/art-auto/2.0'});
});

test('saved-art 2.1 closes target, identity and action metadata', () => {
  for (const body of [
    {...prepare, target: 'Desk Display'}, {...prepare, compositionId: 'unknown'}, {...prepare, artworkId: '../private'},
    {...present, target: 'desk-display'}, {...present, action: 'cancel'}, {...present, compositionId: null},
    {...prepare, text: 'another generation'}, {...prepare, location: 'private'}, {...prepare, token: 'secret'},
  ]) invalid(automatic(body));
  for (const key of ['artworkId', 'compositionId', 'target']) {
    const body = {...prepare}; delete body[key]; invalid(automatic(body));
  }
  invalid({...automatic(prepare), subject: 'desk-display'});
});

test('art 2.1 publishes a nullable selection independently of the recent catalog page', () => {
  valid(state({...state20(), selection: {artworkId: 'older-art', compositionId}}));
  valid(state({...state20(), selection: null}));
  valid({...state(state20()), dataschema: 'https://bunny.invalid/events/art/2.0'});
  invalid({...state({...state20(), selection: null}), dataschema: 'https://bunny.invalid/events/art/2.0'});
});

test('art 2.1 requires a closed reference and carries no selected media or private metadata', () => {
  invalid(state(state20()));
  for (const selection of [{artworkId: 'older-art'}, {artworkId: 'older-art', compositionId: 'bad'},
    {artworkId: 'older-art', compositionId, base64: 'AAAA'}, {artworkId: 'older-art', compositionId, palette: ['#FFFFFF']},
    {artworkId: 'older-art', compositionId, path: '/private/image'}]) invalid(state({...state20(), selection}));
});
