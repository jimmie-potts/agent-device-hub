import type {DatabaseSync} from 'node:sqlite';
import {PrivateRequestDigest} from '@jimmie-potts/sdk';
import type {CompletedOutcome} from '@jimmie-potts/event-contracts/v2/devices';
import type {Family} from './contracts.js';
export type RequestRow = {requestId: string; source: string; family: Family; digest: string; state: 'accepted' | 'started' | 'done'; traceparent: string; outcome?: CompletedOutcome};
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
/** No commands are reconstructed here. Fences and outcomes remain indefinitely. */
export class OnnStore {
  readonly privateDigest: PrivateRequestDigest;
  constructor(readonly database: DatabaseSync, files: () => string) {
    database.exec(`CREATE TABLE IF NOT EXISTS onn_requests (request_id TEXT PRIMARY KEY, record TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS onn_meta (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, last_outcome TEXT) STRICT;
      INSERT OR IGNORE INTO onn_meta VALUES (1, 0, NULL)`);
    this.privateDigest = new PrivateRequestDigest(database, files);
  }
  get(requestId: string): RequestRow | undefined {
    const row = this.database.prepare('SELECT record FROM onn_requests WHERE request_id = ?').get(requestId) as {record: string} | undefined;
    return row === undefined ? undefined : JSON.parse(row.record) as RequestRow;
  }
  save(row: RequestRow): void {this.database.prepare('INSERT INTO onn_requests VALUES (?, ?) ON CONFLICT(request_id) DO UPDATE SET record = excluded.record').run(row.requestId, JSON.stringify(row));}
  unfinished(): RequestRow[] {return (this.database.prepare("SELECT record FROM onn_requests WHERE json_extract(record, '$.state') <> 'done' ORDER BY rowid").all() as {record: string}[]).map(row => JSON.parse(row.record) as RequestRow);}
  hasText(): boolean {return this.database.prepare("SELECT 1 FROM onn_requests WHERE json_extract(record, '$.family') = 'onn-text' LIMIT 1").get() !== undefined;}
  revision(): number {return (this.database.prepare('SELECT revision FROM onn_meta WHERE id = 1').get() as {revision: number}).revision;}
  nextRevision(): number {const revision = this.revision() + 1; this.database.prepare('UPDATE onn_meta SET revision = ? WHERE id = 1').run(revision); return revision;}
  lastOutcome(): CompletedOutcome | undefined {
    const row = this.database.prepare('SELECT last_outcome FROM onn_meta WHERE id = 1').get() as {last_outcome: string | null};
    return row.last_outcome === null ? undefined : JSON.parse(row.last_outcome) as CompletedOutcome;
  }
  outcome(row: RequestRow, value: CompletedOutcome): void {
    this.save({...row, state: 'done', outcome: value});
    this.database.prepare('UPDATE onn_meta SET last_outcome = ? WHERE id = 1').run(JSON.stringify(value));
  }
}
