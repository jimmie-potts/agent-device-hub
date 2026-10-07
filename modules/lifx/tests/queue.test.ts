// One bulb's queue (Hub #928). Converted from controllers/lifx/tests/controller.test.mjs and the paint cases of
// controllers/lifx/tests/status.test.mjs at main 483d3a93. The queue's own cases keep their assertions; each attempt's
// deadline now runs on a manual scheduler, so the old busy-wait stalls and mocked timers are gone. The controller v1
// envelope cases (request order, epochs, receipt eviction, profile versions) moved to the module's 2.0 refusals in
// module.test.ts, and `cancel` and `closeGracefully` became `close`, which the module calls when it stops.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import type {Transport} from '../src/protocol.js';
import {BulbQueue, type Attempt, type QueueOptions} from '../src/queue.js';
import {LifxStore, REMEMBERED} from '../src/store.js';
import {flush, it, manualClock, type ManualClock} from './support.js';

type Exchange = Transport['exchange'];
const state = (): Buffer => {
  const buffer = Buffer.alloc(52);
  [12000, 32000, 50000, 3500].forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  buffer.writeUInt16LE(65535, 10);
  return buffer;
};
/** A wait the bulb never ends, until the exchange is aborted. */
const silence = (signal: AbortSignal): Promise<Buffer> => new Promise((_, reject) => { signal.addEventListener('abort', () => { reject(new Error('aborted')); }, {once: true}); });
function setup(exchange: Exchange, options: Partial<QueueOptions> = {}, clock: ManualClock = manualClock()): {queue: BulbQueue; clock: ManualClock} {
  const queue = new BulbQueue({transport: {exchange, close: () => {}}, timeoutMs: 10, retries: 1, now: clock.now, scheduler: clock.scheduler, ...options});
  return {queue, clock};
}
const run = (queue: BulbQueue, ...args: Parameters<BulbQueue['run']>): Promise<Attempt> => {
  const started = queue.run(...args);
  assert.ok(started, 'the queue admitted the job');
  return started;
};

it('a lost reply is retried within the bound, and the write is sent', async () => {
  let calls = 0;
  const {queue, clock} = setup((_type, _payload, _expected, signal) => {
    calls += 1;
    return calls === 1 ? silence(signal) : Promise.resolve(Buffer.alloc(0));
  });
  const done = run(queue, {kind: 'power', on: true});
  await clock.advance(10);
  const attempt = await done;
  assert.equal(attempt.effect, 'sent');
  assert.equal(attempt.exchanges, 2);
  assert.equal(calls, 2);
});

it('an exhausted write may have taken effect, and nothing sends it again', async () => {
  let calls = 0;
  const {queue, clock} = setup((_type, _payload, _expected, signal) => {
    calls += 1;
    return silence(signal);
  });
  const done = run(queue, {kind: 'power', on: true});
  await clock.advance(1000);
  const attempt = await done;
  assert.deepEqual([attempt.effect, attempt.failure, attempt.exchanges], ['possible', 'unreachable', 2]);
  await clock.advance(60_000);
  assert.equal(calls, 2, 'retries + 1 attempts, then nothing');
});

it('serial read-modify-write keeps the other HSBK fields, and a reading keeps its own time after a later write', async () => {
  let active = 0, maximum = 0;
  const calls: {type: number; payload: Buffer}[] = [];
  const clock = manualClock(100);
  const {queue} = setup(async (type, payload) => {
    active += 1;
    maximum = Math.max(active, maximum);
    calls.push({type, payload: Buffer.from(payload)});
    await new Promise(resolve => { setImmediate(resolve); });
    active -= 1;
    return type === 101 ? state() : Buffer.alloc(0);
  }, {}, clock);
  const first = run(queue, {kind: 'brightness', percent: 25});
  const second = run(queue, {kind: 'color', hue: 180, saturation: 50});
  await Promise.all([first, second]);
  assert.equal(maximum, 1, 'one exchange at a time');
  assert.deepEqual(calls.map(call => call.type), [101, 102, 101, 102]);
  assert.deepEqual([1, 3, 5, 7].map(offset => calls[1]?.payload.readUInt16LE(offset)), [12000, 32000, 16384, 3500]);
  assert.deepEqual([1, 3, 5, 7].map(offset => calls[3]?.payload.readUInt16LE(offset)), [32768, 32768, 50000, 3500]);
  await clock.advance(200);
  await run(queue, {kind: 'power', on: false});
  assert.equal(queue.observation?.atMs, 100, 'an acknowledgment is not an observation');
});

