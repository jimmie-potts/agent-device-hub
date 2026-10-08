// record evidence and attempt retirement for Hub #1006.
import assert from 'node:assert/strict';
import test from 'node:test';
import type {SessionRow} from '../src/sessions.ts';
import {labelAttempt, labelEvidence, labelCanSubmit} from '../src/labels.ts';

const row = {id: 'a'.repeat(64), generation: 1, revision: 4, uncertain: false} as SessionRow;
const attempt = labelAttempt(row, 'Review', 'label-attempt-1');
const accepted = {status: 'accepted', requestId: attempt.requestId} as const;
const observed = {...row, revision: 5, label: {value: 'Review', origin: 'user' as const}};

void test('requested, accepted and confirmed are distinct; a state arriving before the reply confirms afterward', () => {
  assert.equal(labelEvidence(attempt, row, true), 'requested');
  assert.equal(labelEvidence(attempt, row, true, accepted), 'accepted');
  assert.equal(labelEvidence(attempt, observed, true), 'requested');
  assert.equal(labelEvidence(attempt, observed, true, accepted), 'confirmed');
  assert.equal(labelEvidence(attempt, {...observed, revision: 3}, true, accepted), 'accepted');
  assert.equal(labelEvidence(attempt, {...observed, label: {value: 'Review', origin: 'agent'}}, true, accepted), 'accepted');
});

void test('matching no-ops confirm at the same revision; clear needs an absent explicit label', () => {
  assert.equal(labelEvidence(attempt, {...observed, revision: 4}, true, accepted), 'confirmed');
  const clear = labelAttempt(row, null, 'clear-attempt-1');
  const answer = {status: 'accepted', requestId: clear.requestId} as const;
  assert.equal(labelEvidence(clear, row, true, answer), 'confirmed');
  assert.equal(labelEvidence(clear, observed, true, answer), 'accepted');
});

void test('a stale copy does not confirm and a replaced generation retires the attempt', () => {
  assert.equal(labelEvidence(attempt, observed, false, accepted), 'accepted');
  assert.equal(labelEvidence(attempt, {...observed, uncertain: true}, true, accepted), 'accepted');
  assert.equal(labelEvidence(attempt, {...observed, generation: 2}, true, accepted), 'retired');
  assert.equal(labelEvidence(attempt, undefined, true, accepted), 'retired');
});

void test('refusal and uncertainty do not erase the captured attempt or become record confirmation', () => {
  const conflict = {error: {code: 'revision-conflict', retryable: false}} as const;
  assert.equal(labelEvidence(attempt, observed, true, conflict), 'refused');
  assert.equal(labelEvidence(attempt, observed, true, {error: {code: 'uncertain-result', retryable: false}}), 'uncertain');
  assert.deepEqual(attempt, {id: row.id, generation: 1, revision: 4, label: 'Review', requestId: 'label-attempt-1'});
});

void test('submission needs a live current row, no pending request and at most 80 Unicode scalars', () => {
  assert.equal(labelCanSubmit(row, true, false, 'Review'), true);
  assert.equal(labelCanSubmit(row, false, false, 'Review'), false);
  assert.equal(labelCanSubmit({...row, uncertain: true}, true, false, null), false);
  assert.equal(labelCanSubmit(row, true, true, null), false);
  assert.equal(labelCanSubmit(row, true, false, ''), false);
  assert.equal(labelCanSubmit(row, true, false, '🐰'.repeat(80)), true);
  assert.equal(labelCanSubmit(row, true, false, '🐰'.repeat(81)), false);
  assert.equal(labelCanSubmit(row, true, false, null), true);
});
