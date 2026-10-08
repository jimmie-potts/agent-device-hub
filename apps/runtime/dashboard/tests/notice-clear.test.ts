import assert from 'node:assert/strict';
import test from 'node:test';
import type {OperationRecord, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {errorBody} from '@jimmie-potts/event-contracts/v2/errors';
import {noticeAttempt, noticeEvidence} from '../src/notice-clear.ts';

const record = {id: 'a'.repeat(64), generation: 1, revision: 8, notices: [{id: 'b'.repeat(64), acknowledgedBy: []}]} as unknown as SessionRecord;
const attempt = noticeAttempt(record, 'req-clear'); assert.ok(attempt);
const operation = {revision: 9, requestId: 'req-clear', family: 'notice-clear', target: record.id, status: 'completed', result: 'succeeded', evidence: 'observed'} as OperationRecord;
const notice = record.notices[0]; assert.ok(notice);
const acknowledged = {...record, revision: 9, notices: [{...notice, acknowledgedBy: ['dashboard', 'nanoleaf', 'pixoo']}]};
void test('a notice override distinguishes transport, completion and current owner evidence', () => {
  const accepted = {status: 'accepted', requestId: 'req-clear'} as const;
  assert.equal(noticeEvidence(attempt, record, true, 8, [operation], true, accepted).observed, false);
  assert.equal(noticeEvidence(attempt, acknowledged, true, 9, [], true, accepted).observed, false);
  assert.equal(noticeEvidence(attempt, acknowledged, true, 9, [operation], false, accepted).observed, false);
  assert.equal(noticeEvidence(attempt, acknowledged, false, 9, [operation], true, accepted).observed, false);
  assert.equal(noticeEvidence(attempt, acknowledged, true, 9, [operation], true, accepted).observed, true);
  assert.equal(noticeEvidence(attempt, {...acknowledged, generation: 2}, true, 9, [operation], true, accepted).retired, true);
  assert.equal(noticeEvidence(attempt, acknowledged, true, 9, [{...operation, requestId: 'another'}], true, accepted).observed, false);
  assert.equal(noticeEvidence(attempt, {...record, notices: [{...notice, acknowledgedBy: ['pixoo']}]}, true, 100, [operation], true, accepted).observed, false, 'completion before the session copy cannot confirm a partial prior acknowledgment');
  const uncertain = noticeEvidence(attempt, acknowledged, true, 9, [operation], true, errorBody('uncertain-result'));
  assert.equal(uncertain.reply, 'uncertain'); assert.equal(uncertain.observed, true, 'lost reply stays uncertain while independent owner evidence can arrive');
});
