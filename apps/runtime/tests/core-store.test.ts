// The core store (Hub #831): agent-state's owner on the core's SQLite store, which commits each change with the 2.0
// messages it publishes, the published records, history and the intake it took in one transaction, then publishes
// through the outbox. These tests drive the owner directly, as the core does, with a recording participant in place of
// the bus, and check the store's rows and what went out.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createAgentState, recoveryJournalKey, validateExport, type DurableState} from '@jimmie-potts/agent-state';
import {compareDelivery, errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {SdkError} from '@jimmie-potts/sdk';
import {CoreStore, type Deriver} from '../src/core/store.js';
import {DEFAULT_CONSUMERS, OWNER_ID} from '../src/index.js';
import {
  CHILD, CHILD_ID, IDENTITY, SESSION_ID, approvalPrompt, approvalResolved, lifecycleOf, runtimeEnded, sessionStarted, turnEnded, turnStarted,
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
  assert.deepEqual((world.rows('SELECT type, message_id FROM core_history') as {type: string; message_id: string}[]).map(row => [row.type, row.message_id]),
    [['org.bunny.attention.raised', raised?.id]]);
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
  await world.owner?.shutdown().catch(() => {});
  world.owner = await createAgentState({storage: world.store, ownerId: OWNER_ID, consumers: [...DEFAULT_CONSUMERS], clock: world.clock.now});
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
  const owner = await waiting;
  context.after(() => owner.shutdown());
  assert.deepEqual(owner.snapshot().sessions.map(session => session.identity.sessionId), [IDENTITY.sessionId], 'it reads what the first committed');
});
