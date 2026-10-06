// Opens the module's SQLite state and initializes every owner's tables in one transaction (database.py).
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {create, migrate} from './devices.js';
import {initProjectMap, seedProjectMap} from './project-map.js';
import {initSharedInput} from './shared-input.js';
import {execute, first, transaction, type Db} from './sqlite.js';

export interface ConnectOptions {
  /** Seconds to wait for another writer, as Python's sqlite3.connect timeout. */
  timeout?: number;
  /** Seconds since the epoch; only a database older than model version 4 reads it. */
  now?: () => number;
}

const epochSeconds = (): number => Date.now() / 1000;

/** Create or upgrade the schema inside one immediate transaction. */
export function initialize(db: Db, now: () => number = epochSeconds): void {
  transaction(db, () => {
    initProjectMap(db);
    initSharedInput(db);
    // The integration API's tables (integration_meta, integration_requests, animation_favorites) are not created
    // here: that API is not ported, and saved animation favorites move with the effects slice (PORTING.md).
    db.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, turn TEXT, status TEXT, updated REAL)');
    create(db, 'slots');
    db.exec('CREATE TABLE IF NOT EXISTS waits (session TEXT, turn TEXT, key TEXT, kind TEXT, tool TEXT, PRIMARY KEY(session, turn, key))');
    db.exec('CREATE TABLE IF NOT EXISTS activity (session TEXT PRIMARY KEY, turn TEXT, status TEXT, started REAL)');
    db.exec('CREATE TABLE IF NOT EXISTS receipts (session TEXT PRIMARY KEY, turn TEXT, completed REAL, observed INTEGER)');
    create(db, 'display_v3');
    create(db, 'comets');
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    // Existing Linux state gains its device key in place; a repeat is a no-op.
    migrate(db);
    seedProjectMap(db);
    const version = first(db, "SELECT value FROM meta WHERE key='model_version'");
    if (version?.length !== 1 || version[0] !== '4') {
      // This is only the integration's own database. Replace old lighting
      // notifications and initialize the outward pulse for current work.
      for (const table of ['signals', 'notifications']) {
        if (first(db, 'SELECT 1 FROM sqlite_master WHERE name=?', table) !== undefined) execute(db, 'DELETE FROM ' + table);
      }
      execute(db, "UPDATE sessions SET status='blocked' WHERE status='approval'");
      execute(db, 'INSERT OR REPLACE INTO activity '
        + "SELECT id,turn,status,? FROM sessions WHERE status IN ('working','question','blocked','unread')", now());
      execute(db, "INSERT OR REPLACE INTO meta VALUES ('model_version','4')");
    }
  });
}

/** Open `<directory>/status.sqlite` and initialize it; a failure closes the connection and leaves no partial schema. */
export function connectState(directory: string, options: ConnectOptions = {}): Db {
  const db = new DatabaseSync(join(directory, 'status.sqlite'), {timeout: Math.round((options.timeout ?? 2.5) * 1000)});
  try {
    initialize(db, options.now);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** Run `body` on an initialized connection, closing it afterwards, like Python's `contextlib.closing(connect_state(...))`. */
export function withState<T>(directory: string, body: (db: Db) => T, options: ConnectOptions = {}): T {
  const db = connectState(directory, options);
  try {
    return body(db);
  } finally {
    db.close();
  }
}
