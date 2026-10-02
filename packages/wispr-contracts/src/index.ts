import { Ajv2020 } from 'ajv/dist/2020.js';

export const SCHEMA_VERSION = '1.0' as const;
export const ALGORITHM_VERSION = 'numeric-1' as const;
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const CATEGORIES = ['ai-prompts', 'email', 'messaging', 'documents', 'other-unknown'] as const;
export type Category = typeof CATEGORIES[number];
export const APPS = ['chatgpt', 'claude', 'outlook', 'gmail', 'slack', 'teams', 'discord', 'word', 'notion', 'google-docs', 'other'] as const;
export type App = typeof APPS[number];
const appCategories: Record<App, Category> = {
  chatgpt: 'ai-prompts', claude: 'ai-prompts', outlook: 'email', gmail: 'email',
  slack: 'messaging', teams: 'messaging', discord: 'messaging', word: 'documents',
  notion: 'documents', 'google-docs': 'documents', other: 'other-unknown',
};
export function appCategory(app: App): Category { return appCategories[app]; }
export function safeApp(value: string | null): App {
  if (!value) return 'other';
  const aliases: Record<string, App> = { 'microsoft outlook': 'outlook', 'microsoft teams': 'teams', 'microsoft word': 'word', 'google docs': 'google-docs', 'chatgpt.exe': 'chatgpt', 'claude.exe': 'claude', 'slack.exe': 'slack', 'outlook.exe': 'outlook', 'winword.exe': 'word', 'discord.exe': 'discord', 'ms-teams.exe': 'teams', 'notion.exe': 'notion' };
  const key = value.trim().toLowerCase();
  return APPS.includes(key as App) ? key as App : Object.hasOwn(aliases, key) ? aliases[key] : 'other';
}
export const TOTAL_KEYS = ['dictations', 'words', 'recordingSeconds', 'speechSeconds', 'recordingWords', 'speechWords', 'recordingSamples', 'speechSamples', 'wordsCorrected', 'correctionSamples', 'dictionaryReplacements', 'replacementSamples', 'invalidRecording', 'invalidSpeech', 'zeroRecording', 'zeroSpeech', 'invalidCorrections', 'invalidReplacements'] as const;
export type Totals = Record<typeof TOTAL_KEYS[number], number>;
export function emptyTotals(): Totals { return Object.fromEntries(TOTAL_KEYS.map(k => [k, 0])) as Totals; }
export type NumericCell = Totals & { date: string; hour: number; weekday: number; app: App; category: Category; archived: boolean };
export type Bounds = { from: string | null; to: string | null };
export type Preset = 'today' | '7d' | '30d' | 'all';
export type PresetWindow = { key: Preset; from: string | null; to: string; asOf: string; validUntil: string };
export type LanguageEntry = { text: string; occurrences: number; dictations: number };
export type ChangeEntry = { before: string; after: string; occurrences: number; dictations: number };
export type LanguageTable = {
  preset: Preset; app: App | 'all'; category: Category | 'all'; corpus: 'raw' | 'formatted' | 'observed';
  words: LanguageEntry[]; usefulWords: LanguageEntry[]; phrases: LanguageEntry[]; changes: ChangeEntry[];
  omitted: { words: number; usefulWords: number; phrases: number; changes: number };
  coverage: { eligible: number; missing: number; unsupportedLanguage: number; oversized: number; uncertain: number; longChanges: number };
  comparison: 'none' | 'raw-to-formatted' | 'formatted-to-observed'; finality: 'unknown';
  insertions: number; deletions: number; substitutions: number; comparedDictations: number; changedDictations: number;
};
export type LanguageSection = { availability: 'disabled' | 'unavailable'; reason: 'not-enabled' | 'not-collected'; tables: [] }
  | { availability: 'available'; algorithmVersion: string; stopwordVersion: string; tables: LanguageTable[] };
export type Snapshot = {
  schemaVersion: typeof SCHEMA_VERSION; algorithmVersion: typeof ALGORITHM_VERSION; categoryVersion: '1';
  namespace: string; generation: string; revision: number; timezone: string;
  generatedAt: string; lastSuccessAt: string | null; latestSourceDate: string | null;
  health: 'ok' | 'empty' | 'cleared'; truncated: false;
  coverage: {
    captured: Bounds; retained: Bounds; sourceRows: number; archivedRows: number;
    statuses: { formatted: number; raw: number; empty: number; dismissed: number; unknown: number };
    excluded: { words: number; timestamp: number; beforeCapture: number };
    gaps: { from: string; to: string; reason: 'not-observed' | 'failed-attempt' }[];
  };
  numeric: { cells: NumericCell[]; totals: Totals };
  presets: PresetWindow[];
  language: LanguageSection;
  dictionary: {
    availability: 'unavailable' | 'available'; activeEntries: number | null; activeSnippets: number | null;
    localUsage: number | null; remoteUsage: number | null; window: 'unknown'; segment: number;
  };
};

