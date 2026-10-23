import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import type {ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {ModePart} from '../src/core/mode.js';

void test('first start durably serves Free without applying it to a device', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const mode = new ModePart();
    mode.open(database);
    assert.deepEqual(mode.states(['mode']).map(state => (state.data as ModeState).mode), ['free']);
    const reopened = new ModePart();
    reopened.open(database);
    assert.deepEqual(reopened.states(['mode']).map(state => (state.data as ModeState).mode), ['free']);
  } finally {database.close();}
});

void test('mode snapshot exposes an empty versioned exception list and preserves a legacy choice', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const mode = new ModePart(); mode.open(database);
    const first = mode.states(['mode'])[0];
    assert.equal(first?.dataschema, 'https://bunny.invalid/events/mode/2.1');
    assert.deepEqual((first?.data as {overrides?: unknown}).overrides, []);
    database.prepare('UPDATE core_mode SET record = ? WHERE id = ?').run(JSON.stringify({id: 'hub', revision: 42, mode: 'quiet', selectedAtMs: 12}), 'hub');
    const reopened = new ModePart(); reopened.open(database);
    assert.deepEqual(reopened.states(['mode'])[0]?.data, {id: 'hub', revision: 42, mode: 'quiet', selectedAtMs: 12, overrides: []});
  } finally {database.close();}
});

// Real SQLite transactions with only the transport/tracker boundary controlled; no runtime or host is started.
import type {Command, Draft, Logger, Reply, Responder, Sdk} from '@jimmie-potts/sdk';
import type {ModeSetRequest} from '@jimmie-potts/event-contracts/v2/families';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {CoreHandle} from '../src/core/core.js';
import type {CoreTransaction} from '../src/core/store.js';
import type {Action} from '../src/core/tracker.js';

const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const command = (mode: ModeSetRequest['mode'], requestId: string, expectedRevision?: number): Command<ModeSetRequest> => ({
  specversion: '1.0', bunnyprofile: '2.0', id: requestId, source: 'bunny/core', type: 'org.bunny.mode.set.requested', subject: 'hub',
  time: new Date().toISOString(), expiresat: new Date(Date.now() + 10_000).toISOString(), kind: 'command', datacontenttype: 'application/json',
  dataschema: 'https://bunny.invalid/events/mode-set/2.0', traceparent,
  data: {mode, requestId, ...(expectedRevision === undefined ? {} : {expectedRevision})},
});

