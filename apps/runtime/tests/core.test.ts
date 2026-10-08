// The agent-session core under the runtime (Hub #831): the source `bunny/core`, first in the module list, taking hook
// observations, publishing session state, removal and occurrence messages, serving sync, answering notice
// acknowledgments, and refusing durable work on a full disk. In-test modules play the hooks, consumers and modules.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, Outbox, type BunnyModule, type CommandDraft, type Sdk, type SyncedCopy} from '@jimmie-potts/sdk';
import {ModuleHarness, moduleConformance} from '@jimmie-potts/sdk/testing';
import {createCoreModule, type CoreOptions, type CorePart, type LogRecord, type Runtime, type RuntimeOptions} from '../src/index.js';
import {
  IDENTITY, OTHER, OTHER_ID, SESSION_ID, approvalPrompt, approvalResolved, observation, sessionStarted, turnEnded, turnStarted, unknownApproval,
} from './fixtures/agents.js';
import {fillDisk} from './fixtures/disk.js';
import {World} from './fixtures/store-world.js';
import {lampSchemas} from './fixtures/lamp.js';
import {START, contextOf, entry, fixture, flush, health, it, manualClock, run, stateDir, waitFor, type Fixture} from './support.js';

const NOTICE_SCHEMA = 'https://bunny.invalid/events/notice-acknowledge/2.0';
const acknowledge = (session: string, consumerId: string, noticeId: string): {key: string; draft: CommandDraft<{consumerId: string; noticeId: string}>} => ({
  key: `bunny.cmd.notice-acknowledge.${session}`,
  draft: {type: 'org.bunny.notice.acknowledge.requested', subject: session, dataschema: NOTICE_SCHEMA, data: {consumerId, noticeId}},
});
const NO_NOTICE = 'f'.repeat(64);

moduleConformance({
  create: () => createCoreModule(),
  // Its sessions, and its operation records (Hub #922): the kit syncs each family alone.
  serves: ['session', 'operation', 'inbox-item'],
  // The kit's probe, `bunny/kit`, is no consumer the core records acknowledgments for: a domain refusal, at INFO.
  refused: {...acknowledge(SESSION_ID, 'kit', NO_NOTICE), code: 'invalid-request'},
});

const validator = new MessageValidator();
registerCoreFamilies(validator);
for (const [dataschema, schema] of Object.entries({...lampSchemas})) validator.register(dataschema, schema);

type CoreRun = {
  runtime: Runtime;
  logs: LogRecord[];
  /** Every message the bus carried. Each the core published is checked against profile 2.0. */
  seen: Message[];
  invalid: string[];
  hook: Sdk;
  pixoo: Sdk;
  nanoleaf: Sdk;
  /** The watcher's synced copy of the core's sessions. */
  sessions: () => SessionRecord[];
  record: (id?: string) => SessionRecord | undefined;
  url: string;
};

/**
 * The runtime with the core first, then a watcher that keeps a synced copy of the sessions and sees every message, and
 * modules that play a hook and two consumers, `pixoo` and `nanoleaf`.
 */
async function coreRun(context: TestContext, options: Partial<RuntimeOptions> & {core?: CoreOptions; extra?: readonly BunnyModule[]} = {}): Promise<CoreRun> {
  const seen: Message[] = [];
  const invalid: string[] = [];
  let copy: SyncedCopy<Record<string, unknown>> | undefined;
  const watcher = fixture('watcher', async ({sdk}) => {
    await sdk.subscribe('bunny.*.*.*', message => {
      const checked = validator.validate(message);
      if (message.source === 'bunny/core' && !checked.ok) invalid.push(`${message.type}: ${checked.error.detail ?? checked.error.code}`);
      seen.push(message);
    });
    const synced = await sdk.sync(['session'], () => {}, {timeoutMs: 5000});
    assert.equal(synced.status, 'synced');
    if (synced.status === 'synced') copy = synced.copy;
  });
  const hook = fixture('hook'), pixoo = fixture('pixoo'), nanoleaf = fixture('nanoleaf');
  const {core, extra = [], ...rest} = options;
  const {runtime, logs} = await run(context, {modules: [createCoreModule(core), watcher, hook, pixoo, nanoleaf, ...extra], ...rest});
  context.after(() => { assert.deepEqual(invalid, [], 'every message the core published follows profile 2.0'); });
  const sessions = (): SessionRecord[] => (copy?.states() ?? []).map(state => state.data as SessionRecord);
  return {
    runtime, logs, seen, invalid, url: runtime.url, sessions, record: (id = SESSION_ID) => sessions().find(record => record.id === id),
    hook: contextOf(hook).sdk, pixoo: contextOf(pixoo).sdk, nanoleaf: contextOf(nanoleaf).sdk,
  };
}

