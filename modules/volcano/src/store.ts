// The module's private SQLite store: the facts it adds and never rewrites, the continuity committed with them, the owner's
// gap threshold and each threshold request's identity and result. Nothing here deletes a fact (owner decision, 2026-11-03).
import type {DatabaseSync} from 'node:sqlite';
import type {CompletedOutcome} from '@jimmie-potts/event-contracts/v2/devices';
import {DEFAULT_GAP_MINUTES, emptyContinuity, type Continuity, type Fact, type FactData} from './facts.js';

export type Settings = {gapMinutes: number; configurationRevision: number};
export type Meta = {continuity: Continuity; settings: Settings; revision: number};
export type RequestRow = {requestId: string; digest: string; outcome: CompletedOutcome};
export type TimelineFact = Fact & {seq: number};

type FactRow = {seq: number; observed_at_ms: number; received_at_ms: number; data: string};
const STRUCTURAL = "('heater','pump','gap','discontinuity')";
const fromRow = (row: FactRow): TimelineFact => ({...(JSON.parse(row.data) as FactData), seq: row.seq, observedAtMs: row.observed_at_ms, receivedAtMs: row.received_at_ms});

export class VolcanoStore {
  readonly #db: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#db = database;
    database.exec(`
      CREATE TABLE IF NOT EXISTS volcano_facts(seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, observed_at_ms INTEGER NOT NULL, received_at_ms INTEGER NOT NULL, data TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS volcano_facts_time ON volcano_facts(observed_at_ms, seq);
      CREATE INDEX IF NOT EXISTS volcano_facts_kind ON volcano_facts(kind, seq);
      CREATE TABLE IF NOT EXISTS volcano_meta(id INTEGER PRIMARY KEY CHECK(id = 1), record TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS volcano_requests(request_id TEXT PRIMARY KEY, record TEXT NOT NULL) STRICT;
    `);
  }

  meta(): Meta {
    const row = this.#db.prepare('SELECT record FROM volcano_meta WHERE id = 1').get() as {record: string} | undefined;
    return row === undefined ? {continuity: emptyContinuity(), settings: {gapMinutes: DEFAULT_GAP_MINUTES, configurationRevision: 0}, revision: 0} : JSON.parse(row.record) as Meta;
  }

  saveMeta(meta: Meta): void {
    this.#db.prepare('INSERT INTO volcano_meta VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record').run(JSON.stringify(meta));
  }

  append(facts: readonly Fact[]): void {
    const insert = this.#db.prepare('INSERT INTO volcano_facts(kind, observed_at_ms, received_at_ms, data) VALUES(?, ?, ?, ?)');
    for (const {observedAtMs, receivedAtMs, ...data} of facts) insert.run(data.kind, observedAtMs, receivedAtMs, JSON.stringify(data));
  }

  /** The facts a session derivation needs, in stored order: no temperature, counter or marker. */
  structural(): Fact[] {
    return (this.#db.prepare(`SELECT seq, observed_at_ms, received_at_ms, data FROM volcano_facts WHERE kind IN ${STRUCTURAL} ORDER BY seq`).all() as FactRow[]).map(fromRow);
  }

  /** One page of facts in a closed time range, by observation time then stored order, after a `(time, seq)` position. */
  timeline(fromMs: number, toMs: number, after: {atMs: number; seq: number} | undefined, limit: number): TimelineFact[] {
    const rows = after === undefined
      ? this.#db.prepare('SELECT seq, observed_at_ms, received_at_ms, data FROM volcano_facts WHERE observed_at_ms BETWEEN ? AND ? ORDER BY observed_at_ms, seq LIMIT ?').all(fromMs, toMs, limit)
      : this.#db.prepare('SELECT seq, observed_at_ms, received_at_ms, data FROM volcano_facts WHERE observed_at_ms BETWEEN ? AND ? AND (observed_at_ms, seq) > (?, ?) ORDER BY observed_at_ms, seq LIMIT ?').all(fromMs, toMs, after.atMs, after.seq, limit);
    return (rows as FactRow[]).map(fromRow);
  }

  request(requestId: string): RequestRow | undefined {
    const row = this.#db.prepare('SELECT record FROM volcano_requests WHERE request_id = ?').get(requestId) as {record: string} | undefined;
    return row === undefined ? undefined : JSON.parse(row.record) as RequestRow;
  }

  saveRequest(row: RequestRow): void {
    this.#db.prepare('INSERT INTO volcano_requests VALUES(?, ?)').run(row.requestId, JSON.stringify(row));
  }
}
