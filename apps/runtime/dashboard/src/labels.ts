// A label attempt's reply and synced owner evidence remain distinct (Hub #1006).
import type {ActionReply} from './actions.ts';
import type {SessionRow} from './sessions.ts';

export type LabelAttempt = {id: string; generation: number; revision: number; label: string | null; requestId: string};
export type LabelEvidence = 'requested' | 'accepted' | 'confirmed' | 'refused' | 'uncertain' | 'retired';
/** Captures immutable identity and revision for one explicit attempt. */
export const labelAttempt = ({id, generation, revision}: SessionRow, label: string | null, requestId: string): LabelAttempt =>
  ({id, generation, revision, label, requestId});
/** Stale copies and pending attempts cannot submit; text is bounded by Unicode scalar count. */
export const labelCanSubmit = (row: SessionRow, live: boolean, pending: boolean, label: string | null): boolean =>
  live && !row.uncertain && !pending && (label === null || label.length > 0 && [...label].length <= 80);

/** A matching live record confirms an accepted attempt, including a no-op at the same revision. */
export function labelEvidence(attempt: LabelAttempt, row: SessionRow | undefined, live: boolean, answer?: ActionReply): LabelEvidence {
  if (row === undefined || row.id !== attempt.id || row.generation !== attempt.generation) return 'retired';
  if (answer === undefined) return 'requested';
  if ('error' in answer) return answer.error.code === 'uncertain-result' ? 'uncertain' : 'refused';
  const matches = attempt.label === null ? row.label === undefined : row.label?.origin === 'user' && row.label.value === attempt.label;
  return live && !row.uncertain && row.revision >= attempt.revision && matches ? 'confirmed' : 'accepted';
}
