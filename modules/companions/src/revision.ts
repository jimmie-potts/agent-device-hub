import type {DatabaseSync} from 'node:sqlite';

/** A sync owner has one revision sequence across all its state families. */
export function initializeRevision(database: DatabaseSync, floor: number): void {
  database.exec('CREATE TABLE IF NOT EXISTS companions_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL) STRICT');
  database.prepare('INSERT INTO companions_revision VALUES(1,?) ON CONFLICT(id) DO UPDATE SET revision=MAX(revision,excluded.revision)').run(floor);
}
export function revision(database: DatabaseSync): number {
  return (database.prepare('SELECT revision FROM companions_revision WHERE id=1').get() as {revision: number}).revision;
}
export function advanceRevision(database: DatabaseSync): number {
  database.exec('UPDATE companions_revision SET revision=revision+1 WHERE id=1');
  return revision(database);
}
