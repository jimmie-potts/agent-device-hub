// The core's action dispatcher, tracker, outcome intake and history (Hub #782) under the runtime: every tracked action
// from sent to its end, deadlines on a manual clock, a restart while an action is pending, duplicate and conflicting
// outcomes, the outcome acknowledgment, a full disk, and history rows written in each step's own transaction. A scripted
// gadget module (fixtures/gadget.ts) plays the device and reports through its own outbox.
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {BunnyModule} from '@jimmie-potts/sdk';
import {
  DEADLINES, createCoreModule, type ActionAnswer, type CoreHandle, type CoreModule, type LogRecord, type Operation, type OperationChange,
  type OperationStep, type Runtime,
} from '../src/index.js';
import {fillDisk} from './fixtures/disk.js';
import {Gadget, setGadget} from './fixtures/gadget.js';
import {contextOf, fixture, flush, it, manualClock, run, stateDir, waitFor} from './support.js';

const OPERATOR = 'bunny/parts/operator';

type TrackerRun = {
  runtime: Runtime; logs: LogRecord[]; core: CoreModule; gadget: Gadget; changes: OperationChange[];
  clock: ReturnType<typeof manualClock> | undefined;
  database: () => DatabaseSync; handle: () => CoreHandle;
  /** Sends `gadget-set` through the dispatcher as the operator. */
  dispatch: (requestId: string, level?: number, device?: string) => Promise<ActionAnswer>;
  operation: (requestId: string) => Operation | undefined;
  /** History's rows for one request, as kind and the record. */
  history: (requestId: string) => {kind: string; record: Record<string, unknown>}[];
};

/** The runtime with the core, a part that records each tracked change, and the gadget; on a manual clock when asked. */
async function trackerRun(context: TestContext, options: {
  gadget?: Gadget; dir?: string; manual?: boolean; extra?: readonly BunnyModule[];
  /** The spans the runtime may lose, such as a publish that a crash left unfinished. */
  lostSpans?: number;
} = {}): Promise<TrackerRun> {
  const changes: OperationChange[] = [];
  let database: DatabaseSync | undefined;
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{
    open: db => { database = db; },
    start: given => { handle = given; return Promise.resolve(); },
    tracked: change => { changes.push(change); },
  }]});
  const gadget = options.gadget ?? new Gadget();
  const clock = options.manual === true ? manualClock(Date.now()) : undefined;
  const {runtime, logs} = await run(context, {
    modules: [core, gadget.module(), ...options.extra ?? []], ...(options.dir === undefined ? {} : {stateDir: options.dir}),
    ...(clock === undefined ? {} : {clock: {now: clock.now}, scheduler: clock.scheduler}),
  }, {dropped: options.lostSpans ?? 0});
  const db = (): DatabaseSync => {
    assert.ok(database, 'the core store is open');
    return database;
  };
  return {
    runtime, logs, core, gadget, changes, clock, database: db,
    handle: () => {
      assert.ok(handle, 'the core started its parts');
      return handle;
    },
    dispatch: (requestId, level = 50, device = 'g1') => core.actions.dispatch({...setGadget(level, device), requestedBy: OPERATOR, requestId}),
    operation: requestId => handle?.operation(requestId),
    history: requestId => (db().prepare('SELECT kind, record FROM core_history WHERE request_id = ? ORDER BY seq').all(requestId) as {kind: string; record: string}[])
      .map(row => ({kind: row.kind, record: JSON.parse(row.record) as Record<string, unknown>})),
  };
}

/** Each history row of a request: an operation step as `<event> <status>`, and an outcome as `outcome <result>`. */
const steps = (t: TrackerRun, requestId: string): string[] => t.history(requestId).map(({kind, record}) =>
  kind === 'operation' ? `${(record as OperationStep).event} ${(record as OperationStep).status}` : `${kind} ${String((record.data as {result?: unknown}).result)}`);
