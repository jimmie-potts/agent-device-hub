// The Pixoo module's own rows in its SQLite file (Hub #843), beside the library's catalog and the SDK's outbox. It keeps
// only state the module owns: its revision counter, its presentation settings, its last outcome, the commands it has
// accepted and not yet completed, the commands it has completed, so a repeated request changes nothing and a reused
// request ID is refused, and each multi-frame rendition's hosted check, so its frames are read once. Copies of other
// owners' state, the core's sessions and the playback record, are rebuilt by sync and never stored. Each statement is
// prepared once.
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {nowPlayingSetting, presentationConfiguration, type NowPlayingSetting, type PresentationConfiguration} from '../core/index.js';

/** How long a completed command's `(source, requestId)` is kept, so a repeated request is accepted again and changes nothing. */
export const HANDLED_MS = 86_400_000;

/**
 * A command the module accepted and has not yet completed: what its outcome needs after a restart. `digest` is the
 * SHA-256 of its family, subject and data, so a request ID used again for other content is told apart.
 */
export type AcceptedCommand = {source: string; requestId: string; digest: string; family: string; type: string; traceparent: string; acceptedAtMs: number};

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
  readonly #read: StatementSync;
  readonly #write: StatementSync;
  readonly #request: StatementSync;
  readonly #accept: StatementSync;
  readonly #handled: StatementSync;
  readonly #forget: StatementSync;
  readonly #pending: StatementSync;
  readonly #prune: StatementSync;
  readonly #hostedCheck: StatementSync;
  readonly #saveHostedCheck: StatementSync;
  readonly #dropHostedChecks: StatementSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS pixoo_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS pixoo_commands (source TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, family TEXT NOT NULL,
        type TEXT NOT NULL, traceparent TEXT NOT NULL, accepted_at_ms INTEGER NOT NULL, PRIMARY KEY (source, request_id)) STRICT;
      CREATE TABLE IF NOT EXISTS pixoo_handled (source TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, completed_at_ms INTEGER NOT NULL,
        PRIMARY KEY (source, request_id)) STRICT;
      CREATE TABLE IF NOT EXISTS pixoo_hosted_checks (rendition_id TEXT NOT NULL, profile TEXT NOT NULL, fits INTEGER NOT NULL,
        PRIMARY KEY (rendition_id, profile)) STRICT`);
    this.#read = db.prepare('SELECT value FROM pixoo_state WHERE key = ?');
    this.#write = db.prepare('INSERT INTO pixoo_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    this.#request = db.prepare('SELECT digest FROM pixoo_commands WHERE source = ? AND request_id = ? UNION ALL SELECT digest FROM pixoo_handled WHERE source = ? AND request_id = ?');
    this.#accept = db.prepare('INSERT INTO pixoo_commands (source, request_id, digest, family, type, traceparent, accepted_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)');
    this.#handled = db.prepare(`INSERT OR REPLACE INTO pixoo_handled (source, request_id, digest, completed_at_ms)
      SELECT source, request_id, digest, ? FROM pixoo_commands WHERE source = ? AND request_id = ?`);
    this.#forget = db.prepare('DELETE FROM pixoo_commands WHERE source = ? AND request_id = ?');
    this.#pending = db.prepare('SELECT * FROM pixoo_commands ORDER BY accepted_at_ms, source, request_id');
    this.#prune = db.prepare('DELETE FROM pixoo_handled WHERE completed_at_ms < ?');
    this.#hostedCheck = db.prepare('SELECT fits FROM pixoo_hosted_checks WHERE rendition_id = ? AND profile = ?');
    this.#saveHostedCheck = db.prepare('INSERT OR REPLACE INTO pixoo_hosted_checks (rendition_id, profile, fits) VALUES (?, ?, ?)');
    this.#dropHostedChecks = db.prepare('DELETE FROM pixoo_hosted_checks WHERE rendition_id = ?');
  }

  #get(key: string): string | undefined {
    return text(this.#read.get(key), 'value');
  }

  #set(key: string, value: string): void {
    this.#write.run(key, value);
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
      // SQLite may already have rolled the transaction back, as after a full disk; a second ROLLBACK would then fail and
      // hide the error that ended it.
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
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

  /** The digest of the request the module accepted before under this ID, running or completed, or undefined. */
  request(source: string, requestId: string): string | undefined {
    return text(this.#request.get(source, requestId, source, requestId), 'digest');
  }

  /** Records an accepted command. Call it inside the transaction that publishes the device's new pending count. */
  accept(command: AcceptedCommand): void {
    this.#accept.run(command.source, command.requestId, command.digest, command.family, command.type, command.traceparent, command.acceptedAtMs);
  }

  /** Marks a command completed, keeping its digest. Call it inside the transaction that stores its outcome. */
  complete(source: string, requestId: string, atMs: number): void {
    this.#handled.run(atMs, source, requestId);
    this.#forget.run(source, requestId);
  }

  /** Commands accepted and not completed, oldest first. */
  pending(): AcceptedCommand[] {
    return this.#pending.all().flatMap(row => {
      const source = text(row, 'source'), requestId = text(row, 'request_id'), digest = text(row, 'digest'), family = text(row, 'family');
      const type = text(row, 'type'), traceparent = text(row, 'traceparent'), acceptedAtMs = integer(row, 'accepted_at_ms');
      if (source === undefined || requestId === undefined || digest === undefined || family === undefined || type === undefined ||
        traceparent === undefined || acceptedAtMs === undefined) return [];
      return [{source, requestId, digest, family, type, traceparent, acceptedAtMs}];
    });
  }

  /** Forgets completed commands older than `HANDLED_MS`. */
  prune(nowMs: number): void {
    this.#prune.run(nowMs - HANDLED_MS);
  }

  /** Whether a multi-frame rendition's frames fit a profile's hosted GIF, as the library found, or undefined before it checked. */
  hostedCheck(renditionId: string, profile: string): boolean | undefined {
    const value = integer(this.#hostedCheck.get(renditionId, profile), 'fits');
    return value === undefined ? undefined : value === 1;
  }

  saveHostedCheck(renditionId: string, profile: string, fits: boolean): void {
    this.#saveHostedCheck.run(renditionId, profile, fits ? 1 : 0);
  }

  /** Forgets a rendition's hosted checks once the rendition is gone from the library. */
  dropHostedChecks(renditionId: string): void {
    this.#dropHostedChecks.run(renditionId);
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
