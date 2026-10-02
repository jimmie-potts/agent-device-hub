import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { OPTIONAL_COLUMNS, SourceError, sourceLimits, type SourceRow, type SourceLimits, type OptionalColumn } from './reader-types.js';

const textType = (type: string) => /CHAR|CLOB|TEXT/i.test(type);
const numberType = (type: string) => /INT|REAL|FLOA|DOUB|NUM|DEC/i.test(type);
const quoted = (name: string) => `"${name}"`; // names originate only from constants below
const required = ['id', 'timestamp', 'status', 'numWords'];

function normalized(row: Record<string, SQLOutputValue>): SourceRow {
  const invalid: string[] = [];
  const numeric = (key: string): number | null => {
    const value = row[key];
    if (value === null || value === undefined) return null;
    const number = typeof value === 'bigint' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number) || (typeof value === 'bigint' && !Number.isSafeInteger(number))) {
      invalid.push(key); return null;
    }
    return number;
  };
  const text = (key: string, max: number): string | null => {
    const value = row[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || value.length > max) { invalid.push(key); return null; }
    return value;
  };
  const id = typeof row.id === 'bigint' ? row.id.toString() : text('id', 1024);
  if (!id) throw new SourceError('source-schema');
  return { id, timestamp: text('timestamp', 128), status: text('status', 64), numWords: numeric('numWords'),
    duration: numeric('duration'), speechDuration: numeric('speechDuration'),
    numWordsCorrected: numeric('numWordsCorrected'), numDictionaryReplacements: numeric('numDictionaryReplacements'),
    appName: text('appName', 256), invalid };
}

export async function scanNumeric(path: string, limits: SourceLimits, deliver: (rows: SourceRow[], rss: number) => Promise<void>): Promise<{coverage: Record<OptionalColumn, boolean>; selectedBytes: number}> {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 1000, allowExtension: false, enableDoubleQuotedStringLiterals: false });
  try {
    // Bound SQLite allocations even while synchronous SQL cannot report RSS.
    db.exec('PRAGMA hard_heap_limit=67108864; PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA cache_size=-8192; BEGIN');
    const table = db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='History'").get();
    if (table?.type !== 'table' || typeof table.sql !== 'string' || /CREATE\s+VIRTUAL/i.test(table.sql)) throw new SourceError('source-schema');
    const columns = db.prepare('PRAGMA table_xinfo(History)').all();
    const types = new Map(columns.filter(c => c.hidden === 0).map(c => [String(c.name), String(c.type)]));
    for (const name of required) {
      const type = types.get(name);
      if (!type || !(name === 'numWords' ? numberType(type) : name === 'id' ? textType(type) || /INT/i.test(type) : textType(type))) throw new SourceError('source-schema');
    }
    const coverage = Object.fromEntries(OPTIONAL_COLUMNS.map(name => {
      const type = types.get(name);
      return [name, !!type && (name === 'appName' ? textType(type) : numberType(type))];
    })) as Record<OptionalColumn, boolean>;
    const selected = [...required, ...OPTIONAL_COLUMNS.filter(name => coverage[name])];
    const rowCount = db.prepare('SELECT count(*) AS n FROM History').get()?.n;
    if (typeof rowCount !== 'number' || rowCount > limits.maxRows) throw new SourceError('source-capacity');
    // Size before materialization, so a single huge value cannot bypass the bound.
    const byteSql = selected.map(name => `coalesce(length(CAST(${quoted(name)} AS BLOB)),0)`).join('+');
    const size = db.prepare(`SELECT coalesce(sum(${byteSql}),0) AS n FROM History`).get()?.n;
    if (typeof size !== 'number' || size > limits.maxBytes) throw new SourceError('source-capacity');
    const statement = db.prepare(`SELECT ${selected.map(quoted).join(',')} FROM History`);
    statement.setReadBigInts(true);
    let batch: SourceRow[] = [];
    const ids = new Set<string>();
    const sendBatch = async () => {
      if (process.memoryUsage().rss > limits.maxMemoryBytes) throw new SourceError('source-capacity');
      await deliver(batch, process.memoryUsage().rss); batch = [];
    };
    for (const row of statement.iterate()) {
      const value = normalized(row);
      if (ids.has(value.id)) throw new SourceError('source-schema');
      ids.add(value.id); batch.push(value);
      if (batch.length === 128) await sendBatch();
    }
    if (batch.length) await sendBatch();
    db.exec('COMMIT');
    return {coverage, selectedBytes: size};
  } finally { db.close(); }
}

