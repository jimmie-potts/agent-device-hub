// A full disk for the core's tests (Hub #831), through SQLite's own full-disk path.
import type {DatabaseSync} from 'node:sqlite';

/**
 * Leaves the database's file no room to grow, as a full disk would: small pages, so a session's rows need new ones, and
 * a page limit at the file's size after VACUUM has emptied its free list. SQLite then refuses the next change that
 * needs room with SQLITE_FULL. `PRAGMA max_page_count` on the same connection gives the room back.
 */
export function fillDisk(db: DatabaseSync): void {
  db.exec('PRAGMA page_size = 512; VACUUM');
  const pages = (db.prepare('PRAGMA page_count').get() as {page_count: number}).page_count;
  db.exec(`PRAGMA max_page_count = ${pages}`);
}
