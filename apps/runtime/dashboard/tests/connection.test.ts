// The dashboard's link to the runtime (Hub #922) with a scripted participant and a manual scheduler: a refused or
// failed sync is tried again after 1 s, doubling to 30 s, while the page keeps its last records marked stale, and an
// answer that says the runtime no longer takes this browser's session ends the link with no retry.
import assert from 'node:assert/strict';
import test from 'node:test';
import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {RemoteParticipant, Scheduler, SyncChange, SyncResult} from '@jimmie-potts/sdk/remote';
import {DashboardConnection} from '../src/connection.ts';

/** Timers that run only when the test moves the clock. */
function manual(): {scheduler: Scheduler; advance: (ms: number) => Promise<void>; now: () => number} {
  let now = 0;
  const timers = new Set<{at: number; run: () => void}>();
  return {
    now: () => now,
    scheduler: {after: (delayMs, run) => {
      const timer = {at: now + delayMs, run};
      timers.add(timer);
      return () => { timers.delete(timer); };
    }},
    advance: async ms => {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at > now) break;
        timers.delete(timer);
        timer.run();
      }
      for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
    },
  };
}

const record = {id: 'b'.repeat(64), revision: 3} as SessionRecord;
const state = {kind: 'state', data: record} as Message<SessionRecord>;

/** A participant whose syncs follow `answers` in turn, `synced` or a refusal's code; it records when each sync came. */
function scripted(answers: readonly ('synced' | ErrorCode)[], at: () => number): {participant: RemoteParticipant; syncs: number[]; closed: () => boolean; fail: (code: ErrorCode) => void} {
  const syncs: number[] = [];
  let handler: ((change: SyncChange<SessionRecord>) => void) | undefined;
  let closed = false;
  const participant = {
    sync: (_families: readonly string[], handle: (change: SyncChange<SessionRecord>) => void): Promise<SyncResult<SessionRecord>> => {
      syncs.push(at());
      handler = handle;
      const answer = answers[syncs.length - 1] ?? 'unavailable';
      if (answer !== 'synced') return Promise.resolve({status: 'rejected', requestId: 'r', error: errorBody(answer, {detail: 'refused'})});
      const copy = {states: () => [state], get: () => state, close: () => Promise.resolve()};
      return Promise.resolve({status: 'synced', copy, message: {data: {requestId: 'r', revision: 3, members: []}, id: `done-${syncs.length}`}} as unknown as SyncResult<SessionRecord>);
    },
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  } as unknown as RemoteParticipant;
  return {participant, syncs, closed: () => closed, fail: code => { handler?.({type: 'failed', error: errorBody(code, {detail: 'gone'})}); }};
}

void test('a sync the core refuses is tried again after 1 s, doubling to 30 s, and the last records stay, marked stale', async () => {
  const clock = manual();
  const script = scripted(['synced', 'unavailable', 'capacity', 'unavailable', 'unavailable', 'unavailable', 'unavailable', 'synced'], clock.now);
  const connection = new DashboardConnection({url: 'http://127.0.0.1:1', scheduler: clock.scheduler, now: clock.now, connect: () => Promise.resolve(script.participant)});
  await connection.start();
  assert.deepEqual([connection.getState().feed, connection.getState().sessions.synced, connection.getState().sessions.records], ['connected', true, [record]]);
  // A later sync fails: the copy stops, and the page keeps its records, no longer synced.
  script.fail('unavailable');
  await clock.advance(0);
  assert.deepEqual([connection.getState().sessions.synced, connection.getState().sessions.records, connection.getState().sessions.refused], [false, [record], 'unavailable']);
  for (const wait of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
    const before = script.syncs.length;
    await clock.advance(wait - 1);
    assert.equal(script.syncs.length, before, `not before ${wait} ms`);
    await clock.advance(1);
    assert.equal(script.syncs.length, before + 1, `after ${wait} ms`);
    if (script.syncs.length < 8) assert.deepEqual([connection.getState().sessions.synced, connection.getState().sessions.records], [false, [record]], 'kept and stale');
  }
  assert.deepEqual(script.syncs, [0, 1000, 3000, 7000, 15_000, 31_000, 61_000, 91_000], 'one retry loop, capped at 30 s');
  assert.deepEqual([connection.getState().feed, connection.getState().sessions.synced], ['connected', true], 'synced again');
  await connection.close();
});

void test('a sync refused as unauthenticated ends the link at once, with no retry and the last records kept', async () => {
  for (const code of ['unauthenticated', 'forbidden'] as const) {
    const clock = manual();
    const script = scripted(['synced', code], clock.now);
    const connection = new DashboardConnection({url: 'http://127.0.0.1:1', scheduler: clock.scheduler, now: clock.now, connect: () => Promise.resolve(script.participant)});
    await connection.start();
    script.fail('unavailable');
    await clock.advance(1000);
    assert.deepEqual([connection.getState().feed, connection.getState().sessions.records, script.closed()], ['ended', [record], true], code);
    await clock.advance(60_000);
    assert.equal(script.syncs.length, 2, `${code}: never tried again`);
  }
});