const publish = async (sdk: Sdk, ...args: Parameters<typeof observation>): Promise<Message> => {
  const {key, draft} = observation(...args);
  return sdk.publish(key, draft);
};
const traceOf = (message: Message | undefined): string | undefined => message?.traceparent.split('-')[1];
/** The core's records of its store refusing durable work, and of its recovery. */
const storage = (logs: readonly LogRecord[]): LogRecord[] =>
  logs.filter(record => record.attributes['bunny.module'] === 'core' && record.attributes['bunny.operation'] === 'storage' && record.severity_text !== 'DEBUG');
const received = (logs: readonly LogRecord[], outcome: string): LogRecord[] =>
  logs.filter(record => record.attributes['bunny.module'] === 'core' && record.event_name === 'message.received' && record.attributes['bunny.outcome'] === outcome);

it('the core runs as bunny/core with zero device modules: hooks\' observations become sessions every copy syncs, and health is ok', async context => {
  const core = await coreRun(context);
  const report = await health(core.url);
  assert.equal(report.body.status, 'ok');
  assert.equal(entry(report.body, 'core').state, 'running');
  const sent = await publish(core.hook, sessionStarted, Date.now());
  await publish(core.hook, sessionStarted, Date.now(), {identity: OTHER});
  await waitFor(() => core.sessions().length === 2, 5000, 'both sessions in the copy');
  const state = core.seen.find(message => message.type === 'org.bunny.session.updated');
  assert.equal(state?.source, 'bunny/core');
  assert.equal(state?.traceparent.split('-')[1], sent.traceparent.split('-')[1], 'the session joins the hook\'s trace');
  assert.deepEqual(core.sessions().map(record => record.identity.sessionId).sort(), [IDENTITY.sessionId, OTHER.sessionId].sort());
  const [accepted] = received(core.logs, 'accepted');
  assert.equal(accepted?.attributes['bunny.participant'], 'bunny/modules/hook');
  assert.equal(accepted?.attributes['bunny.message.id'], sent.id);
  assert.equal(accepted?.trace_id, sent.traceparent.split('-')[1]);
});

it('an approval prompt is raised and cleared, and a finished turn stays on its session record with no inbox item', async context => {
  const core = await coreRun(context);
  await publish(core.hook, turnStarted, Date.now());
  await publish(core.hook, approvalPrompt('approval-1'), Date.now());
  await waitFor(() => core.record()?.attention.length === 1, 5000, 'the waiting session');
  await publish(core.hook, approvalResolved('approval-1'), Date.now());
  await publish(core.hook, turnEnded, Date.now());
  await waitFor(() => core.record()?.activity === 'idle', 5000, 'the finished turn');
  const record = core.record();
  assert.deepEqual(record?.attention, []);
  assert.equal(record?.notices.length, 1, 'the finished turn\'s unread notice is on the record');
  const occurrences = core.seen.filter(message => message.kind === 'occurrence' && message.source === 'bunny/core').map(message => message.type);
  assert.deepEqual(occurrences, ['org.bunny.attention.raised', 'org.bunny.attention.cleared', 'org.bunny.turn.ended']);
  assert.equal(core.seen.some(message => message.dataschema.includes('/inbox-item/')), false, 'no inbox item');
});

