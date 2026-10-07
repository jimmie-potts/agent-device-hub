// The shipped Nanoleaf module under the runtime (Hub #844): with the event-loop lag check on, a mode command and a wall
// edit are answered while the module's worker waits on a device request, because no transaction spans a device request
// and nothing waits inside SQLite on the event loop. The wall is simulated; nothing reaches a device.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {LINES_ADDRESS, NANOLEAF_FAMILIES, OBSERVE_MS, REQUEST_MS, SimulatedNanoleaf, createNanoleafModule} from '@jimmie-potts/nanoleaf';
import type {RequestResult, Sdk} from '@jimmie-potts/sdk';
import {createCoreModule} from '../src/index.js';
import {NANOLEAF_SECTION} from './scenarios/catalog.js';
import {partTokens, writeConfiguration} from './scenarios/parts.js';
import {entry, fixture, it, run, stateDir, waitFor} from './support.js';

/**
 * How long the event loop may stall while the wall holds the worker's request and the commands are answered: a module
 * that waited on its device, or blocked while a request is out, would stall it for the device's wait. Only that window
 * is measured, under a second, so a busy machine's load elsewhere in the test does not count.
 */
const STALL_MS = 250;
/**
 * How long the event loop may stall from just before the wall holds until its held request has started, a window that
 * waits for the module's next request, up to one poll. A link that blocked as it sent would stall it for the device's
 * wait, up to the link's own deadline; the bound stays below that deadline and above a busy machine's load over the
 * longer window.
 */
const SEND_STALL_MS = REQUEST_MS / 2;
/** How long the outcomes may take once both commands are answered, and how long the wall then keeps the request. */
const OUTCOMES_MS = 500;
const HOLD_MS = 300;
/**
 * The lag check stays on, as in the service, with a limit far above any load a shared test machine adds, so it never
 * ends this test's process; the stalls measured as the held request starts and while it is held are the regression
 * signal.
 */
const LAG_LIMIT_MS = 60_000;

/** A 10 ms heartbeat on the event loop; `stop` returns the longest gap between beats, in milliseconds. */
function heartbeat(): {stop: () => number} {
  let last = performance.now();
  let longest = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 10);
  return {stop: () => {
    clearInterval(timer);
    return Math.max(longest, performance.now() - last);
  }};
}

it('a mode command and an edit are answered while the worker waits on the wall, and the lag check never trips', async context => {
  assert.ok(STALL_MS + OUTCOMES_MS + HOLD_MS < REQUEST_MS, 'the hold is asserted before the link\'s deadline');
  const wall = new SimulatedNanoleaf();
  const outcomes: Message[] = [];
  let operator: Sdk | undefined;
  const probe = fixture('operator', async ({sdk}) => {
    operator = sdk;
    await sdk.subscribe('bunny.event.*.wall', message => { if (message.kind === 'outcome') outcomes.push(message); });
  });
  const configFile = await writeConfiguration(join(await stateDir(context), 'config'), {modules: {nanoleaf: NANOLEAF_SECTION}, tokens: partTokens()});
  const {runtime, logs} = await run(context, {modules: [createCoreModule(), createNanoleafModule({transport: wall.request}), probe], configFile,
    lagCheck: {limitMs: LAG_LIMIT_MS}});
  assert.equal(runtime.health().status, 'ok');
  assert.equal(entry(runtime.health(), 'nanoleaf').state, 'running');
  await waitFor(() => (wall.state().devices[LINES_ADDRESS]?.reads ?? 0) > 2, 5000, 'the worker reading the wall');
  const sdk = operator;
  assert.ok(sdk !== undefined);
  // The first window opens before the wall holds, so the held request starts inside it, as a link's send would.
  const sending = heartbeat();
  wall.hold();
  let holding: {stop: () => number} | undefined;
  try {
    await waitFor(() => wall.state().held > 0, OBSERVE_MS + 1000, 'a request the wall holds');
    const sendStall = sending.stop();
    holding = heartbeat();
    const heldAt = performance.now();
    const answers: RequestResult[] = await Promise.all([
      sdk.request('bunny.cmd.device-mode-set.wall', {type: 'org.bunny.device-mode.set.requested', subject: 'wall',
        dataschema: 'https://bunny.invalid/events/device-mode-set/2.0', data: {mode: 'quiet'}}, {timeoutMs: 5000, requestId: 'held-mode'}),
      sdk.request(`bunny.cmd.${NANOLEAF_FAMILIES.wallEdit.family}.wall`, {type: NANOLEAF_FAMILIES.wallEdit.type, subject: 'wall',
        dataschema: `https://bunny.invalid/events/${NANOLEAF_FAMILIES.wallEdit.family}/2.0`,
        data: {edit: {kind: 'settings', settings: {palette: {working: '#00e5ff'}}}}}, {timeoutMs: 5000, requestId: 'held-edit'}),
    ]);
    const elapsed = performance.now() - heldAt;
    assert.deepEqual(answers.map(answer => answer.status), ['accepted', 'accepted']);
    assert.ok(elapsed < STALL_MS, `both answered in ${Math.round(elapsed)} ms, without waiting for the wall`);
    // The edit and the mode command complete while the wall still holds the request: both are the module's own state.
    await waitFor(() => ['held-edit', 'held-mode'].every(id => outcomes.some(message => (message.data as {requestId?: string}).requestId === id)), OUTCOMES_MS,
      'both outcomes');
    assert.deepEqual(outcomes.find(message => (message.data as {requestId?: string}).requestId === 'held-mode')?.data,
      {requestId: 'held-mode', result: 'succeeded', evidence: 'observed'});
    // The wall keeps the request a while longer, as a slow device would; the event loop must stay free all along.
    await new Promise(resolve => { setTimeout(resolve, HOLD_MS); });
    const stalled = holding.stop();
    assert.ok(wall.state().held > 0, 'the wall still holds the request');
    // Still the link's own request, not one it gave up on at its deadline: that would have logged the wall unavailable.
    assert.equal(logs.some(record => record.event_name === 'device.unavailable'), false, 'the link still waits on the held request');
    assert.ok(sendStall < SEND_STALL_MS, `the event loop stalled at most ${Math.round(sendStall)} ms while the held request started`);
    assert.ok(stalled < STALL_MS, `the event loop stalled at most ${Math.round(stalled)} ms while the wall held the request`);
  } finally {
    // Released even when an assertion failed, so the runtime's stop never waits on a held request.
    sending.stop();
    holding?.stop();
    wall.release();
  }
  await waitFor(() => wall.state().devices[LINES_ADDRESS]?.brightness === 10, 10_000, 'the wall at the Quiet level once it answers');
  assert.deepEqual(runtime.health().lagCheck, {status: 'active', limitMs: LAG_LIMIT_MS});
  assert.equal(logs.some(record => record.event_name === 'runtime.stuck' || record.event_name === 'runtime.module.failed'), false);
});
