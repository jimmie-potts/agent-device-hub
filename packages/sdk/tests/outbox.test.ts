// The per-module outbox (Hub #882, ADR 0012 "Ownership and publication"): messages commit with the module's own
// changes and go out after the commit with their stored id and time. A message a crash kept from going out goes out at
// the next start; an outcome goes out again at every start until the core acknowledges it, and the core drops the
// duplicates by (source, id). What went out is forgotten in one commit per batch (Hub #972), so only a crash between a
// batch's sends and that commit, or a failure of that commit, sends a state or occurrence again; otherwise a restart
// replays none.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {compareDelivery, errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {
  InProcessBus, Outbox, SdkError, acknowledgmentOf, edgeValidator, openModuleDatabaseFile, type AddMessage, type Draft, type ErrorScope, type Logger,
  type OutboxOptions, type Participant, type SendOptions,
} from '../src/index.js';
import {RecordedSpans, countCommits} from '../src/testing/index.js';
import {checked, flush, it, logRecorder, modeSet, session, trace, turnEnded, validator, type LogEntry as Entry} from './support.js';

const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;

/**
 * The consumer that must not lose an outcome, as the core will be: it keeps every (source, id) it has taken, across
 * restarts, and drops a duplicate. `raw` counts every delivery, duplicates included.
 */
class Core {
  readonly taken = new Map<string, Message>();
  readonly raw: Message[] = [];

  async attach(bus: InProcessBus): Promise<void> {
    await bus.connect('bunny/core').subscribe('bunny.*.*.*', message => {
      this.raw.push(message);
      const key = `${message.source}\n${message.id}`;
      const verdict = compareDelivery(this.taken.get(key), message);
      assert.notEqual(verdict, 'conflict', 'a resent message is the stored one, unchanged');
      if (verdict === 'new') this.taken.set(key, message);
    });
  }

  ids(): string[] {
    return [...this.taken.values()].map(message => message.id);
  }
}

/**
 * One run of a module's process: a bus, the module's participant and database, and its outbox. `commits` holds the
 * connection's `synchronous` level at each commit the run made, in order.
 */
type Run = {bus: InProcessBus; module: Participant; database: DatabaseSync; outbox: Outbox; commits: number[]};
type StartOptions = {
  /**
   * Opens the database as the runtime does, with `openModuleDatabaseFile` (Hub #972): exclusive locking, WAL and
   * `synchronous = FULL`. Otherwise it is in SQLite's rollback journal mode at FULL, and a later start may open it while
   * an earlier run's connection stays open.
   */
  wal?: boolean;
  /** Wraps the module's participant, as a crash test does. */
  wrap?: (module: Participant) => Participant;
  /** False when the core has failed and listens to nothing in this run. */
  core?: boolean;
  /** The module's participant does not check what it receives against profile 2.0, as when a test forges a message. */
  unchecked?: boolean;
  /** The outbox's own options. */
  outbox?: Pick<OutboxOptions, 'onError' | 'validator'>;
  /** The module's log and span recorder, which the outbox records through. */
  log?: Logger;
  spans?: RecordedSpans;
};

async function world(context: TestContext): Promise<{core: Core; start: (options?: StartOptions) => Promise<Run>}> {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-outbox-'));
  context.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'lamp.sqlite');
  const core = new Core();
  // Each start is a new process: a new bus, clock and connection, on the same database file.
  const start = async ({wrap = module => module, core: coreUp = true, unchecked = false, outbox: extra = {}, log, spans, wal = false}: StartOptions = {}): Promise<Run> => {
    const bus = new InProcessBus();
    if (coreUp) await core.attach(bus);
    const connected = bus.connect('bunny/modules/lamp');
    const module = unchecked ? connected : checked(connected);
    let opened: DatabaseSync;
    if (wal) opened = openModuleDatabaseFile(file);
    else {
      opened = new DatabaseSync(file);
      opened.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL');
    }
    context.after(() => { if (opened.isOpen) opened.close(); });
    opened.exec('CREATE TABLE IF NOT EXISTS lamps (id TEXT PRIMARY KEY, power TEXT NOT NULL)');
    const {wrap: count, commits} = countCommits();
    const database = count(opened);
    const outbox = new Outbox({
      sdk: wrap(module), database, clock: {now: () => Date.now()}, ...extra, ...(log === undefined ? {} : {log}), ...(spans === undefined ? {} : {trace: spans}),
    });
    return {bus, module, database, outbox, commits};
  };
  return {core, start};
}

/** SQLite's `synchronous = FULL`: each commit syncs to disk before it returns. */
const FULL = 2;

const lamps = (database: DatabaseSync): unknown[] => database.prepare('SELECT id, power FROM lamps ORDER BY id').all().map(row => ({...row}));
/** The outbox's rows: each message's id and whether it has gone out. */
const rows = (database: DatabaseSync): unknown[] => database.prepare('SELECT id, published FROM bunny_outbox ORDER BY seq').all().map(row => ({...row}));
const switchOn = (add: AddMessage, database: DatabaseSync, options: SendOptions = {}): Message[] => {
  database.prepare('INSERT INTO lamps (id, power) VALUES (?, ?)').run('lamp-1', 'on');
  return [
    add('bunny.state.session.s1', session('s1', 1), options),
    add('bunny.event.session.s1', turnEnded('s1'), options),
    add('bunny.event.mode.wall', modeSet('req-1'), options),
  ];
};
const PARENT_TRACE = '0af7651916cd43dd8448eb211c80319c';
const PARENT = {traceparent: `00-${PARENT_TRACE}-b7ad6b7169203331-01`};
/** A participant whose publishes are refused while `refusing` holds, counting every attempt. */
function refusing(module: Participant, state: {refusing: boolean; attempts: number}): Participant {
  return {...module, publishMessage: (key, message) => {
    state.attempts += 1;
    return state.refusing ? Promise.reject(new SdkError(errorBody('invalid-state', {detail: 'the module is stopping'}))) : module.publishMessage(key, message);
  }};
}