it('temperature keeps brightness and hue', async () => {
  const payloads: Buffer[] = [];
  const {queue} = setup((type, payload) => {
    payloads.push(Buffer.from(payload));
    return Promise.resolve(type === 101 ? state() : Buffer.alloc(0));
  });
  assert.equal((await run(queue, {kind: 'temperature', kelvin: 1500})).effect, 'sent');
  assert.deepEqual([1, 3, 5, 7].map(offset => payloads[1]?.readUInt16LE(offset)), [12000, 32000, 50000, 1500]);
});

it('one bulb that does not answer leaves another bulb\'s result independent', async () => {
  const clock = manualClock();
  const answering = setup(() => Promise.resolve(Buffer.alloc(0)), {}, clock).queue;
  const silent = setup((_type, _payload, _expected, signal) => silence(signal), {}, clock).queue;
  const results = Promise.all([run(answering, {kind: 'power', on: true}), run(silent, {kind: 'power', on: true})]);
  await clock.advance(100);
  assert.deepEqual((await results).map(attempt => attempt.effect), ['sent', 'possible']);
});

it('closing aborts a write in flight and keeps queued work from sending or retrying', async () => {
  let calls = 0;
  let started: () => void = () => {};
  const sent = new Promise<void>(resolve => { started = resolve; });
  const {queue} = setup((_type, _payload, _expected, signal) => {
    calls += 1;
    started();
    return silence(signal);
  });
  const active = run(queue, {kind: 'power', on: true});
  const queued = run(queue, {kind: 'power', on: false});
  await sent;
  await queue.close();
  const [x, y] = await Promise.all([active, queued]);
  assert.equal(calls, 1);
  assert.deepEqual([x.effect, x.failure], ['possible', 'cancelled']);
  assert.deepEqual([y.effect, y.failure, y.exchanges], ['none', 'cancelled', 0]);
  assert.equal(queue.run({kind: 'read'}), undefined, 'a closed queue admits nothing');
});

it('a read that times out before a color write leaves no effect, and the last reading is kept', async () => {
  let okay = true, calls = 0;
  const {queue, clock} = setup((_type, _payload, _expected, signal) => {
    calls += 1;
    return okay ? Promise.resolve(state()) : silence(signal);
  });
  assert.equal((await run(queue, {kind: 'read'})).failure, undefined);
  const before = queue.observation;
  okay = false;
  const done = run(queue, {kind: 'brightness', percent: 10});
  await clock.advance(1000);
  const attempt = await done;
  assert.deepEqual([attempt.effect, attempt.failure], ['none', 'unreachable']);
  assert.equal(calls, 3);
  assert.equal(queue.observation, before);
});

it('the queue is bounded, reservations count, and a closed queue cancels what waits', async () => {
  let calls = 0;
  const {queue} = setup((_type, _payload, _expected, signal) => {
    calls += 1;
    return silence(signal);
  }, {maxPending: 2});
  const reservation = queue.reserve();
  assert.ok(reservation);
  const active = run(queue, {kind: 'power', on: true});
  assert.equal(queue.run({kind: 'power', on: false}), undefined, 'full: a reservation and a job');
  reservation.release();
  const queued = run(queue, {kind: 'paint', hsbk: {hue: 0, saturation: 0, brightness: 0, kelvin: 2700}});
  await flush();
  await queue.close();
  assert.deepEqual([(await active).failure, (await queued).failure, (await queued).exchanges], ['cancelled', 'cancelled', 0]);
  assert.equal(calls, 1);
});

