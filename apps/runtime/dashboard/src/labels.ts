// A label attempt's reply and synced owner evidence remain distinct (Hub #1006).
import type {SessionRow} from './sessions.ts';

export type LabelAttempt = {id: string; generation: number; revision: number; label: string | null; requestId: string};
/** Captures immutable identity and revision for one explicit attempt. */
export const labelAttempt = ({id, generation, revision}: SessionRow, label: string | null, requestId: string): LabelAttempt =>
  ({id, generation, revision, label, requestId});
/**
 * Only a copy that is not synced and a pending attempt block a submission; text is bounded by Unicode scalar count. The
 * label is the owner's own data, so the session's status, unknown or with unconfirmed work, does not block it (#1865):
 * the expected-revision guard still refuses an attempt on a record that changed.
 */
export const labelCanSubmit = (_row: SessionRow, live: boolean, pending: boolean, label: string | null): boolean =>
  live && !pending && (label === null || label.length > 0 && [...label].length <= 80);

/** A matching record in a synced copy confirms an accepted attempt, including a no-op at the same revision, whatever the session's status. */
export function labelObservation(attempt: LabelAttempt, row: SessionRow | undefined, live: boolean): 'confirmed' | 'retired' | 'unconfirmed' {
  if (row === undefined || row.id !== attempt.id || row.generation !== attempt.generation) return 'retired';
  const matches = attempt.label === null ? row.label === undefined : row.label?.origin === 'user' && row.label.value === attempt.label;
  return live && row.revision >= attempt.revision && matches ? 'confirmed' : 'unconfirmed';
}
