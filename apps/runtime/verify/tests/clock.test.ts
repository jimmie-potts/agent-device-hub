// Hub #1710: a disposable run on virtual time. The run's supervisor is the authority for its time, which moves only
// when the harness API advances it, with the child's clock and a restart's hold; a run on the real clock refuses the
// clock routes, and the runtime's gateway serves none. The verification child gives the fixture core the same monotonic
// clock that its test clock carries.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {switchLamp} from '../../tests/fixtures/lamp.js';
import {scenario} from '../../tests/scenarios/catalog.js';
import type {CoreModule} from '../../src/index.js';
import type {FixtureCoreOptions} from '../../tests/fixtures/core.js';
import {childClockOf, fixtureCore} from '../child-clock.js';
import {RunFailure, connectRun, readGrants} from '../adapter.js';
import {HARNESS_PATH, MAX_ADVANCE_MS, type ClockState, type HarnessState} from '../protocol.js';
import {base, startRun, type Started} from './support.js';

const post = (url: URL, body: unknown): Promise<Response> =>
  fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: typeof body === 'string' ? body : JSON.stringify(body)});
const clockOf = (run: Started): URL => new URL(`${HARNESS_PATH}/clock`, run.harness);
const advanceOf = (run: Started): URL => new URL(`${HARNESS_PATH}/clock/advance`, run.harness);
async function advance(run: Started, ms: number): Promise<ClockState> {
  const response = await post(advanceOf(run), {ms});
  assert.equal(response.status, 200, `advance ${ms}`);
  return await response.json() as ClockState;
}
async function state(run: Started): Promise<HarnessState> {
  return await (await fetch(new URL(`${HARNESS_PATH}/state`, run.harness))).json() as HarnessState;
}
async function refusedWith(response: Response, status: number, code: 'invalid-state' | 'invalid-request'): Promise<void> {
  assert.equal(response.status, status);
  const body = await response.json() as ErrorBody;
  assert.deepEqual(body, errorBody(code, {detail: body.error.detail ?? ''}));
}
/** Switches lamp-1 on as the run's operator through the gateway's action route, and answers its status. */
async function switchOn(run: Started, requestId: string): Promise<unknown> {
  const grants = await readGrants(run.dataDir);
  const {key, draft} = switchLamp('lamp-1', 'on');
  const [, , family = '', target = ''] = key.split('.');
  const response = await fetch(new URL(`/api/v2/commands/${family}`, run.url), {
    method: 'POST', headers: {authorization: `Bearer ${grants.get('bunny/parts/operator') ?? ''}`, 'content-type': 'application/json'},
    body: JSON.stringify({target, data: draft.data, requestId}),
  });
  return (await response.json() as {status?: unknown}).status;
}
/** The same switch as `switchOn`, answering `lost` when the call loses its connection with the runtime. */
const switchOrLost = (run: Started, requestId: string): Promise<unknown> => switchOn(run, requestId).catch(() => 'lost');

/** Paths a clock control could have on the runtime's gateway; it serves none of them. */
const GATEWAY_CLOCK_PATHS = ['/clock', '/clock/advance', `${HARNESS_PATH}/clock`, `${HARNESS_PATH}/clock/advance`, '/api/v2/clock', '/api/v2/clock/advance', '/api/runtime/v1/clock'];

void test('a run on the real clock refuses both clock routes with 409, and the runtime\'s gateway answers 404 to any clock path', {timeout: 60_000}, async context => {
  const run = await startRun(context, await base(context), 'fixtures');
  await refusedWith(await fetch(clockOf(run)), 409, 'invalid-state');
  await refusedWith(await post(advanceOf(run), {ms: 10}), 409, 'invalid-state');
  for (const path of GATEWAY_CLOCK_PATHS) {
    assert.equal((await fetch(new URL(path, run.url))).status, 404, `GET ${path} on the gateway`);
    assert.equal((await post(new URL(path, run.url), {ms: 10})).status, 404, `POST ${path} on the gateway`);
  }
  assert.equal((await stopOf(run)), 0);
});

