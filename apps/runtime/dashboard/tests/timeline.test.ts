import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyHistoryFilters, historyFace, historyOpen, historyQuery, historyRows, lengthOf, openSpans, recordedAt, selectedHistory, type HistoryOpenSpan, type HistoryRow} from '../src/timeline-model.ts';
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
  assert.equal(historyQuery('recent', emptyHistoryFilters()), '?limit=200');
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

void test('every Timeline period and exact filter query requests at most 200 matching records', () => {
  for (const period of ['today', 'yesterday', 'recent', 'custom'] as const) {
    for (const filters of [emptyHistoryFilters(), {...emptyHistoryFilters(), source: 'bunny/modules/lifx', kind: 'operation', session: 'session_1', from: '2026-10-20', to: '2026-10-22'}]) {
      const query = new URLSearchParams(historyQuery(period, filters).slice(1));
      assert.deepEqual(query.getAll('limit'), ['200'], period);
      if (filters.source !== '') assert.equal(query.get('source'), filters.source);
    }
  }
});

// Spans, gaps, closing rows and open spans (#1773). Instants are fixed, and `at` writes them as offsets so no test
// depends on the viewer's zone or on the current time.
const T = Date.UTC(2026, 10, 12, 9);
const at = (atMs: number): string => `@${(atMs - T) / 60_000}m`;
const H = 3_600_000, M = 60_000;
const change = (record: Record<string, unknown>, other: Partial<HistoryRow> = {}): HistoryRow => row({family: 'device', id: 'desk-lamp', revision: 7, previous: 3, changed: {label: 'Desk lamp'}, removed: [], ...record},
  {kind: 'change', source: 'bunny/modules/wemo', type: 'org.bunny.device.updated', subject: 'desk-lamp', requestId: null, atMs: T, ...other});
const lampSpan = (span: Partial<HistoryOpenSpan> = {}): HistoryOpenSpan => ({source: 'bunny/modules/wemo', family: 'device', id: 'desk-lamp', revision: 7, sinceAtMs: T, lastConfirmedAtMs: T + 2 * H, confirmations: 12, ...span});

void test('a row without a span, a gap, a closing mark or an open span reads exactly as before', () => {
  const expected = {title: 'Device updated', context: 'Desk lamp · wemo', detail: 'This entry contains changed fields only; missing fields have no new evidence.', category: 'Devices', warning: false};
  assert.deepEqual(historyFace(change({})), expected);
  assert.deepEqual(historyFace(change({}), undefined, at), expected);
  assert.deepEqual(historyFace(row({status: 'sent'}), lampSpan(), at), historyFace(row({status: 'sent'})), 'an open span never changes a row that is not a change');
});

void test('a change row says how long the previous state held and how many readings confirmed it', () => {
  const face = historyFace(change({span: {sinceAtMs: T - 4 * H - 29 * M, lastConfirmedAtMs: T, confirmations: 3300}}), undefined, at);
  assert.equal(face.title, 'Device updated');
  assert.deepEqual(face.notes, ['After 4 h 29 min unchanged, 3,300 readings']);
  assert.match(face.detail, /changed fields only/);
  for (const [span, note] of [
    [{sinceAtMs: null, lastConfirmedAtMs: T - M, confirmations: 12}, 'After 12 readings unchanged from an unknown start, the last at @-1m'],
    [{sinceAtMs: null, lastConfirmedAtMs: T - M, confirmations: 1}, 'After 1 reading unchanged from an unknown start, the last at @-1m'],
    [{sinceAtMs: T - M, lastConfirmedAtMs: T - 2 * M, confirmations: 2}, 'After 2 readings unchanged; the recorded times run backward, so no length is shown'],
    [{sinceAtMs: T - 2000, lastConfirmedAtMs: T - 1500, confirmations: 2}, 'After less than 1 s unchanged, 2 readings'],
    [{sinceAtMs: T - 400 * 24 * H, lastConfirmedAtMs: T - 2 * H, confirmations: 1_234_567}, 'After 399 d 22 h unchanged, 1,234,567 readings'],
  ] as const) assert.deepEqual(historyFace(change({span}), undefined, at).notes, [note], JSON.stringify(span));
  for (const span of [{sinceAtMs: 'yesterday', lastConfirmedAtMs: T, confirmations: 2}, {sinceAtMs: T, lastConfirmedAtMs: T, confirmations: 0}, {sinceAtMs: T, confirmations: 2}, 'span']) {
    assert.equal(historyFace(change({span}), undefined, at).notes, undefined, `a malformed span reads as no span: ${JSON.stringify(span)}`);
  }
});