const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const seconds = { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const date = { type: 'string', format: 'calendar-date' };
const instant = { type: 'string', format: 'instant' };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const enumeration = (values: readonly string[]) => ({ type: 'string', enum: values });
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: object, maxItems: number) => ({ type: 'array', items, maxItems });
const totalsProperties = Object.fromEntries(TOTAL_KEYS.map(k => [k, k.endsWith('Seconds') ? seconds : count]));
const bounds = object({ from: nullable(date), to: nullable(date) });
const presets = ['today', '7d', '30d', 'all'];
const entry = object({ text: { type: 'string', minLength: 1, maxLength: 200 }, occurrences: count, dictations: { ...count, minimum: 3 } });
const change = object({ before: { type: 'string', maxLength: 200 }, after: { type: 'string', maxLength: 200 }, occurrences: count, dictations: { ...count, minimum: 3 } });
const table = object({
  preset: enumeration(presets), app: enumeration([...APPS, 'all']), category: enumeration([...CATEGORIES, 'all']), corpus: enumeration(['raw', 'formatted', 'observed']),
  words: array(entry, 100), usefulWords: array(entry, 100), phrases: array(entry, 100), changes: array(change, 100),
  omitted: object({ words: count, usefulWords: count, phrases: count, changes: count }),
  coverage: object({ eligible: count, missing: count, unsupportedLanguage: count, oversized: count, uncertain: count, longChanges: count }),
  comparison: enumeration(['none', 'raw-to-formatted', 'formatted-to-observed']), finality: { const: 'unknown' },
  insertions: count, deletions: count, substitutions: count, comparedDictations: count, changedDictations: count,
});
export const snapshotSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:bunny:wispr-aggregate:1.0',
  ...object({
    schemaVersion: { const: SCHEMA_VERSION }, algorithmVersion: { const: ALGORITHM_VERSION }, categoryVersion: { const: '1' },
    namespace: { type: 'string', format: 'uuid' }, generation: { type: 'string', format: 'uuid' }, revision: count,
    timezone: { type: 'string', format: 'timezone' }, generatedAt: instant, lastSuccessAt: nullable(instant), latestSourceDate: nullable(date),
    health: enumeration(['ok', 'empty', 'cleared']), truncated: { const: false },
    coverage: object({ captured: bounds, retained: bounds, sourceRows: count, archivedRows: count,
      statuses: object({ formatted: count, raw: count, empty: count, dismissed: count, unknown: count }),
      excluded: object({ words: count, timestamp: count, beforeCapture: count }),
      gaps: array(object({ from: instant, to: instant, reason: enumeration(['not-observed', 'failed-attempt']) }), 100_000),
    }),
    numeric: object({ cells: array(object({ date, hour: { type: 'integer', minimum: 0, maximum: 23 }, weekday: { type: 'integer', minimum: 0, maximum: 6 }, app: enumeration(APPS), category: enumeration(CATEGORIES), archived: { type: 'boolean' }, ...totalsProperties }), 100_000), totals: object(totalsProperties) }),
    presets: { ...array(object({ key: enumeration(presets), from: nullable(date), to: date, asOf: instant, validUntil: instant }), 4), minItems: 4 },
    language: { oneOf: [object({ availability: enumeration(['disabled', 'unavailable']), reason: enumeration(['not-enabled', 'not-collected']), tables: { type: 'array', maxItems: 0 } }), object({ availability: { const: 'available' }, algorithmVersion: { type: 'string', maxLength: 40 }, stopwordVersion: { type: 'string', maxLength: 40 }, tables: array(table, 1000) })] },
    dictionary: object({ availability: enumeration(['unavailable', 'available']), activeEntries: nullable(count), activeSnippets: nullable(count), localUsage: nullable(count), remoteUsage: nullable(count), window: { const: 'unknown' }, segment: count }),
  }),
};

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0001-01-01' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
const ajv = new Ajv2020({ strict: true, allErrors: false });
ajv.addFormat('calendar-date', validDate);
ajv.addFormat('instant', (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
ajv.addFormat('timezone', (v: string) => { try { new Intl.DateTimeFormat('en', {timeZone:v}); return v.length<=80; } catch { return false; } });
const check = ajv.compile(snapshotSchema);
export type Validation = { ok: true; value: Snapshot } | { ok: false; code: 'invalid-wispr-snapshot' };

/** Validate untrusted JSON data; no file reads, source records or diagnostic values escape. */
export function validateSnapshot(input: unknown): Validation {
  const invalid = (): Validation => ({ ok: false, code: 'invalid-wispr-snapshot' });
  try {
    const encoded = JSON.stringify(input);
    if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).length > MAX_SNAPSHOT_BYTES) return invalid();
    const value = JSON.parse(encoded) as Snapshot;
    if (!check(value)) return invalid();
    if (new Set(value.presets.map(p=>p.key)).size!==4 || value.presets.some(p=>p.asOf>=p.validUntil || (p.from!==null && p.from>p.to))) return invalid();
    if (value.lastSuccessAt && value.lastSuccessAt>value.generatedAt) return invalid();
    if (value.numeric.cells.some(c=>c.category!==appCategory(c.app) || c.weekday!==new Date(c.date).getUTCDay())) return invalid();
    const sums=emptyTotals();
    for (const cell of value.numeric.cells) for (const key of TOTAL_KEYS) sums[key]+=cell[key];
    if (TOTAL_KEYS.some(k=>Math.abs(sums[k]-value.numeric.totals[k])>1e-7)) return invalid();
    const keys=new Set<string>();
    for (const c of value.numeric.cells) {
      const key=JSON.stringify([c.date,c.hour,c.app,c.archived]); if(keys.has(key))return invalid();keys.add(key);
      if(c.speechSamples>c.dictations||c.recordingSamples>c.dictations||c.correctionSamples>c.dictations||c.replacementSamples>c.dictations||c.speechWords>c.words||c.recordingWords>c.words)return invalid();
    }
    for(const b of [value.coverage.captured,value.coverage.retained])if((b.from===null)!==(b.to===null)||(b.from!==null&&b.to!==null&&b.from>b.to))return invalid();
    if(value.coverage.gaps.some(g=>g.from>=g.to))return invalid();
    if (value.language.availability === 'available') {
      for (const t of value.language.tables) {
        if(t.changedDictations>t.comparedDictations)return invalid();
        for (const e of [...t.words,...t.usefulWords,...t.phrases,...t.changes]) if(e.occurrences<e.dictations)return invalid();
      }
    }
    return { ok: true, value };
  } catch { return invalid(); }
}

