// record evidence and attempt retirement for Hub #1006.
import assert from 'node:assert/strict';
import test from 'node:test';
import type {SessionRow} from '../src/sessions.ts';
import {labelAttempt, labelObservation, labelCanSubmit} from '../src/labels.ts';

const row = {id: 'a'.repeat(64), generation: 1, revision: 4, uncertain: false} as SessionRow;
const attempt = labelAttempt(row, 'Review', 'label-attempt-1');
const observed = {...row, revision: 5, label: {value: 'Review', origin: 'user' as const}};

void test('a matching owner label must be current, have user origin, and meet the revision guard', () => {
  assert.equal(labelObservation(attempt, row, true), 'unconfirmed');
  assert.equal(labelObservation(attempt, observed, true), 'confirmed');
  assert.equal(labelObservation(attempt, {...observed, revision: 3}, true), 'unconfirmed');
  assert.equal(labelObservation(attempt, {...observed, label: {value: 'Review', origin: 'agent'}}, true), 'unconfirmed');
});

void test('matching no-ops confirm at the same revision; clear needs an absent explicit label', () => {
  assert.equal(labelObservation(attempt, {...observed, revision: 4}, true), 'confirmed');
  const clear = labelAttempt(row, null, 'clear-attempt-1');
  assert.equal(labelObservation(clear, row, true), 'confirmed');
  assert.equal(labelObservation(clear, observed, true), 'unconfirmed');
});

void test('a copy that is not synced does not confirm and a replaced generation retires the attempt', () => {
  assert.equal(labelObservation(attempt, observed, false), 'unconfirmed');
  assert.equal(labelObservation(attempt, {...observed, uncertain: true}, true), 'confirmed', 'an uncertain status does not hide a matching synced label (#1865)');
  assert.equal(labelObservation(attempt, {...observed, generation: 2}, true), 'retired');
  assert.equal(labelObservation(attempt, undefined, true), 'retired');
});

void test('the attempt retains its captured request identity and revision', () => {
  assert.deepEqual(attempt, {id: row.id, generation: 1, revision: 4, label: 'Review', requestId: 'label-attempt-1'});
});

void test('submission needs a synced copy, no pending request and at most 80 Unicode scalars', () => {
  assert.equal(labelCanSubmit(row, true, false, 'Review'), true);
  assert.equal(labelCanSubmit(row, false, false, 'Review'), false);
  // The label is the owner's own data: an unknown status or unconfirmed work does not block it (#1865).
  assert.equal(labelCanSubmit({...row, uncertain: true}, true, false, null), true);
  assert.equal(labelCanSubmit({...row, uncertain: true}, false, false, 'Review'), false);
  assert.equal(labelCanSubmit(row, true, true, null), false);
  assert.equal(labelCanSubmit(row, true, false, ''), false);
  assert.equal(labelCanSubmit(row, true, false, '🐰'.repeat(80)), true);
  assert.equal(labelCanSubmit(row, true, false, '🐰'.repeat(81)), false);
  assert.equal(labelCanSubmit(row, true, false, null), true);
});