it('a consumer acknowledges a notice for itself only, and each consumer\'s acknowledgment is recorded apart', async context => {
  const core = await coreRun(context);
  await publish(core.hook, turnStarted, Date.now());
  await publish(core.hook, turnEnded, Date.now());
  await waitFor(() => core.record()?.notices.length === 1, 5000, 'the notice');
  const noticeId = core.record()?.notices[0]?.id ?? '';
  let lastReply: Message | undefined;
  const ask = async (sdk: Sdk, ...args: Parameters<typeof acknowledge>): Promise<string> => {
    const {key, draft} = acknowledge(...args);
    const result = await sdk.request(key, draft, {timeoutMs: 5000});
    if (result.status === 'accepted') lastReply = result.reply;
    return result.status === 'accepted' ? 'accepted' : result.error.error.code;
  };
  const revision = core.record()?.revision ?? 0;
  assert.equal(await ask(core.nanoleaf, SESSION_ID, 'pixoo', noticeId), 'forbidden', 'nanoleaf may not acknowledge for pixoo');
  assert.equal(await ask(core.pixoo, SESSION_ID, 'tidbyt', noticeId), 'invalid-request', 'no such consumer');
  assert.equal(await ask(core.pixoo, SESSION_ID, 'pixoo', NO_NOTICE), 'not-found', 'no such notice');
  assert.equal(await ask(core.pixoo, OTHER_ID, 'pixoo', noticeId), 'not-found', 'no such session');
  assert.equal(core.record()?.revision, revision, 'no refusal changed the record');

  assert.equal(await ask(core.pixoo, SESSION_ID, 'pixoo', noticeId), 'accepted');
  await waitFor(() => (core.record()?.revision ?? 0) > revision, 5000, 'the acknowledged record');
  assert.deepEqual(core.record()?.notices[0]?.acknowledgedBy, ['pixoo'], 'recorded for pixoo only; nanoleaf\'s notice is untouched');
  const acknowledged = core.record()?.revision;
  const state = core.seen.filter(message => message.type === 'org.bunny.session.updated').at(-1);
  assert.equal(traceOf(state), traceOf(lastReply), 'the acknowledged record joins the command\'s trace');
  assert.equal(await ask(core.pixoo, SESSION_ID, 'pixoo', noticeId), 'accepted', 'a repeat is accepted');
  assert.equal(core.record()?.revision, acknowledged, 'and changes nothing');
  assert.equal(core.seen.some(message => message.kind === 'outcome' && message.source === 'bunny/core'), false, 'the reply is the whole answer');
  const rejected = core.logs.filter(record => record.event_name === 'command.rejected').map(record => [record.attributes['bunny.code'], record.severity_text]);
  assert.deepEqual(rejected, [['forbidden', 'WARN'], ['invalid-request', 'INFO'], ['not-found', 'INFO'], ['not-found', 'INFO']]);
});

const RECOVER_SCHEMA = 'https://bunny.invalid/events/approval-recover/2.0';
const recover = (session: string, turnId: string, expectedRevision: number): {key: string; draft: CommandDraft<{turnId: string; expectedRevision: number}>} => ({
  key: `bunny.cmd.approval-recover.${session}`,
  draft: {type: 'org.bunny.approval.recover.requested', subject: session, dataschema: RECOVER_SCHEMA, data: {turnId, expectedRevision}},
});

it('an operator recovers the one uncertain approval without an ID once the session\'s evidence is uncertain, and only then', async context => {
  const clock = manualClock();
  const core = await coreRun(context, {clock: {now: clock.now}, scheduler: clock.scheduler});
  const ask = async (...args: Parameters<typeof recover>): Promise<{answer: string; reply?: Message}> => {
    const {key, draft} = recover(...args);
    const result = await core.pixoo.request(key, draft, {timeoutMs: 5000});
    return result.status === 'accepted' ? {answer: 'accepted', reply: result.reply} : {answer: result.error.error.code};
  };
  await publish(core.hook, turnStarted, START);
  await publish(core.hook, unknownApproval, START);
  await waitFor(() => core.record()?.attention.length === 1, 5000, 'the waiting session');
  const waiting = core.record()?.revision ?? -1;
  assert.equal((await ask(SESSION_ID, 'turn-1', waiting)).answer, 'invalid-state', 'evidence is current, so the marker may still be real');
  assert.equal((await ask(OTHER_ID, 'turn-1', waiting)).answer, 'not-found', 'no such session');
  // Five minutes without evidence: the record turns uncertain at a new revision.
  clock.advance(300_000);
  await waitFor(() => core.record()?.freshness === 'uncertain', 5000, 'the uncertain record');
  const uncertain = core.record()?.revision ?? -1;
  assert.ok(uncertain > waiting);
  assert.equal((await ask(SESSION_ID, 'turn-1', waiting)).answer, 'revision-conflict', 'the operator read an older record');
  assert.equal((await ask(SESSION_ID, 'turn-2', uncertain)).answer, 'invalid-state', 'no marker on that turn');
  assert.equal(core.record()?.attention.length, 1, 'no refusal changed the record');

  const recovered = await ask(SESSION_ID, 'turn-1', uncertain);
  assert.equal(recovered.answer, 'accepted');
  await waitFor(() => core.record()?.attention.length === 0, 5000, 'the cleared marker in the copy');
  const cleared = core.seen.find(message => message.type === 'org.bunny.attention.cleared');
  assert.equal((cleared?.data as {cause?: string} | undefined)?.cause, 'recovered');
  assert.equal(traceOf(cleared), traceOf(recovered.reply), 'the recovery joins the command\'s trace');
  assert.equal((await ask(SESSION_ID, 'turn-1', core.record()?.revision ?? -1)).answer, 'invalid-state', 'a second recovery finds nothing to retire');
  assert.equal(core.seen.some(message => message.kind === 'outcome' && message.source === 'bunny/core'), false, 'the reply is the whole answer');
  const rejected = core.logs.filter(record => record.event_name === 'command.rejected').map(record => [record.attributes['bunny.code'], record.severity_text]);
  assert.deepEqual(rejected, [['invalid-state', 'INFO'], ['not-found', 'INFO'], ['revision-conflict', 'INFO'], ['invalid-state', 'INFO'], ['invalid-state', 'INFO']]);
  const completed = core.logs.filter(record => record.event_name === 'command.completed' && record.attributes['bunny.participant'] === 'bunny/modules/pixoo');
  assert.equal(completed.length, 1);
});