it('messages commit with the module\'s changes and go out after the commit, in order, with their stored id and time', async context => {
  const {core, start} = await world(context);
  const {database, outbox} = await start();
  const added = await outbox.transaction(add => switchOn(add, database));
  await flush();
  assert.deepEqual(lamps(database), [{id: 'lamp-1', power: 'on'}]);
  assert.deepEqual(core.raw, added, 'each message once, as add returned it');
  assert.deepEqual(added.map(message => message.kind), ['state', 'occurrence', 'outcome']);
  assert.ok(added.every(message => message.source === 'bunny/modules/lamp'));
});

it('a transaction that throws rolls back its changes and its messages, and nothing goes out', async context => {
  const {core, start} = await world(context);
  const run = await start();
  const failure = new Error('the device said no');
  await assert.rejects(run.outbox.transaction(add => {
    switchOn(add, run.database);
    throw failure;
  }), failure);
  await flush();
  assert.deepEqual(lamps(run.database), []);
  assert.deepEqual(core.raw, []);
  // Nothing was stored either: a restart has nothing to send.
  const again = await start();
  assert.equal(await again.outbox.republish(), 0);
  await flush();
  assert.deepEqual(core.raw, []);
});

it('an outcome saved before a crash between commit and publish goes out after the restart exactly once', async context => {
  const {core, start} = await world(context);
  // The process dies after the commit, before anything is published.
  const crashed = await start({wrap: module => ({...module, publishMessage: () => Promise.reject(new Error('the process died'))})});
  const added = await crashed.outbox.transaction(add => switchOn(add, crashed.database));
  assert.equal(added.length, 3, 'the work committed, so the transaction resolves');
  await flush();
  assert.equal(core.raw.length, 0, 'nothing went out before the crash');
  assert.deepEqual(lamps(crashed.database), [{id: 'lamp-1', power: 'on'}], 'the change committed');

  const restarted = await start();
  assert.equal(await restarted.outbox.republish(), 3);
  await flush();
  assert.equal(core.raw.length, 3, 'each stored message goes out once');
  assert.equal(core.taken.size, 3);
  assert.deepEqual(core.raw.map(message => message.kind), ['state', 'occurrence', 'outcome']);
  const outcome = core.raw[2] as Message<{requestId: string}>;
  assert.equal(outcome.data.requestId, 'req-1');
  // The next restart sends only the outcome again, which the core has not acknowledged; it still has each once.
  const third = await start();
  assert.equal(await third.outbox.republish(), 1);
  await flush();
  assert.deepEqual(core.raw.slice(3), [outcome]);
  assert.equal(core.taken.size, 3, 'exactly once, as a duplicate-dropping consumer sees it');
});

it('a clean restart replays no state or occurrence; only the unacknowledged outcome goes out again', async context => {
  const {core, start} = await world(context);
  const first = await start();
  const added = await first.outbox.transaction(add => switchOn(add, first.database));
  await flush();
  assert.equal(core.raw.length, 3);
  const restarted = await start();
  assert.equal(await restarted.outbox.republish(), 1);
  await flush();
  assert.deepEqual(core.raw.slice(3), [added[2]], 'the outcome, unchanged; the state and the occurrence never again');
  assert.deepEqual(core.ids(), added.map(message => message.id), 'the consumer took each once');
  // A later transaction in the same run sends only its own message.
  const [next] = await restarted.outbox.transaction(add => [add('bunny.state.session.s1', session('s1', 2))]);
  await flush();
  assert.deepEqual(core.raw.slice(4), [next]);
});

it('an outcome published while the core had failed goes out again at the next start, however much later', async context => {
  // The reviewers' case: under the runtime's failure isolation, a failed core stops while the lamp keeps running.
  context.mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date'], now: Date.parse('2026-10-06T12:00:00.000Z')});
  const {core, start} = await world(context);
  const lonely = await start({core: false});
  const added = await lonely.outbox.transaction(add => switchOn(add, lonely.database));
  await flush();
  assert.equal(core.raw.length, 0, 'nobody listened');
  context.mock.timers.tick(10 * 60_000);
  await flush();
  const restarted = await start();
  assert.equal(await restarted.outbox.republish(), 1, 'only the outcome is kept for the core');
  await flush();
  assert.deepEqual(core.raw, [added[2]], 'the core takes the outcome once');
});

it('an acknowledged outcome is forgotten and never sent again', async context => {
  const {core, start} = await world(context);
  const first = await start();
  const added = await first.outbox.transaction(add => switchOn(add, first.database));
  await flush();
  const [state, occurrence, outcome] = added;
  assert.ok(state && occurrence && outcome);
  assert.equal(first.outbox.acknowledge(state.id), false, 'a state is never kept for an acknowledgment');
  assert.equal(first.outbox.acknowledge(occurrence.id), false);
  assert.equal(first.outbox.acknowledge('unknown-id'), false);
  assert.equal(first.outbox.acknowledge(outcome.id), true);
  assert.equal(first.outbox.acknowledge(outcome.id), false, 'once');
  assert.equal(first.database.prepare('SELECT COUNT(*) AS count FROM bunny_outbox').get()?.count, 0, 'nothing is left stored');
  const restarted = await start();
  assert.equal(await restarted.outbox.republish(), 0);
  await flush();
  assert.equal(core.raw.length, 3, 'nothing was sent again');
});

