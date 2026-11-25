import type {DatabaseSync} from 'node:sqlite';
import type {CodingJobEntry} from './job-page.js';
import type {CodingCompanion, CodingProgress} from '@jimmie-potts/event-contracts/v2/coding';

/** One accepted coding operation: which task it serves, which worker endpoint runs it and how it ended. */
export type CodingResponsibility = {operationId: string; taskId: string; endpointId: string; traceparent: string; started: boolean; status: 'pending' | CodingProgress['status']};
/**
 * One approved hand-off waiting for its companion's slot (Hub #2028), oldest first. `sending` marks the one whose
 * dispatch has left and whose acceptance has not been recorded; a start finds it of unknown fate, never resends it.
 */
export type CodingWaitingRecord = {operationId: string; taskId: string; companion: CodingCompanion; repository: string; brief: string; traceparent: string; sending: boolean};
export type CodingOrigin = {conversationId: string; taskId: string};
export type CodingJob = CodingOrigin & {jobId: string; operationId: string; repository: string; brief: string};
type CodingObservation = {operationId: string; taskId: string; kind: 'sent' | 'stop-unconfirmed' | 'result'; text: string; traceparent: string; legacyEvidence?: string; startup?: boolean};
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
    database.exec(`CREATE TABLE IF NOT EXISTS companion_coding_accepted_waits (
      operation_id TEXT PRIMARY KEY REFERENCES companion_coding(operation_id), traceparent TEXT NOT NULL
    ) STRICT`);
    database.exec(`CREATE TABLE IF NOT EXISTS companion_coding_jobs (
      job_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, conversation_id TEXT NOT NULL,
      task_id TEXT NOT NULL, repository TEXT NOT NULL, brief TEXT NOT NULL,
      stop_requested INTEGER NOT NULL DEFAULT 0 CHECK(stop_requested IN (0,1))
    ) STRICT`);
    database.exec(`CREATE TABLE IF NOT EXISTS companion_coding_job_updates (
      operation_id TEXT NOT NULL, task_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('sent','stop-unconfirmed','result')),
      text TEXT NOT NULL, traceparent TEXT NOT NULL, legacy_evidence TEXT,
      startup INTEGER NOT NULL DEFAULT 0 CHECK(startup IN (0,1)), delivered INTEGER NOT NULL DEFAULT 0 CHECK(delivered IN (0,1)),
      PRIMARY KEY(operation_id, kind)
    ) STRICT`);
  }
  create(job: CodingJob): void {
    this.database.prepare('INSERT INTO companion_coding_jobs(job_id,operation_id,conversation_id,task_id,repository,brief) VALUES(?,?,?,?,?,?)')
      .run(job.jobId, job.operationId, job.conversationId, job.taskId, job.repository, job.brief);
  }
  job(operationId: string): CodingJob | undefined {
    const row = this.database.prepare('SELECT * FROM companion_coding_jobs WHERE operation_id=?').get(operationId);
    if (row === undefined) return undefined;
    const {job_id: jobId, operation_id: attempt, conversation_id: conversationId, task_id: taskId, repository, brief} = row;
    if (typeof jobId !== 'string' || typeof attempt !== 'string' || typeof conversationId !== 'string' || typeof taskId !== 'string' ||
      typeof repository !== 'string' || typeof brief !== 'string') throw new Error('coding-job-invalid');
    return {jobId, operationId: attempt, conversationId, taskId, repository, brief};
  }
  activeJobs(after: string, limit: number): Omit<CodingJobEntry, 'status' | 'setup'>[] {
    return this.database.prepare(`SELECT job.job_id, job.operation_id, job.task_id, job.conversation_id, job.repository, waiting.companion
      FROM companion_coding_jobs job LEFT JOIN companion_coding_waiting waiting USING (operation_id)
      WHERE job.job_id > ? AND NOT EXISTS (SELECT 1 FROM companion_coding_job_updates observation
        WHERE observation.operation_id = job.operation_id AND observation.kind = 'result')
      ORDER BY job.job_id LIMIT ?`).all(after, limit).map(row => {
      const {job_id: jobId, operation_id: operationId, task_id: taskId, conversation_id: conversationId, repository, companion} = row;
      if (typeof jobId !== 'string' || typeof operationId !== 'string' || typeof taskId !== 'string' ||
        typeof conversationId !== 'string' || typeof repository !== 'string') throw new Error('coding-job-invalid');
      return {jobId, operationId, taskId, conversationId, repository,
        ...(companion === 'bunny' || companion === 'reachy' || companion === 'microduck' ? {companion} : {})};
    });
  }
  requestStop(operationId: string): boolean {
    return this.database.prepare('UPDATE companion_coding_jobs SET stop_requested=1 WHERE operation_id=? AND stop_requested=0').run(operationId).changes === 1;
  }
  stopRequested(operationId: string): boolean {
    return this.database.prepare('SELECT 1 FROM companion_coding_jobs WHERE operation_id=? AND stop_requested=1').get(operationId) !== undefined;
  }
  update({operationId, taskId, kind, text, traceparent, legacyEvidence, startup}: CodingObservation): void {
    this.database.prepare('INSERT OR IGNORE INTO companion_coding_job_updates(operation_id,task_id,kind,text,traceparent,legacy_evidence,startup) VALUES(?,?,?,?,?,?,?)')
      .run(operationId, taskId, kind, text, traceparent, legacyEvidence ?? null, startup === true ? 1 : 0);
  }
  recoverDeliveries(): void {
    this.database.prepare('UPDATE companion_coding_job_updates SET startup=1 WHERE delivered=0').run();
  }
  observationSaved(operationId: string, kind: CodingObservation['kind']): boolean {
    return this.database.prepare('SELECT 1 FROM companion_coding_job_updates WHERE operation_id=? AND kind=?').get(operationId, kind) !== undefined;
  }
  resultSaved(operationId: string): boolean {return this.observationSaved(operationId, 'result');}
  acceptedWait(operationId: string): string | undefined {
    const row = this.database.prepare('SELECT traceparent FROM companion_coding_accepted_waits WHERE operation_id=?').get(operationId);
    if (row === undefined) return undefined;
    if (typeof row.traceparent !== 'string') throw new Error('coding-accepted-wait-invalid');
    return row.traceparent;
  }
  undelivered(operationId?: string): CodingObservation[] {
    const rows = operationId === undefined
      ? this.database.prepare('SELECT * FROM companion_coding_job_updates WHERE delivered=0 ORDER BY rowid').all()
      : this.database.prepare('SELECT * FROM companion_coding_job_updates WHERE delivered=0 AND operation_id=? ORDER BY rowid').all(operationId);
    return rows.map(row => {
      const {operation_id: id, task_id: taskId, kind, text, traceparent, legacy_evidence: legacyEvidence, startup} = row;
      if (typeof id !== 'string' || typeof taskId !== 'string' || typeof text !== 'string' || typeof traceparent !== 'string' ||
        (kind !== 'sent' && kind !== 'stop-unconfirmed' && kind !== 'result') ||
        (legacyEvidence !== null && typeof legacyEvidence !== 'string') || (startup !== 0 && startup !== 1)) throw new Error('coding-job-update-invalid');
      return {operationId: id, taskId, kind, text, traceparent, startup: startup === 1, ...(legacyEvidence === null ? {} : {legacyEvidence})};
    });
  }
  delivered({operationId, kind}: CodingObservation): void {
    this.database.prepare('UPDATE companion_coding_job_updates SET delivered=1 WHERE operation_id=? AND kind=?').run(operationId, kind);
  }
  /** Records the responsibility and, in the same transaction, ends the hand-off's wait if it waited. */
  accept(record: Omit<CodingResponsibility, 'started' | 'status'>): void {
    this.database.exec('SAVEPOINT coding_accept');
    try {
      this.database.prepare('INSERT INTO companion_coding(operation_id,task_id,endpoint_id,traceparent) VALUES(?,?,?,?)')
        .run(record.operationId, record.taskId, record.endpointId, record.traceparent);
      this.database.prepare('INSERT INTO companion_coding_accepted_waits SELECT operation_id,traceparent FROM companion_coding_waiting WHERE operation_id=?').run(record.operationId);
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
  waitingCount(): number {
    const row = this.database.prepare('SELECT count(*) AS total FROM companion_coding_waiting').get();
    if (typeof row?.total !== 'number') throw new Error('coding-waiting-invalid');
    return row.total;
  }
  waitingFor(operationId: string): CodingWaitingRecord | undefined {
    const row = this.database.prepare('SELECT * FROM companion_coding_waiting WHERE operation_id=?').get(operationId);
    return row === undefined ? undefined : this.#waitingRecord(row);
  }
  waiting(limit = -1): CodingWaitingRecord[] {
    return this.database.prepare('SELECT * FROM companion_coding_waiting ORDER BY rowid LIMIT ?').all(limit).map(row => this.#waitingRecord(row));
  }
  #waitingRecord(row: Record<string, unknown>): CodingWaitingRecord {
    const {operation_id: operationId, task_id: taskId, companion, repository, brief, traceparent, sending} = row;
    if (typeof operationId !== 'string' || typeof taskId !== 'string' || (companion !== 'bunny' && companion !== 'reachy' && companion !== 'microduck')
      || typeof repository !== 'string' || typeof brief !== 'string' || typeof traceparent !== 'string' || (sending !== 0 && sending !== 1)) throw new Error('coding-waiting-invalid');
    return {operationId, taskId, companion, repository, brief, traceparent, sending: sending === 1};
  }
}