it('the core\'s sessions tool reads the sessions it holds, filtered by provider and text, and changes nothing', async context => {
  const module = createCoreModule();
  const tool = module.manifest.tools?.find(entry => entry.name === 'sessions');
  assert.ok(tool);
  assert.deepEqual(await tool.read({}), {error: {code: 'unavailable', retryable: true, detail: 'the core is not serving its sessions now'}}, 'not before it starts');
  const watcher = fixture('watcher');
  await run(context, {modules: [module, watcher]});
  const sdk = contextOf(watcher).sdk;
  await publish(sdk, sessionStarted, Date.now(), {title: {value: 'Port Nanoleaf', source: 'provider'}});
  await publish(sdk, sessionStarted, Date.now(), {identity: OTHER});
  const all = async (): Promise<SessionRecord[]> => ((await tool.read({})) as {sessions: SessionRecord[]}).sessions;
  await waitFor(async () => (await all()).length === 2, 5000, 'both sessions');
  const titled = (await tool.read({q: 'NANOLEAF'})) as {revision: number; sessions: SessionRecord[]};
  assert.deepEqual(titled.sessions.map(record => record.identity.sessionId), [IDENTITY.sessionId]);
  assert.ok(titled.revision > 0);
  assert.deepEqual(((await tool.read({provider: 'codex'})) as {sessions: unknown[]}).sessions, []);
  assert.equal(((await tool.read({q: OTHER.sessionId})) as {sessions: unknown[]}).sessions.length, 1);
});

it('an observation that breaks profile 2.0, or reuses (source, id) with other content, changes nothing', async context => {
  const core = await coreRun(context);
  const {key, draft} = observation(sessionStarted, Date.now());
  await core.hook.publish(key, {...draft, subject: OTHER_ID});
  const sent = await core.hook.publish(key, draft);
  await core.hook.publishMessage(key, {...sent, data: {...sent.data, observedAtMs: (sent.data as {observedAtMs: number}).observedAtMs + 1}});
  await waitFor(() => received(core.logs, 'rejected').length === 2, 5000, 'both refusals');
  assert.deepEqual(received(core.logs, 'rejected').map(record => record.attributes['bunny.code']), ['invalid-message', 'duplicate-conflict']);
  assert.equal(received(core.logs, 'accepted').length, 1);
  assert.equal(core.sessions().length, 1);
});

it('freshness turns uncertain on the core\'s own timer at five minutes, at a revision every copy applies', async context => {
  const clock = manualClock();
  const core = await coreRun(context, {clock: {now: clock.now}, scheduler: clock.scheduler});
  await publish(core.hook, sessionStarted, START);
  await waitFor(() => core.record() !== undefined, 5000, 'the session');
  const before = core.record();
  assert.equal(before?.freshness, 'current');
  clock.advance(299_999);
  await new Promise(resolve => { setImmediate(resolve); });
  assert.equal(core.record()?.freshness, 'current');
  clock.advance(1);
  await waitFor(() => core.record()?.freshness === 'uncertain', 5000, 'the uncertain record in the copy');
  assert.ok((core.record()?.revision ?? 0) > (before?.revision ?? 0));
});

