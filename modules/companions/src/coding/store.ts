import type {DatabaseSync} from 'node:sqlite';
import type {CodingCompanion, CodingProgress} from '@jimmie-potts/event-contracts/v2/coding';

/** One accepted coding operation: which task it serves, which worker endpoint runs it and how it ended. */
export type CodingResponsibility = {operationId: string; taskId: string; endpointId: string; traceparent: string; started: boolean; status: 'pending' | CodingProgress['status']};
/**
 * One approved hand-off waiting for its companion's slot (Hub #2028), oldest first. `sending` marks the one whose
 * dispatch has left and whose acceptance has not been recorded; a start finds it of unknown fate, never resends it.
 */
export type CodingWaitingRecord = {operationId: string; taskId: string; companion: CodingCompanion; repository: string; brief: string; traceparent: string; sending: boolean};
const companions: readonly string[] = ['bunny', 'reachy', 'microduck'];
/**
 * Durable responsibility, final receipts and the hand-offs waiting for a slot (Hub #502, #2028). Availability, the
 * worker endpoint and its slots are never recovered.
 */
export class CodingStore {
  constructor(readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS companion_coding (
      operation_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, endpoint_id TEXT NOT NULL,
      traceparent TEXT NOT NULL, started INTEGER NOT NULL DEFAULT 0 CHECK(started IN (0,1)),
      status TEXT NOT NULL DEFAULT 'pending'
    ) STRICT`);
    database.exec(`CREATE TABLE IF NOT EXISTS companion_coding_waiting (
      operation_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, companion TEXT NOT NULL CHECK(companion IN ('bunny','reachy','microduck')),
      repository TEXT NOT NULL, brief TEXT NOT NULL, traceparent TEXT NOT NULL, sending INTEGER NOT NULL DEFAULT 0 CHECK(sending IN (0,1))
    ) STRICT`);
  }
  /** Records the responsibility and, in the same transaction, ends the hand-off's wait if it waited. */
  accept(record: Omit<CodingResponsibility, 'started' | 'status'>): void {
    this.database.exec('SAVEPOINT coding_accept');
    try {
      this.database.prepare('INSERT INTO companion_coding(operation_id,task_id,endpoint_id,traceparent) VALUES(?,?,?,?)')
        .run(record.operationId, record.taskId, record.endpointId, record.traceparent);
      this.database.prepare('DELETE FROM companion_coding_waiting WHERE operation_id=?').run(record.operationId);
      this.database.exec('RELEASE coding_accept');
    } catch (error) {this.database.exec('ROLLBACK TO coding_accept'); this.database.exec('RELEASE coding_accept'); throw error;}
  }
  started(operationId: string): void {this.database.prepare('UPDATE companion_coding SET started=1 WHERE operation_id=?').run(operationId);}
  settle(operationId: string, status: CodingProgress['status']): void {
    this.database.prepare('UPDATE companion_coding SET status=? WHERE operation_id=?').run(status, operationId);
  }
  records(status: CodingResponsibility['status']): CodingResponsibility[] {
    return this.database.prepare('SELECT * FROM companion_coding WHERE status=? ORDER BY rowid').all(status).map(row => {
      if (typeof row.operation_id !== 'string' || typeof row.task_id !== 'string' || typeof row.endpoint_id !== 'string' || typeof row.traceparent !== 'string'
        || (row.started !== 0 && row.started !== 1) || typeof row.status !== 'string') throw new Error('coding-responsibility-invalid');
      return {operationId: row.operation_id, taskId: row.task_id, endpointId: row.endpoint_id, traceparent: row.traceparent, started: row.started === 1, status: row.status as CodingResponsibility['status']};
    });
  }
  uncertain(): CodingResponsibility | undefined {return this.records('uncertain').at(-1);}
  /** Whether this operation was accepted as a run, whatever became of it. */
  accepted(operationId: string): boolean {return this.database.prepare('SELECT 1 FROM companion_coding WHERE operation_id=?').get(operationId) !== undefined;}
  wait(record: Omit<CodingWaitingRecord, 'sending'>): void {
    this.database.prepare('INSERT INTO companion_coding_waiting(operation_id,task_id,companion,repository,brief,traceparent) VALUES(?,?,?,?,?,?)')
      .run(record.operationId, record.taskId, record.companion, record.repository, record.brief, record.traceparent);
  }
  sending(operationId: string): void {this.database.prepare('UPDATE companion_coding_waiting SET sending=1 WHERE operation_id=?').run(operationId);}
  /** Ends a wait without a run: cancelled, refused or of unknown fate. */
  unwait(operationId: string): void {this.database.prepare('DELETE FROM companion_coding_waiting WHERE operation_id=?').run(operationId);}
  waiting(): CodingWaitingRecord[] {
    return this.database.prepare('SELECT * FROM companion_coding_waiting ORDER BY rowid').all().map(row => {
      if (typeof row.operation_id !== 'string' || typeof row.task_id !== 'string' || typeof row.companion !== 'string' || !companions.includes(row.companion)
        || typeof row.repository !== 'string' || typeof row.brief !== 'string' || typeof row.traceparent !== 'string' || (row.sending !== 0 && row.sending !== 1)) throw new Error('coding-waiting-invalid');
      return {operationId: row.operation_id, taskId: row.task_id, companion: row.companion as CodingCompanion, repository: row.repository, brief: row.brief, traceparent: row.traceparent, sending: row.sending === 1};
    });
  }
}