const shape = (operation: Operation | undefined): unknown => [operation?.status, operation?.result, operation?.evidence, operation?.error?.code];
/** Moves the manual clock and lets what it fires settle. */
async function advance(t: TrackerRun, ms: number): Promise<void> {
  assert.ok(t.clock);
  t.clock.advance(ms);
  for (let turn = 0; turn < 5; turn += 1) await flush();
}
const records = (logs: readonly LogRecord[], requestId: string): string[] => logs
  .filter(record => record.attributes['bunny.module'] === 'core' && record.attributes['bunny.request.id'] === requestId && record.event_name.startsWith('command.'))
  .map(record => `${record.event_name} ${record.severity_text} ${String(record.attributes['bunny.outcome'])}`);

it('an action is recorded sent before it goes out, then accepted, then completed by its outcome, each step with its history rows', async context => {
  const t = await trackerRun(context);
  assert.deepEqual(await t.dispatch('req-on'), {status: 'accepted', requestId: 'req-on'});
  await waitFor(() => t.operation('req-on')?.status === 'completed', 5000, 'the outcome');
  const done = t.operation('req-on');
  assert.deepEqual(shape(done), ['completed', 'succeeded', 'observed', undefined]);
  assert.deepEqual([done?.kind, done?.target, done?.requestedBy, done?.command, done?.data, done?.reply, done?.responder],
    ['device', 'g1', OPERATOR, 'org.bunny.gadget.set.requested', {level: 50}, 'accepted', 'bunny/modules/gadget']);
  assert.equal(done?.deadlineAtMs, (done?.sentAtMs ?? 0) + DEADLINES.device.outcomeMs);
  assert.deepEqual(steps(t, 'req-on'), ['sent sent', 'reply accepted', 'outcome succeeded', 'outcome completed']);
  // The gadget got the command once, as the core's participant, with the action's request ID.
  assert.deepEqual(t.gadget.commands.map(command => [command.source, command.data.requestId]), [['bunny/core', 'req-on']]);
  assert.deepEqual(t.changes.map(change => [change.operation.status, change.previous?.status, change.outcome === undefined ? '' : 'outcome']),
    [['sent', undefined, ''], ['accepted', 'sent', ''], ['completed', 'accepted', 'outcome']], 'each change reaches the parts');
  // The core acknowledged the outcome after its commit, and the gadget's outbox forgot it.
  const [outcome] = t.gadget.published;
  await waitFor(() => t.gadget.acknowledged.includes(outcome?.id ?? ''), 5000, 'the acknowledgment');
  await waitFor(() => t.runtime !== undefined && records(t.logs, 'req-on').length === 3, 5000, 'the records');
  assert.deepEqual(records(t.logs, 'req-on'), ['command.queued INFO queued', 'command.admitted INFO accepted', 'command.completed INFO succeeded']);
  const received = t.logs.find(record => record.event_name === 'message.received' && record.attributes['bunny.module'] === 'core' && record.attributes['bunny.request.id'] === 'req-on');
  assert.deepEqual([received?.attributes['bunny.outcome'], received?.trace_id, received?.span_id], ['accepted', outcome?.traceparent.split('-')[1], outcome?.traceparent.split('-')[2]],
    'the intake record carries the outcome\'s own trace and span (#950)');
  const queued = t.logs.find(record => record.event_name === 'command.queued');
  assert.equal(queued?.trace_id, outcome?.traceparent.split('-')[1], 'the action and its outcome share one trace');
});