it('an outcome acknowledged before its first publish is never published', async context => {
  const {core, start} = await world(context);
  const crashed = await start({wrap: module => ({...module, publishMessage: () => Promise.reject(new Error('the process died'))})});
  await crashed.outbox.transaction(add => switchOn(add, crashed.database));
  const stored = crashed.database.prepare('SELECT message FROM bunny_outbox ORDER BY seq').all() as {message: string}[];
  const outcome = JSON.parse(stored[2]?.message ?? '{}') as Message;
  const restarted = await start();
  assert.equal(restarted.outbox.acknowledge(outcome.id), true);
  assert.equal(await restarted.outbox.republish(), 2);
  await flush();
  assert.deepEqual(core.raw.map(message => message.kind), ['state', 'occurrence']);
});

it('republish follows the core\'s acknowledgments: the core\'s forgets the outcome, and any other sender\'s is ignored (Hub #782)', async context => {
  const {core, start} = await world(context);
  const {log, entries} = logRecorder();
  // The forged acknowledgment below is one profile 2.0 refuses, so the module's participant does not check it.
  const run = await start({log, unchecked: true});
  assert.equal(await run.outbox.republish(), 0, 'nothing is stored yet, and the outbox now follows the acknowledgments');
  const [, , outcome] = await run.outbox.transaction(add => switchOn(add, run.database));
  assert.ok(outcome);
  await flush();
  const {key, draft} = acknowledgmentOf(outcome);
  assert.equal(key, 'bunny.event.outcome-recorded.lamp');
  // A forged acknowledgment names the outcome in its payload, but its sender is not the core; the core's acknowledgment
  // of another module's outcome with the same id is not this module's.
  await run.bus.connect('bunny/modules/forger').publish(key, draft);
  await run.bus.connect('bunny/core').publish(key, {...draft, data: {source: 'bunny/modules/other', id: outcome.id}});
  await flush();
  assert.deepEqual(rows(run.database), [{id: outcome.id, published: 1}], 'the outcome is kept');
  assert.deepEqual(entries.filter(entry => entry.event === 'message.received').map(entry => [entry.level, entry.fields['bunny.participant'], entry.fields['bunny.code']]),
    [['warn', 'bunny/modules/forger', 'forbidden']], 'the forged acknowledgment is recorded once, as a refusal a correct participant never gets');
  await run.bus.connect('bunny/core').publish(key, draft, {parent: outcome});
  await flush();
  assert.deepEqual(rows(run.database), [], 'the core\'s acknowledgment made the outbox forget it');
  const acknowledged = entries.filter(entry => entry.event === 'outbox.acknowledged');
  assert.deepEqual(acknowledged.map(entry => [entry.level, entry.fields['bunny.message.id']]), [['info', outcome.id]]);
  assert.equal(acknowledged[0]?.trace?.traceparent.split('-')[1], outcome.traceparent.split('-')[1], 'in the outcome\'s trace');
  const restarted = await start();
  assert.equal(await restarted.outbox.republish(), 0, 'the outcome is never sent again');
  await flush();
  assert.equal(core.raw.filter(message => message.id === outcome.id).length, 1);
});

it('a lost acknowledgment discards nothing: the outcome goes out at the next start, and the core\'s acknowledgment then forgets it (Hub #782)', async context => {
  const {core, start} = await world(context);
  const first = await start();
  await first.outbox.republish();
  const [, , outcome] = await first.outbox.transaction(add => switchOn(add, first.database));
  assert.ok(outcome);
  await flush();
  // The core's acknowledgment never arrives: the module stops first.
  first.database.close();
  const restarted = await start();
  const acknowledging = restarted.bus.connect('bunny/core');
  // As the core does, it acknowledges again each time the outcome arrives, even as a duplicate.
  await restarted.bus.connect('bunny/core-watch').subscribe('bunny.event.mode.*', async message => {
    if (message.kind === 'outcome') {
      const {key, draft} = acknowledgmentOf(message);
      await acknowledging.publish(key, draft, {parent: message});
    }
  });
  assert.equal(await restarted.outbox.republish(), 1, 'the unacknowledged outcome goes out again');
  await flush();
  assert.deepEqual(rows(restarted.database), [], 'and its acknowledgment made the outbox forget it');
  assert.equal(core.ids().filter(id => id === outcome.id).length, 1, 'the core takes it once');
});

it('a remote outbox with the edge\'s validator never holds an outcome behind a message the edge would refuse (Hub #782, #948)', async context => {
  const {core, start} = await world(context);
  const edge = edgeValidator();
  // The participant refuses what the edge's validator refuses, as a remote edge does.
  const remote = (module: Participant): Participant => ({...module, publishMessage: (key, message) => {
    const result = edge.validate(message);
    return result.ok ? module.publishMessage(key, message) : Promise.reject(new SdkError({error: result.error}));
  }});
  const unknown = {...turnEnded('s1'), dataschema: 'https://bunny.invalid/events/not-registered/2.0'};
  // Without it, the refused message waits in the outbox, and the outcome behind it with it.
  const plain = await start({wrap: remote});
  await plain.outbox.transaction(add => [add('bunny.event.session.s1', unknown), add('bunny.event.mode.wall', modeSet('req-1'))]);
  await flush();
  assert.equal(core.raw.length, 0, 'the outcome waits behind the refused message');
  plain.database.exec('DELETE FROM bunny_outbox');
  // With it, the message is refused when it is stored, and the outcome goes out.
  const validated = await start({wrap: remote, outbox: {validator: edge}});
  await assert.rejects(validated.outbox.transaction(add => add('bunny.event.session.s1', unknown)), refused('unknown-schema'));
  const [outcome] = await validated.outbox.transaction(add => [add('bunny.event.mode.wall', modeSet('req-2'))]);
  await flush();
  assert.deepEqual(core.raw.map(message => message.id), [outcome?.id]);
});

