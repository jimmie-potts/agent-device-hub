import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyHistoryFilters, historyFace, historyQuery, historyRows, selectedHistory, type HistoryRow} from '../src/timeline-model.ts';
import {createHistoryReader, type HistorySnapshot} from '../src/timeline-read.ts';
const row = (record: Record<string, unknown>, other: Partial<HistoryRow> = {}): HistoryRow => ({seq: 1, atMs: 1000, kind: 'operation', source: 'bunny/parts/dashboard', subject: 'lamp', type: 'org.bunny.power.set.requested', requestId: 'r1', record, ...other});

void test('operation labels preserve requested, accepted, transmitted, observed, failed and uncertain evidence', () => {
  for (const [record, expected] of [
    [{status: 'sent'}, 'Power · requested'], [{status: 'accepted'}, 'Power · accepted'],
    [{status: 'completed', result: 'succeeded', evidence: 'transmitted'}, 'Power · transmitted'],
    [{status: 'completed', result: 'succeeded', evidence: 'observed'}, 'Power · observed'],
    [{status: 'completed', result: 'succeeded', evidence: 'none'}, 'Power · succeeded'],
    [{result: 'failed', evidence: 'none'}, 'Power · failed'], [{result: 'uncertain'}, 'Power · uncertain'],
    [{status: 'expired', result: 'failed', evidence: 'none'}, 'Power · expired'], [{status: 'conflict'}, 'Power · conflicting results'],
  ] as const) assert.equal(historyFace(row(record)).title, expected);
  assert.match(historyFace(row({status: 'sent'})).detail, /Completion is not established/);
  assert.match(historyFace(row({result: 'uncertain'})).detail, /effect is unknown/);
  assert.equal(historyFace(row({data: {result: 'succeeded', evidence: 'observed'}}, {kind: 'outcome', type: 'org.bunny.command.completed'})).title, 'Result · observed');
});

void test('compact changes never reconstruct unrecorded state and unknown types keep neutral evidence', () => {
  const face = historyFace(row({family: 'device', changed: {label: 'Desk lamp'}}, {kind: 'change'}));
  assert.equal(face.title, 'Device updated');assert.equal(face.context, 'Desk lamp · Devices');assert.match(face.detail, /changed fields only/);
  const unknown = historyFace(row({anything: true}, {kind: 'occurrence', type: 'new.event'}));
  assert.equal(unknown.title, 'Event recorded');assert.match(unknown.context, /lamp/);
  const remaining = historyFace(row({family: 'session', previous: 7, changed: {attention: [{kind: 'input', id: {status: 'known', id: 'remaining'}}]}}, {kind: 'change'}));
  assert.equal(remaining.title, 'Attention updated', 'the whole replacement array does not prove another request');
  assert.equal(historyFace(row({data: {}}, {kind: 'occurrence', type: 'org.bunny.attention.raised'})).title, 'Attention requested');
});

void test('categories and stable newest-first ordering preserve unknown Hub records in All', () => {
  const rows = [row({family: 'session'}, {seq: 2, kind: 'change'}), row({kind: 'device'}, {seq: 3}), row({}, {seq: 4, type: 'org.bunny.mode.set.requested'}), row({}, {seq: 1, atMs: 2000})];
  assert.deepEqual(selectedHistory(rows, 'All').map(value => value.seq), [1, 4, 3, 2]);
  assert.deepEqual(selectedHistory(rows, 'Agents').map(value => value.seq), [2]);
  assert.deepEqual(selectedHistory(rows, 'Devices').map(value => value.seq), [3]);
  assert.deepEqual(selectedHistory(rows, 'Automation').map(value => value.seq), [4]);
  assert.deepEqual(rows.map(value => value.seq), [2, 3, 4, 1]);
});

void test('whole-reply validation refuses malformed records and duplicate identities', () => {
  assert.deepEqual(historyRows({rows: [row({})]}), [row({})]);assert.deepEqual(historyRows({rows: []}), []);
  for (const value of [{}, {rows: null}, {rows: [row({}), row({})]}, {rows: [row({}, {atMs: NaN})]}, {rows: [row({}, {kind: 'fake'})]}, {rows: [{...row({}), record: null}]}, {rows: [{...row({}), requestId: 5}]}]) assert.equal(historyRows(value), undefined);
});

