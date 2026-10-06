// The per-module outbox (Hub #882, ADR 0012 "Ownership and publication"): messages commit with the module's own
// changes and go out after the commit with their stored id and time. A message a crash kept from going out goes out at
// the next start; an outcome goes out again at every start until the core acknowledges it, and the core drops the
// duplicates by (source, id). Nothing else is ever sent again, so a restart replays no state or occurrence.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {compareDelivery, type Message} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, Outbox, SdkError, type AddMessage, type Draft, type Participant} from '../src/index.js';
import {checked, flush, it, modeSet, session, turnEnded} from './support.js';

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

/** One run of a module's process: a bus, the module's participant and database, and its outbox. */
type Run = {bus: InProcessBus; module: Participant; database: DatabaseSync; outbox: Outbox};
type StartOptions = {
  /** Wraps the module's participant, as a crash test does. */
  wrap?: (module: Participant) => Participant;
  /** False when the core has failed and listens to nothing in this run. */
  core?: boolean;
};

async function world(context: TestContext): Promise<{core: Core; start: (options?: StartOptions) => Promise<Run>}> {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-outbox-'));
  context.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'lamp.sqlite');
  const core = new Core();
  // Each start is a new process: a new bus, clock and connection, on the same database file.
  const start = async ({wrap = module => module, core: coreUp = true}: StartOptions = {}): Promise<Run> => {
    const bus = new InProcessBus();
    if (coreUp) await core.attach(bus);
    const module = checked(bus.connect('bunny/modules/lamp'));
    const database = new DatabaseSync(file);
    context.after(() => { if (database.isOpen) database.close(); });
    database.exec('CREATE TABLE IF NOT EXISTS lamps (id TEXT PRIMARY KEY, power TEXT NOT NULL)');
    const outbox = new Outbox({sdk: wrap(module), database, clock: {now: () => Date.now()}});
    return {bus, module, database, outbox};
  };
  return {core, start};
}

const lamps = (database: DatabaseSync): unknown[] => database.prepare('SELECT id, power FROM lamps ORDER BY id').all().map(row => ({...row}));
const switchOn = (add: <T extends object>(key: string, draft: Draft<T>) => Message<T>, database: DatabaseSync): Message[] => {
  database.prepare('INSERT INTO lamps (id, power) VALUES (?, ?)').run('lamp-1', 'on');
  return [
    add('bunny.state.session.s1', session('s1', 1)),
    add('bunny.event.session.s1', turnEnded('s1')),
    add('bunny.event.mode.wall', modeSet('req-1')),
  ];
};

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
  const added = await crashed.outbox.transaction(add => switchOn(add, crashed.database)).catch(() => undefined);
  assert.equal(added, undefined);
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
  const added = await crashed.outbox.transaction(add => switchOn(add, crashed.database)).catch(() => undefined);
  assert.equal(added, undefined);
  const stored = crashed.database.prepare('SELECT message FROM bunny_outbox ORDER BY seq').all() as {message: string}[];
  const outcome = JSON.parse(stored[2]?.message ?? '{}') as Message;
  const restarted = await start();
  assert.equal(restarted.outbox.acknowledge(outcome.id), true);
  assert.equal(await restarted.outbox.republish(), 2);
  await flush();
  assert.deepEqual(core.raw.map(message => message.kind), ['state', 'occurrence']);
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

it('a publish refused after the commit keeps the message stored for the next start', async context => {
  const {core, start} = await world(context);
  const first = await start();
  await first.module.close();
  await assert.rejects(first.outbox.transaction(add => switchOn(add, first.database)), refused('invalid-state'));
  assert.deepEqual(lamps(first.database), [{id: 'lamp-1', power: 'on'}], 'the work committed');
  const restarted = await start();
  assert.equal(await restarted.outbox.republish(), 3);
  await flush();
  assert.equal(core.taken.size, 3);
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
