import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DEVICE_HISTORY_VERSION, type DeviceHistorySnapshot} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {DeviceHistoryPages, localYesterday} from '../src/assistant/device-history.js';

void test('local yesterday is half-open at both midnights through daylight saving changes', () => {
  const zone = 'America/New_York';
  const spring = localYesterday(Date.parse('2026-03-09T09:00:00Z'), zone);
  const fall = localYesterday(Date.parse('2026-11-02T09:00:00Z'), zone);
  assert.equal(spring.fromAtMs, Date.parse('2026-03-08T05:00:00Z'));
  assert.equal(spring.toAtMs - spring.fromAtMs, 23 * 3_600_000);
  assert.equal(fall.fromAtMs, Date.parse('2026-11-01T04:00:00Z'));
  assert.equal(fall.toAtMs - fall.fromAtMs, 25 * 3_600_000);
  const utc = localYesterday(Date.parse('2026-11-02T09:00:00Z'), 'UTC');
  assert.equal(utc.fromAtMs, Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(utc.toAtMs - utc.fromAtMs, 24 * 3_600_000);
});

void test('history pages freeze their evidence and recheck scope and grants on every page', () => {
  let reads = 0;
  const pages = new DeviceHistoryPages(() => query => {
    reads += 1;
    const snapshot: DeviceHistorySnapshot = {schema: DEVICE_HISTORY_VERSION, query, boundary: reads,
      complete: true, durations: {on: 50, off: 25, unknown: 25}, lastChange: null,
      links: [{requestId: 'private-operation', observationSeq: 0, transmissionOutcomeSeq: 1, transmittedAtMs: 0, sentSeq: 0}],
      evidence: Array.from({length: 30}, (_, seq) => ({seq, messageId: null, atMs: seq, confirmedThroughMs: seq + 1,
        kind: 'observation', power: 'on'}))};
    return snapshot;
  });
  const scope = {taskId: 'task-a', destination: 'synthetic', now: 100, requestedAtMs: 100, timeZone: 'UTC'};
  const input = {source: 'bunny/modules/wemo', target: 'fixture', period: '', fromAtMs: 0, toAtMs: 100, cursor: ''};
  const allow = () => true;
  const first = JSON.parse(pages.read(input, scope, allow)) as {next: string | null; evidence: {seq: number}[]; boundary: number};
  assert.ok(first.next !== null && first.next !== '');
  let cursor: string | null = first.next;
  assert.match(JSON.stringify(first), /private-operation/);
  assert.doesNotMatch(pages.read(input, scope, source => source !== 'operations'), /private-operation/);
  const seen = first.evidence.map(point => point.seq);
  assert.match(pages.read({...input, cursor}, {...scope, taskId: 'task-b'}, allow), /revision-conflict/);
  assert.match(pages.read({...input, cursor}, {...scope, destination: 'anthropic'}, allow), /revision-conflict/);
  assert.match(pages.read({...input, toAtMs: 90, cursor}, scope, allow), /revision-conflict/);
  assert.match(pages.read({...input, cursor}, scope, () => false), /forbidden/);
  assert.match(new DeviceHistoryPages(() => undefined).read({...input, cursor}, scope, allow), /start a fresh history read/);
  while (cursor !== null) {
    const page = JSON.parse(pages.read({...input, cursor}, scope, allow)) as typeof first;
    assert.equal(page.boundary, first.boundary);
    seen.push(...page.evidence.map(point => point.seq));
    cursor = page.next;
  }
  assert.deepEqual(seen, Array.from({length: 30}, (_, index) => index));
  assert.equal(reads, 2, 'another authorized request takes its own snapshot, while paging never rereads');
});

void test('relative history paging keeps the owner request date across midnight', () => {
  const pages = new DeviceHistoryPages(() => query => ({
    schema: DEVICE_HISTORY_VERSION, query, boundary: 13, complete: true, durations: {on: 0, off: 0, unknown: query.toAtMs - query.fromAtMs},
    lastChange: null, links: [],
    evidence: Array.from({length: 13}, (_, seq) => ({seq, messageId: null, atMs: query.fromAtMs + seq,
      confirmedThroughMs: query.fromAtMs + seq, kind: 'observation', power: 'on'})),
  }));
  const requestedAtMs = Date.parse('2026-11-02T04:59:00Z');
  const scope = {taskId: 'task-a', destination: 'anthropic', now: requestedAtMs, requestedAtMs, timeZone: 'America/New_York'};
  const input = {source: 'bunny/modules/wemo', target: 'fixture', period: 'yesterday', fromAtMs: 0, toAtMs: 0, cursor: ''};
  const first = JSON.parse(pages.read(input, scope, () => true)) as {query: {fromAtMs: number; toAtMs: number}; next: string | null};
  assert.equal(first.query.fromAtMs, Date.parse('2026-10-31T04:00:00Z'));
  assert.ok(first.next !== null && first.next !== '');
  const second = JSON.parse(pages.read({...input, cursor: first.next}, {...scope, now: requestedAtMs + 120_000}, () => true)) as typeof first;
  assert.deepEqual(second.query, first.query);
  assert.equal(second.next, null);
});

void test('owner-bound pages refuse model-selected bounds, omit unrelated metadata and keep the owner request identity', () => {
  const requestedAtMs = Date.parse('2026-11-02T04:59:00Z');
  const interval = {fromAtMs: Date.parse('2026-10-31T04:00:00Z'), toAtMs: Date.parse('2026-11-01T04:00:00Z')};
  const source = 'bunny/modules/wemo', target = 'fixture';
  let reads = 0;
  const pages = new DeviceHistoryPages(() => query => {
    reads += 1;
    return {schema: DEVICE_HISTORY_VERSION, query, boundary: 17, complete: false,
      durations: {on: 8, off: 0, unknown: query.toAtMs - query.fromAtMs - 8}, lastChange: null,
      evidence: Array.from({length: 13}, (_, seq) => ({seq, messageId: 'PRIVATE_RECORD', atMs: query.fromAtMs + seq,
        confirmedThroughMs: query.fromAtMs + seq, kind: 'observation', power: 'on'})),
      links: [{requestId: 'PRIVATE_OPERATION', observationSeq: 1, sentAtMs: query.fromAtMs, transmittedAtMs: query.fromAtMs, sentSeq: 1, transmissionOutcomeSeq: 1}]};
  });
  const scope = {taskId: 'task-a', destination: 'anthropic', now: requestedAtMs, requestedAtMs, timeZone: 'America/New_York',
    bound: {requestId: 'owner-a', history: {query: {source, target, ...interval}, kind: 'durations', yesterday: true}}} as const;
  const general = {taskId: scope.taskId, destination: scope.destination, now: scope.now, requestedAtMs, timeZone: scope.timeZone};
  const exact = {source, target, period: '', ...interval, cursor: ''};
  for (const altered of [{...exact, target: 'foreign'}, {...exact, source: 'bunny/modules/lifx'},
    {...exact, fromAtMs: exact.fromAtMs + 1}]) assert.match(pages.read(altered, scope, () => true), /forbidden/u);
  assert.equal(reads, 0);
  const empty = {source: '', target: '', period: '', fromAtMs: 0, toAtMs: 0, cursor: ''};
  const first = pages.read(empty, scope, () => true);
  assert.doesNotMatch(first, /PRIVATE_|"seq"|"links"|"boundary"/u);
  const parsed = JSON.parse(first) as {query: typeof scope.bound.history.query; next: string; evidence: unknown[]; complete: boolean};
  assert.deepEqual(parsed.query, scope.bound.history.query);
  assert.equal(parsed.complete, false);
  assert.equal(parsed.evidence.length, 12);
  const second = {...empty, cursor: parsed.next};
  assert.match(pages.read({...exact, target: 'foreign', cursor: parsed.next}, scope, () => true), /forbidden/u);
  assert.match(pages.read({...exact, cursor: parsed.next}, general, () => true), /revision-conflict/u);
  const otherOwner = {...scope, bound: {...scope.bound, requestId: 'owner-b'}};  assert.match(pages.read(second, otherOwner, () => true), /revision-conflict/u);
  assert.match(pages.read(second, scope, (_source, field) => field !== 'status'), /forbidden/u);
  const later = JSON.parse(pages.read(second, {...scope, now: requestedAtMs + 120_000}, () => true)) as typeof parsed;
  assert.deepEqual(later.query, parsed.query);
  assert.equal(later.evidence.length, 1);
  assert.equal(later.next, null);
  assert.equal(reads, 1);
  assert.doesNotMatch(pages.read(exact, general, () => true), /^refused:/u);
});
