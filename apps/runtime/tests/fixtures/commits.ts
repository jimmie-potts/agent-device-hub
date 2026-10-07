// Counts a connection's commits, for the core store's tests (Hub #972): each commit is a sync to disk on the event loop.
import type {DatabaseSync, SQLInputValue, StatementSync} from 'node:sqlite';

/** SQLite's `synchronous` levels: FULL syncs each commit; NORMAL, in WAL mode, leaves it to the next sync of the log. */
export const FULL = 2;
export const NORMAL = 1;

const bound = (target: object, property: string | symbol): unknown => {
  const value: unknown = Reflect.get(target, property, target);
  return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
};

/**
 * Stands in front of a connection and records each commit it makes, as the connection's `synchronous` level when it
 * ran: a `COMMIT` that ends a transaction, or a write outside one that changed a row, which SQLite commits on its own.
 */
export function countCommits(): {wrap: (db: DatabaseSync) => DatabaseSync; commits: number[]} {
  const commits: number[] = [];
  const wrap = (database: DatabaseSync): DatabaseSync => {
    const level = (): number => Number((database.prepare('PRAGMA synchronous').get() as {synchronous: number}).synchronous);
    const statement = (target: StatementSync): StatementSync => new Proxy(target, {
      get(inner, property) {
        if (property !== 'run') return bound(inner, property);
        return (...values: SQLInputValue[]) => {
          const outside = !database.isTransaction;
          const at = level();
          const result = inner.run(...values);
          if (outside && Number(result.changes) > 0) commits.push(at);
          return result;
        };
      },
    });
    return new Proxy(database, {
      get(target, property) {
        if (property === 'prepare') return (sql: string) => statement(target.prepare(sql));
        if (property !== 'exec') return bound(target, property);
        return (sql: string) => {
          const inside = target.isTransaction;
          const at = level();
          target.exec(sql);
          if (inside && !target.isTransaction && /^\s*(?:COMMIT|END)\b/i.test(sql)) commits.push(at);
        };
      },
    });
  };
  return {wrap, commits};
}