it('within one run, each message goes out once, in commit order across transactions', async context => {
  const {core, start} = await world(context);
  const {outbox} = await start();
  const first = outbox.transaction(add => [add('bunny.state.session.s1', session('s1', 1))]);
  const second = outbox.transaction(add => [add('bunny.state.session.s1', session('s1', 2))]);
  const third = await outbox.transaction(add => [add('bunny.state.session.s1', session('s1', 3))]);
  const sent = [...await first, ...await second, ...third];
  await flush();
  assert.deepEqual(core.raw, sent, 'each once, in order');
});

it('a publish refused after the commit resolves as committed, and the next start sends the messages unchanged', async context => {
  const {core, start} = await world(context);
  const first = await start();
  await first.module.close();
  const added = await first.outbox.transaction(add => switchOn(add, first.database, {parent: PARENT}));
  assert.deepEqual(lamps(first.database), [{id: 'lamp-1', power: 'on'}], 'the work committed, and the caller is never told otherwise');
  assert.deepEqual(rows(first.database), added.map(({id}) => ({id, published: 0})), 'every message awaits publication');
  const restarted = await start();
  assert.equal(await restarted.outbox.republish(), 3);
  await flush();
  assert.deepEqual(core.raw, added, 'each message once, with the id, time and trace it was stored with');
  assert.ok(added.every(message => trace(message.traceparent).traceId === PARENT_TRACE));
});

it('a commit whose publish is refused resolves, is reported once as awaiting publication, and goes out unchanged later', async context => {
  // The outbox keeps no timer: past any deadline, nothing sends again on its own.
  context.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const {core, start} = await world(context);
  const publishing = {refusing: true, attempts: 0};
  const reports: {error: unknown; scope: ErrorScope}[] = [];
  const run = await start({wrap: module => refusing(module, publishing), outbox: {onError: (error, scope) => { reports.push({error, scope}); }}});
  const added = await run.outbox.transaction(add => switchOn(add, run.database, {parent: PARENT}));
  assert.equal(added.length, 3, 'committed: it resolves with the work\'s result, never as a rollback');
  assert.deepEqual(lamps(run.database), [{id: 'lamp-1', power: 'on'}]);
  assert.deepEqual(rows(run.database), added.map(({id}) => ({id, published: 0})), 'committed and awaiting publication');
  assert.equal(publishing.attempts, 1, 'the refusal stopped the send at its first message');
  const [report] = reports;
  assert.ok(report?.error instanceof SdkError);
  assert.deepEqual(report.error.body, errorBody('invalid-state', {detail: 'committed, awaiting publication'}));
  assert.ok(report.error.cause instanceof SdkError, 'the refusal stays in memory as the cause');
  assert.deepEqual(report.scope, {source: 'bunny/modules/lamp', pattern: 'outbox'});
  context.mock.timers.tick(24 * 60 * 60_000);
  await flush();
  assert.equal(publishing.attempts, 1, 'nothing sends again on its own');
  assert.deepEqual(core.raw, []);

  // A second refused transaction in the same run is not reported again.
  const [held] = await run.outbox.transaction(add => [add('bunny.state.session.s2', session('s2', 1))]);
  assert.equal(reports.length, 1, 'one report for the run of refusals');
  assert.equal(publishing.attempts, 2);

  publishing.refusing = false;
  const [next] = await run.outbox.transaction(add => [add('bunny.state.session.s1', session('s1', 2))]);
  await flush();
  assert.deepEqual(core.raw, [...added, held, next], 'the waiting messages first, exactly as stored: id, time and trace');
  assert.ok(added.every(message => trace(message.traceparent).traceId === PARENT_TRACE), 'the stored trace context is kept');
  assert.equal(publishing.attempts, 7, 'two refused attempts, then each message once');
  assert.deepEqual(rows(run.database), [{id: added[2]?.id, published: 1}], 'only the outcome stays, published, until the core acknowledges it');

  // After a send went through, the next refusal is reported again.
  publishing.refusing = true;
  await run.outbox.transaction(add => [add('bunny.state.session.s3', session('s3', 1))]);
  assert.equal(reports.length, 2);
});

it('a refused publish goes to a BunnySdkWarning by default, and a failing listener never fails the transaction', async context => {
  const {start} = await world(context);
  const publishing = {refusing: true, attempts: 0};
  const warnings: Error[] = [];
  const listen = (warning: Error): void => { warnings.push(warning); };
  process.on('warning', listen);
  context.after(() => { process.off('warning', listen); });
  const quiet = await start({wrap: module => refusing(module, publishing)});
  await quiet.outbox.transaction(add => switchOn(add, quiet.database));
  await new Promise(resolve => { setImmediate(resolve); });
  const warning = warnings.find(entry => entry.name === 'BunnySdkWarning');
  assert.equal(warning?.message, 'bunny/modules/lamp on outbox: invalid-state: committed, awaiting publication');
  const throwing = await start({wrap: module => refusing(module, publishing), outbox: {onError: () => { throw new Error('the listener failed'); }}});
  assert.equal((await throwing.outbox.transaction(add => [add('bunny.state.session.s2', session('s2', 1))])).length, 1);
});

it('with a validator, a message the profile refuses rolls its transaction back instead of waiting in the outbox', async context => {
  const {core, start} = await world(context);
  const run = await start({outbox: {validator}});
  const unknown = {...turnEnded('s1'), dataschema: 'https://bunny.invalid/events/not-registered/2.0'};
  await assert.rejects(run.outbox.transaction(add => switchOn(add, run.database).concat(add('bunny.event.session.s1', unknown))), refused('unknown-schema'));
  assert.deepEqual(lamps(run.database), [], 'the work rolled back with it');
  assert.deepEqual(rows(run.database), [], 'nothing waits in the outbox');
  const added = await run.outbox.transaction(add => switchOn(add, run.database));
  await flush();
  assert.deepEqual(core.raw, added, 'a later transaction is not held back');
});

