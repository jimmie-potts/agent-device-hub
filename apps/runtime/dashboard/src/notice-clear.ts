// Evidence for one explicit operator override; reconnect and reload send nothing.
import type {OperationRecord, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {ActionReply} from './actions.ts';

export type NoticeAttempt = {id: string; generation: number; revision: number; noticeId: string; requestId: string};
export const noticeAttempt = (record: SessionRecord, requestId: string): NoticeAttempt | undefined => {
  const notice = record.notices.at(-1);
  return notice === undefined ? undefined : {id: record.id, generation: record.generation, revision: record.revision, noticeId: notice.id, requestId};
};
export type NoticeEvidence = {reply: 'requested' | 'accepted' | 'refused' | 'uncertain'; completion: string; observed: boolean; retired: boolean};
/** Completion and session evidence must match this request, target, generation and selected notice. */
export function noticeEvidence(attempt: NoticeAttempt, record: SessionRecord | undefined, live: boolean, sessionRevision: number | undefined,
  operations: readonly OperationRecord[], operationsSynced: boolean, answer?: ActionReply): NoticeEvidence {
  const retired = record === undefined || record.id !== attempt.id || record.generation !== attempt.generation;
  const operation = operations.find(item => item.requestId === attempt.requestId && item.family === 'notice-clear' && item.target === attempt.id);
  const completed = operationsSynced && operation?.status === 'completed' && operation.result === 'succeeded' && operation.evidence === 'observed';
  const notice = record?.notices.find(item => item.id === attempt.noticeId);
  return {
    reply: answer === undefined ? 'requested' : 'error' in answer ? answer.error.code === 'uncertain-result' ? 'uncertain' : 'refused' : 'accepted',
    completion: operationsSynced ? operation?.status ?? 'not observed' : 'not synced',
    // The guarded save advances this session; recording the later reply can advance only the operation projection.
    observed: !retired && live && completed && (record?.revision ?? -1) > attempt.revision && (sessionRevision ?? -1) >= (record?.revision ?? Infinity) && (notice?.acknowledgedBy.length ?? 0) > 0,
    retired,
  };
}
