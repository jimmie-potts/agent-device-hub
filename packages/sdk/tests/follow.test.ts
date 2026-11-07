// A page copy that reads again after a refusal that may clear (Hub #1540), with a manual clock and no real sleeps.
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import {
  FIRST_READ_RETRY_MS, MAX_READ_RETRY_MS, SdkError, followCopy, readRefusal, type CopyHandlers, type ReadRefusal, type Scheduler, type SyncChange,
  type SyncedCopy, type SyncHandler, type SyncResult,
} from '../src/remote.js';
import {it} from './support.js';

type Value = {id: string; revision: number};

/** A manual scheduler: each pending delay waits until the test fires it. */
function clock() {
  const timers: {delayMs: number; run: () => void; cancelled: boolean}[] = [];
  const scheduler: Scheduler = {after: (delayMs, run) => {
    const timer = {delayMs, run, cancelled: false}; timers.push(timer);
    return () => { timer.cancelled = true; };
  }};
  return {
    scheduler,
    pending: () => timers.filter(timer => !timer.cancelled).map(timer => timer.delayMs),
    fire: async () => {
      const timer = timers.find(item => !item.cancelled); assert.ok(timer, 'a read is scheduled');
      timer.cancelled = true; timer.run(); await flush();
    },
  };
}

/** Each call is a new read with its own copy, as each sync through the shell opens one. */
function reads() {
  const all: {
    changed: SyncHandler<Value>; restarted: () => void; closed: number;
    answer: () => Promise<void>; refuse: (code: ErrorCode) => Promise<void>; fail: (error: unknown) => Promise<void>;
  }[] = [];
  const read = (changed: SyncHandler<Value>, options: {onRestarted: () => void}): Promise<SyncResult<Value>> => new Promise((resolve, reject) => {
    const entry = {
      changed, restarted: options.onRestarted, closed: 0,
      answer: async () => {
        const copy: SyncedCopy<Value> = {states: () => [], get: () => undefined, close: () => { entry.closed++; return Promise.resolve(); }};
        resolve({status: 'synced', copy, message: {} as never});
        await flush();
      },
      refuse: async (code: ErrorCode) => { resolve({status: 'rejected', requestId: 'synthetic', error: errorBody(code)}); await flush(); },
      fail: async (error: unknown) => { reject(error); await flush(); },
    };
    all.push(entry);
  });
  return {read, all, last: () => { const entry = all.at(-1); assert.ok(entry, 'a read was made'); return entry; }};
}

/** The page side: what each handler heard, in order. */
function page() {
  const heard: string[] = [], refusals: ReadRefusal[] = [];
  const handlers: CopyHandlers<Value> = {
    changed: (change, copy) => { heard.push(`${change.type}${copy === undefined ? ' before copy' : ''}`); },
    restarted: () => { heard.push('restarted'); },
    current: () => { heard.push('current'); },
    refused: refusal => { heard.push(`refused ${refusal.code}`); refusals.push(refusal); },
  };
  return {handlers, heard, refusals};
}
const synced: SyncChange<Value> = {type: 'synced', message: {} as never};

it('a retryable refusal is read again after 1 s, doubling to a 30 s cap, until a read returns its copy', async () => {
  const owner = reads(), time = clock(), seen = page();
  const stop = followCopy(owner.read, seen.handlers, time.scheduler);
  const delays: number[] = [];
  for (const code of ['unavailable', 'capacity', 'unavailable', 'unavailable', 'unavailable', 'unavailable', 'unavailable', 'unavailable'] as const) {
    await owner.last().refuse(code);
    delays.push(...time.pending()); await time.fire();
  }
  assert.equal(FIRST_READ_RETRY_MS, 1000); assert.equal(MAX_READ_RETRY_MS, 30_000);
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000], 'the backoff stays bounded at 30 s');
  await owner.last().answer();
  assert.equal(seen.heard.at(-1), 'current');
  assert.deepEqual(time.pending(), [], 'a current copy schedules nothing');
  assert.equal(owner.all.length, 9, 'one read per step, and only reads');
  stop();
  assert.equal(owner.last().closed, 1, 'stopping closes the current copy');
});

