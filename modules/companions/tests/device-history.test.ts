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
});

void test('history pages freeze their evidence and recheck scope and grants on every page', () => {
  let reads = 0;
  const pages = new DeviceHistoryPages(() => query => {
    reads += 1;
    const snapshot: DeviceHistorySnapshot = {schema: DEVICE_HISTORY_VERSION, query, boundary: reads,
      complete: true, durations: {on: 50, off: 25, unknown: 25}, lastChange: null,
      causes: [{requestId: 'private-operation', observationSeq: 0, outcomeSeq: 1, sentSeq: 0}],
      evidence: Array.from({length: 30}, (_, seq) => ({seq, messageId: null, atMs: seq, confirmedThroughMs: seq + 1,
        kind: 'observation', power: 'on'}))};
    return snapshot;
  });
  const scope = {taskId: 'task-a', destination: 'synthetic', now: 100, timeZone: 'UTC'};
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