it('a refusal is failed with no evidence, a stopped module\'s command is failed, and one still queued at its reply deadline is expired', async context => {
  const t = await trackerRun(context, {manual: true});
  t.gadget.script({reply: 'not-found'});
  const refused = await t.dispatch('req-refused');
  assert.equal('error' in refused && refused.error.code, 'not-found');
  assert.deepEqual(shape(t.operation('req-refused')), ['rejected', 'failed', 'none', 'not-found']);
  // Nobody answers another family: its module is not running.
  const unrouted = await t.core.actions.dispatch({
    key: 'bunny.cmd.widget-set.w1', requestedBy: OPERATOR, requestId: 'req-nobody',
    draft: {type: 'org.bunny.widget.set.requested', subject: 'w1', dataschema: 'https://bunny.invalid/events/widget-set/2.0', data: {level: 1}},
  });
  assert.equal('error' in unrouted && unrouted.error.code, 'unavailable');
  assert.deepEqual(shape(t.operation('req-nobody')), ['rejected', 'failed', 'none', 'unavailable']);
  // One held in the handler, then one queued behind it: at their deadline the first is uncertain, the queued one expired.
  t.gadget.script({reply: 'hold'});
  const held = t.dispatch('req-held');
  await waitFor(() => t.gadget.commands.length === 2, 5000, 'the held command');
  const queued = t.dispatch('req-queued');
  await flush();
  await advance(t, DEADLINES.device.replyMs);
  const [heldAnswer, queuedAnswer] = await Promise.all([held, queued]);
  assert.equal('error' in heldAnswer && heldAnswer.error.code, 'uncertain-result');
  assert.equal('error' in queuedAnswer && queuedAnswer.error.code, 'expired');
  assert.deepEqual(shape(t.operation('req-held')), ['uncertain', 'uncertain', 'none', 'uncertain-result']);
  assert.deepEqual(shape(t.operation('req-queued')), ['expired', 'failed', 'none', 'expired']);
  assert.deepEqual(steps(t, 'req-queued'), ['sent sent', 'reply expired']);
  // The held command finishes late: its outcome completes the uncertain record, and history keeps both.
  t.gadget.release();
  await waitFor(() => t.operation('req-held')?.status === 'completed', 5000, 'the late outcome');
  assert.deepEqual(shape(t.operation('req-held')), ['completed', 'succeeded', 'observed', undefined]);
  assert.deepEqual(steps(t, 'req-held'), ['sent sent', 'reply uncertain', 'outcome succeeded', 'outcome completed']);
  assert.deepEqual(t.gadget.commands.map(command => command.data.requestId), ['req-refused', 'req-held'], 'the expired one never reached the gadget, and nothing was sent again');
});

it('an accepted action with no outcome by its deadline is uncertain, and a late outcome still completes it', async context => {
  const t = await trackerRun(context, {manual: true});
  t.gadget.script({outcome: 'none'});
  assert.deepEqual(await t.dispatch('req-quiet'), {status: 'accepted', requestId: 'req-quiet'});
  await advance(t, DEADLINES.device.outcomeMs - 1);
  assert.equal(t.operation('req-quiet')?.status, 'accepted', 'not before its deadline');
  await advance(t, 1);
  await waitFor(() => t.operation('req-quiet')?.status === 'uncertain', 5000, 'uncertain at the deadline');
  assert.deepEqual(shape(t.operation('req-quiet')), ['uncertain', 'uncertain', 'none', 'uncertain-result']);
  await waitFor(() => records(t.logs, 'req-quiet').includes('command.completed WARN uncertain'), 5000, 'the deadline\'s record');
  await t.gadget.report('req-quiet', {result: 'failed', evidence: 'none', error: {code: 'unavailable', retryable: true, detail: 'the gadget did not answer'}});
  await waitFor(() => t.operation('req-quiet')?.status === 'completed', 5000, 'the late outcome');
  assert.deepEqual(shape(t.operation('req-quiet')), ['completed', 'failed', 'none', 'unavailable'], 'a definitive outcome replaces uncertain');
  assert.deepEqual(steps(t, 'req-quiet'), ['sent sent', 'reply accepted', 'deadline uncertain', 'outcome failed', 'outcome completed'], 'history keeps both');
  assert.equal(t.gadget.commands.length, 1, 'nothing was sent again');
});

it('a restart while an action is pending: it ends uncertain at its deadline, and the command is never sent again', async context => {
  const dir = await stateDir(context);
  const gadget = new Gadget();
  gadget.script({outcome: 'none'});
  const first = await trackerRun(context, {gadget, dir});
  assert.deepEqual(await first.dispatch('req-pending'), {status: 'accepted', requestId: 'req-pending'});
  await first.runtime.stop();
  const second = await trackerRun(context, {gadget, dir, manual: true});
  assert.equal(second.operation('req-pending')?.status, 'accepted', 'still pending after the restart');
  await advance(second, DEADLINES.device.outcomeMs);
  await waitFor(() => second.operation('req-pending')?.status === 'uncertain', 5000, 'uncertain at its deadline');
  assert.equal(gadget.commands.length, 1, 'never sent again');
  // The same request ID cannot send it again either: it answers what the action got.
  assert.deepEqual(await second.dispatch('req-pending'), {status: 'accepted', requestId: 'req-pending'});
  assert.equal(gadget.commands.length, 1);
});

