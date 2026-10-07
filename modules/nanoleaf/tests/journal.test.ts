// The control journal's outcomes (Hub #844): each error is the 2.0 registry's error detail, with the code's fixed
// `retryable` flag, so the module publishes it through its outbox unchanged (ADR 0012, "Safe errors"). A hold records
// the operation it waits on, which the device record's `held` names (Hub #975).
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {initialize} from '../src/database.js';
import {DEFAULT, metaKey} from '../src/devices.js';
import {hold, held, holdOf, outcomeOf, recoverAttempts, release, type End, type Outcome, type ScenesChanged} from '../src/journal.js';
import {execute, rows, transaction, type Db, type Row} from '../src/sqlite.js';
import {controlState} from '../src/store.js';
import {suite, test} from './support.js';

suite('journal outcomes', () => {
  test('every failed or uncertain outcome carries the registry\'s error detail', () => {
    const queued = {device: 'wall', id: 'request-1', completed: 0, uncertain: 0};
    const ends: [End, string][] = [[{kind: 'uncertain'}, 'uncertain-result'], [{kind: 'retired'}, 'cancelled'], [{kind: 'expired'}, 'expired'],
      [{kind: 'refused', code: 'unsupported-capability'}, 'unsupported-capability']];
    for (const [end, code] of ends) {
      const outcome = outcomeOf(queued, end);
      assert.deepEqual(outcome.error, errorBody(code as Parameters<typeof errorBody>[0]).error, end.kind);
    }
    assert.deepEqual(outcomeOf({...queued, uncertain: 1}, {kind: 'retired'}).error, errorBody('uncertain-result').error);
    assert.equal(outcomeOf(queued, {kind: 'sent'}).error, undefined);
  });
});

/** A fresh module database in memory, closed when the test ends. */
function database(context: TestContext): Db {
  const db = new DatabaseSync(':memory:');
  context.after(() => { db.close(); });
  initialize(db);
  return db;
}
const holdRows = (db: Db): Row[] => rows(db, 'SELECT device,request_id,held_at_ms FROM control_holds ORDER BY device');

suite('holds and the operation they wait on', () => {
  test('a hold names the write it waits on and when it began, keeps its first one, and a release ends both', context => {
    const db = database(context);
    const {revision} = controlState(db);
    transaction(db, () => { hold(db, DEFAULT, revision, {requestId: 'lost', heldAtMs: 1_000}); });
    assert.equal(held(db, revision), true);
    assert.deepEqual(holdOf(db, revision), {requestId: 'lost', heldAtMs: 1_000});
    // A second uncertain write at the same revision leaves the hold as it began.
    transaction(db, () => { hold(db, DEFAULT, revision, {requestId: 'later', heldAtMs: 2_000}); });
    assert.deepEqual(holdOf(db, revision), {requestId: 'lost', heldAtMs: 1_000});
    // Holds are per device.
    transaction(db, () => { hold(db, 'panels', controlState(db, 'panels').revision, {requestId: 'panel-write', heldAtMs: 3_000}); });
    assert.deepEqual(holdOf(db, controlState(db, 'panels').revision, 'panels'), {requestId: 'panel-write', heldAtMs: 3_000});
    transaction(db, () => { release(db, DEFAULT); });
    assert.equal(held(db, revision), false);
    assert.equal(holdOf(db, revision), undefined);
    assert.deepEqual(holdRows(db), [['panels', 'panel-write', 3_000]], 'the release left no operation behind, and the Panels\' hold stands');
  });

  test('a hold ends with the mode revision it held, and a later hold names its own write', context => {
    const db = database(context);
    const {revision} = controlState(db);
    transaction(db, () => { hold(db, DEFAULT, revision, {requestId: 'lost', heldAtMs: 1_000}); });
    transaction(db, () => { execute(db, 'INSERT OR REPLACE INTO meta VALUES (?, ?)', metaKey('mode_revision'), String(revision + 1)); });
    assert.equal(held(db, revision + 1), false);
    assert.equal(holdOf(db, revision + 1), undefined, 'no operation is named for a hold that no longer applies');
    transaction(db, () => { hold(db, DEFAULT, revision + 1, {requestId: 'next', heldAtMs: 5_000}); });
    assert.deepEqual(holdOf(db, revision + 1), {requestId: 'next', heldAtMs: 5_000});
  });

  test('an attempt a restart finds without a result holds its device, named with the restart\'s time; an animation holds nothing', context => {
    const db = database(context);
    const {revision} = controlState(db);
    const insert = (id: string, kind: string, command: object): void => {
      execute(db, "INSERT INTO control_journal (id, device, kind, command, mode_revision, phase, uncertain, accepted, expires) VALUES (?, ?, ?, ?, ?, 'attempting', 1, 1, 100)",
        id, DEFAULT, kind, JSON.stringify(command), revision);
    };
    transaction(db, () => { insert('play', 'animation.play', {kind: 'animation.play', preset: 'ocean'}); });
    const reported: (Outcome | ScenesChanged)[] = [];
    transaction(db, () => { recoverAttempts(db, DEFAULT, message => { reported.push(message); }, 7_000); });
    assert.deepEqual(reported.map(message => message.type === 'outcome' ? message.result : message.type), ['uncertain']);
    assert.equal(holdOf(db, revision), undefined, 'an animation\'s attempt holds nothing');
    transaction(db, () => { insert('out', 'brightness.set', {kind: 'brightness.set', percent: 20}); });
    transaction(db, () => { recoverAttempts(db, DEFAULT, message => { reported.push(message); }, 9_000); });
    assert.deepEqual(holdOf(db, revision), {requestId: 'out', heldAtMs: 9_000});
  });
});