void test('a run of the shipped runtime refuses both clock routes with 409', {timeout: 60_000}, async context => {
  const run = await startRun(context, await base(context), 'shipped');
  await refusedWith(await fetch(clockOf(run)), 409, 'invalid-state');
  await refusedWith(await post(advanceOf(run), {ms: 10}), 409, 'invalid-state');
  assert.equal((await stopOf(run)), 0);
});

void test('a run on virtual time moves its runtime\'s clock only on an advance, and a restart\'s hold moves it too', {timeout: 60_000}, async context => {
  // The shared-inbox scenario's run asks for virtual time (tests/scenarios/inbox.ts): the core and the fixture lamp.
  const run = await startRun(context, await base(context), 'shared-inbox-history');
  const start = await (await fetch(clockOf(run))).json() as ClockState;
  assert.equal(start.clock, 'virtual');
  assert.deepEqual(await (await fetch(clockOf(run))).json(), start, 'nothing moves the clock but an advance');
  // The negative control of the gateway's 404s: the same requests reach a clock on the harness.
  for (const path of [`${HARNESS_PATH}/clock`]) {
    assert.equal((await fetch(new URL(path, run.url))).status, 404, `GET ${path} on the gateway`);
    assert.equal((await fetch(new URL(path, run.harness))).status, 200, `GET ${path} on the harness`);
  }
  for (const path of GATEWAY_CLOCK_PATHS) assert.equal((await post(new URL(path, run.url), {ms: 10})).status, 404, `POST ${path} on the gateway`);
  assert.equal((await fetch(clockOf(run)).then(async response => await response.json() as ClockState)).nowMs, start.nowMs, 'a gateway request moved nothing');

  // Two minutes of virtual time pass at once; the runtime's next record carries the moved time, which the real clock
  // has not reached.
  const moved = await advance(run, 120_000);
  assert.equal(moved.nowMs, start.nowMs + 120_000);
  assert.equal(await switchOn(run, 'req-virtual'), 'accepted');
  // An advance of nothing settles the run: the lamp's answer, and every record the runtime wrote, read before it answers.
  await advance(run, 0);
  const admitted = (await state(run)).logs.find(({record}) => record.event_name === 'runtime.command.admitted');
  assert.ok(admitted !== undefined && Date.parse(admitted.record.timestamp ?? '') >= start.nowMs + 120_000, 'the runtime admitted the command at its virtual time');
  assert.ok(Date.now() < start.nowMs + 120_000, 'the real clock is behind it');

  // A restart's hold is virtual: the run's time moves by the hold, and the next runtime starts there.
  const restarted = await post(new URL(`${HARNESS_PATH}/restart`, run.harness), {holdMs: 4000});
  assert.equal(restarted.status, 200);
  const after = await (await fetch(clockOf(run))).json() as ClockState;
  assert.equal(after.nowMs, moved.nowMs + 4000, 'the hold moved virtual time by exactly its length');
  const second = (await state(run)).logs.find(({generation, record}) => generation === 2 && record.event_name === 'runtime.started');
  assert.ok(second !== undefined && Date.parse(second.record.timestamp ?? '') >= after.nowMs, 'the restarted runtime starts at the run\'s virtual time');

  // An advance takes only `ms`, a whole number of milliseconds within its bound.
  for (const body of [{ms: -1}, {ms: 1.5}, {ms: MAX_ADVANCE_MS + 1}, {ms: '10'}, {ms: 10, extra: 1}, {}, 'null', '[]']) {
    await refusedWith(await post(advanceOf(run), body), 400, 'invalid-request');
  }
  assert.equal((await (await fetch(clockOf(run))).json() as ClockState).nowMs, after.nowMs, 'a refused advance moved nothing');

  // The run adapter follows the run's clock, and refuses a hook against a stopped runtime, which needs a real hold.
  const selected = scenario('shared-inbox-history');
  assert.ok(selected !== undefined);
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed: selected.seed});
  try {
    assert.equal(h.clock, 'virtual');
    assert.equal(h.now(), after.nowMs, 'the adapter\'s time is the run\'s');
    await h.wait(30_000);
    assert.equal(h.now(), after.nowMs + 30_000);
    await assert.rejects(h.hook({}, {runtime: 'stopped'}), (error: unknown) => error instanceof RunFailure);
    // Idle polls may pass without the run; whatever they owe it reaches it before the next call does.
    for (let poll = 0; poll < 5; poll += 1) await h.wait(10);
    await h.gateway({as: 'reader', method: 'GET', path: '/api/v2/families/inbox-item'});
    assert.equal((await (await fetch(clockOf(run))).json() as ClockState).nowMs, after.nowMs + 30_050, 'the run got the time it was owed before the call');
    assert.equal(h.now(), after.nowMs + 30_050);
  } finally {
    await h.close();
  }
  assert.equal((await stopOf(run)), 0);
});

