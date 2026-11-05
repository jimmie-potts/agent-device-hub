// The art state family (Hub #680): spend per provider, recent work by reference, and nothing private or heavy.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator, SCHEMA_BASE} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';
import {ART_CATALOG_EDIT_SCHEMA, ART_CATALOG_EDIT_TYPE, ART_ID, ART_STATE_SCHEMA, ART_STATE_TYPE, artContentRef, artSchemas, registerArtStateFamily} from '../dist/v2/art-state.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8'));
const sha = 'a'.repeat(64);
const provider = name => ({provider: name, available: true, ceilingMicros: 150_000_000, paceMicros: 5_000_000, spentMicros: 3000, reservedMicros: 90_000, uncertainMicros: 0, remainingMicros: 149_907_000, todayMicros: 93_000, excessMicros: 0, earlierUncertainMicros: 0});
const data = () => ({id: 'art', revision: 3, month: '2026-11', day: '2026-11-03', providers: [provider('openai'), provider('anthropic')],
  guard: {calls: 1, limit: 30, windowMs: 3_600_000}, gifs: {accepted: 1, rejected: 0},
  jobs: [{requestId: 'req-1', purpose: 'request', admittedBy: 'owner', status: 'finished', outcome: 'partial', artworkId: 'art-1', createdAtMs: 1, finishedAtMs: 2,
    targets: [{target: 'tidbyt', outcome: 'succeeded', code: null, reason: null}, {target: 'pixoo', outcome: 'rejected', code: 'capacity', reason: 'monthly-ceiling'}]}],
  artworks: [{artworkId: 'art-1', createdAtMs: 1, favorite: false, feedback: null, variationOf: null, palette: ['#101828'], provenance: {generatedBy: 'openai', factual: false},
    compositions: [{target: 'tidbyt', compositionId: sha, outcome: 'succeeded', motion: 'gif',
      renditions: [{renditionId: sha, width: 64, height: 32, frames: 1, durationMs: 0, format: 'png', bytes: 1840, ref: artContentRef.rendition(sha)}]}]}],
  candidates: [{artworkId: 'art-1', target: 'tidbyt', compositionId: sha, favorite: false, stagedUntilMs: 9}],
  retention: {recentLimit: 200, recent: 1, favorites: 0, retained: []}});
// The envelope of a core state fixture, so this test tracks the shared envelope rather than restating it.
const message = value => ({...structuredClone(fixtures.valid['assistant-state']), source: 'bunny/modules/art', type: ART_STATE_TYPE, subject: ART_ID, dataschema: ART_STATE_SCHEMA, data: value});
const validator = new MessageValidator(); registerCoreFamilies(validator); registerArtStateFamily(validator);
const check = value => validator.validate(value, {nowMs: Date.parse(value.time)});

test('the art family carries spend per provider and recent work by reference', () => {
  assert.equal(ART_STATE_SCHEMA, `${SCHEMA_BASE}art/2.0`);
  assert.deepEqual(Object.keys(artSchemas), [ART_STATE_SCHEMA, ART_CATALOG_EDIT_SCHEMA]);
  const answer = check(message(data()));
  assert.equal(answer.ok, true, JSON.stringify(answer));
});

test('the art family refuses a prompt, image bytes, a third provider, another subject or an unvalidated palette', () => {
  const refused = (change, wrap = message) => {const value = data(); change(value); assert.equal(check(wrap(value)).ok, false, change.toString());};
  refused(value => {value.prompt = 'private text';});
  refused(value => {value.artworks[0].compositions[0].renditions[0].base64 = 'AAAA';});
  refused(value => {value.providers.push(provider('openai'));});
  refused(value => {value.providers[1].provider = 'codex';});
  refused(value => {value.artworks[0].palette = ['tomato'];});
  refused(value => {value.artworks[0].provenance.factual = true;});
  refused(value => {value.providers[0].spentMicros = 0.5;});
  refused(() => {}, value => ({...message(value), subject: 'other'}));
  refused(() => {}, value => ({...message(value), kind: 'occurrence'}));
});

test('the catalog command is closed to its four actions and starts nothing', () => {
  const command = data => ({...structuredClone(fixtures.valid['assistant-dispatch']), source: 'bunny/core', type: ART_CATALOG_EDIT_TYPE, subject: ART_ID, dataschema: ART_CATALOG_EDIT_SCHEMA, data: {requestId: 'r-1', ...data}});
  for (const good of [{action: 'favorite', artworkId: 'art-1', favorite: true}, {action: 'feedback', artworkId: 'art-1', signal: 'less'}, {action: 'delete', artworkId: 'art-1'}, {action: 'reuse', artworkId: 'art-1', target: 'pixoo'}]) {
    const answer = check(command(good));
    assert.equal(answer.ok, true, JSON.stringify(answer));
  }
  for (const bad of [{action: 'favorite', artworkId: 'art-1'}, {action: 'feedback', artworkId: 'art-1', signal: 'angry'}, {action: 'delete', artworkId: 'art-1', text: 'x'}, {action: 'reuse', artworkId: 'art-1', target: 'ui'}, {action: 'start'}]) assert.equal(check(command(bad)).ok, false, JSON.stringify(bad));
});

test('content references are valid gateway references', () => {
  for (const ref of [artContentRef.catalog, artContentRef.ledger, artContentRef.artwork('art-1'), artContentRef.rendition(sha)]) assert.match(ref, /^[A-Za-z0-9_.-]{1,128}$/);
});
