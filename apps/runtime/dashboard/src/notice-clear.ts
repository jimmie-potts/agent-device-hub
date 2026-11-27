// Evidence for one explicit operator override; reconnect and reload send nothing.
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {SessionView} from '@jimmie-potts/event-contracts/v2/session-view';
import {uncertainOf} from './sessions.ts';

export type NoticeAttempt = {id: string; generation: number; revision: number; noticeId: string; requestId: string};
/** The session's latest notice, which the override selects. */
export const currentNotice = (view: SessionView): SessionView['outcome']['notices'][number] | undefined => view.outcome.notices.at(-1);
export const noticeAttempt = (view: SessionView, requestId: string): NoticeAttempt | undefined => {
  const notice = currentNotice(view);
  return notice === undefined ? undefined : {id: view.id, generation: view.generation, revision: view.revision, noticeId: notice.id, requestId};
};
/**
 * Whether the override may be offered for the selected session (Hub #1865, design decision 10): with control authority,
 * over a live synced copy, for a session the dashboard does not mark uncertain. There is no freshness term: a session
 * that holds a finished turn or waits for the owner stays available however long it is silent. The selected notice and
 * the expected-revision guard stay with the attempt.
 */
export const overrideAvailable = (view: SessionView | undefined, {control, live, synced}: {control: boolean; live: boolean; synced: boolean}): boolean =>
  control && live && synced && view !== undefined && uncertainOf(view) === undefined;
export type NoticeEvidence = {completed: boolean; completion: string; acknowledgedBy: readonly string[] | undefined; retired: boolean};
/** Matching operation completion and the selected notice's current acknowledgments are separate evidence. */
export function noticeEvidence(attempt: NoticeAttempt, view: SessionView | undefined, live: boolean,
  operations: readonly OperationRecord[], operationsSynced: boolean): NoticeEvidence {
  const retired = view === undefined || view.id !== attempt.id || view.generation !== attempt.generation;
  const operation = operations.find(item => item.requestId === attempt.requestId && item.family === 'notice-clear' && item.target === attempt.id);
  const notice = view?.outcome.notices.find(item => item.id === attempt.noticeId);
  return {
    completed: operationsSynced && operation?.status === 'completed' && operation.result === 'succeeded',
    completion: operationsSynced ? operation?.status ?? 'not observed' : 'not synced',
    acknowledgedBy: !retired && live ? notice?.acknowledgedBy : undefined,
    retired,
  };
}
