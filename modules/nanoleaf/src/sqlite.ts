// Positional SQLite access in the shape the Python bridge used: rows are tuples and callers own the transaction.
import type {DatabaseSync} from 'node:sqlite';

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

/** Python's `with db:` around an explicit BEGIN: commit on success, roll back on any error. */
export function transaction<T>(db: Db, body: () => T, begin = 'BEGIN IMMEDIATE'): T {
  db.exec(begin);
  try {
    const result = body();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

/** transaction() around an asynchronous body, such as one that sends to a device while it holds the write lock. */
export async function transactionAsync<T>(db: Db, body: () => Promise<T>, begin = 'BEGIN IMMEDIATE'): Promise<T> {
  db.exec(begin);
  try {
    const result = await body();
    if (db.isTransaction) db.exec('COMMIT');
    return result;
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