void test('quick date ranges use calendar boundaries and preserve exact filters', () => {
  const filters = {...emptyHistoryFilters(), kind: 'operation', source: 'bunny/parts/dashboard', session: 'session_1'};
  const now = new Date(2026, 9, 23, 15, 20);
  const today = new URLSearchParams(historyQuery('today', filters, now).slice(1));
  assert.equal(today.get('fromAtMs'), String(new Date(2026, 9, 23).getTime()));
  assert.equal(today.get('toAtMs'), String(new Date(2026, 9, 24).getTime() - 1));
  assert.equal(today.get('session'), 'session_1');
  const yesterday = new URLSearchParams(historyQuery('yesterday', filters, now).slice(1));
  assert.equal(yesterday.get('fromAtMs'), String(new Date(2026, 9, 22).getTime()));
  assert.equal(historyQuery('recent', emptyHistoryFilters()), '');
  assert.throws(() => historyQuery('custom', {...filters, from: '2026-10-24', to: '2026-10-22'}));
});

void test('Today spans the actual local daylight-saving day', () => {
  const previous = process.env.TZ;process.env.TZ = 'America/New_York';
  try {
    for (const [month, day, hours] of [[2, 8, 23], [10, 1, 25]] as const) {
      const query = new URLSearchParams(historyQuery('today', emptyHistoryFilters(), new Date(2026, month, day, 12)).slice(1));
      assert.equal(Number(query.get('toAtMs')) + 1 - Number(query.get('fromAtMs')), hours * 3_600_000);
    }
  } finally {if (previous === undefined) delete process.env.TZ;else process.env.TZ = previous;}
});

void test('latest read wins even when obsolete response ignores cancellation; disposal aborts without publishing', async () => {
  const pending: {signal: AbortSignal; resolve: (value: {ok: boolean; json: () => Promise<unknown>}) => void}[] = [], states: HistorySnapshot[] = [];
  const reader = createHistoryReader((_query, signal) => new Promise(resolve => {pending.push({signal, resolve});}), state => {states.push(state);});
  const old = reader.read('old'), latest = reader.read('latest');
  assert.equal(pending[0]?.signal.aborted, true);
  pending[1]?.resolve({ok: true, json: () => Promise.resolve({rows: [row({})]})});await latest;
  pending[0]?.resolve({ok: false, json: () => Promise.resolve({})});await old;
  assert.equal(states.at(-1)?.phase, 'ready');assert.equal(states.at(-1)?.rows.length, 1);
  const after = reader.read('empty');pending[2]?.resolve({ok: true, json: () => Promise.resolve({rows: []})});await after;
  assert.equal(states.at(-1)?.rows.length, 0);
  const unmounted = reader.read('unmount');reader.dispose();const count = states.length;
  assert.equal(pending[3]?.signal.aborted, true);pending[3]?.resolve({ok: true, json: () => Promise.resolve({rows: [row({})]})});await unmounted;
  assert.equal(states.length, count);await reader.read('after-disposal');assert.equal(pending.length, 4);
});

void test('failed and malformed reads retain last-good rows with unavailable status and explicit retry only', async () => {
  let count = 0;const states: HistorySnapshot[] = [];
  const reader = createHistoryReader(() => {
    count++;if (count === 3) return Promise.reject(new Error('offline'));
    return Promise.resolve({ok: true, json: () => Promise.resolve(count === 1 ? {rows: [row({})]} : {rows: [{}]})});
  }, state => {states.push(state);});
  await reader.read('');await reader.read('');
  assert.equal(states.at(-1)?.phase, 'unavailable');assert.equal(states.at(-1)?.rows.length, 1);
  await reader.read('');assert.equal(states.at(-1)?.phase, 'unavailable');assert.equal(count, 3);reader.dispose();
});

void test('history refusals retain only known safe codes, never raw gateway details', async () => {
  let latest: HistorySnapshot | undefined, code = 'invalid-request';
  const reader = createHistoryReader(() => Promise.resolve({ok: false, json: () => Promise.resolve({error: {code, detail: 'private raw detail'}})}), state => {latest = state;});
  for (const safe of ['invalid-request', 'unauthenticated', 'forbidden', 'unavailable', 'internal', 'too-large']) {
    code = safe;await reader.read('');assert.equal(latest?.errorCode, safe);assert(!JSON.stringify(latest).includes('private raw detail'));
  }
  code = 'private-unrecognized-error';await reader.read('');assert.equal(latest?.errorCode, undefined);reader.dispose();
});