it('a full disk refuses an observation before anything reports it accepted, changes nothing, and once there is room the core takes it', async context => {
  let database: DatabaseSync | undefined;
  const core = await coreRun(context, {core: {parts: [{open: db => { database = db; }}]}});
  await publish(core.hook, sessionStarted, Date.now());
  await waitFor(() => core.sessions().length === 1, 5000, 'the first session');
  assert.ok(database);
  fillDisk(database);
  const seen = core.seen.length;
  const {key, draft} = observation(sessionStarted, Date.now(), {identity: OTHER, title: {value: 'x'.repeat(160), source: 'user'}});
  const sent = await core.hook.publish(key, draft);
  await waitFor(() => received(core.logs, 'rejected').length === 1, 5000, 'the refusal');
  const [refusal] = received(core.logs, 'rejected');
  assert.deepEqual([refusal?.attributes['bunny.code'], refusal?.attributes['bunny.reason'], refusal?.severity_text], ['capacity', 'busy', 'INFO']);
  assert.deepEqual(storage(core.logs).map(record => [record.event_name, record.severity_text, record.attributes['bunny.code']]),
    [['operation.failed', 'WARN', 'capacity']], 'the condition is recorded once');
  assert.equal(received(core.logs, 'accepted').length, 1, 'only the first observation was accepted');
  assert.deepEqual(core.seen.slice(seen).filter(message => message.source === 'bunny/core'), [], 'nothing published');
  assert.equal(core.sessions().length, 1);

  // Room again: the core opens its owner again on what committed, and the hook's retry of the same message is taken.
  database.exec('PRAGMA max_page_count = 1073741823');
  await core.hook.publishMessage(key, sent);
  await waitFor(() => core.sessions().length === 2, 5000, 'the second session');
  assert.equal(received(core.logs, 'accepted').length, 2);
  assert.deepEqual(storage(core.logs).map(record => [record.event_name, record.severity_text]), [['operation.failed', 'WARN'], ['operation.completed', 'INFO']], 'and its recovery');
});

it('the core starts first: a module that syncs and republishes in its own start finds it listening', async context => {
  const dir = await stateDir(context);
  // The first runtime has no core: the bridge's outcome is published to nobody and stays in its outbox, unacknowledged.
  const bridge = (): Fixture => fixture('bridge', async ({sdk, database, clock}) => {
    const outbox = new Outbox({sdk, database: database(), clock});
    const synced = await sdk.sync(['session'], () => {}, {timeoutMs: 5000});
    if (synced.status === 'synced') await synced.copy.close();
    if (await outbox.republish() > 0) return;
    await outbox.transaction(add => {
      add('bunny.event.lamp.bridge', {kind: 'outcome', type: 'org.bunny.lamp.switch.completed', subject: 'bridge', dataschema: 'https://bunny.invalid/events/outcome/2.0',
        data: {requestId: 'req-bridge', result: 'succeeded', evidence: 'observed'}});
    });
  });
  await run(context, {modules: [bridge()], stateDir: dir}).then(({runtime}) => runtime.stop()).catch(() => {});
  const {logs} = await run(context, {modules: [createCoreModule(), bridge()], stateDir: dir});
  await waitFor(() => received(logs, 'accepted').some(record => record.attributes['bunny.request.id'] === 'req-bridge'), 5000, 'the republished outcome');
  assert.equal(logs.filter(record => record.attributes['bunny.module'] === 'bridge' && record.event_name === 'runtime.module.failed').length, 0);
});

it('a stop that comes while the core still starts waits for it, shuts its owner down and lets the next start take the lease', async context => {
  const dir = await stateDir(context);
  // Another owner holds the lease, so the core's start waits for it.
  const blocker = await World.open(context, {file: join(dir, 'core.sqlite')});
  const bus = new InProcessBus();
  const first = new ModuleHarness(createCoreModule(), {bus, stateDir: dir});
  let settled = false;
  const starting = first.start().finally(() => { settled = true; });
  await new Promise(resolve => { setTimeout(resolve, 100); });
  const stopping = first.stop();
  await blocker.owner?.shutdown();
  blocker.store.close();
  await stopping;
  assert.equal(settled, true, 'the stop waited for the start');
  await starting.catch(() => {});
  assert.deepEqual(first.failures, []);
  const second = new ModuleHarness(createCoreModule(), {bus, stateDir: dir});
  await second.start();
  context.after(() => second.stop());
  const synced = await bus.connect('bunny/parts/reader').sync(['session'], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'synced', 'the second core took the lease and serves its sessions');
  if (synced.status === 'synced') await synced.copy.close();
});

