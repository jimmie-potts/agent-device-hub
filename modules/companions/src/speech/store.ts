import type {DatabaseSync} from 'node:sqlite';
import type {SpeechPlayback} from '@jimmie-potts/event-contracts/v2/companions';
import {Outcome} from '@jimmie-potts/sdk';

export type Responsibility = {operationId: string; candidateId: string; endpointId: string; traceparent: string; started: boolean};
/** Durable responsibility and final receipts only. Availability and candidates are never recovered. */
export class SpeechStore {
  constructor(readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS companion_speech (
      operation_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL UNIQUE, endpoint_id TEXT NOT NULL,
      traceparent TEXT NOT NULL, started INTEGER NOT NULL DEFAULT 0 CHECK(started IN (0,1)),
      playback TEXT NOT NULL DEFAULT 'pending'
    ) STRICT`);
  }
  has(candidateId: string): boolean {return this.database.prepare('SELECT 1 FROM companion_speech WHERE candidate_id=?').get(candidateId) !== undefined;}
  accept(record: Responsibility): void {
    this.database.prepare('INSERT INTO companion_speech(operation_id,candidate_id,endpoint_id,traceparent) VALUES(?,?,?,?)')
      .run(record.operationId, record.candidateId, record.endpointId, record.traceparent);
  }
  started(operationId: string): void {this.database.prepare('UPDATE companion_speech SET started=1 WHERE operation_id=?').run(operationId);}
  settle(playback: SpeechPlayback): void {
    this.database.prepare('UPDATE companion_speech SET playback=?,started=? WHERE operation_id=?').run(playback.status, Number(playback.started), playback.operationId);
  }
  records(status: 'pending' | 'uncertain'): Responsibility[] {
    return this.database.prepare('SELECT * FROM companion_speech WHERE playback=? ORDER BY rowid').all(status).map(row => {
      if (typeof row.operation_id !== 'string' || typeof row.candidate_id !== 'string' || typeof row.endpoint_id !== 'string' || typeof row.traceparent !== 'string'
        || (row.started !== 0 && row.started !== 1)) throw new Error('speech-responsibility-invalid');
      return {operationId: row.operation_id, candidateId: row.candidate_id, endpointId: row.endpoint_id, traceparent: row.traceparent, started: row.started === 1};
    });
  }
  uncertain(): Responsibility | undefined {return this.records(Outcome.uncertain).at(-1);}
}