it('only published kinds on their own key class go in, so no command is ever stored or sent again', async context => {
  const {core, start} = await world(context);
  const {database, outbox} = await start();
  const command = {...turnEnded('s1'), kind: 'command'} as unknown as Draft<object>;
  await assert.rejects(outbox.transaction(add => add('bunny.cmd.mode.wall', command)), refused('invalid-request'), 'a command');
  await assert.rejects(outbox.transaction(add => add('bunny.event.session.s1', command)), refused('invalid-request'), 'a command on an event key');
  await assert.rejects(outbox.transaction(add => add('bunny.state.session.s1', turnEnded('s1'))), refused('invalid-request'), 'the wrong key class');
  await assert.rejects(outbox.transaction(add => add('bunny.state.session', session('s1', 1))), refused('invalid-request'), 'a malformed key');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM bunny_outbox').get()?.count, 0);
  await flush();
  assert.deepEqual(core.raw, []);
});

it('the work runs synchronously in the outbox\'s own transaction', async context => {
  const {core, start} = await world(context);
  const {database, outbox} = await start();
  // The types refuse async work; a caller outside TypeScript is refused at run time, and its promise is left handled.
  const asyncWork = ((add: AddMessage) => Promise.reject(new Error(add.name))) as unknown as (add: AddMessage) => void;
  await assert.rejects(outbox.transaction(asyncWork), TypeError, 'async work');
  database.exec('BEGIN');
  await assert.rejects(outbox.transaction(add => add('bunny.state.session.s1', session('s1', 1))), refused('invalid-state'), 'inside another transaction');
  database.exec('ROLLBACK');
  let kept: AddMessage | undefined;
  await outbox.transaction(add => { kept = add; });
  assert.throws(() => kept?.('bunny.state.session.s1', session('s1', 1)), refused('invalid-state'), 'add after the transaction');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM bunny_outbox').get()?.count, 0);
  await flush();
  assert.deepEqual(core.raw, []);
});

// Hub #949: the outbox records an outcome's first publication once and a deferral once per run of refusals, through the
// module's log in place of onError, and a publish span for each outcome it sends: the stored context's child in the same
// transaction, a link otherwise.

const recorder = logRecorder;
const published = (entries: Entry[]): Entry[] => entries.filter(entry => entry.event === 'outcome.published');

it('an outcome\'s first publication is recorded once, in its own trace, and a replay records nothing and links its publish span', async context => {
  const {start} = await world(context);
  const {log, entries} = recorder();
  const spans = new RecordedSpans();
  const first = await start({log, spans});
  const added = await first.outbox.transaction(add => switchOn(add, first.database, {parent: PARENT}));
  await flush();
  const outcome = added[2];
  assert.ok(outcome);
  assert.deepEqual(published(entries), [{level: 'info', event: 'outcome.published', trace: {traceparent: outcome.traceparent},
    fields: {'bunny.request.id': 'req-1', 'bunny.message.id': outcome.id, 'bunny.outcome': 'succeeded'}}]);
  const [publish] = spans.named('bunny.outcome.publish');
  assert.ok(publish);
  assert.equal(publish.kind, 'producer');
  assert.equal(publish.traceId, PARENT_TRACE);
  assert.equal(publish.parentSpanId, trace(outcome.traceparent).spanId, 'the same transaction stored it: the stored context\'s child');
  assert.equal(spans.named('bunny.outcome.publish').length, 1, 'only outcomes get a publish span');

  const restarted = await start({log, spans});
  assert.equal(await restarted.outbox.republish(), 1);
  await flush();
  assert.equal(published(entries).length, 1, 'a replayed outcome makes no second record');
  const replay = spans.named('bunny.outcome.publish')[1];
  assert.ok(replay);
  assert.equal(replay.parentSpanId, undefined, 'never reparented');
  assert.notEqual(replay.traceId, PARENT_TRACE, 'a new root');
  assert.deepEqual(replay.links, [{traceId: PARENT_TRACE, spanId: trace(outcome.traceparent).spanId}], 'linked to the stored context');
  assert.ok(spans.spans.every(span => span.endedAtMs !== undefined && span.status === 'unset'));
  assert.deepEqual(entries.filter(entry => entry.event !== 'outcome.published'), [], 'nothing else');
});

it('a crash before the first publish: the first publication after the restart is recorded once, and its span links', async context => {
  const {start} = await world(context);
  const {log, entries} = recorder();
  const spans = new RecordedSpans();
  const crashed = await start({log, spans, wrap: module => ({...module, publishMessage: () => Promise.reject(new Error('the process died: tok_SYNTHETIC123'))})});
  await crashed.outbox.transaction(add => switchOn(add, crashed.database, {parent: PARENT}));
  assert.deepEqual(entries, [{level: 'warn', event: 'outbox.deferred', fields: {'bunny.code': 'internal', 'bunny.outbox.waiting_count': 3}}],
    'one deferral, with the count still waiting, and no exception\'s message');
  const restarted = await start({log, spans});
  assert.equal(await restarted.outbox.republish(), 3);
  await flush();
  assert.equal(published(entries).length, 1, 'its first publication, once');
  const third = await start({log, spans});
  assert.equal(await third.outbox.republish(), 1);
  await flush();
  assert.equal(published(entries).length, 1, 'the replay makes none');
  const publishes = spans.named('bunny.outcome.publish');
  assert.equal(publishes.length, 2);
  assert.ok(publishes.every(span => span.parentSpanId === undefined && span.links.length === 1 && span.links[0]?.traceId === PARENT_TRACE),
    'work published after a restart links to its stored context');
  assert.equal(JSON.stringify(entries).includes('tok_SYNTHETIC123'), false);
});

