// Positional SQLite access in the shape the Python bridge used: rows are tuples and callers own the transaction.
import {chmodSync, closeSync, constants, lstatSync, openSync, type Stats} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

export type Db = DatabaseSync;
/** The values the Nanoleaf schema stores. */
export type SqlValue = string | number | null;
export type Row = readonly SqlValue[];

function checked(values: unknown): Row {
  if (!Array.isArray(values)) throw new TypeError('Expected a row.');
  for (const value of values) {
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new TypeError('Unsupported SQLite value.');
  }
  return values as Row;
}

/** Every row of a query, like Python's fetchall(). */
export function rows(db: Db, sql: string, ...params: readonly SqlValue[]): Row[] {
  const statement = db.prepare(sql);
  statement.setReturnArrays(true);
  const result: unknown = statement.all(...params);
  if (!Array.isArray(result)) throw new TypeError('Expected rows.');
  return result.map(checked);
}

/** The first row of a query, or undefined, like Python's fetchone(). */
export function first(db: Db, sql: string, ...params: readonly SqlValue[]): Row | undefined {
  const statement = db.prepare(sql);
  statement.setReturnArrays(true);
  const result: unknown = statement.get(...params);
  return result === undefined ? undefined : checked(result);
}

/** Run one statement; returns the number of rows it changed. */
export function execute(db: Db, sql: string, ...params: readonly SqlValue[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}

/** Python's Connection.total_changes. */
export function totalChanges(db: Db): number {
  const row = first(db, 'SELECT total_changes()');
  return typeof row?.[0] === 'number' ? row[0] : 0;
}

/** One value of a row; a missing column is a programming error. */
export function at(row: Row, index: number): SqlValue {
  const value = row[index];
  if (value === undefined) throw new RangeError(`No column ${index}.`);
  return value;
}

export function text(row: Row, index: number): string {
  const value = at(row, index);
  if (typeof value !== 'string') throw new TypeError(`Column ${index} is not text.`);
  return value;
}

export function number(row: Row, index: number): number {
  const value = at(row, index);
  if (typeof value !== 'number') throw new TypeError(`Column ${index} is not a number.`);
  return value;
}

/** A result that is not a promise: the work runs inside a synchronous SQLite transaction, as the SDK's outbox requires. */
export type Synchronous<R> = R extends PromiseLike<unknown> ? never : R;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') && value !== null && 'then' in value && typeof value.then === 'function';

/**
 * Python's `with db:` around an explicit BEGIN: commit on success, roll back on any error. The body is synchronous: no
 * transaction stays open across a wait or a device request. Its type refuses a promise. One returned anyway is refused
 * with a `TypeError`, which rolls back only the work done before the body's first await; writes after it run outside
 * the transaction.
 */
export function transaction<T>(db: Db, body: () => Synchronous<T>, begin = 'BEGIN IMMEDIATE'): T {
  db.exec(begin);
  try {
    const result: unknown = body();
    if (isThenable(result)) {
      // Leave the returned promise handled: its outcome no longer matters once the work is refused.
      result.then(undefined, () => {});
      throw new TypeError('the transaction\'s work must be synchronous');
    }
    db.exec('COMMIT');
    return result as T;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

/** Python's `a == b` for two rows. */
export function sameRow(left: Row | undefined, right: Row | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Opens a SQLite file that only the owner can read or write: the file is created with mode 600 before SQLite opens it,
 * and an older file is narrowed to 600, so its journals, which SQLite creates with the file's own mode, are private too.
 * The device locks, the layout lock and the registry lock use it.
 *
 * Only SQLite opens an existing file. Closing any other descriptor of it would drop every POSIX lock this process holds
 * on it, so a second take refused in this process would free the first holder's lock for another process (Hub #972).
 * An existing file is checked with `lstat`, and a missing one is created with `O_EXCL`, whose descriptor no lock can be
 * on yet. A link in the file's place is refused with `ELOOP`, as opening it with `O_NOFOLLOW` would.
 */
export function privateDatabase(path: string, options: {timeout: number}): DatabaseSync {
  if (statOf(path) === undefined) {
    try {
      closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600));
    } catch (error) {
      // Another opener created it meanwhile: it is checked as an existing file.
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
  }
  const info = statOf(path);
  if (info?.isSymbolicLink() === true) throw Object.assign(new Error(`ELOOP: a link stands in the place of ${path}`), {code: 'ELOOP'});
  if (info === undefined || !info.isFile()) throw Object.assign(new Error(`${path} is not a regular file`), {code: 'EINVAL'});
  if ((info.mode & 0o777) !== 0o600) chmodSync(path, 0o600);
  return new DatabaseSync(path, options);
}

/** SQLite's result code for a full database, from a node:sqlite error's `errcode`. */
const SQLITE_FULL = 13;

/**
 * Whether an error, or one it was caused by, is a full disk: `SQLITE_FULL` from SQLite or `ENOSPC` from the file
 * system. It reads only each error's `errcode` and `code`, never its text, and follows at most eight causes.
 */
export function fullDisk(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth += 1) {
    if ('errcode' in current && typeof current.errcode === 'number' && (current.errcode & 0xff) === SQLITE_FULL) return true;
    if ('code' in current && current.code === 'ENOSPC') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

/** The file's own status, never a link's target's, or undefined when nothing is there. */
function statOf(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
