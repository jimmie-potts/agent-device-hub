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
import {ModuleHarness, moduleConformance, standInAckSchemas} from '@jimmie-potts/sdk/testing';
import {createCoreModule, type CoreOptions, type LogRecord, type RuntimeOptions} from '../src/index.js';
import {
  IDENTITY, OTHER, OTHER_ID, SESSION_ID, approvalPrompt, approvalResolved, observation, sessionStarted, turnEnded, turnStarted,
} from './fixtures/agents.js';
import {historySchemas, standInParts} from './fixtures/core.js';
import {fillDisk} from './fixtures/disk.js';
import {World} from './fixtures/store-world.js';
import {lampSchemas} from './fixtures/lamp.js';
import {START, contextOf, entry, fixture, health, it, manualClock, run, stateDir, waitFor, type Fixture} from './support.js';

const NOTICE_SCHEMA = 'https://bunny.invalid/events/notice-acknowledge/2.0';
const acknowledge = (session: string, consumerId: string, noticeId: string): {key: string; draft: CommandDraft<{consumerId: string; noticeId: string}>} => ({
  key: `bunny.cmd.notice-acknowledge.${session}`,
  draft: {type: 'org.bunny.notice.acknowledge.requested', subject: session, dataschema: NOTICE_SCHEMA, data: {consumerId, noticeId}},
});
const NO_NOTICE = 'f'.repeat(64);

moduleConformance({
  create: () => createCoreModule(),
  serves: ['session'],
  // The kit's probe is no consumer the core knows, so it may not acknowledge for one.
  refused: {...acknowledge(SESSION_ID, 'pixoo', NO_NOTICE), code: 'forbidden'},
});

const validator = new MessageValidator();
registerCoreFamilies(validator);
for (const [dataschema, schema] of Object.entries({...standInAckSchemas, ...historySchemas, ...lampSchemas})) validator.register(dataschema, schema);

type CoreRun = {
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
    logs, seen, invalid, url: runtime.url, sessions, record: (id = SESSION_ID) => sessions().find(record => record.id === id),
    hook: contextOf(hook).sdk, pixoo: contextOf(pixoo).sdk, nanoleaf: contextOf(nanoleaf).sdk,
  };
}

const publish = async (sdk: Sdk, ...args: Parameters<typeof observation>): Promise<Message> => {
  const {key, draft} = observation(...args);
  return sdk.publish(key, draft);
};
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
  const ask = async (sdk: Sdk, ...args: Parameters<typeof acknowledge>): Promise<string> => {
    const {key, draft} = acknowledge(...args);
    const result = await sdk.request(key, draft, {timeoutMs: 5000});
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
  assert.equal(await ask(core.pixoo, SESSION_ID, 'pixoo', noticeId), 'accepted', 'a repeat is accepted');
  assert.equal(core.record()?.revision, acknowledged, 'and changes nothing');
  assert.equal(core.seen.some(message => message.kind === 'outcome' && message.source === 'bunny/core'), false, 'the reply is the whole answer');
  const rejected = core.logs.filter(record => record.event_name === 'command.rejected').map(record => [record.attributes['bunny.code'], record.severity_text]);
  assert.deepEqual(rejected, [['forbidden', 'WARN'], ['invalid-request', 'INFO'], ['not-found', 'INFO'], ['not-found', 'INFO']]);
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
  assert.deepEqual([refusal?.attributes['bunny.code'], refusal?.attributes['bunny.reason'], refusal?.severity_text], ['capacity', 'busy', 'WARN']);
  assert.equal(received(core.logs, 'accepted').length, 1, 'only the first observation was accepted');
  assert.deepEqual(core.seen.slice(seen).filter(message => message.source === 'bunny/core'), [], 'nothing published');
  assert.equal(core.sessions().length, 1);

  // Room again: the core opens its owner again on what committed, and the hook's retry of the same message is taken.
  database.exec('PRAGMA max_page_count = 1073741823');
  await core.hook.publishMessage(key, sent);
  await waitFor(() => core.sessions().length === 2, 5000, 'the second session');
  assert.equal(received(core.logs, 'accepted').length, 2);
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
  const {logs} = await run(context, {modules: [createCoreModule({parts: [standInParts()]}), bridge()], stateDir: dir});
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