void test('the verification child gives the fixture core the monotonic clock its test clock carries, which moves with its wall clock', async () => {
  assert.equal(childClockOf('real'), undefined, 'on the real clock the child passes no test clock');
  for (const argument of ['', 'virtual', '-1', '1.5', '01', '12345678901234567']) assert.throws(() => childClockOf(argument), {message: /clock argument/}, argument);
  const clock = childClockOf('1000');
  assert.ok(clock !== undefined);
  // The child builds its core only through `fixtureCore`: on virtual time with the test clock's monotonic clock.
  const built: FixtureCoreOptions[] = [];
  const create = (options: FixtureCoreOptions): CoreModule => { built.push(options); return {} as CoreModule; };
  fixtureCore(clock, {}, create);
  fixtureCore(undefined, {}, create);
  assert.equal(built[0]?.monotonic, clock.testClock.monotonic, 'the fixture core and runMain get the same monotonic clock');
  assert.equal(built[1]?.monotonic, undefined, 'on the real clock the core keeps its own');
  assert.equal(clock.testClock.clock.now(), 1000);
  assert.equal(clock.testClock.monotonic(), 1000);
  const answer = await clock.advance(2500, () => false);
  assert.deepEqual([answer.nowMs, clock.testClock.clock.now(), clock.testClock.monotonic()], [2500, 2500, 2500], 'monotonic time moves with the wall clock');
  // The child itself: its core comes from `fixtureCore` with its clock, never from the core factory directly, and its
  // test clock goes to runMain.
  const child = await readFile(new URL('../../../verify/child.ts', import.meta.url), 'utf8');
  assert.match(child, /fixtureCore = buildCore\(clock, /, 'the child builds its core through fixtureCore with its clock');
  assert.doesNotMatch(child, /createCoreModule|tests\/fixtures\/core\.js/, 'the child builds no core of its own');
  assert.match(child, /testClock: clock\.testClock/, 'the child gives runMain the same clock');
});

void test('an advance that meets an ended runtime ends at once, so the runtime\'s restart does not wait behind it', {timeout: 60_000}, async context => {
  const run = await startRun(context, await base(context), 'shared-inbox-history');
  // The runtime will die between the lamp's next commit and its publish.
  assert.equal((await post(new URL(`${HARNESS_PATH}/arm-crash`, run.harness), {})).status, 200);
  // Two advances queue on the run's lifecycle before the switch that kills the runtime, so its restart queues behind
  // both: the first is under way, or about to begin, when the runtime dies, and the second begins with it gone.
  const first = advance(run, MAX_ADVANCE_MS);
  const second = advance(run, 60_000);
  assert.equal(await switchOrLost(run, 'req-crash'), 'lost');
  // The first advance ends at the time the runtime died, which it reached.
  const [died] = await Promise.all([first, second]);
  // An advance of nothing comes after the restart in the lifecycle queue.
  await advance(run, 0);
  const restarted = (await state(run)).logs.find(({generation, record}) => generation === 2 && record.event_name === 'runtime.started');
  assert.ok(restarted !== undefined, 'the runtime restarted');
  // The restarted runtime starts at the run's virtual time, which no advance moved while no runtime ran.
  assert.equal(Date.parse(restarted.record.timestamp ?? ''), died.nowMs, 'the restart did not wait behind a minute of virtual time with no runtime');
  assert.equal((await stopOf(run)), 0);
});

/** Stops the run and answers its supervisor's exit code. */
async function stopOf(run: Started): Promise<number | null> {
  return (await run.stop()).code;
}
