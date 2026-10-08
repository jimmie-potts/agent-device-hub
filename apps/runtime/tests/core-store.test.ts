// The core store (Hub #831): agent-state's owner on the core's SQLite store, which commits each change with the 2.0
// messages it publishes, the published records, history and the intake it took in one transaction, then publishes
// through the outbox. These tests drive the owner directly, as the core does, with a recording participant in place of
// the bus, and check the store's rows and what went out.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createAgentState, recoveryJournalKey, validateExport, type DurableState, type StorageLease} from '@jimmie-potts/agent-state';
import {compareDelivery, errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {SdkError, type LogFields, type Logger} from '@jimmie-potts/sdk';
import {countCommits} from '@jimmie-potts/sdk/testing';
import {CoreStore, SAVE_COST, type Deriver} from '../src/core/store.js';
import {DEFAULT_CONSUMERS, OWNER_ID} from '../src/index.js';
import {MODULE_SCOPE, record, runtimeResource} from '../src/record.js';
import {
  CHILD, CHILD_ID, IDENTITY, OTHER, SESSION_ID, approvalPrompt, approvalResolved, lifecycleOf, runtimeEnded, sessionStarted, turnEnded, turnStarted,
  unknownApproval,
} from './fixtures/agents.js';
import {fillDisk} from './fixtures/disk.js';
import {World, lifecycleMessage} from './fixtures/store-world.js';
import {START, flush, it, stateDir} from './support.js';

const sessions = (messages: readonly Message[]): SessionRecord[] =>
  messages.filter(message => message.type === 'org.bunny.session.updated').map(message => message.data as SessionRecord);
const types = (messages: readonly Message[]): string[] => messages.map(message => message.type);

it('a committed observation publishes its session state and occurrence after the commit, with history and the intake in the same transaction', async context => {
  const world = await World.open(context);
  assert.deepEqual(await world.observe(sessionStarted), {ok: true, revision: 1, outcome: 'applied'});
  const prompt = await world.observe(approvalPrompt('approval-1'), {sequence: 1});
  assert.equal(prompt.ok, true);
  const messages = world.since(0);
  assert.deepEqual(types(messages), ['org.bunny.session.updated', 'org.bunny.session.updated', 'org.bunny.attention.raised']);
  const [created, waiting, raised] = messages;
  assert.equal(created?.source, 'bunny/core');
  assert.equal((created?.data as SessionRecord).revision, 1, 'the record carries the revision of its change');
  assert.equal((created?.data as SessionRecord).generation, 1, 'a new record\'s generation is its admission revision');
  assert.deepEqual((waiting?.data as SessionRecord).attention, [{id: {status: 'known', id: 'approval-1'}, kind: 'approval', turn: {status: 'known', id: 'turn-1'}}]);
  assert.deepEqual(raised?.data, {
    session: SESSION_ID, identity: IDENTITY, turn: {status: 'known', id: 'turn-1'}, observedAtMs: START,
    ordering: {status: 'known', authority: 'claude-code', epoch: 'epoch-1', sequence: 1}, revision: 2,
    attention: {id: {status: 'known', id: 'approval-1'}, kind: 'approval', turn: {status: 'known', id: 'turn-1'}},
  });
  assert.equal(raised?.time, waiting?.time, 'one change\'s messages share their time');
  // Stored with the change: the durable state, the record, the revision, the history of the occurrence and the intake.
  const [state] = world.rows('SELECT revision, payload FROM state') as {revision: number; payload: string}[];
  assert.equal(state?.revision, 2);
  assert.equal(validateExport(JSON.parse(state?.payload ?? '')).ok, true, 'the agent-state 2.1 format the old Hub keeps');
  assert.deepEqual(world.rows('SELECT value FROM core_revision'), [{value: 2}]);
  // History (#782) keeps each state as a compact change event, what changed since the record it held, and the
  // occurrence whole, all in the change's own transaction.
  const history = world.rows('SELECT kind, revision, type, message_id, record FROM core_history ORDER BY seq') as {kind: string; revision: number; type: string; message_id: string; record: string}[];
  assert.deepEqual(history.map(row => [row.kind, row.revision, row.type, row.message_id]), [
    ['change', 1, 'org.bunny.session.updated', created?.id], ['change', 2, 'org.bunny.session.updated', waiting?.id], ['occurrence', 2, 'org.bunny.attention.raised', raised?.id],
  ]);
  const [first, second] = history.map(row => JSON.parse(row.record) as {family: string; id: string; revision: number; previous: number | null; changed: Record<string, unknown>; removed: string[]});
  assert.deepEqual([first?.family, first?.id, first?.revision, first?.previous], ['session', SESSION_ID, 1, null], 'a new entity changes from nothing');
  assert.ok(first !== undefined && 'identity' in first.changed && !('id' in first.changed) && !('revision' in first.changed));
  assert.deepEqual([second?.revision, second?.previous, second?.removed], [2, 1, []]);
  assert.deepEqual(second?.changed.attention, (waiting?.data as SessionRecord).attention, 'only what changed, with its new value');
  assert.equal('identity' in (second?.changed ?? {}), false, 'not a snapshot: what stayed the same is left out');
  assert.deepEqual(JSON.parse(history[2]?.record ?? '{}'), raised, 'an occurrence is kept whole');
  assert.equal(world.rows('SELECT * FROM core_taken').length, 2, 'both observations, by (source, id)');
  assert.deepEqual(world.rows('SELECT * FROM bunny_outbox'), [], 'published, so the outbox let them go');
});

it('the store keeps the old Hub\'s state table and format, and a new store reads back what it committed', async context => {
  const world = await World.open(context);
  await world.observe(sessionStarted, {title: {value: 'Port the core', source: 'user'}});
  const columns = (world.rows('PRAGMA table_info(state)') as {name: string; type: string; pk: number}[]).map(({name, type, pk}) => [name, type, pk]);
  assert.deepEqual(columns, [['id', 'INTEGER', 1], ['revision', 'INTEGER', 0], ['payload', 'TEXT', 0]], 'the columns of apps/hub/src/storage.ts');
  const before = JSON.parse((world.rows('SELECT payload FROM state')[0] as {payload: string}).payload) as DurableState;
  assert.equal(before.formatVersion, '2.1');
  await world.crashAndRestart();
  const after = JSON.parse((world.rows('SELECT payload FROM state')[0] as {payload: string}).payload) as DurableState;
  assert.deepEqual(after.sessions, before.sessions, 'reopened as committed');
  assert.equal(world.owner?.snapshot('1.2').sessions[0]?.title?.value, 'Port the core');
});

it('each occurrence follows MAPPING.md: resolved, turn-ended, turn-retired, and a runtime end before each removal', async context => {
  const world = await World.open(context);
  await world.observe(turnStarted, {sequence: 1});
  await world.observe(approvalPrompt('approval-1'), {sequence: 2});
  let from = world.published.length;
  await world.observe(approvalResolved('approval-1'), {sequence: 3});
  const resolved = world.since(from).find(message => message.type === 'org.bunny.attention.cleared');
  assert.equal((resolved?.data as {cause: string}).cause, 'resolved');

  // A turn end forgets its turn's approvals without a request ID, and retains a notice.
  await world.observe(unknownApproval, {sequence: 4});
  from = world.published.length;
  await world.observe(turnEnded, {sequence: 5});
  const ended = world.since(from);
  assert.deepEqual(types(ended), ['org.bunny.session.updated', 'org.bunny.attention.cleared', 'org.bunny.turn.ended']);
  const record = sessions(ended)[0];
  assert.equal(record?.activity, 'idle');
  assert.equal(record?.notices.length, 1);
  assert.equal((ended[1]?.data as {cause: string}).cause, 'turn-ended');
  assert.equal((ended[2]?.data as {noticeId?: string}).noticeId, record?.notices[0]?.id, 'turn-ended names the notice it retained');

  // A newer turn retires the old one: an approval without a request ID raised there is cleared, naming both turns.
  await world.observe(unknownApproval, {turn: 'turn-1', sequence: 6});
  from = world.published.length;
  await world.observe(turnStarted, {turn: 'turn-2', sequence: 7});
  const retired = world.since(from).find(message => message.type === 'org.bunny.attention.cleared');
  assert.equal((retired?.data as {cause: string}).cause, 'turn-retired');
  assert.deepEqual((retired?.data as {turn: unknown}).turn, {status: 'known', id: 'turn-2'}, 'the observation\'s turn');
  assert.deepEqual((retired?.data as {attention: {turn: unknown}}).attention.turn, {status: 'known', id: 'turn-1'}, 'the turn it was raised on');

  // A runtime end retires the record and its known descendants: session-ended, then one removal per record.
  await world.observe(sessionStarted, {identity: CHILD, parent: {status: 'known', identity: IDENTITY}, turn: null});
  from = world.published.length;
  await world.observe(runtimeEnded, {turn: 'turn-2', sequence: 8});
  const gone = world.since(from);
  assert.deepEqual(types(gone), ['org.bunny.session.ended', 'org.bunny.session.removed', 'org.bunny.session.removed']);
  assert.equal((gone[0]?.data as {session: string}).session, SESSION_ID);
  assert.deepEqual(gone.slice(1).map(message => (message.data as {entity: {id: string}; reason: string})).map(({entity, reason}) => [entity.id, reason]).sort(),
    [[SESSION_ID, 'retired'], [CHILD_ID, 'retired']].sort());
  assert.deepEqual(world.store.records(), []);
  assert.deepEqual((world.rows('SELECT type FROM core_history ORDER BY seq') as {type: string}[]).map(row => row.type).slice(-3),
    ['org.bunny.session.ended', 'org.bunny.session.removed', 'org.bunny.session.removed'], 'history keeps what happened');
});

it('a finished turn stays on its session record as an unread notice; it is no inbox item', async context => {
  const world = await World.open(context);
  await world.observe(turnStarted);
  await world.observe(turnEnded);
  const messages = world.since(0);
  assert.equal(messages.some(message => message.dataschema.includes('/inbox-item/')), false);
  const record = world.store.records()[0];
  assert.deepEqual(record?.notices.map(notice => [notice.turn, notice.acknowledgedBy]), [[{status: 'known', id: 'turn-1'}, []]]);
});

it('owner-started clearings carry the session\'s current turn, the owner\'s instant and unknown ordering', async context => {
  const world = await World.open(context);
  await world.observe(turnStarted, {sequence: 1});
  await world.observe(unknownApproval, {sequence: 2});
  // Explicit approval recovery needs a stale record: five minutes without evidence.
  world.clock.advance(300_000);
  const owner = world.owner;
  assert.ok(owner);
  const from = world.published.length;
  const recovered = await owner.recoverApproval(IDENTITY, 'turn-1', owner.snapshot().revision);
  assert.equal(recovered.ok, true);
  await flush();
  const cleared = world.since(from).find(message => message.type === 'org.bunny.attention.cleared');
  assert.deepEqual({...cleared?.data as object, revision: 0}, {
    session: SESSION_ID, identity: IDENTITY, turn: {status: 'known', id: 'turn-1'}, observedAtMs: START + 300_000, ordering: {status: 'unknown'}, revision: 0,
    attention: {id: {status: 'unknown'}, kind: 'approval', turn: {status: 'known', id: 'turn-1'}}, cause: 'recovered',
  });
  const journal = owner.journal().at(-1);
  assert.equal(journal?.sessionKey, recoveryJournalKey(IDENTITY, 'turn-1'), 'agent-state journals it as recovery');
});

it('startup settles approvals left on retired turns, as owner-started turn-retired clearings', async context => {
  // A store an older owner wrote: an approval without a request ID on a turn that a newer turn already retired.
  const world = await World.open(context);
  await world.observe(turnStarted, {sequence: 1});
  await world.observe(turnStarted, {turn: 'turn-2', sequence: 2});
  await world.owner?.shutdown();
  const payload = JSON.parse((world.rows('SELECT payload FROM state')[0] as {payload: string}).payload) as DurableState;
  const [stored] = payload.sessions;
  assert.ok(stored);
  stored.attention.push({id: {status: 'unknown'}, kind: 'approval', turn: {status: 'known', id: 'turn-1'}});
  world.db.prepare('UPDATE state SET payload = ?').run(JSON.stringify(payload));
  const from = world.published.length;
  await world.crashAndRestart();
  const cleared = world.since(from).find(message => message.type === 'org.bunny.attention.cleared');
  assert.equal((cleared?.data as {cause: string}).cause, 'turn-retired');
  assert.deepEqual((cleared?.data as {turn: unknown; ordering: unknown}).turn, {status: 'known', id: 'turn-2'});
  assert.deepEqual((cleared?.data as {ordering: unknown}).ordering, {status: 'unknown'});
});

it('expiry after 24 hours without evidence publishes a removal with reason expired, and the turn-ended occurrence stays in history', async context => {
  const world = await World.open(context);
  await world.observe(turnStarted);
  await world.observe(turnEnded);
  world.clock.advance(86_400_000);
  const from = world.published.length;
  await world.owner?.maintain();
  await flush();
  const removed = world.since(from).filter(message => message.type === 'org.bunny.session.removed');
  assert.deepEqual(removed.map(message => (message.data as {reason: string}).reason), ['expired']);
  assert.deepEqual(world.store.records(), []);
  assert.ok((world.rows('SELECT type FROM core_history') as {type: string}[]).some(row => row.type === 'org.bunny.turn.ended'));
});

it('freshness turns uncertain at five minutes at a new revision, computed at each message\'s time', async context => {
  const world = await World.open(context);
  await world.observe(sessionStarted);
  const revision = world.store.revision;
  world.clock.advance(299_999);
  assert.equal(await world.store.refresh(), false, 'still current a millisecond before');
  world.clock.advance(1);
  assert.equal(await world.store.refresh(), true);
  await flush();
  const [record] = sessions(world.since(1));
  assert.equal(record?.freshness, 'uncertain');
  assert.ok((record?.revision ?? 0) > revision, 'the revision is raised first, so no consumer drops it as stale');
  assert.equal(world.store.nextTurn(), undefined, 'nothing else turns on its own');
});

it('after a restart every stored session is uncertain until fresh evidence, at revisions above every earlier one', async context => {
  const world = await World.open(context);
  await world.observe(sessionStarted, {hostSessionId: 'local_0f8e2c4a'});
  const before = world.store.revision;
  const from = world.published.length;
  await world.crashAndRestart();
  const [restarted] = sessions(world.since(from));
  assert.equal(restarted?.restartUncertain, true);
  assert.equal(restarted?.freshness, 'uncertain');
  assert.ok((restarted?.revision ?? 0) > before);
  assert.equal(restarted?.hostSessionId, 'local_0f8e2c4a', 'the host session ID persists in the private store');
  world.clock.advance(1);
  await world.observe(turnStarted, {turn: 'turn-2'});
  assert.equal(world.store.records()[0]?.restartUncertain, false, 'fresh evidence ends it');
  assert.equal(world.store.records()[0]?.hostSessionId, undefined, 'a 1.2 observation without one clears it');
});

it('a full disk refuses the change before anything reports it accepted, changes nothing, and the next change after room is freed is taken', async context => {
  const world = await World.open(context);
  await world.observe(sessionStarted);
  fillDisk(world.db);
  const before = world.snapshot();
  const from = world.published.length;
  const message = lifecycleMessage(lifecycleOf(sessionStarted, world.clock.now(), {identity: CHILD, title: {value: 'x'.repeat(160), source: 'user'}}), world.clock.now());
  const refused = await world.take(message);
  assert.deepEqual(refused, {ok: false, code: 'storage-failed'});
  assert.equal(world.store.takeFailure(), 'full', 'the store tells a full disk from other failures');
  assert.deepEqual(world.published.slice(from), [], 'nothing published');
  assert.deepEqual(world.snapshot(), before, 'nothing changed');
  assert.equal(world.store.received(message), 'new', 'not taken, so the same message is new again');

  // Room again: the owner, faulted by the failed commit, opens again on what committed, and takes the same message.
  world.db.exec('PRAGMA max_page_count = 1073741823');
  await world.reopen();
  assert.equal((await world.take(message)).ok, true);
  assert.deepEqual(sessions(world.since(from)).map(record => record.identity.sessionId), [CHILD.sessionId]);
});

it('a publication refused after the commit is committed and awaiting publication, never a rollback, and goes out later unchanged', async context => {
  const world = await World.open(context);
  world.refuse = new SdkError(errorBody('unavailable', {detail: 'the participant has closed'}));
  const result = await world.observe(sessionStarted);
  assert.deepEqual(result, {ok: true, revision: 1, outcome: 'applied'}, 'the change stands, and is reported as taken');
  await world.observe(turnStarted, {turn: 'turn-2'});
  assert.equal(world.refused.length, 1, 'reported once per run of refusals');
  const [report] = world.refused;
  assert.ok(report instanceof SdkError);
  assert.deepEqual([report.body.error.code, report.body.error.detail], ['unavailable', 'committed, awaiting publication']);
  assert.equal(world.store.records()[0]?.activity, 'active', 'committed');
  const stored = (world.rows('SELECT message FROM bunny_outbox ORDER BY seq') as {message: string}[]).map(row => JSON.parse(row.message) as Message);
  assert.equal(stored.length, 2);
  assert.equal(world.published.length, 0);

  world.refuse = undefined;
  assert.equal(await world.store.republish(), 2);
  assert.deepEqual(world.published.map(({message}) => compareDelivery(stored.shift(), message)), ['duplicate', 'duplicate'], 'the stored messages, with their id, time and trace');
});

it('a crash between commit and publish loses and duplicates nothing: the restart sends each stored message once, with its id and time', async context => {
  const world = await World.open(context);
  world.dead = true;
  await world.observe(sessionStarted);
  await world.observe(approvalPrompt('approval-1'));
  assert.equal(world.published.length, 0, 'the process died before it published');
  const stored = (world.rows('SELECT message FROM bunny_outbox ORDER BY seq') as {message: string}[]).map(row => JSON.parse(row.message) as Message);
  assert.deepEqual(types(stored), ['org.bunny.session.updated', 'org.bunny.session.updated', 'org.bunny.attention.raised']);

  await world.crashAndRestart();
  // A consumer that drops duplicates by (source, id) sees each message once; the restart's own record follows.
  const seen = new Map<string, Message>();
  for (const {message} of world.published) {
    const prior = seen.get(`${message.source} ${message.id}`);
    assert.notEqual(compareDelivery(prior, message), 'conflict');
    seen.set(`${message.source} ${message.id}`, message);
  }
  for (const message of stored) assert.equal(compareDelivery(seen.get(`${message.source} ${message.id}`), message), 'duplicate', `${message.type} went out as stored`);
  assert.equal(world.published.length, seen.size, 'nothing twice');

  const count = world.published.length;
  await world.crashAndRestart();
  assert.equal(world.published.slice(count).filter(({message}) => stored.some(old => old.id === message.id)).length, 0, 'the next start sends none of them again');
});

// Hub #972: each commit is a sync to disk on the event loop. A change commits once with everything it records, and what
// it published is forgotten in one more commit, after the sends.

/** SQLite's `synchronous = FULL`: each commit syncs to disk before it returns. */
const FULL = 2;

it('an observation commits its change once, and what it published once more, after the sends', async context => {
  const {wrap, commits} = countCommits();
  const world = await World.open(context, {wrap});
  await world.observe(sessionStarted);
  const before = {commits: commits.length, published: world.published.length};
  await world.observe(approvalPrompt('approval-1'));
  assert.deepEqual(types(world.since(before.published)), ['org.bunny.session.updated', 'org.bunny.attention.raised']);
  assert.deepEqual(commits.slice(before.commits), [FULL, FULL],
    'the change with its records, history and intake, then one for the two messages that went out');
  assert.deepEqual(world.rows('SELECT * FROM bunny_outbox'), []);
});

it('opened as the runtime opens it, a change and its publication bookkeeping each commit at FULL', async context => {
  const {wrap, commits} = countCommits();
  const world = await World.open(context, {wrap, wal: true});
  assert.deepEqual([...world.rows('PRAGMA journal_mode'), ...world.rows('PRAGMA locking_mode')], [{journal_mode: 'wal'}, {locking_mode: 'exclusive'}]);
  const before = commits.length;
  await world.observe(sessionStarted);
  await world.observe(approvalPrompt('approval-1'));
  assert.deepEqual(commits.slice(before), [FULL, FULL, FULL, FULL], 'each change, then what it published, each synced');
});

it('a crash after the sends and before their bookkeeping committed sends the change again at the next start, and a consumer that drops duplicates takes it once', async context => {
  const world = await World.open(context, {wal: true});
  await world.observe(sessionStarted);
  const from = world.published.length;
  world.hangAfter = from + 2;
  await world.observe(approvalPrompt('approval-1'));
  const sent = world.since(from);
  assert.deepEqual(types(sent), ['org.bunny.session.updated', 'org.bunny.attention.raised'], 'both went out before the crash');
  assert.equal(world.rows('SELECT * FROM bunny_outbox').length, 2, 'their bookkeeping never committed');

  await world.crashAndRestart();
  const again = world.since(from + 2).filter(message => sent.some(old => old.id === message.id));
  assert.deepEqual(again.map(message => compareDelivery(sent.find(old => old.id === message.id), message)), ['duplicate', 'duplicate'],
    'the restart sends both again, exactly as first sent, so a consumer that drops duplicates takes each once');
  assert.deepEqual(world.rows('SELECT * FROM bunny_outbox'), []);
  const count = world.published.length;
  await world.crashAndRestart();
  assert.equal(world.published.slice(count).filter(({message}) => sent.some(old => old.id === message.id)).length, 0, 'the next start sends neither again');
});

it('a duplicate observation after a restart is dropped by its (source, id), and the same id with other content is a conflict', async context => {
  const world = await World.open(context);
  const message = lifecycleMessage(lifecycleOf(sessionStarted, START), START, 'hook-retried');
  await world.take(message);
  await world.crashAndRestart();
  assert.equal(world.store.received(message), 'duplicate');
  assert.equal(world.store.received({...message, data: {...message.data, observedAtMs: START + 1}}), 'conflict');
});

it('a part\'s rows commit in the change\'s transaction, and a part that throws rolls the whole change back', async context => {
  let fail = false;
  const derive: Deriver = (change, tx) => {
    tx.database.prepare('INSERT INTO part_rows VALUES (?, ?)').run(change.revision, change.messages.length);
    if (fail) throw new Error('the part failed');
  };
  const dir = await stateDir(context);
  const file = join(dir, 'core.sqlite');
  const setup = new DatabaseSync(file);
  setup.exec('CREATE TABLE part_rows (revision INTEGER, messages INTEGER)');
  setup.close();
  const world = await World.open(context, {file, derivers: [derive]});
  await world.observe(sessionStarted);
  assert.deepEqual(world.rows('SELECT * FROM part_rows'), [{revision: 1, messages: 1}]);
  fail = true;
  const before = world.snapshot();
  const from = world.published.length;
  assert.deepEqual(await world.observe(turnStarted, {turn: 'turn-2'}), {ok: false, code: 'storage-failed'});
  assert.equal(world.store.takeFailure(), 'failed');
  assert.deepEqual(world.snapshot(), before);
  assert.deepEqual(world.published.slice(from), []);
  assert.equal(world.rows('SELECT * FROM part_rows').length, 1);
});

it('the lease is exclusive: a second owner on the same store waits for it, and takes over once the first lets go', async context => {
  const world = await World.open(context);
  await world.observe(sessionStarted);
  const second = new CoreStore({
    database: new DatabaseSync(world.file), clock: {now: world.clock.now}, onError: () => {},
    sdk: {source: 'bunny/core', publishMessage: <T extends object>(_key: string, message: Message<T>): Promise<Message<T>> => Promise.resolve(message)},
  });
  const open = (storageTimeoutMs: number): ReturnType<typeof createAgentState> =>
    createAgentState({storage: second, ownerId: OWNER_ID, consumers: [...DEFAULT_CONSUMERS], clock: world.clock.now, storageTimeoutMs});
  await assert.rejects(open(200), /storage-unavailable/, 'refused at agent-state\'s deadline while the first holds the lease');
  const waiting = open(3000);
  await world.owner?.shutdown();
  world.store.close();
  const owner = await waiting;
  context.after(() => owner.shutdown());
  assert.deepEqual(owner.snapshot().sessions.map(session => session.identity.sessionId), [IDENTITY.sessionId], 'it reads what the first committed');
});

it('the lease needs no journal: a lock database whose journal cannot be written still gives it, as on a full disk', async context => {
  const file = join(await stateDir(context), 'core.sqlite');
  // A directory where SQLite would write the lock database's rollback journal: any journal write fails.
  await mkdir(`${file}-owner-journal`);
  const world = await World.open(context, {file});
  assert.equal((await world.observe(sessionStarted)).ok, true);
});

it('the store keeps its lock while a failed commit\'s owner is opened again, so a second store waiting for it never gets it', async context => {
  const world = await World.open(context);
  await world.observe(sessionStarted);
  const second = new CoreStore({
    database: new DatabaseSync(world.file), clock: {now: world.clock.now}, onError: () => {},
    sdk: {source: 'bunny/core', publishMessage: <T extends object>(_key: string, message: Message<T>): Promise<Message<T>> => Promise.resolve(message)},
  });
  const contending = createAgentState({storage: second, ownerId: OWNER_ID, consumers: [...DEFAULT_CONSUMERS], clock: world.clock.now, storageTimeoutMs: 1500})
    .then(owner => owner.shutdown().then(() => 'took the lease'), () => 'refused');
  const revision = world.store.revision;
  fillDisk(world.db);
  assert.deepEqual(await world.observe(sessionStarted, {identity: CHILD}), {ok: false, code: 'storage-failed'});
  // The owner is opened again after a pause in which the second store keeps trying for the lock.
  await world.reopen(200);
  assert.equal(await contending, 'refused');
  second.close();
  world.db.exec('PRAGMA max_page_count = 1073741823');
  const taken = await world.observe(sessionStarted, {identity: CHILD});
  assert.equal(taken.ok, true);
  assert.ok(world.store.revision > revision, 'the revision only rises');
  assert.deepEqual(world.rows('SELECT value, commits FROM core_revision').map(row => (row as {value: number}).value), [world.store.revision], 'as the file holds it');
});

it('an observation\'s (source, id) is kept 24 hours past its own instant, even from a hook whose clock runs two hours ahead', async context => {
  const world = await World.open(context);
  const ahead = lifecycleMessage(lifecycleOf(approvalPrompt('approval-1'), START + 7_200_000), START, 'hook-ahead');
  assert.equal((await world.take(ahead)).ok, true);
  // A day and an hour later, after another intake pruned what was due, agent-state would still admit the observation.
  world.clock.advance(90_000_000);
  await world.observe(sessionStarted, {identity: CHILD});
  assert.equal(world.store.received(ahead), 'duplicate', 'so it is still dropped as a duplicate');
});

it('a (source, id) is pruned once its 24 hours have passed, and not before', async context => {
  const world = await World.open(context);
  const first = lifecycleMessage(lifecycleOf(sessionStarted, START), START, 'hook-first');
  await world.take(first);
  world.clock.advance(86_399_999);
  await world.observe(turnStarted, {turn: 'turn-2'});
  assert.equal(world.store.received(first), 'duplicate', 'kept until 24 hours have passed');
  world.clock.advance(1);
  await world.observe(sessionStarted, {identity: CHILD});
  assert.equal(world.store.received(first), 'new', 'pruned by the next intake once they have');
  assert.equal(world.rows('SELECT id FROM core_taken WHERE id = \'hook-first\'').length, 0);
});

it('a rollback that fails is not taken for a commit: the change is refused and nothing is kept', async context => {
  let failRollback = false;
  let failing = false;
  const wrap = (db: DatabaseSync): DatabaseSync => new Proxy(db, {
    get(target, property) {
      if (property === 'exec') {
        return (sql: string) => {
          if (sql === 'ROLLBACK' && failRollback) {
            failRollback = false;
            throw new Error('the rollback failed');
          }
          target.exec(sql);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  const derive: Deriver = () => { if (failing) throw new Error('the part failed'); };
  const world = await World.open(context, {wrap, derivers: [derive]});
  await world.observe(sessionStarted);
  const before = world.snapshot();
  failing = true;
  failRollback = true;
  assert.deepEqual(await world.observe(turnStarted, {turn: 'turn-2'}), {ok: false, code: 'storage-failed'});
  assert.equal(failRollback, false, 'the outbox\'s rollback failed');
  assert.deepEqual(world.snapshot(), before, 'the store rolled the change back itself');
});

it('a failure names only the commit it came from: a later commit clears it', async context => {
  const world = await World.open(context);
  await world.observe(sessionStarted);
  fillDisk(world.db);
  world.clock.advance(300_000);
  await assert.rejects(world.store.refresh(), 'the store refuses to publish the record turning uncertain');
  world.db.exec('PRAGMA max_page_count = 1073741823');
  await world.store.refresh();
  assert.equal(world.store.takeFailure(), undefined, 'the full disk is no longer named');
});

it('a database that closed under the store, as a crash closes it, ends the store\'s use: a transaction is refused, and nothing is left unhandled', async context => {
  const world = await World.open(context);
  await world.observe(sessionStarted);
  assert.equal(world.store.open, true);
  const unhandled: unknown[] = [];
  const heard = (reason: unknown): void => { unhandled.push(reason); };
  process.on('unhandledRejection', heard);
  context.after(() => { process.off('unhandledRejection', heard); });
  world.db.close();
  assert.equal(world.store.open, false, 'the store is no longer open, so the tracker takes nothing more');
  await assert.rejects(world.store.transaction(() => {}));
  await new Promise(resolve => { setImmediate(resolve); });
  assert.deepEqual(unhandled, [], 'the outbox\'s refusal is taken');
});

it('a store that holds another owner\'s state is refused before anything is written to it', async context => {
  const file = join(await stateDir(context), 'core.sqlite');
  const other = new DatabaseSync(file);
  other.exec('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL)');
  other.prepare('INSERT INTO state VALUES (1, 1, ?)').run(JSON.stringify({ownerId: 'someone-else'}));
  const tables = (): unknown[] => other.prepare('SELECT name FROM sqlite_master ORDER BY name').all().map(row => ({...row}));
  const before = tables();
  await assert.rejects(World.open(context, {file}));
  assert.deepEqual(tables(), before, 'no core table was created');
  other.close();
});

/** What a store logged, as level, event and fields. */
type Logged = [level: string, event: string, fields: LogFields];

/** A logger that keeps each record; with `failing`, every call throws after keeping its record. */
function recorder(failing = false): {log: Logger; logged: Logged[]} {
  const logged: Logged[] = [];
  const keep = (level: string) => (event: string, fields: LogFields = {}): void => {
    logged.push([level, event, fields]);
    if (failing) throw new Error('the sink failed');
  };
  return {logged, log: {debug: keep('debug'), info: keep('info'), warn: keep('warn'), error: keep('error')}};
}

/** The save-cost records among what a store logged. */
const costs = (logged: readonly Logged[]): Logged[] => logged.filter(([, event]) => event.startsWith('storage.cost.'));

/** The state block's size in bytes, as the store holds it. */
const stateBytes = (world: World): number => Buffer.byteLength((world.rows('SELECT payload FROM state')[0] as {payload: string}).payload);

/** Each record as the runtime writes it for the core: kept whole, with only its own fields, or the test fails. */
function asWritten(logged: readonly Logged[]): void {
  const resource = runtimeResource('test', '00000000-0000-4000-8000-000000000976');
  for (const [level, event, fields] of logged) {
    const written = record(level === 'warn' ? 'warn' : 'info', MODULE_SCOPE, event, {...fields, 'bunny.module': 'core'}, START, resource);
    assert.ok(written, `${event} is a registered module record`);
    assert.deepEqual(written.attributes, {...fields, 'bunny.module': 'core', 'bunny.provenance': 'source'}, `${event} keeps every field it was given`);
  }
}

it('a state block past its limit is recorded once with its size, and once more when it is back within it (Hub #976)', async context => {
  const {log, logged} = recorder();
  // A limit between one session's state and two sessions', so the block passes it as a second session starts, and is
  // back within it a day later, once agent-state's maintenance has let go of what it keeps for a day. Every save takes
  // 0 ms.
  const LIMIT = 1_500;
  const world = await World.open(context, {watch: {log, saveCost: {...SAVE_COST, stateBytes: LIMIT}, timer: () => 0}});
  const sizes: number[] = [];
  const step = async (...observation: Parameters<World['observe']>): Promise<void> => {
    assert.equal((await world.observe(...observation)).ok, true);
    sizes.push(stateBytes(world));
  };
  await step(sessionStarted);
  await step(sessionStarted, {identity: OTHER});
  await step(turnStarted, {identity: OTHER, turn: 'turn-2'});
  world.clock.advance(86_400_001);
  assert.equal((await world.owner?.maintain())?.ok, true);
  sizes.push(stateBytes(world));
  await step(sessionStarted);
  await step(turnStarted, {turn: 'turn-2'});
  assert.deepEqual(sizes.map(size => size > LIMIT), [false, true, true, false, false, false], `the block's sizes in bytes: ${sizes.join(', ')}`);
  assert.deepEqual(costs(logged), [
    ['warn', 'storage.cost.high', {'bunny.operation': 'storage', 'bunny.state.bytes': sizes[1]}],
    ['info', 'storage.cost.normal', {'bunny.operation': 'storage', 'bunny.state.bytes': sizes[3]}],
  ], 'one WARN as the block passes the limit and one INFO as it is back within it, each with only the block\'s size');
  asWritten(costs(logged));
});

it('a save that takes longer than 100 ms is recorded once with its time, and once more when a save is quick again (Hub #976)', async context => {
  const {log, logged} = recorder();
  // Each save takes `work` milliseconds of the store's timer: half as the store applies agent-state's change to the whole
  // state, which it does from the change's first read, before it serializes the state, and half in a part's rows in the
  // save's transaction. Each message's publication after the commit takes a second, which is no part of the save.
  let now = 0, work = 0;
  const applying = (lease: StorageLease): StorageLease => ({
    ...lease,
    commit: (change, signal) => {
      let read = false;
      return lease.commit(new Proxy(change, {get: (target, key) => {
        if (!read) now += work / 2;
        read = true;
        return Reflect.get(target, key) as unknown;
      }}), signal);
    },
  });
  const slowPart: Deriver = () => { now += work / 2; };
  const world = await World.open(context, {derivers: [slowPart], lease: applying, watch: {log, timer: () => now}});
  world.publishing = () => { now += 1000; };
  assert.deepEqual(SAVE_COST, {stateBytes: 8 * 1024 * 1024, saveMs: 100}, 'half of the 16 MiB limit, and 100 ms');
  const save = async (ms: number, ...observation: Parameters<World['observe']>): Promise<void> => {
    work = ms;
    const result = await world.observe(...observation);
    assert.equal(result.ok && result.outcome, 'applied');
  };
  await save(5, sessionStarted);
  await save(100, turnStarted, {turn: 'turn-2'});
  assert.deepEqual(costs(logged), [], 'a save of exactly 100 ms is not past the limit');
  await save(100.25, approvalPrompt('approval-1'), {turn: 'turn-2'});
  await save(250, approvalResolved('approval-1'), {turn: 'turn-2'});
  await save(5, turnEnded, {turn: 'turn-2'});
  await save(5, turnStarted, {turn: 'turn-3'});

  assert.deepEqual(costs(logged), [
    ['warn', 'storage.cost.high', {'bunny.operation': 'storage', 'bunny.save.duration_ms': 101}],
    ['info', 'storage.cost.normal', {'bunny.operation': 'storage', 'bunny.save.duration_ms': 5}],
  ], 'one WARN for the run of slow saves and one INFO once a save is quick, each with only the save\'s time in whole milliseconds rounded up');
  asWritten(costs(logged));
  assert.deepEqual(world.rows('SELECT revision FROM state'), [{revision: 6}], 'every save committed');
});

it('a costly save stands when its record cannot be written (Hub #976)', async context => {
  const {log, logged} = recorder(true);
  let now = 0, work = 0;
  const world = await World.open(context, {derivers: [() => { now += work; }], watch: {log, timer: () => now}});
  work = 150;
  assert.deepEqual(await world.observe(sessionStarted), {ok: true, revision: 1, outcome: 'applied'});
  work = 5;
  assert.deepEqual(await world.observe(turnStarted, {turn: 'turn-2'}), {ok: true, revision: 2, outcome: 'applied'}, 'the owner was never faulted');
  assert.deepEqual(costs(logged).map(([level, event]) => [level, event]), [['warn', 'storage.cost.high'], ['info', 'storage.cost.normal']]);
  assert.deepEqual(world.rows('SELECT revision FROM state'), [{revision: 2}]);
});

it('a save that does not commit changes neither condition (Hub #976)', async context => {
  const {log, logged} = recorder();
  let now = 0, work = 0, failing = false;
  const part: Deriver = () => {
    now += work;
    if (failing) throw new Error('the part failed');
  };
  const world = await World.open(context, {derivers: [part], watch: {log, timer: () => now}});
  work = 150;
  assert.equal((await world.observe(sessionStarted)).ok, true);
  failing = true;
  work = 5;
  assert.deepEqual(await world.observe(turnStarted, {turn: 'turn-2'}), {ok: false, code: 'storage-failed'}, 'the part rolls the quick save back');
  assert.deepEqual(costs(logged).map(([level]) => level), ['warn'], 'a refused save does not end the run');
  failing = false;
  await world.reopen();
  assert.equal((await world.observe(turnStarted, {turn: 'turn-2'})).ok, true);
  assert.deepEqual(costs(logged), [
    ['warn', 'storage.cost.high', {'bunny.operation': 'storage', 'bunny.save.duration_ms': 150}],
    ['info', 'storage.cost.normal', {'bunny.operation': 'storage', 'bunny.save.duration_ms': 5}],
  ]);
});