it('a module that crashed between saving its outcome and reporting it reports it at its next start; history takes it once, and nothing is sent again', async context => {
  const dir = await stateDir(context);
  const gadget = new Gadget();
  // The publish that never finishes leaves its span unfinished when this runtime stops.
  const first = await trackerRun(context, {gadget, dir, lostSpans: 1});
  gadget.dead = true;
  assert.deepEqual(await first.dispatch('req-crash'), {status: 'accepted', requestId: 'req-crash'});
  await flush();
  assert.equal(first.operation('req-crash')?.status, 'accepted', 'the outcome never went out');
  await first.runtime.stop();
  gadget.dead = false;
  const second = await trackerRun(context, {gadget, dir});
  await waitFor(() => second.operation('req-crash')?.status === 'completed', 5000, 'the republished outcome');
  assert.deepEqual(steps(second, 'req-crash'), ['sent sent', 'reply accepted', 'outcome succeeded', 'outcome completed']);
  await waitFor(() => gadget.acknowledged.length === 1, 5000, 'the acknowledgment');
  assert.equal(gadget.commands.length, 1, 'no command was sent again');
});

it('a resent outcome counts once and is acknowledged again, so a lost acknowledgment recovers at the next start', async context => {
  const dir = await stateDir(context);
  const gadget = new Gadget();
  gadget.loseAcknowledgments = true;
  const first = await trackerRun(context, {gadget, dir});
  await first.dispatch('req-lost');
  await waitFor(() => first.operation('req-lost')?.status === 'completed', 5000, 'the outcome');
  await first.runtime.stop();
  gadget.loseAcknowledgments = false;
  const second = await trackerRun(context, {gadget, dir});
  const [outcome] = gadget.published;
  await waitFor(() => gadget.acknowledged.includes(outcome?.id ?? ''), 5000, 'the acknowledgment of the resent outcome');
  assert.equal(gadget.published.filter(message => message.id === outcome?.id).length, 2, 'the outbox sent it again');
  assert.equal(second.history('req-lost').filter(row => row.kind === 'outcome').length, 1, 'history took it once');
  assert.deepEqual(shape(second.operation('req-lost')), ['completed', 'succeeded', 'observed', undefined]);
  await waitFor(() => second.logs.some(record => record.event_name === 'message.received' && record.attributes['bunny.outcome'] === 'duplicate'
    && record.severity_text === 'INFO' && record.attributes['bunny.request.id'] === 'req-lost'), 5000, 'the duplicate\'s record, a recovery at INFO');
  // Forgotten now: a third start sends nothing.
  await second.runtime.stop();
  const sent = gadget.published.length;
  await trackerRun(context, {gadget, dir});
  await flush();
  assert.equal(gadget.published.length, sent);
});

it('late and conflicting outcomes: a succeeded and a failed one keep both in either order, and an identical retransmission is no change', async context => {
  const t = await trackerRun(context);
  for (const [requestId, first, second] of [['req-a', 'succeeded', 'failed'], ['req-b', 'failed', 'succeeded']] as const) {
    const report = (result: 'succeeded' | 'failed'): {result: 'succeeded' | 'failed'; evidence: 'observed' | 'none'; error?: {code: 'unavailable'; retryable: true}} =>
      result === 'succeeded' ? {result, evidence: 'observed'} : {result, evidence: 'none', error: {code: 'unavailable', retryable: true}};
    t.gadget.script({outcome: report(first)});
    await t.dispatch(requestId);
    await waitFor(() => t.operation(requestId)?.status === 'completed', 5000, 'the first outcome');
    const changesBefore = t.changes.length;
    const later = await t.gadget.report(requestId, report(second));
    await waitFor(() => t.operation(requestId)?.status === 'conflict', 5000, 'the conflict');
    const operation = t.operation(requestId);
    assert.deepEqual([operation?.result, operation?.outcomes.map(item => item.result)], ['conflict', [first, second]], `${first} then ${second}`);
    assert.equal(t.changes.at(-1)?.operation.result, 'conflict', 'the parts hear of the conflict, so #923 opens or reopens its item');
    // The same message again is a duplicate: history and the tracker take it once, and the core acknowledges it again.
    const acknowledged = t.gadget.acknowledged.filter(id => id === later.id).length;
    await t.gadget.forge(later, later.data);
    await waitFor(() => t.gadget.acknowledged.filter(id => id === later.id).length > acknowledged, 5000, 'the acknowledgment of the duplicate');
    assert.equal(t.changes.length, changesBefore + 1, 'the duplicate changed nothing');
    assert.equal(t.history(requestId).filter(row => row.kind === 'outcome').length, 2, 'history keeps both outcomes, each once');
  }
});

