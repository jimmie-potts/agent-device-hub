// The LIFX module's own SQLite file (Hub #928, ADR 0012 "Ownership and publication"). It keeps only what the module owns
// and must keep across restarts: each bulb's mode, configuration revision and shown status key, the module's record
// revision, and its record of each command it accepted, never the command message. The outbox shares the file, so a
// change, its records and its outcome commit in one transaction.
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {NATIVE_MODES, type NativeMode} from './configuration.js';
import {PAINT_KEYS, type PaintKey} from './status.js';

/** How a command the module accepted stands: stored, its device work begun, or completed with its outcome stored. */
export type RequestState = 'accepted' | 'started' | 'done';
/** The module's record of one accepted command. `traceparent` is the command's, so its outcome joins its trace. */
export type RequestRow = {source: string; requestId: string; digest: string; bulb: string; family: string; state: RequestState; traceparent: string};
export type BulbRow = {id: string; configurationRevision: number; mode: NativeMode | undefined; shown: PaintKey | undefined};

/** How many completed commands the module remembers, so a repeat of one is accepted again without a second effect. */
export const REMEMBERED = 1024;

const isMode = (value: unknown): value is NativeMode => NATIVE_MODES.some(mode => mode === value);
const isKey = (value: unknown): value is PaintKey => PAINT_KEYS.some(key => key === value);

export class LifxStore {
  readonly #revision: StatementSync;
  readonly #setRevision: StatementSync;
  readonly #bulb: StatementSync;
  readonly #seed: StatementSync;
  readonly #setBulb: StatementSync;
  readonly #request: StatementSync;
  readonly #accept: StatementSync;
  readonly #setState: StatementSync;
  readonly #unfinished: StatementSync;
  readonly #forget: StatementSync;

  constructor(database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS lifx_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS lifx_bulbs (
        id TEXT PRIMARY KEY, configuration_revision INTEGER NOT NULL DEFAULT 0, mode TEXT, shown TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS lifx_requests (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, bulb TEXT NOT NULL,
        family TEXT NOT NULL, state TEXT NOT NULL, traceparent TEXT NOT NULL, UNIQUE (source, request_id)
      ) STRICT`);
    this.#revision = database.prepare('SELECT value FROM lifx_meta WHERE key = \'revision\'');
    this.#setRevision = database.prepare('INSERT INTO lifx_meta (key, value) VALUES (\'revision\', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    this.#bulb = database.prepare('SELECT id, configuration_revision, mode, shown FROM lifx_bulbs WHERE id = ?');
    this.#seed = database.prepare('INSERT OR IGNORE INTO lifx_bulbs (id, mode) VALUES (?, ?)');
    this.#setBulb = database.prepare(`INSERT INTO lifx_bulbs (id, configuration_revision, mode, shown) VALUES (?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET configuration_revision = excluded.configuration_revision, mode = excluded.mode, shown = excluded.shown`);
    this.#request = database.prepare('SELECT source, request_id, digest, bulb, family, state, traceparent FROM lifx_requests WHERE source = ? AND request_id = ?');
    this.#accept = database.prepare('INSERT INTO lifx_requests (source, request_id, digest, bulb, family, state, traceparent) VALUES (?, ?, ?, ?, ?, \'accepted\', ?)');
    this.#setState = database.prepare('UPDATE lifx_requests SET state = ? WHERE source = ? AND request_id = ?');
    this.#unfinished = database.prepare('SELECT source, request_id, digest, bulb, family, state, traceparent FROM lifx_requests WHERE state <> \'done\' ORDER BY seq');
    this.#forget = database.prepare(`DELETE FROM lifx_requests WHERE state = 'done' AND seq NOT IN (
      SELECT seq FROM lifx_requests WHERE state = 'done' ORDER BY seq DESC LIMIT ${REMEMBERED})`);
  }

  /** The last record revision the module stored. */
  revision(): number {
    const row = this.#revision.get() as {value: number} | undefined;
    return row?.value ?? 0;
  }

  setRevision(revision: number): void {
    this.#setRevision.run(revision);
  }

  bulb(id: string): BulbRow | undefined {
    const row = this.#bulb.get(id) as {id: string; configuration_revision: number; mode: string | null; shown: string | null} | undefined;
    if (row === undefined) return undefined;
    return {id: row.id, configurationRevision: row.configuration_revision, mode: isMode(row.mode) ? row.mode : undefined, shown: isKey(row.shown) ? row.shown : undefined};
  }

  /** Stores a bulb's starting mode, unless the bulb already has a row. */
  seed(id: string, mode: NativeMode | undefined): void {
    this.#seed.run(id, mode ?? null);
  }

  setBulb(row: BulbRow): void {
    this.#setBulb.run(row.id, row.configurationRevision, row.mode ?? null, row.shown ?? null);
  }

  request(source: string, requestId: string): RequestRow | undefined {
    const row = this.#request.get(source, requestId) as Record<string, string> | undefined;
    return row === undefined ? undefined : requestOf(row);
  }

  accept(row: Omit<RequestRow, 'state'>): void {
    this.#accept.run(row.source, row.requestId, row.digest, row.bulb, row.family, row.traceparent);
  }

  setState(source: string, requestId: string, state: RequestState): void {
    this.#setState.run(state, source, requestId);
    if (state === 'done') this.#forget.run();
  }

  /** Every accepted command without a stored outcome, oldest first. */
  unfinished(): RequestRow[] {
    return (this.#unfinished.all() as Record<string, string>[]).map(requestOf);
  }
}

function requestOf(row: Record<string, string>): RequestRow {
  const state = row.state === 'started' || row.state === 'done' ? row.state : 'accepted';
  return {
    source: row.source ?? '', requestId: row.request_id ?? '', digest: row.digest ?? '', bulb: row.bulb ?? '', family: row.family ?? '', state,
    traceparent: row.traceparent ?? '',
  };
}
