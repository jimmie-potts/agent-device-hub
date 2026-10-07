// The Pixoo module's own rows in its SQLite file (Hub #843), beside the library's catalog and the SDK's outbox. It keeps
// only state the module owns: its revision counter, its presentation settings, its last outcome, the commands it has
// accepted and not yet completed, and the commands it has completed, so a repeated request changes nothing. Copies of
// other owners' state, the core's sessions and the playback record, are rebuilt by sync and never stored.
import type {DatabaseSync} from 'node:sqlite';
import {nowPlayingSetting, presentationConfiguration, type NowPlayingSetting, type PresentationConfiguration} from '../core/index.js';

/** How long a completed command's `(source, requestId)` is kept, so a repeated request is accepted again and changes nothing. */
export const HANDLED_MS = 86_400_000;

/** A command the module accepted and has not yet completed: what its outcome needs after a restart. */
export type AcceptedCommand = {source: string; requestId: string; family: string; type: string; traceparent: string; acceptedAtMs: number};

type Row = Record<string, unknown>;
const text = (row: Row | undefined, column: string): string | undefined => {
  const value = row?.[column];
  return typeof value === 'string' ? value : undefined;
};
const integer = (row: Row | undefined, column: string): number | undefined => {
  const value = row?.[column];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
};

export class PixooStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS pixoo_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS pixoo_commands (source TEXT NOT NULL, request_id TEXT NOT NULL, family TEXT NOT NULL, type TEXT NOT NULL,
        traceparent TEXT NOT NULL, accepted_at_ms INTEGER NOT NULL, PRIMARY KEY (source, request_id)) STRICT;
      CREATE TABLE IF NOT EXISTS pixoo_handled (source TEXT NOT NULL, request_id TEXT NOT NULL, completed_at_ms INTEGER NOT NULL,
        PRIMARY KEY (source, request_id)) STRICT`);
  }

  #get(key: string): string | undefined {
    return text(this.#db.prepare('SELECT value FROM pixoo_state WHERE key = ?').get(key), 'value');
  }

  #set(key: string, value: string): void {
    this.#db.prepare('INSERT INTO pixoo_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  #number(key: string): number {
    const stored = this.#get(key);
    const value = stored === undefined ? 0 : Number(stored);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  /** The module's revision: every record it serves carries the revision of its last change, and only this raises it. */
  get revision(): number {
    return this.#number('revision');
  }

  /** Raises the revision by one and returns it. Call it inside the transaction that publishes the change. */
  nextRevision(): number {
    const next = this.revision + 1;
    this.#set('revision', String(next));
    return next;
  }

  /** The device's configuration revision: it rises with every presentation or Now Playing setting the module saves. */
  get configurationRevision(): number {
    return this.#number('configurationRevision');
  }

  /** The saved presentation, or undefined before the module saved one. A saved value that no longer parses is ignored. */
  presentation(): PresentationConfiguration | undefined {
    const parsed = presentationConfiguration.safeParse(json(this.#get('presentation')));
    return parsed.success ? parsed.data : undefined;
  }

  nowPlaying(): NowPlayingSetting | undefined {
    const parsed = nowPlayingSetting.safeParse(json(this.#get('nowPlaying')));
    return parsed.success ? parsed.data : undefined;
  }

  /** Saves the presentation and raises the configuration revision, in one transaction. */
  savePresentation(value: PresentationConfiguration): void {
    this.#saveSetting('presentation', value);
  }

  saveNowPlaying(value: NowPlayingSetting): void {
    this.#saveSetting('nowPlaying', value);
  }

  #saveSetting(key: string, value: object): void {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#set(key, JSON.stringify(value));
      this.#set('configurationRevision', String(this.configurationRevision + 1));
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /** The last completed outcome, as the device record reports it, or undefined before the first. */
  lastOutcome(): unknown {
    return json(this.#get('lastOutcome'));
  }

  saveLastOutcome(outcome: object): void {
    this.#set('lastOutcome', JSON.stringify(outcome));
  }

  /** Whether the module accepted this request before, whether it is still running or completed. */
  known(source: string, requestId: string): boolean {
    return this.#db.prepare('SELECT 1 FROM pixoo_commands WHERE source = ? AND request_id = ? UNION ALL SELECT 1 FROM pixoo_handled WHERE source = ? AND request_id = ?')
      .get(source, requestId, source, requestId) !== undefined;
  }

  /** Records an accepted command, before the module replies, so a restart reports its outcome. */
  accept(command: AcceptedCommand): void {
    this.#db.prepare('INSERT INTO pixoo_commands (source, request_id, family, type, traceparent, accepted_at_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .run(command.source, command.requestId, command.family, command.type, command.traceparent, command.acceptedAtMs);
  }

  /** Marks a command completed. Call it inside the transaction that stores its outcome. */
  complete(source: string, requestId: string, atMs: number): void {
    this.#db.prepare('DELETE FROM pixoo_commands WHERE source = ? AND request_id = ?').run(source, requestId);
    this.#db.prepare('INSERT OR REPLACE INTO pixoo_handled (source, request_id, completed_at_ms) VALUES (?, ?, ?)').run(source, requestId, atMs);
  }

  /** Commands accepted and not completed, oldest first. */
  pending(): AcceptedCommand[] {
    return this.#db.prepare('SELECT * FROM pixoo_commands ORDER BY accepted_at_ms, source, request_id').all().flatMap(row => {
      const source = text(row, 'source'), requestId = text(row, 'request_id'), family = text(row, 'family'), type = text(row, 'type');
      const traceparent = text(row, 'traceparent'), acceptedAtMs = integer(row, 'accepted_at_ms');
      if (source === undefined || requestId === undefined || family === undefined || type === undefined || traceparent === undefined || acceptedAtMs === undefined) return [];
      return [{source, requestId, family, type, traceparent, acceptedAtMs}];
    });
  }

  /** Forgets completed commands older than `HANDLED_MS`. */
  prune(nowMs: number): void {
    this.#db.prepare('DELETE FROM pixoo_handled WHERE completed_at_ms < ?').run(nowMs - HANDLED_MS);
  }
}

function json(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