it('a reused (source, id) with other content is refused as duplicate-conflict, kept for diagnosis, and changes no action', async context => {
  const t = await trackerRun(context);
  t.gadget.script({outcome: 'none'});
  await t.dispatch('req-reused');
  const outcome = await t.gadget.report('req-reused', {result: 'succeeded', evidence: 'observed'});
  await waitFor(() => t.operation('req-reused')?.status === 'completed', 5000, 'the outcome');
  const changes = t.changes.length;
  const acknowledged = t.gadget.acknowledged.length;
  await t.gadget.forge(outcome, {requestId: 'req-reused', result: 'failed', evidence: 'none', error: {code: 'unavailable', retryable: true}});
  await waitFor(() => t.logs.some(record => record.event_name === 'message.received' && record.attributes['bunny.code'] === 'duplicate-conflict'), 5000, 'the refusal');
  const refusal = t.logs.find(record => record.event_name === 'message.received' && record.attributes['bunny.code'] === 'duplicate-conflict');
  assert.deepEqual([refusal?.severity_text, refusal?.attributes['bunny.reason'], refusal?.trace_id], ['WARN', 'duplicate', outcome.traceparent.split('-')[1]]);
  const kept = t.database().prepare('SELECT source, message_id, message FROM core_refused').all() as {source: string; message_id: string; message: string}[];
  assert.deepEqual(kept.map(row => [row.source, row.message_id, (JSON.parse(row.message) as Message<{result: string}>).data.result]), [['bunny/modules/gadget', outcome.id, 'failed']]);
  assert.deepEqual(shape(t.operation('req-reused')), ['completed', 'succeeded', 'observed', undefined], 'the stored outcome stands');
  assert.equal(t.changes.length, changes, 'no change, so no inbox item');
  await flush();
  assert.equal(t.gadget.acknowledged.length, acknowledged, 'and no acknowledgment');
});

it('a request ID names one action: the same action again answers what it got and sends nothing; anything else is duplicate-conflict', async context => {
  const t = await trackerRun(context);
  assert.deepEqual(await t.dispatch('req-once', 20), {status: 'accepted', requestId: 'req-once'});
  assert.deepEqual(await t.core.actions.dispatch({key: 'bunny.cmd.gadget-set.g1', draft: {...setGadget(20).draft, data: {level: 20}}, requestedBy: OPERATOR, requestId: 'req-once'}),
    {status: 'accepted', requestId: 'req-once'});
  const other = await t.dispatch('req-once', 80);
  assert.equal('error' in other && other.error.code, 'duplicate-conflict');
  const someoneElse = await t.core.actions.dispatch({...setGadget(20), requestedBy: 'bunny/parts/panel', requestId: 'req-once'});
  assert.equal('error' in someoneElse && someoneElse.error.code, 'duplicate-conflict');
  t.gadget.script({reply: 'invalid-state'});
  await t.dispatch('req-refused-once');
  const again = await t.dispatch('req-refused-once');
  assert.equal('error' in again && again.error.code, 'invalid-state', 'a refused action answers its refusal again');
  assert.deepEqual(t.gadget.commands.map(command => command.data.requestId), ['req-once', 'req-refused-once'], 'each sent once');
  const generated = await t.core.actions.dispatch({...setGadget(5), requestedBy: OPERATOR});
  assert.ok('status' in generated && /^[0-9a-f-]{36}$/.test(generated.requestId), 'one is generated otherwise');
});