async function unit(empty = false) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE completed (request_id TEXT PRIMARY KEY) STRICT');
  const sent: Action[] = [], published: Draft<object>[] = [];
  const responders = new Map<string, Responder<ModeSetRequest>>();
  const flags = {admitted: true, failCommit: false, diskFull: false, failComplete: false, pending: false, ended: 0, postcommit: 0};
  let revision = 0;
  const part = new ModePart({
    admit: () => flags.admitted,
    complete: (tx, delivered) => {
      tx.database.prepare('INSERT INTO completed VALUES (?)').run(delivered.data.requestId);
      if (flags.failComplete) throw new Error('test-completion-refused');
      return () => {flags.postcommit += 1;};
    },
    end: () => {flags.ended += 1;},
  });
  const sdk = {source: 'bunny/core', respond: (_pattern: string, handler: Responder<ModeSetRequest>) => {
    responders.set(_pattern, handler); return Promise.resolve({close: () => Promise.resolve()});
  }} as unknown as Sdk;
  const core: CoreHandle = {
    sdk, clock: {now: () => Date.now()}, ready: Promise.resolve(), log: {} as Logger,
    received: () => 'new', operation: id => sent.some(action => action.requestId === id) && !flags.pending ? {status: 'completed'} as ReturnType<CoreHandle['operation']> : undefined,
    transaction: work => {
      const staged: Draft<object>[] = [];
      db.exec('BEGIN');
      try {
        const tx: CoreTransaction = {database: db, atMs: Date.now(), revision: () => revision + 1,
          add: <T extends object>(_key: string, draft: Draft<T>) => {staged.push(draft); return {...command('free', 'publication'), ...draft} as Message<T>;},
          take: () => {}, record: () => {}, step: () => {}};
        const result = work(tx);
        if (flags.failCommit) throw new Error('test-commit-refused');
        if (flags.diskFull) throw Object.assign(new Error('test-storage-full'), {errcode: 13});
        db.exec('COMMIT'); revision += 1; published.push(...staged); return Promise.resolve(result);
      } catch (error) {db.exec('ROLLBACK'); return Promise.reject(error);}
    },
    dispatch: action => {
      // Selection and completion must already be committed before the first transport call.
      assert.equal((db.prepare('SELECT count(*) AS count FROM completed').get() as {count: number}).count, flags.postcommit);
      sent.push(action);
      return Promise.resolve(action.draft.subject === 'wall' ? {error: {code: 'unavailable' as const, retryable: true}} : {status: 'accepted' as const, requestId: action.requestId ?? ''});
    },
  };
  await part.start(core); part.open(db);
  part.setParticipants(empty ? [] : [{id: 'wall', kind: 'nanoleaf'}, {id: 'pixoo-1', kind: 'pixoo'}]);
  const select = async (delivered: Command<ModeSetRequest>): Promise<Reply> => {
    const responder = responders.get(delivered.type === 'org.bunny.mode-override.set.requested' ? 'bunny.cmd.mode-override-set.*' : 'bunny.cmd.mode-set.hub');
    assert.ok(responder); return responder(delivered);
  };
  const state = (): ModeState => {const draft = part.states(['mode'])[0]; assert.ok(draft); return draft.data as ModeState;};
  return {db, part, sent, published, flags, state, select};
}

void test('selection saves and completes together before independent native commands, including explicit reapply', async () => {
  const w = await unit();
  try {
    assert.equal(w.sent.length, 0);
    assert.deepEqual(await w.select(command('work', 'req-work', 0)), {status: 'accepted'});
    assert.equal(w.state().mode, 'work'); assert.equal(w.state().revision, 1);
    assert.deepEqual(w.sent.map(action => [action.draft.subject, action.draft.data]), [['wall', {mode: 'work'}], ['pixoo-1', {mode: 'monitor'}]]);
    assert.equal(w.flags.postcommit, 1); assert.equal(w.flags.ended, 1);
    assert.deepEqual(await w.select(command('work', 'req-work-again', 1)), {status: 'accepted'});
    assert.equal(w.sent.length, 4); assert.notEqual(w.sent[0]?.requestId, w.sent[2]?.requestId);
    const reopened = new ModePart(); reopened.open(w.db);
    assert.equal((reopened.states(['mode'])[0]?.data as ModeState | undefined)?.mode, 'work');
    reopened.states(['mode']); assert.equal(w.sent.length, 4, 'restart and reads never apply the saved choice');
  } finally {w.db.close();}
});

const individual = (target: string, mode: ModeSetRequest['mode'], requestId: string, revision?: number): Command<ModeSetRequest> => ({
  ...command(mode, requestId, revision), subject: target, type: 'org.bunny.mode-override.set.requested',
  dataschema: 'https://bunny.invalid/events/mode-override-set/2.0',
});

void test('individual choices isolate targets, survive restart, clear individually and reset on global reapply', async () => {
  const w = await unit();
  try {
    await w.select(command('work', 'global-work'));
    const at = w.state().selectedAtMs;
    assert.deepEqual(await w.select(individual('wall', 'free', 'individual-free', w.state().revision)), {status: 'accepted'});
    assert.equal(w.state().mode, 'work'); assert.equal(w.state().selectedAtMs, at);
    assert.deepEqual(w.state().overrides?.map(({target, mode}) => ({target, mode})), [{target: 'wall', mode: 'free'}]);
    assert.deepEqual(w.sent.slice(2).map(action => [action.draft.subject, action.draft.data]), [['wall', {mode: 'free'}]]);
    const reopened = new ModePart(); reopened.open(w.db);
    assert.deepEqual(reopened.states(['mode'])[0]?.data, w.state()); assert.equal(w.sent.length, 3);
    await w.select(individual('pixoo-1', 'quiet', 'individual-quiet', w.state().revision));
    assert.equal(w.state().overrides?.length, 2);
    await w.select(individual('wall', 'work', 'follow-work', w.state().revision));
    assert.deepEqual(w.state().overrides?.map(choice => choice.target), ['pixoo-1']);
    await w.select(command('work', 'global-reapply', w.state().revision));
    assert.deepEqual(w.state().overrides, []); assert.equal(w.sent.length, 7);
  } finally {w.db.close();}
});

