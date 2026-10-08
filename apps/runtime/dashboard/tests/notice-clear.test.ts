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
  const evidence = noticeEvidence(attempt, acknowledged, true, [operation], true, accepted);
  assert.equal(evidence.reply, 'accepted'); assert.equal(evidence.completion, 'completed');
  assert.deepEqual(evidence.acknowledgedBy, ['dashboard', 'nanoleaf', 'pixoo']);
  assert.equal(noticeEvidence(attempt, acknowledged, true, [], true, accepted).completion, 'not observed');
  assert.equal(noticeEvidence(attempt, acknowledged, true, [operation], false, accepted).completion, 'not synced');
  assert.equal(noticeEvidence(attempt, acknowledged, false, [operation], true, accepted).acknowledgedBy, undefined);
  assert.equal(noticeEvidence(attempt, {...acknowledged, generation: 2}, true, [operation], true, accepted).retired, true);
  assert.equal(noticeEvidence(attempt, acknowledged, true, [{...operation, requestId: 'another'}], true, accepted).completion, 'not observed');
  const partial = noticeEvidence(attempt, {...record, revision: 9, notices: [{...notice, acknowledgedBy: ['pixoo']}]}, true, [{...operation, revision: 10}], true, accepted);
  assert.equal(partial.completion, 'completed'); assert.deepEqual(partial.acknowledgedBy, ['pixoo'], 'an intermediate record is listed without claiming every consumer acknowledged');
  const uncertain = noticeEvidence(attempt, acknowledged, true, [operation], true, errorBody('uncertain-result'));
  assert.equal(uncertain.reply, 'uncertain'); assert.deepEqual(uncertain.acknowledgedBy, evidence.acknowledgedBy, 'a lost reply does not hide independent owner evidence');
});