void test('a gap row says readings stopped and resumed by the recorded times, and not why', () => {
  const face = historyFace(change({changed: {observed: {observedAtMs: T}}, gapMs: H + 12 * M, span: {sinceAtMs: T - 3 * H, lastConfirmedAtMs: T - H - 12 * M, confirmations: 40}}), undefined, at);
  assert.equal(face.title, 'Readings resumed');
  assert.deepEqual(face.notes, ['After 1 h 48 min unchanged, 40 readings', 'No reading for 1 h 12 min, then the same state']);
  assert.equal(face.detail, 'The recorded times show readings stopped and resumed. This entry does not say why.');
  assert.equal(face.category, 'Devices');
  assert.deepEqual(historyFace(change({gapMs: 121_000}), undefined, at).notes, ['No reading for 2 min, then the same state'], 'a gap row without a span');
  assert.equal(historyFace(change({gapMs: -5}), undefined, at).title, 'Device updated', 'a gap is never negative');
});

void test('a closing row says it closes the readings before a removal and changes nothing; the removal row after it reads as before', () => {
  const closing = change({changed: {}, previous: 7, closedBy: 'removal', span: {sinceAtMs: T - 4 * H - 29 * M, lastConfirmedAtMs: T - M, confirmations: 3300}}, {seq: 2});
  const face = historyFace(closing, undefined, at);
  assert.equal(face.title, 'Last readings before removal');
  assert.deepEqual(face.notes, ['4 h 28 min unchanged, 3,300 readings']);
  assert.equal(face.detail, 'This entry closes the readings that held the same state before the record was removed. It changes nothing.');
  const removed = row({data: {entity: {family: 'device', id: 'desk-lamp'}, revision: 8}}, {seq: 3, kind: 'removal', atMs: T, type: 'org.bunny.device.removed'});
  assert.equal(historyFace(removed).title, 'Record removed');
  assert.equal(openSpans([closing, removed], []).byRow.size, 0);
  assert.deepEqual(historyFace(change({closedBy: 'removal', span: {sinceAtMs: null, lastConfirmedAtMs: T - M, confirmations: 4}}), undefined, at).notes, ['4 readings unchanged from an unknown start, the last at @-1m']);
});

void test('the newest row of an entity with an open span says since when it is unchanged and its last reading time, never now', () => {
  const newest = change({span: {sinceAtMs: T - H, lastConfirmedAtMs: T - M, confirmations: 720}}, {seq: 5}), older = change({revision: 5}, {seq: 4, atMs: T - H});
  const shown = openSpans([older, newest], [lampSpan()]).byRow;
  assert.deepEqual([...shown.keys()], [5]);
  const face = historyFace(newest, shown.get(5), at);
  assert.deepEqual(face.notes, ['After 59 min unchanged, 720 readings', 'Unchanged since @0m, last reading at @120m, 12 readings']);
  assert.ok(face.notes?.every(note => !/\bnow\b/i.test(note)));
  assert.match(historyFace(newest, lampSpan()).notes?.at(-1) ?? '', /^Unchanged since .+, last reading at .+, 12 readings$/, 'the default writes recorded instants');
  // The span continues only the row it was written against.
  assert.equal(openSpans([older], [lampSpan()]).byRow.size, 0, 'not on an older row at another revision');
  assert.equal(openSpans([newest], [lampSpan({sinceAtMs: T + 1})]).byRow.size, 0, 'not on a row at the same revision but another instant, as a later gap row');
  assert.equal(openSpans([newest], [lampSpan({id: 'fan'})]).byRow.size, 0, 'not on another entity');
  assert.equal(openSpans([newest, change({revision: 9}, {seq: 6, atMs: T + H})], [lampSpan()]).byRow.size, 0, 'not when a newer row of the entity is in the page');
});

