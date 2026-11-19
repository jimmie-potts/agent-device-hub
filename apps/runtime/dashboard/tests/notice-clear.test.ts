import assert from 'node:assert/strict';
import test from 'node:test';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession, type SessionFacts, type SessionView} from '@jimmie-potts/event-contracts/v2/session-view';
import {errorBody} from '@jimmie-potts/event-contracts/v2/errors';
import {noticeAttempt, noticeEvidence, overrideAvailable} from '../src/notice-clear.ts';

/** A synthetic Claude Code session whose turn ended: its session/3.0 record, which is its view. */
function view(change: Partial<SessionFacts> = {}): SessionView {
  return buildSession({
    id: 'a'.repeat(64), revision: 8, generation: 1,
    identity: {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code', sessionId: 'session-sim-1'},
    parent: {status: 'top-level'}, turn: {status: 'known', id: 'turn-1'}, work: 'idle', attention: [], read: 'unknown',
    notices: [{id: 'b'.repeat(64), kind: 'turn-ended', turn: {status: 'known', id: 'turn-1'}, acknowledgedBy: []}],
    unavailable: [], ordering: {status: 'unknown'}, observedAtMs: 1000, lastEvidenceAtMs: 1000,
    children: {working: 0, unconfirmed: 0}, ...change,
  });
}
const record = view();
const attempt = noticeAttempt(record, 'req-clear'); assert.ok(attempt);
const operation = {revision: 9, requestId: 'req-clear', family: 'notice-clear', target: record.id, status: 'completed', result: 'succeeded', evidence: 'observed'} as OperationRecord;
const notice = record.outcome.notices[0]; assert.ok(notice);
const withNotices = (base: SessionView, revision: number, notices: SessionView['outcome']['notices']): SessionView => ({...base, revision, outcome: {...base.outcome, notices}});
const acknowledged = withNotices(record, 9, [{...notice, acknowledgedBy: ['dashboard', 'nanoleaf', 'pixoo']}]);
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
  const partial = noticeEvidence(attempt, withNotices(record, 9, [{...notice, acknowledgedBy: ['pixoo']}]), true, [{...operation, revision: 10}], true, accepted);
  assert.equal(partial.completion, 'completed'); assert.deepEqual(partial.acknowledgedBy, ['pixoo'], 'an intermediate record is listed without claiming every consumer acknowledged');
  const uncertain = noticeEvidence(attempt, acknowledged, true, [operation], true, errorBody('uncertain-result'));
  assert.equal(uncertain.reply, 'uncertain'); assert.deepEqual(uncertain.acknowledgedBy, evidence.acknowledgedBy, 'a lost reply does not hide independent owner evidence');
});

void test('the override has no age term: a finished or waiting session silent past five minutes stays available (#1865)', () => {
  const live = {control: true, live: true, synced: true};
  // Silence and a restart never change a finished session's record, whose last change may be long ago.
  assert.equal(overrideAvailable(view(), live), true, 'a finished session silent for ten minutes');
  assert.equal(overrideAvailable(view({unconfirmed: 'restart'}), live), true, 'after a restart');
  const question = {id: {status: 'known', id: 'question-1'}, kind: 'question', turn: {status: 'known', id: 'turn-2'}} as const;
  assert.equal(overrideAvailable(view({unconfirmed: 'restart', work: 'active', turn: {status: 'known', id: 'turn-2'}, attention: [question]}), live), true,
    'a waiting session');
  assert.equal(overrideAvailable(view({unconfirmed: 'restart', work: 'active'}), live), false, 'unconfirmed work is the shared uncertainty');
  assert.equal(overrideAvailable(view({work: 'unknown', notices: []}), live), false, 'an unknown status');
  for (const missing of [{control: false}, {live: false}, {synced: false}]) assert.equal(overrideAvailable(view(), {...live, ...missing}), false, JSON.stringify(missing));
  assert.equal(overrideAvailable(undefined, live), false);
});
