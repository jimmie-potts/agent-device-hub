// A full disk for the core's tests (Hub #831), through SQLite's own full-disk path.
import type {DatabaseSync} from 'node:sqlite';

/**
 * Leaves the database's file no room to grow, as a full disk would: small pages, so a session's rows need new ones, and
 * a page limit at the file's size after VACUUM has emptied its free list. SQLite then refuses the next change that
 * needs room with SQLITE_FULL. `PRAGMA max_page_count` on the same connection gives the room back. A database in WAL
 * mode, as the runtime opens a module's (Hub #972), keeps its page size through a VACUUM, so it leaves WAL for the
 * VACUUM and comes back to it.
 */
export function fillDisk(db: DatabaseSync): void {
  const mode = (db.prepare('PRAGMA journal_mode').get() as {journal_mode: string}).journal_mode;
  if (mode === 'wal') db.exec('PRAGMA journal_mode = DELETE');
  db.exec('PRAGMA page_size = 512; VACUUM');
  if (mode === 'wal') db.exec('PRAGMA journal_mode = WAL');
  const pages = (db.prepare('PRAGMA page_count').get() as {page_count: number}).page_count;
  db.exec(`PRAGMA max_page_count = ${pages}`);
}