export const FAILURE_CODES = ['source-unavailable','source-schema','source-busy','source-capacity','source-deadline','source-read','source-changed','store-capacity','aggregate-capacity','publication-capacity','publication-failed','run-deadline','run-cancelled','binding-mismatch'] as const;
export type FailureCode = typeof FAILURE_CODES[number];
export type CollectorStatus = {schemaVersion:'1.0';namespace:string;generation:string;revision:number;lastAttemptAt:string;lastSuccessAt:string|null;latestSourceDate:string|null;health:Snapshot['health']|FailureCode;languageEnabled:boolean};
export const statusSchema = {$schema:'https://json-schema.org/draft/2020-12/schema',$id:'urn:bunny:wispr-status:1.0',...object({schemaVersion:{const:'1.0'},namespace:{type:'string',format:'uuid'},generation:{type:'string',format:'uuid'},revision:count,lastAttemptAt:instant,lastSuccessAt:nullable(instant),latestSourceDate:nullable(date),health:enumeration(['ok','empty','cleared',...FAILURE_CODES]),languageEnabled:{type:'boolean'}})};
const checkStatus=ajv.compile(statusSchema);
export function validateStatus(input:unknown):{ok:true;value:CollectorStatus}|{ok:false;code:'invalid-wispr-status'} {
  const invalid=()=>({ok:false as const,code:'invalid-wispr-status' as const});
  try{const encoded=JSON.stringify(input);if(typeof encoded!=='string'||new TextEncoder().encode(encoded).length>4096)return invalid();const value=JSON.parse(encoded) as CollectorStatus;if(!checkStatus(value)||(value.lastSuccessAt!==null&&value.lastSuccessAt>value.lastAttemptAt))return invalid();return {ok:true,value};}catch{return invalid();}
}

export function localDate(instant: string | number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));
}
export function offsetDate(date: string, days: number): string { return new Date(Date.parse(date)+days*86_400_000).toISOString().slice(0,10); }
export function presetWindows(now: string, timezone: string): PresetWindow[] {
  const today=localDate(now,timezone);
  // Find the first millisecond of the next calendar date; this also covers 23/25-hour days.
  let low=Date.parse(now), high=low+48*3_600_000;
  while(high-low>1){const mid=Math.floor((low+high)/2);if(localDate(mid,timezone)===today)low=mid;else high=mid;}
  const validUntil=new Date(high).toISOString();
  return (['today','7d','30d','all'] as const).map(key=>({key,from:key==='all'?null:offsetDate(today,key==='today'?0:key==='7d'?-6:-29),to:today,asOf:now,validUntil}));
}
export function emptySnapshot(input: {namespace:string;generation:string;now:string;timezone:string}): Snapshot {
  return {
    schemaVersion:SCHEMA_VERSION,algorithmVersion:ALGORITHM_VERSION,categoryVersion:'1',namespace:input.namespace,generation:input.generation,revision:0,
    timezone:input.timezone,generatedAt:input.now,lastSuccessAt:null,latestSourceDate:null,health:'cleared',truncated:false,
    coverage:{captured:{from:null,to:null},retained:{from:null,to:null},sourceRows:0,archivedRows:0,statuses:{formatted:0,raw:0,empty:0,dismissed:0,unknown:0},excluded:{words:0,timestamp:0,beforeCapture:0},gaps:[]},
    numeric:{cells:[],totals:emptyTotals()},presets:presetWindows(input.now,input.timezone),
    language:{availability:'disabled',reason:'not-enabled',tables:[]},
    dictionary:{availability:'unavailable',activeEntries:null,activeSnippets:null,localUsage:null,remoteUsage:null,window:'unknown',segment:0},
  };
}
export { numericReport, type NumericFilter } from './query.js';
