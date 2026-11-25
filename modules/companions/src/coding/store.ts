import type {DatabaseSync} from 'node:sqlite';
import type {CodingAttemptEntry, CodingAttemptResult, CodingJobEntry} from './job-page.js';
import type {CodingCompanion, CodingContinuation, CodingProgress} from '@jimmie-potts/event-contracts/v2/coding';
import type {CodingChoice, CodingHarness} from './routing.js';

/** One accepted coding operation: which task it serves, which worker endpoint runs it and how it ended. */
export type CodingResponsibility = {operationId: string; taskId: string; endpointId: string; traceparent: string; started: boolean; status: 'pending' | CodingProgress['status']};
/**
 * One approved hand-off waiting for its companion's slot (Hub #2028), oldest first. `sending` marks the one whose
 * dispatch has left and whose acceptance has not been recorded; a start finds it of unknown fate, never resends it.
 */
export type CodingWaitingRecord = {operationId: string; taskId: string; companion: CodingCompanion; repository: string; brief: string; traceparent: string; sending: boolean};
export type CodingOrigin = {conversationId: string; taskId: string};
export type CodingJob = CodingOrigin & {jobId: string; operationId: string; repository: string; brief: string};
export type CodingAttempt = CodingAttemptEntry & {
  jobId: string; choice: CodingChoice; companion: CodingCompanion; handoffToken?: string; selectionId?: string; continuation?: CodingContinuation;
};
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
    database.exec(`CREATE TABLE IF NOT EXISTS companion_coding_attempts (
      operation_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES companion_coding_jobs(job_id),
      choice TEXT NOT NULL, companion TEXT NOT NULL, harness TEXT, session_id TEXT,
      selection_reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', result TEXT, handoff_token TEXT, selection_id TEXT,
      from_operation_id TEXT UNIQUE, from_token TEXT, stop_requested INTEGER NOT NULL DEFAULT 0 CHECK(stop_requested IN (0,1))
    ) STRICT`);
    database.exec('CREATE INDEX IF NOT EXISTS companion_coding_attempt_job ON companion_coding_attempts(job_id)');
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
    const row = this.database.prepare(`SELECT j.*, ? AS attempt FROM companion_coding_jobs j
      WHERE j.operation_id=? OR j.job_id=(SELECT job_id FROM companion_coding_attempts WHERE operation_id=?)`).get(operationId, operationId, operationId);
    if (row === undefined) return undefined;
    const {job_id: jobId, attempt, conversation_id: conversationId, task_id: taskId, repository, brief} = row;
    if (typeof jobId !== 'string' || typeof attempt !== 'string' || typeof conversationId !== 'string' || typeof taskId !== 'string' ||
      typeof repository !== 'string' || typeof brief !== 'string') throw new Error('coding-job-invalid');
    return {jobId, operationId: attempt, conversationId, taskId, repository, brief};
  }
  jobById(jobId: string): CodingJob | undefined {
    const row = this.database.prepare('SELECT operation_id FROM companion_coding_jobs WHERE job_id=?').get(jobId);
    return typeof row?.operation_id === 'string' ? this.job(row.operation_id) : undefined;
  }
  activeJobs(after: string, limit: number): Omit<CodingJobEntry, 'status' | 'setup'>[] {
    return this.database.prepare(`WITH current AS (
      SELECT j.*, COALESCE((SELECT a.operation_id FROM companion_coding_attempts a
        WHERE a.job_id=j.job_id ORDER BY a.rowid DESC LIMIT 1), j.operation_id) AS current_operation FROM companion_coding_jobs j
      WHERE j.job_id > ?
    )
      SELECT job.job_id, job.current_operation AS operation_id, job.task_id, job.conversation_id, job.repository,
        COALESCE(waiting.companion, attempt.companion) AS companion
      FROM current job LEFT JOIN companion_coding_waiting waiting ON waiting.operation_id=job.current_operation
      LEFT JOIN companion_coding_attempts attempt ON attempt.operation_id=job.current_operation
      WHERE NOT EXISTS (SELECT 1 FROM companion_coding_job_updates observation
        WHERE observation.operation_id = job.current_operation AND observation.kind = 'result')
      ORDER BY job.job_id LIMIT ?`).all(after, limit).map(row => {
      const {job_id: jobId, operation_id: operationId, task_id: taskId, conversation_id: conversationId, repository, companion} = row;
      if (typeof jobId !== 'string' || typeof operationId !== 'string' || typeof taskId !== 'string' ||
        typeof conversationId !== 'string' || typeof repository !== 'string') throw new Error('coding-job-invalid');
      return {jobId, operationId, taskId, conversationId, repository,
        ...(companion === 'bunny' || companion === 'reachy' || companion === 'microduck' ? {companion} : {})};
    });
  }
  createAttempt(attempt: Pick<CodingAttempt, 'jobId' | 'operationId' | 'choice' | 'companion' | 'harness' | 'selectionReason' | 'continuation'>): void {
    this.database.prepare(`INSERT INTO companion_coding_attempts(operation_id,job_id,choice,companion,harness,selection_reason,from_operation_id,from_token)
      VALUES(?,?,?,?,?,?,?,?)`).run(attempt.operationId, attempt.jobId, attempt.choice, attempt.companion, attempt.harness, attempt.selectionReason,
      attempt.continuation?.fromOperationId ?? null, attempt.continuation?.token ?? null);
  }
  attempts(jobId: string): CodingAttempt[] {
    return this.database.prepare('SELECT * FROM companion_coding_attempts WHERE job_id=? ORDER BY rowid').all(jobId).map(row => this.#attempt(row));
  }
  attempt(operationId: string): CodingAttempt | undefined {
    const row = this.database.prepare('SELECT * FROM companion_coding_attempts WHERE operation_id=?').get(operationId);
    return row === undefined ? undefined : this.#attempt(row);
  }
  #attempt(row: Record<string, unknown>): CodingAttempt {
    const {operation_id: operationId, job_id: jobId, choice, companion, harness, session_id: sessionId, selection_reason: selectionReason,
      status, result, handoff_token: handoffToken, selection_id: selectionId, from_operation_id: from, from_token: token} = row;
    if (typeof operationId !== 'string' || typeof jobId !== 'string' || typeof selectionReason !== 'string' ||
      (choice !== 'auto' && choice !== 'claude-code' && choice !== 'codex') ||
      (companion !== 'bunny' && companion !== 'reachy' && companion !== 'microduck') ||
      (harness !== null && harness !== 'claude-code' && harness !== 'codex') || (sessionId !== null && typeof sessionId !== 'string') ||
      (status !== 'queued' && status !== 'dispatching' && status !== 'started' && status !== 'completed' && status !== 'failed' &&
        status !== 'cancelled' && status !== 'uncertain') || (result !== null && typeof result !== 'string')) throw new Error('coding-attempt-invalid');
    return {operationId, jobId, choice, companion, harness, sessionId, selectionReason, status, result: result === null ? null : JSON.parse(result) as CodingAttemptResult,
      ...(typeof handoffToken === 'string' ? {handoffToken} : {}), ...(typeof selectionId === 'string' ? {selectionId} : {}),
      ...(typeof from === 'string' && typeof token === 'string' ? {continuation: {fromOperationId: from, token}} : {})};
  }
  routeAttempt(operationId: string, harness: CodingHarness | undefined, reason: string): void {
    this.database.prepare("UPDATE companion_coding_attempts SET harness=?, selection_reason=? WHERE operation_id=? AND status='queued'")
      .run(harness ?? null, reason, operationId);
  }
  observeAttempt(operationId: string, status: CodingAttempt['status'], sessionId?: string, result?: CodingAttemptResult, handoffToken?: string, selectionId?: string, harness?: CodingHarness): void {
    this.database.prepare(`UPDATE companion_coding_attempts SET status=?, session_id=COALESCE(session_id,?),
      result=COALESCE(result,?), handoff_token=COALESCE(handoff_token,?), selection_id=COALESCE(selection_id,?), harness=COALESCE(harness,?) WHERE operation_id=?`)
      .run(status, sessionId ?? null, result === undefined ? null : JSON.stringify(result), handoffToken ?? null, selectionId ?? null, harness ?? null, operationId);
  }
  requestStop(operationId: string): boolean {
    if (this.attempt(operationId) !== undefined) return this.database.prepare('UPDATE companion_coding_attempts SET stop_requested=1 WHERE operation_id=? AND stop_requested=0').run(operationId).changes === 1;
    return this.database.prepare('UPDATE companion_coding_jobs SET stop_requested=1 WHERE operation_id=? AND stop_requested=0').run(operationId).changes === 1;
  }
  stopRequested(operationId: string): boolean {
    if (this.database.prepare('SELECT 1 FROM companion_coding_attempts WHERE operation_id=? AND stop_requested=1').get(operationId) !== undefined) return true;
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
      this.observeAttempt(record.operationId, 'dispatching');
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
  terminalStatus(operationId: string): 'completed' | 'failed' | 'cancelled' | 'uncertain' | undefined {
    const status = this.database.prepare('SELECT status FROM companion_coding WHERE operation_id=?').get(operationId)?.status;
    return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'uncertain' ? status : undefined;
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
