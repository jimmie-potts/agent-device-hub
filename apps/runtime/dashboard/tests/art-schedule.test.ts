import assert from 'node:assert/strict';
import test from 'node:test';
import type {ArtSchedulePolicy} from '@jimmie-potts/event-contracts/v2/art-schedule';
import {artMinute, artTimeInput, sameArtPolicy, saveArtSchedule} from '../src/art-schedule-client.ts';
const policy: ArtSchedulePolicy = {enabled: false, wakingStartMinute: 480, wakingEndMinute: 1320, appearances: 7, targets: ['desk', 'sign'], browser: true,
  ambient: true, generation: false, weather: false, coversStatus: false};
void test('art waking input preserves midnight and overnight choices and rejects ambiguous clock input', () => {
  for (const minute of [0, 1, 480, 1320, 1439]) assert.equal(artMinute(artTimeInput(minute)), minute);
  for (const text of ['', '8:00', '24:00', '12:60', '08:00Z', '-1:00']) assert.equal(artMinute(text), undefined);
  assert.equal(sameArtPolicy(policy, {...policy, targets: ['sign', 'desk']}), true);
  for (const changed of [{...policy, enabled: true}, {...policy, targets: ['desk']}, {...policy, weather: true}, {...policy, wakingStartMinute: 1320, wakingEndMinute: 480}])
    assert.equal(sameArtPolicy(policy, changed), false);
});
void test('art policy write sends one bounded revisioned request with the existing mutation guard', async context => {
  const writes: {url: string; init: RequestInit | undefined}[] = [];
  context.mock.method(globalThis, 'fetch', (url: string, init?: RequestInit) => {
    writes.push({url, init});return Promise.resolve(new Response(JSON.stringify({schema: 'art-schedule/2.0', id: 'art', settingsRevision: 5})));
  });
  assert.deepEqual(await saveArtSchedule({expectedSettingsRevision: 4, policy}), {kind: 'acknowledged', settingsRevision: 5});
  assert.equal(writes.length, 1);assert.equal(writes[0]?.url, '/api/v2/automation/art');
  assert.equal(writes[0]?.init?.method, 'PUT');assert.equal(new Headers(writes[0]?.init?.headers).get('bunny-request'), '1');
  const body = writes[0]?.init?.body;assert.ok(typeof body === 'string');
  assert.deepEqual(JSON.parse(body), {expectedSettingsRevision: 4, policy});
});
void test('lost, malformed and mismatched art saves remain uncertain and never retry', async context => {
  let calls = 0;let reply: unknown;
  context.mock.method(globalThis, 'fetch', () => {calls++;return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(new Response(JSON.stringify(reply)));});
  for (reply of [new Error('lost'), null, {}, {schema: 'art-schedule/2.0', id: 'other', settingsRevision: 5},
    {schema: 'art-schedule/2.0', id: 'art', settingsRevision: 4}, {schema: 'art-schedule/2.0', id: 'art', settingsRevision: 6}]) {
    const before = calls;assert.deepEqual(await saveArtSchedule({expectedSettingsRevision: 4, policy}), {kind: 'uncertain'});assert.equal(calls, before + 1);
  }
});
void test('a stale art edit is a conflict, while unknown server effects remain uncertain', async context => {
  let code = 'revision-conflict';let calls = 0;
  context.mock.method(globalThis, 'fetch', () => {calls++;return Promise.resolve(new Response(JSON.stringify({error: {code, retryable: false}}), {status: 409}));});
  assert.deepEqual(await saveArtSchedule({expectedSettingsRevision: 4, policy}), {kind: 'refused', code: 'revision-conflict'});
  code = 'uncertain-result';assert.deepEqual(await saveArtSchedule({expectedSettingsRevision: 4, policy}), {kind: 'uncertain'});
  code = 'internal';assert.deepEqual(await saveArtSchedule({expectedSettingsRevision: 4, policy}), {kind: 'uncertain'});
  assert.equal(calls, 3);
});