it('a copy that fails is closed and read again, and a returned copy restarts the backoff', async () => {
  const owner = reads(), time = clock(), seen = page();
  const stop = followCopy(owner.read, seen.handlers, time.scheduler);
  await owner.all[0]?.changed({type: 'updated', entity: {family: 'value', id: 'a'}, message: {} as never});
  await owner.all[0]?.answer();
  await owner.all[0]?.changed(synced);
  assert.deepEqual(seen.heard, ['updated before copy', 'current', 'synced']);
  await owner.all[0]?.changed({type: 'failed', error: errorBody('unavailable')});
  assert.equal(owner.all[0]?.closed, 1, 'the failed copy is released');
  assert.deepEqual(time.pending(), [1000]);
  await owner.all[0]?.changed(synced); owner.all[0]?.restarted();
  assert.equal(seen.heard.at(-1), 'refused unavailable', 'a failed read is heard no more');
  await time.fire(); await owner.all[1]?.refuse('capacity'); assert.deepEqual(time.pending(), [2000]);
  await time.fire(); await owner.all[2]?.answer();
  await owner.all[2]?.changed({type: 'failed', error: errorBody('unavailable')});
  assert.deepEqual(time.pending(), [1000], 'success restarts the backoff');
  stop(); assert.deepEqual(time.pending(), [], 'stopping cancels the pending read');
  assert.equal(owner.all.length, 3);
});

it('a refusal that cannot clear is reported once and never read again', async () => {
  for (const end of ['rejected', 'failed', 'thrown'] as const) {
    for (const code of ['forbidden', 'invalid-state', 'invalid-request', 'not-found'] as const) {
      const owner = reads(), time = clock(), seen = page();
      const stop = followCopy(owner.read, seen.handlers, time.scheduler);
      if (end === 'rejected') await owner.last().refuse(code);
      else if (end === 'thrown') await owner.last().fail(new SdkError(errorBody(code)));
      else { await owner.last().answer(); await owner.last().changed({type: 'failed', error: errorBody(code)}); }
      assert.deepEqual(seen.refusals, [{code, retryable: false}], `${end} ${code}`);
      assert.deepEqual(time.pending(), [], `a ${end} ${code} schedules no read`);
      assert.equal(owner.all.length, 1);
      stop();
    }
  }
});

it('a thrown failure without a registry body is the retryable unavailable, thrown synchronously or not', async () => {
  assert.deepEqual(readRefusal(new TypeError('the request could not be built')), {code: 'unavailable', retryable: true});
  assert.deepEqual(readRefusal(new SdkError(errorBody('capacity'))), {code: 'capacity', retryable: true});
  const time = clock(), seen = page();
  let calls = 0;
  const stop = followCopy<Value>(() => { calls++; if (calls === 1) throw new TypeError('synchronous'); return Promise.reject(new Error('asynchronous')); },
    seen.handlers, time.scheduler);
  await flush(); assert.deepEqual(seen.refusals, [{code: 'unavailable', retryable: true}]); assert.deepEqual(time.pending(), [1000]);
  await time.fire(); assert.equal(calls, 2); assert.deepEqual(time.pending(), [2000]);
  stop(); assert.deepEqual(time.pending(), []);
});

it('stopping silences the page, cancels the next read and closes a copy that returns later', async () => {
  const owner = reads(), time = clock(), seen = page();
  const stop = followCopy(owner.read, seen.handlers, time.scheduler);
  stop();
  await owner.all[0]?.changed(synced); owner.all[0]?.restarted(); await owner.all[0]?.answer();
  assert.deepEqual(seen.heard, []); assert.equal(owner.all[0]?.closed, 1, 'a late copy is closed');
  const second = reads(), later = clock(), quiet = page();
  const end = followCopy(second.read, quiet.handlers, later.scheduler);
  await second.last().refuse('unavailable'); end();
  assert.deepEqual(later.pending(), [], 'a pending read is cancelled');
  assert.equal(second.all.length, 1);
  const third = reads(), racing = page();
  const done = followCopy(third.read, racing.handlers, clock().scheduler);
  await third.last().changed({type: 'failed', error: errorBody('unavailable')}); done(); await third.last().answer();
  assert.equal(third.last().closed, 1, 'a copy that returns after its read failed is closed');
});