/** A part that only hands the test the core store's connection, to fill its disk. */
const diskPart = (opened: (database: DatabaseSync) => void): CorePart => ({open: opened});
const ROOM = 'PRAGMA max_page_count = 1073741823';

it('a full disk refuses an acknowledgment with capacity before it records anything, and once there is room it is recorded', async context => {
  let database: DatabaseSync | undefined;
  const core = await coreRun(context, {core: {parts: [diskPart(db => { database = db; })]}});
  await publish(core.hook, turnStarted, Date.now());
  await publish(core.hook, turnEnded, Date.now());
  await waitFor(() => core.record()?.notices.length === 1, 5000, 'the notice');
  const noticeId = core.record()?.notices[0]?.id ?? '';
  const revision = core.record()?.revision;
  assert.ok(database);
  fillDisk(database);
  const {key, draft} = acknowledge(SESSION_ID, 'pixoo', noticeId);
  const refusedReply = await core.pixoo.request(key, draft, {timeoutMs: 5000});
  assert.equal(refusedReply.status === 'rejected' && refusedReply.error.error.code, 'capacity');
  assert.equal(core.record()?.revision, revision, 'nothing was recorded');
  database.exec(ROOM);
  const accepted = await core.pixoo.request(key, draft, {timeoutMs: 5000});
  assert.equal(accepted.status, 'accepted');
  await waitFor(() => core.record()?.notices[0]?.acknowledgedBy.includes('pixoo') === true, 5000, 'the acknowledgment');
});

it('freshness the store cannot publish is tried again on a capped, doubling backoff, with one condition record and a summary a minute', async context => {
  const clock = manualClock();
  let database: DatabaseSync | undefined;
  const hook = fixture('hook');
  const {logs} = await run(context, {
    modules: [createCoreModule({parts: [diskPart(db => { database = db; })]}), hook], clock: {now: clock.now}, scheduler: clock.scheduler, logLevel: 'debug',
  });
  await publish(contextOf(hook).sdk, sessionStarted, START);
  await waitFor(() => received(logs, 'accepted').length === 1, 5000, 'the session');
  assert.ok(database);
  fillDisk(database);
  const attempts = (): number => logs.filter(record => record.event_name === 'operation.failed' && record.attributes['bunny.operation'] === 'status').length;
  // The record turns uncertain at five minutes; the store refuses that and every attempt for the next two minutes.
  clock.advance(300_000);
  await flush();
  for (let second = 0; second < 125; second += 1) {
    clock.advance(1000);
    await flush();
  }
  assert.equal(attempts(), 8, 'attempts at 0, 1, 3, 7, 15, 31, 63 and 123 s: doubling, capped at 60 s');
  assert.deepEqual(storage(logs).map(record => [record.severity_text, record.attributes['bunny.duration_ms'], record.attributes['bunny.attempt_count']]),
    [['WARN', undefined, undefined], ['WARN', 63_000, 6], ['WARN', 123_000, 1]], 'the transition, then a summary at most once a minute with the refusals since');
  // Room again: the next attempt, 60 s after the last, publishes the record, and the condition ends with one record.
  database.exec(ROOM);
  clock.advance(60_000);
  await waitFor(() => storage(logs).at(-1)?.event_name === 'operation.completed', 5000, 'the recovery');
  assert.equal(attempts(), 8);
});

it('a duplicate observation is logged at DEBUG only, and changes nothing', async context => {
  const hook = fixture('hook');
  const {logs} = await run(context, {modules: [createCoreModule(), hook], logLevel: 'debug'});
  const {key, draft} = observation(sessionStarted, Date.now());
  const sent = await contextOf(hook).sdk.publish(key, draft);
  await contextOf(hook).sdk.publishMessage(key, sent);
  await waitFor(() => received(logs, 'duplicate').length === 1, 5000, 'the duplicate');
  assert.deepEqual(received(logs, 'duplicate').map(record => record.severity_text), ['DEBUG']);
  assert.equal(received(logs, 'accepted').length, 1);
});