it('the dispatcher refuses what is no tracked action before anything is recorded, and names moments and mode changes by their kind', async context => {
  const t = await trackerRun(context);
  const answer = (action: Parameters<CoreModule['actions']['dispatch']>[0]): Promise<string> =>
    t.core.actions.dispatch(action).then(result => 'error' in result ? result.error.code : result.status);
  assert.equal(await answer({key: 'bunny.state.gadget.g1', draft: setGadget(1).draft, requestedBy: OPERATOR}), 'invalid-request');
  assert.equal(await answer({key: 'bunny.cmd.gadget-set.g2', draft: setGadget(1).draft, requestedBy: OPERATOR}), 'invalid-message', 'a subject that is not its key\'s target');
  assert.equal(await answer({key: `bunny.cmd.approval-recover.${'0'.repeat(64)}`, draft: {...setGadget(1).draft, subject: '0'.repeat(64)}, requestedBy: OPERATOR}), 'invalid-request',
    'the core\'s own operator commands are no tracked actions');
  assert.equal(await answer({...setGadget(1), requestedBy: OPERATOR, requestId: 'not a request id'}), 'invalid-request');
  assert.equal(t.database().prepare('SELECT COUNT(*) AS count FROM core_operations').get()?.count, 0, 'nothing was recorded');
  // Nobody answers moments or mode changes here, but each is tracked with its kind's deadline.
  const moment = await t.core.actions.dispatch({
    key: 'bunny.cmd.moment-play.wall', requestedBy: OPERATOR, requestId: 'req-moment',
    draft: {type: 'org.bunny.moment.play.requested', subject: 'wall', dataschema: 'https://bunny.invalid/events/moment-play/2.0',
      data: {momentId: 'm1', mood: 'calm', durationMs: 5000, priorityClass: 'event', coversStatus: false, startAtMs: Date.now(), toleranceMs: 1000}},
  });
  assert.equal('error' in moment && moment.error.code, 'unavailable');
  const mode = await t.core.actions.dispatch({
    key: 'bunny.cmd.mode-set.hub', requestedBy: OPERATOR, requestId: 'req-mode',
    draft: {type: 'org.bunny.mode.set.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/mode-set/2.0', data: {mode: 'quiet'}},
  });
  assert.equal('error' in mode && mode.error.code, 'unavailable');
  for (const [requestId, kind] of [['req-moment', 'moment'], ['req-mode', 'mode']] as const) {
    const operation = t.operation(requestId);
    assert.deepEqual([operation?.kind, (operation?.deadlineAtMs ?? 0) - (operation?.sentAtMs ?? 0), operation?.result], [kind, DEADLINES[kind].outcomeMs, 'failed']);
  }
});