void test('an open span with backward recorded times keeps both instants and reports no duration', () => {
  const face = historyFace(change({}), lampSpan({lastConfirmedAtMs: T - M, confirmations: 2}), at);
  assert.deepEqual(face.notes, ['First reading at @0m, last reading at @-1m, 2 readings. The recorded times run backward.']);
});

void test('an unknown-start span cannot be attached to either legacy row at the same revision', () => {
  const older = change({}, {seq: 4, atMs: T - H});
  const newer = change({}, {seq: 5});
  const open = [lampSpan({sinceAtMs: null})];
  const full = openSpans([older, newer], open);
  const filtered = openSpans([older], open, 'Devices');
  assert.equal(full.byRow.size, 0, 'the full page does not identify its starting row');
  assert.equal(filtered.byRow.size, 0, 'a date filter cannot attach it to the older row');
  assert.deepEqual(filtered.unknownStarts, full.unknownStarts);
  assert.deepEqual(filtered.unknownStarts.map(({context, note}) => ({context, note})), [{
    context: 'Desk lamp · wemo · device', note: `Unchanged from an unknown start, last reading at ${recordedAt(T + 2 * H)}, 12 readings`,
  }]);
  assert.deepEqual(openSpans([older], open, 'Agents').unknownStarts, []);
  assert.deepEqual(openSpans([], open).unknownStarts, []);
});

void test('unknown starts identify separate families with the same source, ID and label', () => {
  const device = change({});
  const display = change({family: 'display'}, {seq: device.seq + 1});
  const spans = [lampSpan({sinceAtMs: null}), lampSpan({family: 'display', sinceAtMs: null})];
  const {unknownStarts} = openSpans([device, display], spans, 'Devices');
  assert.deepEqual(unknownStarts.map(entry => entry.context), ['Desk lamp · wemo · device', 'Desk lamp · wemo · display']);
});

void test('unknown starts distinguish entities with the same visible label and family', () => {
  const first = change({});
  const second = change({id: 'shelf-lamp'}, {seq: first.seq + 1, subject: 'shelf-lamp'});
  const spans = [lampSpan({sinceAtMs: null}), lampSpan({id: 'shelf-lamp', sinceAtMs: null})];
  const {unknownStarts} = openSpans([first, second], spans, 'Devices');
  assert.deepEqual(unknownStarts.map(entry => entry.context), [
    'Desk lamp · wemo · device (bunny/modules/wemo, desk-lamp)',
    'Desk lamp · wemo · device (bunny/modules/wemo, shelf-lamp)',
  ]);
});

void test('lengths and counts use short units and plural forms', () => {
  for (const [ms, expected] of [[0, 'less than 1 s'], [999, 'less than 1 s'], [1000, '1 s'], [59_999, '59 s'], [60_000, '1 min'], [H - 1, '59 min'], [H, '1 h'], [H + M, '1 h 1 min'],
    [24 * H - 1, '23 h 59 min'], [24 * H, '1 d'], [26 * H, '1 d 2 h'], [400 * 24 * H + 2 * H + 59 * M, '400 d 2 h']] as const) assert.equal(lengthOf(ms), expected, String(ms));
});

void test('the optional open member is read whole or not at all, and an old reply reads as before', async () => {
  const reply = {schema: 'history/2.0', rows: [change({})], open: [lampSpan()]};
  assert.deepEqual(historyRows(reply), [change({})], 'rows read the same with or without open');
  assert.deepEqual(historyOpen(reply), [lampSpan()]);
  assert.deepEqual(historyOpen({rows: []}), []);
  for (const open of [null, 'x', [{...lampSpan(), confirmations: 0}], [{...lampSpan(), sinceAtMs: -1}], [lampSpan(), {}], [{...lampSpan(), revision: '7'}]]) assert.deepEqual(historyOpen({rows: [], open}), [], JSON.stringify(open));
  const states: HistorySnapshot[] = [];
  let answer: unknown = reply;
  const reader = createHistoryReader(() => Promise.resolve({ok: true, json: () => Promise.resolve(answer)}), state => {states.push(state);});
  await reader.read('');assert.deepEqual(states.at(-1)?.open, [lampSpan()]);
  answer = {schema: 'history/2.0', rows: [change({})]};
  await reader.read('');assert.equal(Object.hasOwn(states.at(-1) ?? {}, 'open'), false, 'a reply without open makes the snapshot it made before');
  reader.dispose();
});