it('a malformed message is refused, and its record is written with only its well-formed fields', async context => {
  const hook = fixture('hook');
  const {logs} = await run(context, {modules: [createCoreModule(), hook]});
  const {key, draft} = observation(sessionStarted, Date.now());
  const sent = await contextOf(hook).sdk.publish(key, {...draft, subject: OTHER_ID});
  await contextOf(hook).sdk.publishMessage(key, {...sent, id: 'not a valid id!'});
  await waitFor(() => received(logs, 'rejected').length === 2, 5000, 'both refusals');
  const [, malformed] = received(logs, 'rejected');
  assert.equal(malformed?.attributes['bunny.message.id'], undefined, 'the malformed id is left out');
  assert.equal(malformed?.attributes['bunny.participant'], 'bunny/modules/hook');
  // `run` also checks that the writer dropped no record.
});

it('a restart with stored sessions on a full disk keeps the core running: syncs wait for room, intake is refused, and both recover', async context => {
  const dir = await stateDir(context);
  const first = fixture('hook');
  const {runtime: before, logs: earlier} = await run(context, {modules: [createCoreModule(), first], stateDir: dir});
  await publish(contextOf(first).sdk, sessionStarted, Date.now());
  await waitFor(() => received(earlier, 'accepted').length === 1, 5000, 'the stored session');
  await before.stop();

  let database: DatabaseSync | undefined;
  const hook = fixture('hook'), reader = fixture('reader');
  const {runtime, logs} = await run(context, {modules: [createCoreModule({parts: [diskPart(db => { fillDisk(db); database = db; })]}), hook, reader], stateDir: dir});
  assert.equal(entry((await health(runtime.url)).body, 'core').state, 'running', 'the core runs');
  const sync = (): ReturnType<Sdk['sync']> => contextOf(reader).sdk.sync(['session'], () => {}, {timeoutMs: 5000});
  const refused = await sync();
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'unavailable', 'no sync until the restart\'s uncertainty is published');
  await publish(contextOf(hook).sdk, sessionStarted, Date.now(), {identity: OTHER});
  await waitFor(() => received(logs, 'rejected').length === 1, 5000, 'the refused observation');
  assert.equal(received(logs, 'rejected')[0]?.attributes['bunny.code'], 'capacity');

  assert.ok(database);
  database.exec(ROOM);
  // The next freshness attempt, a second after the failed one, publishes the restart's uncertainty.
  await waitFor(() => storage(logs).at(-1)?.event_name === 'operation.completed', 5000, 'the recovery');
  const synced = await sync();
  assert.equal(synced.status, 'synced');
  if (synced.status !== 'synced') return;
  assert.deepEqual(synced.copy.states().map(state => (state.data as SessionRecord).restartUncertain), [true]);
  await synced.copy.close();
  await publish(contextOf(hook).sdk, sessionStarted, Date.now(), {identity: OTHER});
  await waitFor(() => received(logs, 'accepted').length === 1, 5000, 'the observation after room is freed');
  assert.equal(entry((await health(runtime.url)).body, 'core').state, 'running');
});

it('maintenance that falls due on a full disk leaves the core running, refusing intake, and it opens its owner again on a capped backoff', async context => {
  // On a real full disk even a change that frees space fails, since its rollback journal needs room; the page limit lets
  // such a change through. This part fails every change that publishes as SQLite does then, with SQLITE_FULL.
  let full = false;
  const disk: CorePart = {derive: () => { if (full) throw Object.assign(new Error('database or disk is full'), {errcode: 13}); }};
  const clock = manualClock();
  const hook = fixture('hook');
  const {runtime, logs} = await run(context, {
    modules: [createCoreModule({parts: [disk]}), hook], clock: {now: clock.now}, scheduler: clock.scheduler, logLevel: 'debug',
  });
  const {sdk} = contextOf(hook);
  await publish(sdk, sessionStarted, START);
  await waitFor(() => received(logs, 'accepted').length === 1, 5000, 'the first session');
  // A day later the first session is due to expire, and the disk is full.
  clock.advance(86_400_001);
  await flush();
  full = true;
  const reopens = (): number => logs.filter(record => record.event_name === 'operation.failed' && record.attributes['bunny.operation'] === 'storage' && record.severity_text === 'DEBUG').length;
  await publish(sdk, sessionStarted, clock.now(), {identity: OTHER});
  await waitFor(() => received(logs, 'rejected').length === 1, 5000, 'the refusal');
  assert.equal(reopens(), 1, 'opening the owner again ran its maintenance, which the full disk refused');
  await publish(sdk, sessionStarted, clock.now(), {identity: OTHER});
  await waitFor(() => received(logs, 'rejected').length === 2, 5000, 'the second refusal');
  assert.equal(reopens(), 1, 'within the backoff the core does not try again');
  assert.deepEqual(received(logs, 'rejected').map(record => record.attributes['bunny.code']), ['capacity', 'capacity']);
  assert.equal(entry((await health(runtime.url)).body, 'core').state, 'running');

  full = false;
  clock.advance(1000);
  await publish(sdk, sessionStarted, clock.now(), {identity: OTHER});
  await waitFor(() => received(logs, 'accepted').length === 2, 5000, 'the observation after room is freed');
  assert.ok(logs.some(record => record.event_name === 'operation.completed' && record.attributes['bunny.operation'] === 'storage'), 'the condition ended');
});