it('a full disk refuses an action with unavailable and storage-full before anything is sent, and an outcome is not acknowledged until it commits', async context => {
  const t = await trackerRun(context);
  await t.dispatch('req-before');
  await waitFor(() => t.operation('req-before')?.status === 'completed', 5000, 'the first action');
  t.gadget.script({outcome: 'none'});
  await t.dispatch('req-outcome-later');
  fillDisk(t.database());
  const refused = await t.dispatch('req-full');
  assert.equal('error' in refused && refused.error.code, 'unavailable');
  assert.equal('error' in refused && refused.error.detail, 'storage-full');
  assert.equal(t.operation('req-full'), undefined, 'nothing was recorded');
  assert.deepEqual(t.history('req-full'), [], 'neither the operation nor its history row: they commit together or not at all');
  assert.deepEqual(t.gadget.commands.map(command => command.data.requestId), ['req-before', 'req-outcome-later'], 'and nothing was sent');
  // An outcome that cannot commit is not acknowledged: the gadget keeps it and sends it again later.
  const outcome = await t.gadget.report('req-outcome-later', {result: 'succeeded', evidence: 'observed'});
  await waitFor(() => t.logs.some(record => record.event_name === 'message.received' && record.attributes['bunny.message.id'] === outcome.id && record.attributes['bunny.outcome'] === 'rejected'),
    5000, 'the refused intake');
  assert.equal(t.gadget.acknowledged.includes(outcome.id), false, 'no acknowledgment before the commit');
  assert.equal(t.operation('req-outcome-later')?.status, 'accepted');
  // An outcome no action awaits changes no operation row; its history row alone would commit, and still it is not
  // acknowledged while the commit is refused.
  const untracked = await t.gadget.report('req-untracked', {result: 'succeeded', evidence: 'observed'});
  await waitFor(() => t.logs.some(record => record.event_name === 'message.received' && record.attributes['bunny.message.id'] === untracked.id && record.attributes['bunny.outcome'] === 'rejected'),
    5000, 'the refused intake of an untracked outcome');
  await flush();
  assert.equal(t.gadget.acknowledged.includes(untracked.id), false, 'no acknowledgment of an outcome that did not commit');
  // Room again: the gadget's next start sends it again, and the core takes and acknowledges it.
  t.database().exec('PRAGMA max_page_count = 1073741823');
  await t.gadget.forge(outcome, outcome.data);
  await waitFor(() => t.operation('req-outcome-later')?.status === 'completed', 5000, 'the outcome once there is room');
  await waitFor(() => t.gadget.acknowledged.includes(outcome.id), 5000, 'its acknowledgment');
});

it('history keeps every occurrence and removal another module publishes, once, and each state as what changed', async context => {
  const sender = fixture('sender');
  const t = await trackerRun(context, {extra: [sender]});
  const {sdk} = contextOf(sender);
  const thing = {type: 'org.bunny.thing.updated', subject: 't1', dataschema: 'https://bunny.invalid/events/thing/2.0'};
  const state = (data: object): Promise<unknown> => sdk.publish('bunny.state.thing.t1', {kind: 'state', ...thing, data});
  await state({id: 't1', revision: 1, power: 'off', label: 'desk'});
  await state({id: 't1', revision: 2, power: 'on', label: 'desk'});
  await state({id: 't1', revision: 2, power: 'on', label: 'desk'});
  await state({id: 't1', revision: 1, power: 'off', label: 'desk'});
  await state({id: 't1', revision: 3, power: 'on'});
  const occurred = await sdk.publish('bunny.event.thing.t1', {
    kind: 'occurrence', type: 'org.bunny.thing.switched', subject: 't1', dataschema: 'https://bunny.invalid/events/thing-switched/2.0', data: {thing: 't1'},
  });
  await sdk.publishMessage('bunny.event.thing.t1', occurred);
  await sdk.publish('bunny.state.thing.t1', {
    kind: 'removal', type: 'org.bunny.thing.removed', subject: 't1', dataschema: 'https://bunny.invalid/events/removal/2.0',
    data: {entity: {family: 'thing', id: 't1'}, revision: 4, reason: 'deleted'},
  });
  await state({id: 't1', revision: 4, power: 'off'});
  const rows = (): {kind: string; record: Record<string, unknown>}[] =>
    (t.database().prepare('SELECT kind, record FROM core_history WHERE source = \'bunny/modules/sender\' ORDER BY seq').all() as {kind: string; record: string}[])
      .map(row => ({kind: row.kind, record: JSON.parse(row.record) as Record<string, unknown>}));
  await waitFor(() => rows().some(row => row.kind === 'removal'), 5000, 'the removal in history');
  await new Promise(resolve => { setTimeout(resolve, 50); });
  const changes = rows().filter(row => row.kind === 'change').map(({record}) => [record.revision, record.previous, record.changed, record.removed]);
  assert.deepEqual(changes, [
    [1, null, {power: 'off', label: 'desk'}, []], [2, 1, {power: 'on'}, []], [3, 2, {}, ['label']],
  ], 'what changed, not a snapshot: a repeat, a stale state and a state at the removal\'s revision add nothing');
  assert.deepEqual(rows().map(row => row.kind), ['change', 'change', 'change', 'occurrence', 'removal'], 'the resent occurrence is taken once');
  assert.deepEqual(rows()[3]?.record, occurred, 'an occurrence is kept whole');
});
