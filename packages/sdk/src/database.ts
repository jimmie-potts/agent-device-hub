// A module's own SQLite database, opened one way by the runtime and by the module test kit (Hub #972), so a module's
// tests commit as the runtime does.
import {DatabaseSync} from 'node:sqlite';

/** SQLite's result code for a full disk, the low byte of a node:sqlite error's `errcode`. */
const SQLITE_FULL = 13;
/** How many errors `fullDisk` reads: the error itself and up to seven causes. */
const FULL_DISK_DEPTH = 8;

/**
 * Whether an error, or one it was caused by, is a full disk: `SQLITE_FULL` from SQLite (in the low byte of `errcode`,
 * so an extended result code counts too) or `ENOSPC` from the file system. It reads only each error's `errcode` and
 * `code`, never its text, and reads the error and at most seven causes, so a cycle or a long chain ends the walk. A
 * module answers a full disk with the registry's `capacity`; the runtime's offline tools report `disk-short` (Hub #1003).
 */
export function fullDisk(error: unknown): boolean {
  let current = error;
  for (let read = 0; read < FULL_DISK_DEPTH && typeof current === 'object' && current !== null; read += 1) {
    if ('errcode' in current && typeof current.errcode === 'number' && (current.errcode & 0xff) === SQLITE_FULL) return true;
    if ('code' in current && current.code === 'ENOSPC') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

/**
 * Opens the SQLite file at `file`, creating it when missing, as a module's own database:
 * - `locking_mode = EXCLUSIVE`, set before anything reads the file: the connection keeps the file to itself, so SQLite
 *   keeps the log's index in memory and never creates `<file>-shm`. A start on a full disk therefore needs no new space
 *   to open its database, and a second connection to the file, in this process or another, is refused with
 *   `SQLITE_BUSY` while this one is open. A component's database has one connection (AGENTS.md). The lock is a POSIX
 *   lock: closing any descriptor of the file that this process opened outside SQLite drops it, so a caller never opens
 *   an existing file another way while a connection is open.
 * - `journal_mode = WAL` at `synchronous = FULL`: each commit appends to `<file>-wal` and syncs it once before it
 *   returns, so a commit survives a power loss. A clean close checkpoints the log into the file and removes it.
 *   `NORMAL` would skip that sync, and a power loss could then undo a committed outcome (ADR 0012).
 * - `foreign_keys = ON`.
 *
 * A new file on a full disk cannot take WAL mode, which writes its header: it keeps SQLite's rollback journal, at the
 * same `synchronous` level, until it is opened again with room. Every write then fails with `SQLITE_FULL` until there
 * is room, as on any full disk.
 */
export function openModuleDatabaseFile(file: string): DatabaseSync {
  const database = new DatabaseSync(file);
  try {
    database.exec('PRAGMA locking_mode = EXCLUSIVE; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL');
    try {
      database.exec('PRAGMA journal_mode = WAL');
    } catch (error) {
      if (!fullDisk(error)) throw error;
      if (database.isTransaction) database.exec('ROLLBACK');
    }
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}