it('a refused publish makes one deferred warning per run of refusals in place of onError, and the waiting outcome\'s later publication links to it', async context => {
  const {start} = await world(context);
  const {log, entries} = recorder();
  const spans = new RecordedSpans();
  const publishing = {refusing: true, attempts: 0};
  const reports: unknown[] = [];
  const run = await start({log, spans, wrap: module => refusing(module, publishing), outbox: {onError: error => { reports.push(error); }}});
  const added = await run.outbox.transaction(add => switchOn(add, run.database, {parent: PARENT}));
  assert.deepEqual(entries, [{level: 'warn', event: 'outbox.deferred', fields: {'bunny.code': 'invalid-state', 'bunny.outbox.waiting_count': 3}}]);
  await run.outbox.transaction(add => [add('bunny.state.session.s2', session('s2', 1))]);
  assert.equal(entries.length, 1, 'one record for the run of refusals');
  assert.deepEqual(reports, [], 'with a log, onError hears nothing: one deferral is one record');
  publishing.refusing = false;
  await run.outbox.transaction(add => [add('bunny.state.session.s1', session('s1', 2))]);
  await flush();
  assert.equal(published(entries).length, 1);
  const [publish] = spans.named('bunny.outcome.publish');
  assert.ok(publish);
  assert.equal(publish.parentSpanId, undefined, 'deferred from an earlier transaction: linked, not parented');
  assert.deepEqual(publish.links, [{traceId: PARENT_TRACE, spanId: trace(added[2]?.traceparent ?? '').spanId}]);
  publishing.refusing = true;
  await run.outbox.transaction(add => [add('bunny.state.session.s3', session('s3', 1))]);
  assert.deepEqual(entries.filter(entry => entry.event === 'outbox.deferred').map(entry => entry.fields['bunny.outbox.waiting_count']), [3, 1],
    'after a send went through, the next refusal is recorded again');
});

it('a failed outcome\'s publication is a warning with its code, and a publish that fails mid-send ends its span with error', async context => {
  const {start} = await world(context);
  const {log, entries} = recorder();
  const spans = new RecordedSpans();
  const run = await start({log, spans});
  const failed: Draft<object> = {...modeSet('req-2'), data: {requestId: 'req-2', result: 'failed', evidence: 'none', error: errorBody('unavailable', {detail: 'the lamp did not answer'}).error}};
  const [outcome] = await run.outbox.transaction(add => [add('bunny.event.mode.wall', failed)]);
  await flush();
  assert.deepEqual(published(entries).map(entry => [entry.level, entry.fields]), [['warn',
    {'bunny.request.id': 'req-2', 'bunny.message.id': outcome.id, 'bunny.outcome': 'failed', 'bunny.code': 'unavailable'}]]);
  const publishing = {refusing: true, attempts: 0};
  const refused = await start({log, spans, wrap: module => refusing(module, publishing)});
  const before = entries.length;
  await assert.rejects(refused.outbox.republish(), (error: unknown) => error instanceof SdkError);
  const last = spans.named('bunny.outcome.publish').at(-1);
  assert.equal(last?.status, 'error', 'the refused publish');
  assert.equal(entries.length, before, 'republish passes its refusal on to the caller, so it records nothing');
});

// Hub #972: a commit is a sync to disk on the event loop. Each publication batch's bookkeeping commits once, after its
// sends settle, at the connection's level, as every commit does. A crash before the bookkeeping commits sends the batch
// again with the same ids, and a crash before the send sends it at the next start.

it('a publication batch\'s bookkeeping commits once, after its sends settle', async context => {
  const {core, start} = await world(context);
  const {database, outbox, commits} = await start();
  const added = await outbox.transaction(add => switchOn(add, database));
  await flush();
  assert.deepEqual(core.raw, added);
  assert.equal(commits.length, 2, 'the work\'s commit, then one for the three messages that went out');
  assert.deepEqual(rows(database), [{id: added[2]?.id, published: 1}], 'the state and the occurrence forgotten, the outcome marked');
});

it('transactions that commit before a queued send starts share its bookkeeping commit', async context => {
  const {core, start} = await world(context);
  const {outbox, commits} = await start();
  const first = outbox.transaction(add => [add('bunny.state.session.s1', session('s1', 1))]);
  const second = outbox.transaction(add => [add('bunny.state.session.s1', session('s1', 2))]);
  const third = await outbox.transaction(add => [add('bunny.state.session.s1', session('s1', 3))]);
  const sent = [...await first, ...await second, ...third];
  await flush();
  assert.deepEqual(core.raw, sent, 'each once, in commit order');
  assert.equal(commits.length, 4, 'three commits of work, and one for the batch the first send took');
});

it('a transaction that commits while a send is under way waits for the next batch: a send takes its rows when it starts', async context => {
  const {core, start} = await world(context);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  const {outbox, commits} = await start({wrap: module => ({...module, publishMessage: async (key, message) => {
    // The first publish waits until the test lets it go, so the first send is under way while the second commits.
    if (!held) {
      held = true;
      await gate;
    }
    return module.publishMessage(key, message);
  }})});
  const first = outbox.transaction(add => [add('bunny.state.session.s1', session('s1', 1))]);
  await flush();
  assert.equal(held, true, 'the first send is under way');
  const second = outbox.transaction(add => [add('bunny.state.session.s2', session('s2', 1))]);
  assert.equal(commits.length, 2, 'both transactions committed');
  release();
  const sent = [...await first, ...await second];
  await flush();
  assert.deepEqual(core.raw, sent, 'each once, in commit order');
  assert.equal(commits.length, 4, 'one bookkeeping commit for each batch: the first send took only the first transaction\'s row');
});