void test('pending selections refuse overlaps and unknown or unsaved individual choices send nothing', async () => {
  const w = await unit();
  try {
    w.flags.pending = true;
    await w.select(command('work', 'global-pending'));
    const before = w.state();
    const busy = await w.select(individual('wall', 'free', 'overlap', before.revision));
    assert.ok('error' in busy); assert.equal(busy.error.code, 'capacity');
    assert.deepEqual(w.state(), before); assert.equal(w.sent.length, 2);
    w.flags.pending = false;
    const missing = await w.select(individual('missing', 'free', 'missing-target', before.revision));
    assert.ok('error' in missing); assert.equal(missing.error.code, 'unavailable');
    w.flags.failCommit = true;
    assert.ok('error' in await w.select(individual('wall', 'free', 'failed-save', before.revision)));
    assert.deepEqual(w.state(), before); assert.equal(w.sent.length, 2);
    w.flags.failCommit = false;
    assert.deepEqual(await w.select(individual('wall', 'free', 'after-settlement', before.revision)), {status: 'accepted'});
    assert.equal(w.state().overrides?.[0]?.mode, 'free');
  } finally {w.db.close();}
});

void test('empty participation saves global intent; invalid existing state is never reset', async () => {
  const w = await unit(true);
  try {
    assert.deepEqual(await w.select(command('quiet', 'empty-global')), {status: 'accepted'});
    assert.equal(w.state().mode, 'quiet'); assert.equal(w.sent.length, 0);
    for (const corrupt of ['broken-json', JSON.stringify({id: 'hub', mode: 'free'}), JSON.stringify({...w.state(), overrides: [{target: 'wall', mode: 'quiet', selectedAtMs: 0}]})]) {
      w.db.prepare('UPDATE core_mode SET record = ?').run(corrupt);
      assert.throws(() => new ModePart().open(w.db));
      assert.equal((w.db.prepare('SELECT record FROM core_mode').get() as {record: string}).record, corrupt);
    }
  } finally {w.db.close();}
});

void test('invalid, unauthorized, stale and unsaved selections preserve prior state and send nothing', async () => {
  const w = await unit();
  try {
    const before = w.state();
    const invalid = command('quiet', 'req-invalid'); invalid.data.mode = 'bad' as ModeSetRequest['mode'];
    assert.ok('error' in await w.select(invalid));
    w.flags.admitted = false; assert.ok('error' in await w.select(command('quiet', 'req-raw'))); w.flags.admitted = true;
    assert.deepEqual(await w.select(command('quiet', 'req-stale', 123)), {error: {code: 'revision-conflict', retryable: false, detail: 'the Hub mode changed; read it again'}});
    w.flags.failComplete = true; assert.ok('error' in await w.select(command('quiet', 'req-completion'))); w.flags.failComplete = false;
    w.flags.failCommit = true; assert.ok('error' in await w.select(command('quiet', 'req-storage')));
    w.flags.failCommit = false; w.flags.diskFull = true;
    const full = await w.select(command('quiet', 'req-full')); assert.ok('error' in full); assert.equal(full.error.code, 'capacity');
    assert.deepEqual(w.state(), before); assert.equal(w.sent.length, 0); assert.equal(w.published.length, 0);
    assert.equal((w.db.prepare('SELECT count(*) AS count FROM completed').get() as {count: number}).count, 0);
    assert.equal(w.flags.postcommit, 0);
  } finally {w.db.close();}
});