it('a read and a write share the queue', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const types: number[] = [];
  const {queue} = setup(async type => {
    types.push(type);
    if (types.length === 1) await gate;
    return type === 101 ? state() : Buffer.alloc(0);
  }, {timeoutMs: 500});
  const read = run(queue, {kind: 'read'});
  const write = run(queue, {kind: 'power', on: true});
  await flush();
  assert.deepEqual(types, [101]);
  release();
  await Promise.all([read, write]);
  assert.deepEqual(types, [101, 21]);
});

it('a paint is one absolute LightSetColor with the full HSBK, no LightGet, and never touches power', async () => {
  const calls: {type: number; payload: Buffer}[] = [];
  const {queue} = setup((type, payload) => {
    calls.push({type, payload: Buffer.from(payload)});
    return Promise.resolve(Buffer.alloc(0));
  });
  const attempt = await run(queue, {kind: 'paint', hsbk: {hue: 100, saturation: 200, brightness: 300, kelvin: 3500}});
  assert.equal(attempt.effect, 'sent');
  assert.deepEqual(calls.map(call => call.type), [102]);
  assert.deepEqual([1, 3, 5, 7].map(offset => calls[0]?.payload.readUInt16LE(offset)), [100, 200, 300, 3500]);
});

it('no retry starts after the command\'s own deadline', async () => {
  let calls = 0;
  const {queue, clock} = setup((_type, _payload, _expected, signal) => {
    calls += 1;
    return silence(signal);
  }, {retries: 3});
  const done = run(queue, {kind: 'power', on: true}, {deadlineMs: clock.now() + 15});
  await clock.advance(1000);
  assert.equal((await done).exchanges, 2, 'the first attempt, and one retry that started before the deadline');
  assert.equal(calls, 2);
});

it('a job that waited in the queue past its command\'s deadline sends nothing and ends expired', async () => {
  const types: number[] = [];
  const {queue, clock} = setup((type, _payload, _expected, signal) => {
    types.push(type);
    return silence(signal);
  });
  const first = run(queue, {kind: 'power', on: true});
  const late = run(queue, {kind: 'power', on: false}, {deadlineMs: clock.now() + 5});
  const turn = run(queue, {kind: 'turn'}, {deadlineMs: clock.now() + 5});
  await clock.advance(1000);
  assert.deepEqual([(await first).effect, (await first).exchanges], ['possible', 2]);
  for (const attempt of [await late, await turn]) assert.deepEqual([attempt.effect, attempt.failure, attempt.exchanges], ['none', 'expired', 0]);
  assert.deepEqual(types, [21, 21], 'only the first job reached the bulb');
});

it('a write whose read outlasted the command\'s deadline is never sent', async () => {
  const types: number[] = [];
  let answer: () => void = () => {};
  const {queue, clock} = setup(type => {
    types.push(type);
    // The read waits for the test; a write, if one were sent, would be acknowledged at once.
    return type === 101 ? new Promise<Buffer>(resolve => { answer = () => { resolve(state()); }; }) : Promise.resolve(Buffer.alloc(0));
  }, {timeoutMs: 500});
  const done = run(queue, {kind: 'color', hue: 120, saturation: 100}, {deadlineMs: clock.now() + 50});
  await clock.advance(100);
  answer();
  const attempt = await done;
  assert.deepEqual([attempt.effect, attempt.failure, attempt.exchanges], ['none', 'expired', 1]);
  assert.ok(attempt.observed, 'the reading still counts');
  assert.deepEqual(types, [101], 'the LightGet only, never the LightSetColor');
});

it('the store remembers the newest completed commands and forgets older ones', () => {
  const store = new LifxStore(new DatabaseSync(':memory:'));
  for (let index = 0; index <= REMEMBERED; index += 1) {
    store.accept({source: 'bunny/parts/operator', requestId: `req-${index}`, digest: 'd', bulb: 'pendant-1', family: 'power-set', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'});
    store.setState('bunny/parts/operator', `req-${index}`, 'done');
  }
  assert.equal(store.request('bunny/parts/operator', 'req-0'), undefined, 'the oldest is forgotten');
  assert.equal(store.request('bunny/parts/operator', `req-${REMEMBERED}`)?.state, 'done');
  assert.equal(store.request('bunny/parts/operator', 'req-1')?.state, 'done', `the newest ${REMEMBERED} are kept`);
});