it('a send refused partway commits what went out before it, once, and records that outcome\'s publication', async context => {
  const {core, start} = await world(context);
  const {log, entries} = recorder();
  const publishing = {refusing: false, attempts: 0};
  const run = await start({log, wrap: module => {
    const counted = refusing(module, publishing);
    // The first message goes out, and the refusals start with the next.
    return {...counted, publishMessage: (key, message) => {
      const result = counted.publishMessage(key, message);
      if (publishing.attempts === 1) publishing.refusing = true;
      return result;
    }};
  }});
  const added = await run.outbox.transaction(add => [
    add('bunny.event.mode.wall', modeSet('req-1')), add('bunny.state.session.s1', session('s1', 1)), add('bunny.event.session.s1', turnEnded('s1')),
  ]);
  await flush();
  assert.deepEqual(core.raw, added.slice(0, 1), 'the outcome went out; the refusal stopped the send');
  assert.equal(run.commits.length, 2, 'the work, then one bookkeeping commit for what went out');
  assert.deepEqual(rows(run.database), [{id: added[0]?.id, published: 1}, {id: added[1]?.id, published: 0}, {id: added[2]?.id, published: 0}]);
  assert.deepEqual(published(entries).map(entry => entry.fields['bunny.message.id']), [added[0]?.id], 'its first publication, once its batch committed');
  assert.deepEqual(entries.filter(entry => entry.event === 'outbox.deferred').map(entry => entry.fields['bunny.outbox.waiting_count']), [2]);
  publishing.refusing = false;
  const [next] = await run.outbox.transaction(add => [add('bunny.state.session.s2', session('s2', 1))]);
  await flush();
  assert.deepEqual(core.raw, [...added, next], 'the waiting messages first, then the new one');
  assert.equal(published(entries).length, 1);
});

it('republishing outcomes that already went out commits nothing', async context => {
  const {core, start} = await world(context);
  const first = await start();
  const [outcome] = await first.outbox.transaction(add => [add('bunny.event.mode.wall', modeSet('req-1'))]);
  await flush();
  const restarted = await start();
  assert.equal(await restarted.outbox.republish(), 1);
  await flush();
  assert.deepEqual(core.raw, [outcome, outcome], 'sent again, unchanged, for the core to acknowledge');
  assert.deepEqual(restarted.commits, [], 'an outcome already marked published needs no write');
});

it('a bookkeeping commit that fails keeps every row, is reported once, and the next send sends them again with their ids', async context => {
  const {core, start} = await world(context);
  const {log, entries} = recorder();
  const run = await start({log});
  // Nothing can be forgotten while the trigger stands, so the batch's bookkeeping rolls back.
  run.database.exec('CREATE TEMP TRIGGER keep BEFORE DELETE ON bunny_outbox BEGIN SELECT RAISE(ABORT, \'no room\'); END');
  const added = await run.outbox.transaction(add => switchOn(add, run.database));
  await flush();
  assert.deepEqual(core.raw, added, 'all three went out');
  assert.deepEqual(rows(run.database), added.map(({id}) => ({id, published: 0})), 'nothing was forgotten or marked');
  assert.deepEqual(entries.filter(entry => entry.event === 'outbox.deferred').map(entry => [entry.fields['bunny.code'], entry.fields['bunny.outbox.waiting_count']]),
    [['internal', 3]], 'reported once, with every row still waiting');
  assert.equal(published(entries).length, 0, 'no publication is recorded for a batch whose bookkeeping did not commit');
  run.database.exec('DROP TRIGGER keep');
  const [next] = await run.outbox.transaction(add => [add('bunny.state.session.s2', session('s2', 1))]);
  await flush();
  assert.deepEqual(core.raw.slice(3), [...added, next], 'the same three again, with their ids, then the new one');
  assert.deepEqual(core.ids(), [...added, next].map(message => message.id), 'a consumer that drops duplicates takes each once');
  assert.deepEqual(published(entries).map(entry => entry.fields['bunny.message.id']), [added[2]?.id], 'the outcome\'s publication, recorded once');
  assert.deepEqual(rows(run.database), [{id: added[2]?.id, published: 1}]);
});

it('an acknowledgment that lands after its outcome went out and before the batch committed records the publication, once', async context => {
  const {core, start} = await world(context);
  const {log, entries} = recorder();
  const acknowledged: string[] = [];
  const outbox: {current?: Outbox} = {};
  let outcome: string | undefined;
  const run = await start({log, wrap: module => ({...module, publishMessage: (key, message) => {
    // The core acknowledges the outcome while the batch's next message goes out, before its bookkeeping commits.
    if (outcome !== undefined && outbox.current?.acknowledge(outcome) === true) acknowledged.push(outcome);
    if (message.kind === 'outcome') outcome = message.id;
    return module.publishMessage(key, message);
  }})});
  outbox.current = run.outbox;
  const added = await run.outbox.transaction(add => [
    add('bunny.state.session.s1', session('s1', 1)), add('bunny.event.mode.wall', modeSet('req-1')), add('bunny.event.session.s1', turnEnded('s1')),
  ]);
  await flush();
  assert.deepEqual(core.raw, added);
  assert.deepEqual(acknowledged, [added[1]?.id], 'acknowledged mid-batch');
  assert.deepEqual(published(entries).map(entry => entry.fields['bunny.message.id']), [added[1]?.id], 'its publication recorded once');
  assert.deepEqual(rows(run.database), [], 'the outcome acknowledged, the rest forgotten');
});

it('every commit, the bookkeeping and acknowledgments included, runs at the connection\'s level, so a power loss never undoes one', async context => {
  const {start} = await world(context);
  const run = await start({wal: true});
  const pragma = (name: string): unknown => Object.values(run.database.prepare(`PRAGMA ${name}`).get() ?? {})[0];
  assert.deepEqual([pragma('journal_mode'), pragma('locking_mode'), pragma('synchronous')], ['wal', 'exclusive', FULL], 'opened as the runtime opens it');
  const added = await run.outbox.transaction(add => switchOn(add, run.database));
  await flush();
  assert.equal(run.outbox.acknowledge(added[2]?.id ?? ''), true);
  await run.outbox.transaction(add => [add('bunny.state.session.s1', session('s1', 2))]);
  await flush();
  assert.deepEqual(run.commits, [FULL, FULL, FULL, FULL, FULL], 'work, bookkeeping, acknowledgment, work, bookkeeping');
});

