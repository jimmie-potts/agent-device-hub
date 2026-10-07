// Counts a connection's commits, for the outbox's and the core store's tests (Hub #972): each commit at
// `synchronous = FULL` is a sync to disk on the event loop.
import type {DatabaseSync, SQLInputValue, StatementSync} from 'node:sqlite';

const WRITE = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i;
const bound = (target: object, property: string | symbol): unknown => {
  const value: unknown = Reflect.get(target, property, target);
  return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
};

/**
 * Stands in front of a connection and records each commit it makes, as the connection's `synchronous` level when it
 * ran (2 is FULL): a `COMMIT` that ends a transaction, or a write outside one that changed a row, which SQLite commits
 * on its own. `wrap` gives the connection to use in its place; `commits` fills as it commits.
 */
export function countCommits(): {wrap: (db: DatabaseSync) => DatabaseSync; commits: number[]} {
  const commits: number[] = [];
  const wrap = (database: DatabaseSync): DatabaseSync => {
    const level = (): number => Number((database.prepare('PRAGMA synchronous').get() as {synchronous: number}).synchronous);
    // A write outside a transaction commits on its own when it changes a row: `run` says how many, and a write with
    // `RETURNING`, read through `get` or `all`, returns one row for each.
    const statement = (target: StatementSync, write: boolean): StatementSync => new Proxy(target, {
      get(inner, property) {
        if (!write || (property !== 'run' && property !== 'get' && property !== 'all')) return bound(inner, property);
        return (...values: SQLInputValue[]) => {
          const outside = !database.isTransaction;
          const at = level();
          if (property === 'run') {
            const result = inner.run(...values);
            if (outside && Number(result.changes) > 0) commits.push(at);
            return result;
          }
          const result = property === 'get' ? inner.get(...values) : inner.all(...values);
          if (outside && (Array.isArray(result) ? result.length > 0 : result !== undefined)) commits.push(at);
          return result;
        };
      },
    });
    return new Proxy(database, {
      get(target, property) {
        if (property === 'prepare') return (sql: string) => statement(target.prepare(sql), WRITE.test(sql));
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