it('a restart whose start-up maintenance falls on a full disk starts the core anyway, refusing intake until it has room', async context => {
  let full = false;
  const disk: CorePart = {derive: () => { if (full) throw Object.assign(new Error('database or disk is full'), {errcode: 13}); }};
  const dir = await stateDir(context);
  const clock = manualClock();
  const first = fixture('hook');
  const {runtime: before, logs: earlier} = await run(context, {modules: [createCoreModule(), first], stateDir: dir, clock: {now: clock.now}, scheduler: clock.scheduler});
  await publish(contextOf(first).sdk, sessionStarted, START);
  await waitFor(() => received(earlier, 'accepted').length === 1, 5000, 'the stored session');
  await before.stop();

  // A day later the stored session is due to expire as the owner opens, and the disk is full.
  clock.advance(86_400_001);
  full = true;
  const hook = fixture('hook');
  const {runtime, logs} = await run(context, {modules: [createCoreModule({parts: [disk]}), hook], stateDir: dir, clock: {now: clock.now}, scheduler: clock.scheduler});
  assert.equal(entry((await health(runtime.url)).body, 'core').state, 'running', 'no failure exit, so no restart loop');
  await publish(contextOf(hook).sdk, sessionStarted, clock.now(), {identity: OTHER});
  await waitFor(() => received(logs, 'rejected').length === 1, 5000, 'the refusal');
  assert.equal(received(logs, 'rejected')[0]?.attributes['bunny.code'], 'capacity');
  full = false;
  clock.advance(1000);
  await publish(contextOf(hook).sdk, sessionStarted, clock.now(), {identity: OTHER});
  await waitFor(() => received(logs, 'accepted').length === 1, 5000, 'the observation once there is room');
});

it('a second core never gets the store while the first opens its owner again after a failed commit', async context => {
  const dir = await stateDir(context);
  let database: DatabaseSync | undefined;
  const bus = new InProcessBus();
  const first = new ModuleHarness(createCoreModule({parts: [diskPart(db => { database = db; })]}), {bus, stateDir: dir});
  await first.start();
  context.after(() => first.stop());
  const hook = bus.connect('bunny/parts/hook');
  context.after(() => hook.close());
  const taken = (outcome: string): number => first.logs.filter(entry => entry.event === 'message.received' && entry.fields['bunny.outcome'] === outcome).length;
  await publish(hook, sessionStarted, Date.now());
  await waitFor(() => taken('accepted') === 1, 5000, 'the first session');
  assert.ok(database);
  const revisionOnDisk = (): number => (database?.prepare('SELECT value FROM core_revision').get() as {value: number} | undefined)?.value ?? 0;
  const before = revisionOnDisk();

  // A second core, as a second runtime on the same state directory would, cannot open the core's database, which the
  // first keeps to itself (Hub #972). The store's own tests cover the lease behind it.
  const second = new ModuleHarness(createCoreModule(), {bus: new InProcessBus(), stateDir: dir});
  const contending = second.start().then(() => 'started', () => 'refused');
  fillDisk(database);
  const refused = await publish(hook, sessionStarted, Date.now(), {identity: OTHER});
  await waitFor(() => taken('rejected') === 1, 5000, 'the refused observation');
  assert.equal(await contending, 'refused', 'the first core kept its store through opening its owner again');
  await second.stop();
  assert.equal(revisionOnDisk(), before, 'the refused change left the revision as it was');
  assert.equal(database.prepare('SELECT 1 FROM core_taken WHERE id = ?').get(refused.id), undefined, 'and took nothing');

  database.exec(ROOM);
  await publish(hook, sessionStarted, Date.now(), {identity: OTHER});
  await waitFor(() => taken('accepted') === 2, 5000, 'the observation after room is freed');
  assert.ok(revisionOnDisk() > before, 'the revision only rises');
  assert.deepEqual(first.failures, []);
});