const CRASH = fileURLToPath(new URL('./fixtures/outbox-crash.js', import.meta.url));
type WireLine = {sent?: string; message?: Message; record?: string; republished?: number; committed?: boolean; acknowledged?: boolean};

/** The crash tests' module process: a database file and a wire file that outlive each run (fixtures/outbox-crash.ts). */
async function crashWorld(context: TestContext): Promise<{file: string; run: (...args: string[]) => Promise<NodeJS.Signals | null>; wire: () => Promise<WireLine[]>}> {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-outbox-crash-'));
  context.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'lamp.sqlite');
  const wirePath = join(dir, 'wire.jsonl');
  return {
    file,
    run: async (...args) => {
      const child = spawn(process.execPath, [CRASH, file, wirePath, ...args], {stdio: ['ignore', 'ignore', 'inherit']});
      const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
      if (signal === null) assert.equal(code, 0, 'the run ended cleanly');
      return signal;
    },
    wire: async () => (await readFile(wirePath, 'utf8').catch(() => '')).split('\n').filter(line => line !== '').map(line => JSON.parse(line) as WireLine),
  };
}

/** What a consumer that drops duplicates by (source, id) holds, failing on a resend that differs from the first copy. */
function takenOnce(lines: readonly WireLine[]): Map<string, Message> {
  const taken = new Map<string, Message>();
  for (const {message} of lines) {
    if (message === undefined) continue;
    const key = `${message.source}\n${message.id}`;
    assert.notEqual(compareDelivery(taken.get(key), message), 'conflict', 'a resent message is the stored one, unchanged');
    if (!taken.has(key)) taken.set(key, message);
  }
  return taken;
}
const sentKinds = (lines: readonly WireLine[]): (string | undefined)[] => lines.filter(line => line.message !== undefined).map(line => line.message?.kind);

it('killed after its sends and before their bookkeeping commits, a module sends the batch again at its next start, and the consumer takes each once', async context => {
  const crash = await crashWorld(context);
  assert.equal(await crash.run('commit', 'after-send'), 'SIGKILL');
  const killed = await crash.wire();
  assert.deepEqual(sentKinds(killed), ['state', 'outcome', 'occurrence'], 'all three went out before the kill');
  assert.equal(killed.some(line => line.committed === true || line.record === 'outcome.published'), false, 'nothing after the sends');

  assert.equal(await crash.run('republish'), null);
  const restarted = (await crash.wire()).slice(killed.length);
  assert.deepEqual(sentKinds(restarted), ['state', 'outcome', 'occurrence'], 'the batch whose bookkeeping never committed goes out again');
  assert.deepEqual(restarted.at(-1), {republished: 3});
  const taken = takenOnce([...killed, ...restarted]);
  assert.deepEqual([...taken.values()], killed.flatMap(line => line.message ?? []), 'the consumer takes each message once, as first sent');

  assert.equal(await crash.run('republish'), null);
  const all = await crash.wire();
  const third = all.slice(killed.length + restarted.length);
  assert.deepEqual(sentKinds(third), ['outcome'], 'once the batch committed, only the unacknowledged outcome goes out again');
  assert.equal(takenOnce(all).size, 3, 'nothing lost and nothing taken twice');
  assert.equal(all.filter(line => line.record === 'outcome.published').length, 1, 'its publication is recorded once, by the run that committed it');
});

it('killed between its commit and its first send, a module sends everything at its next start, once', async context => {
  const crash = await crashWorld(context);
  assert.equal(await crash.run('commit', 'before-send'), 'SIGKILL');
  assert.deepEqual(sentKinds(await crash.wire()), [], 'nothing went out before the kill');
  const stored = new DatabaseSync(crash.file, {readOnly: true});
  try {
    assert.deepEqual(stored.prepare('SELECT id, power FROM lamps').all().map(row => ({...row})), [{id: 'lamp-1', power: 'on'}], 'the work committed');
    assert.deepEqual(stored.prepare('SELECT kind, published FROM bunny_outbox ORDER BY seq').all().map(row => ({...row})),
      [{kind: 'state', published: 0}, {kind: 'outcome', published: 0}, {kind: 'occurrence', published: 0}], 'every message stored, none published');
  } finally {
    stored.close();
  }
  assert.equal(await crash.run('republish'), null);
  assert.equal(await crash.run('republish'), null);
  const all = await crash.wire();
  assert.deepEqual(sentKinds(all), ['state', 'outcome', 'occurrence', 'outcome'], 'each at the first start, then only the outcome');
  assert.equal(takenOnce(all).size, 3);
  assert.equal(all.filter(line => line.record === 'outcome.published').length, 1);
});

it('killed after the core acknowledged an outcome mid-batch and before the bookkeeping committed, a module records that outcome\'s publication once', async context => {
  const crash = await crashWorld(context);
  assert.equal(await crash.run('commit', 'ack-mid-batch'), 'SIGKILL');
  const killed = await crash.wire();
  assert.deepEqual(sentKinds(killed), ['state', 'outcome', 'occurrence']);
  assert.equal(killed.some(line => line.acknowledged === true), true, 'the acknowledgment landed before the bookkeeping');
  assert.equal(killed.filter(line => line.record === 'outcome.published').length, 1, 'the acknowledgment recorded the publication, as no later send will');
  assert.equal(await crash.run('republish'), null);
  assert.equal(await crash.run('republish'), null);
  const all = await crash.wire();
  assert.deepEqual(sentKinds(all.slice(killed.length)), ['state', 'occurrence'], 'the acknowledged outcome never goes out again; the rest of the batch does, once');
  assert.equal(takenOnce(all).size, 3);
  assert.equal(all.filter(line => line.record === 'outcome.published').length, 1, 'at most once, and here once');
});
