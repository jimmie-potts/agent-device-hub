import type { Snapshot } from '@jimmie-potts/wispr-contracts';
import { readDictionary } from './dictionary.js';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { OPTIONAL_COLUMNS, SourceError, sourceLimits, type SourceRow, type SourceLimits, type OptionalColumn } from './reader-types.js';

import { MAX_STAGE_BYTES, type LanguageInput } from './language.js';
import { sourceTimestamp } from './numeric.js';

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

export async function scanNumeric(path:string,limits:SourceLimits,deliver:(rows:SourceRow[],rss:number)=>Promise<void>) {return scanSource(path,limits,deliver,{language:false});}

export async function scanSource(path: string, limits: SourceLimits, deliver: (rows: SourceRow[], rss: number) => Promise<void>, options:{language:boolean}): Promise<{coverage: Record<OptionalColumn, boolean>; selectedBytes: number; dictionary:Snapshot['dictionary']}> {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 1000, allowExtension: false, enableDoubleQuotedStringLiterals: false });
  try {
    // Bound SQLite allocations even while synchronous SQL cannot report RSS.
    db.exec('PRAGMA hard_heap_limit=67108864; PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA cache_size=-8192; BEGIN');
    const table = db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='History'").get();
    if (table?.type !== 'table' || typeof table.sql !== 'string' || /CREATE\s+VIRTUAL/i.test(table.sql)) throw new SourceError('source-schema');
    const columns = db.prepare('PRAGMA table_xinfo(History)').all();
    const types = new Map(columns.filter(c => c.hidden === 0).map(c => [String(c.name), String(c.type)]));
    const native = !types.has('id');
    const idColumn = native ? 'transcriptEntityId' : 'id';
    if (native) {
      const key = columns.find(c => c.name === idColumn && c.hidden === 0);
      if (key?.pk !== 1 || key.notnull !== 1 || columns.filter(c => typeof c.pk === 'number' && c.pk > 0).length !== 1 || !textType(types.get(idColumn) ?? '')) throw new SourceError('source-schema');
    }
    // Fixed profile aliases only; source/configuration never supplies SQL identifiers.
    const column = (name: string) => name === 'id' ? idColumn : native && name === 'appName' ? 'app' : name;
    for (const name of required) {
      const type = types.get(column(name));
      const supported = name === 'numWords' ? numberType(type ?? '') : name === 'id' ? textType(type ?? '') || /INT/i.test(type ?? '') :
        textType(type ?? '') || (native && name === 'timestamp' && /^DATETIME$/i.test(type ?? ''));
      if (!type || !supported) throw new SourceError('source-schema');
    }
    const coverage = Object.fromEntries(OPTIONAL_COLUMNS.map(name => {
      const type = types.get(column(name));
      return [name, !!type && (name === 'appName' ? textType(type) : numberType(type))];
    })) as Record<OptionalColumn, boolean>;
    const selected = [...required, ...OPTIONAL_COLUMNS.filter(name => coverage[name])];
    const extra:{expression:string;alias:string}[]=[];
    if(options.language){
      for(const [name,alias,max] of [['asrText','raw',MAX_STAGE_BYTES],['formattedText','formatted',MAX_STAGE_BYTES],['editedText','observed',MAX_STAGE_BYTES],['detectedLanguage','detectedLanguage',64],['language','language',64],['editedTextStatus','editedTextStatus',64],['editObservationEnd','editObservationEnd',128]] as const){
        const column=quoted(name),supported=textType(types.get(name)??'');
        extra.push({alias,expression:supported?`CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END`:'NULL'});
        if(['raw','formatted','observed'].includes(alias))extra.push({alias:alias+'Oversized',expression:supported?`CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))>${max} THEN 1 ELSE 0 END`:'0'});
      }
    }
    const rowCount = db.prepare('SELECT count(*) AS n FROM History').get()?.n;
    if (typeof rowCount !== 'number' || rowCount > limits.maxRows) throw new SourceError('source-capacity');
    // Size before materialization, so a single huge value cannot bypass the bound.
    const byteSql = [...selected.map(name => quoted(column(name))),...extra.map(e=>e.expression)].map(expression => `coalesce(length(CAST((${expression}) AS BLOB)),0)`).join('+');
    const size = db.prepare(`SELECT coalesce(sum(${byteSql}),0) AS n FROM History`).get()?.n;
    if (typeof size !== 'number' || size > limits.maxBytes) throw new SourceError('source-capacity');
    const statement = db.prepare(`SELECT ${[...selected.map(name => `${quoted(column(name))} AS ${quoted(name)}`),...extra.map(e=>`${e.expression} AS ${quoted('language_'+e.alias)}`)].join(',')} FROM History`);
    statement.setReadBigInts(true);
    let batch: SourceRow[] = [];
    const ids = new Set<string>();
    const sendBatch = async () => {
      if (process.memoryUsage().rss > limits.maxMemoryBytes) throw new SourceError('source-capacity');
      await deliver(batch, process.memoryUsage().rss); batch = [];
    };
    for (const row of statement.iterate()) {
      const value = normalized(row);
      if(options.language){
        const get=(key:string)=>typeof row['language_'+key]==='string'?row['language_'+key] as string:null;
        const detected=get('detectedLanguage'),configured=get('language');
        const locale=types.has('detectedLanguage')?detected:configured;
        const end=sourceTimestamp(get('editObservationEnd')),start=sourceTimestamp(value.timestamp),status=get('editedTextStatus');
        const observation:LanguageInput['observation']=status==='partial'?'partial':status==='complete'&&start&&end&&end.time>=start.time?'complete':'unknown';
        value.language={raw:get('raw'),formatted:get('formatted'),observed:get('observed'),language:locale,observation,
          oversized:(['raw','formatted','observed'] as const).filter(k=>row['language_'+k+'Oversized']===1n)};
      }
      if (ids.has(value.id)) throw new SourceError('source-schema');
      ids.add(value.id); batch.push(value);
      if (batch.length === 128) await sendBatch();
    }
    if (batch.length) await sendBatch();
    let dictionaryBytes=0;
    const dictionary=readDictionary(db,limits.maxRows,limits.maxBytes-size,bytes=>{dictionaryBytes=bytes;});
    db.exec('COMMIT');
    return {coverage, selectedBytes: size+dictionaryBytes,dictionary};
  } finally { db.close(); }
}
