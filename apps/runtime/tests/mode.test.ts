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

async function unit() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE completed (request_id TEXT PRIMARY KEY) STRICT');
  const sent: Action[] = [], published: Draft<object>[] = [];
  let responder: Responder<ModeSetRequest> | undefined;
  const flags = {admitted: true, failCommit: false, diskFull: false, failComplete: false, ended: 0, postcommit: 0};
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
    responder = handler; return Promise.resolve({close: () => Promise.resolve()});
  }} as unknown as Sdk;
  const core: CoreHandle = {
    sdk, clock: {now: () => Date.now()}, ready: Promise.resolve(), log: {} as Logger,
    received: () => 'new', operation: () => undefined,
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
  part.setParticipants([{id: 'wall', kind: 'nanoleaf'}, {id: 'pixoo-1', kind: 'pixoo'}]);
  const select = async (delivered: Command<ModeSetRequest>): Promise<Reply> => {assert.ok(responder); return responder(delivered);};
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
