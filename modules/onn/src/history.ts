import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {SdkError, fullDisk} from '@jimmie-potts/sdk';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {validateMetadataSample, type MetadataSample, type MetadataSession, type Omission} from './metadata.js';
import {READER_SHA256, READER_SOURCE_VERSION} from './reader-artifact.js';

export const HISTORY_RESPONSE_BYTES = 128 * 1024;
export const HISTORY_CANDIDATES = 500;
export const HISTORY_TEXT_BYTES = 512;
export const HISTORY_STALE_MS = 15_000;
export type HistoryApp = 'youtube' | 'stremio';
export type GapReason = 'startup' | 'unavailable' | 'busy' | 'storage' | 'clock';
export type Intake = {intakeId: string; runId: string; poll: number; receivedAtMs: number};
export type ProjectionOmission = {field: Omission['field']; reason: 'projection-limit'; originalBytes: number};
export type SessionProjection = MetadataSession & {projectionOmissions: ProjectionOmission[]};
export type HistoryGap = Intake & {sequence: number; reason: GapReason};
export type Coverage = {
  collectionStartedAtMs: number | null; gapCount: number; recentGaps: HistoryGap[]; storageAvailable: boolean; pendingGap: (Intake & {reason:'storage'}) | null;
  limits: {pollMs: 5000; staleMs: 15000; candidates: 500; textBytes: 512; responseBytes: 131072; recentGaps: 20; sourceSessions: 8; sourceTextBytes: 8192; sourceReplyBytes: 262144};
  semantics: 'observations-only';
};
export type AcceptedEvidence = Intake & {sequence: number; deviceElapsedMs: number; reader: {sha256: string; sourceVersion: string}};
export type HistoryState = {
  schema: 'onn-history-state/2.0'; enabled: boolean; status: 'disabled' | 'fresh' | 'stale' | 'unavailable';
  current: SessionProjection[]; ambiguous: boolean; currentEvidence: 'fresh-observation' | 'last-observed' | 'none';
  lastAccepted: AcceptedEvidence | null; coverage: Coverage;
};
export type HistoryProvenance = {
  source: 'android-media-session'; readerSchema: 'onn-metadata/2.0';
  semantics: 'selected-title-observed' | 'title-observed';
};
export type HistoryObservation = AcceptedEvidence & SessionProjection & {id: string; provenance: HistoryProvenance};
export type HistoryOccurrence = {
  id: string; app: HistoryApp; firstObservedAtMs: number; matchingObservedAtMs: number;
  identityConfidence: 'unsupported' | 'source-id' | 'ambiguous'; observation: HistoryObservation;
};
export type PageOmission = {reason: 'response-limit'; continuation: true};
export type HistoryPage = {
  schema: 'onn-history/2.0'; cutoff: number; ordering: 'evidence-desc'; items: HistoryOccurrence[];
  nextCursor: string | null; coverage: Coverage; pageOmissions: PageOmission[];
};
export type HistoryDetail = {
  schema: 'onn-history-detail/2.0'; cutoff: number; occurrence: HistoryOccurrence;
  observations: HistoryObservation[]; nextCursor: string | null; coverage: Coverage; pageOmissions: PageOmission[];
};
type HistoryFilters = {app: HistoryApp | null; fromMs: number | null; toMs: number | null; title: string | null; limit: number};
type DetailFilters = {id: string; limit: number};
type Cursor = {version: 2; kind: 'history' | 'detail'; filterDigest: string; cutoff: number; after: number};
type IntakeRow = Intake & {sequence: number; kind: 'sample' | 'gap'; payload: string; deviceElapsedMs: number | null; gapCount: number; reader: string | null};
type SampleIntakeRow = IntakeRow & {kind: 'sample'; deviceElapsedMs: number; reader: string};
type ObservationRow = {id: number; intakeSequence: number; occurrenceId: number; app: HistoryApp; receivedAtMs: number; session: string};
type OccurrenceRow = {id: number; app: HistoryApp; firstObservedAtMs: number; confidence: HistoryOccurrence['identityConfidence']};
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value,key);
    return typeof key === 'string' && descriptor?.enumerable === true && Object.hasOwn(descriptor,'value');
  });
};
const closed = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).every(key => keys.includes(key));
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const safeFailure = (error: unknown): ErrorBody => error instanceof SdkError ? error.body : errorBody(fullDisk(error) ? 'capacity' : 'unavailable', {detail: 'ONN history storage is unavailable'});
const filterDigest = (filters: HistoryFilters | DetailFilters): string => createHash('sha256').update(canonical(filters)).digest('base64url');
const invalid = (): ErrorBody => errorBody('invalid-request', {detail: 'invalid ONN history query or cursor'});
const textFields = ['title', 'displayTitle', 'subtitle', 'artist', 'album', 'genre', 'description', 'mediaId'] as const;
const project = (session: MetadataSession): SessionProjection => {
  const copy = structuredClone(session) as SessionProjection;
  copy.projectionOmissions = [];
  if (copy.metadata !== null) for (const field of textFields) {
    const value = copy.metadata[field];
    if (value === null || Buffer.byteLength(value, 'utf8') <= HISTORY_TEXT_BYTES) continue;
    let truncated = ''; let bytes = 0;
    for (const character of value) {const size = Buffer.byteLength(character); if (bytes + size > HISTORY_TEXT_BYTES) break; truncated += character; bytes += size;}
    copy.metadata[field] = truncated;
    copy.projectionOmissions.push({field, reason: 'projection-limit', originalBytes: Buffer.byteLength(value)});
  }
  return copy;
};
const limits = (): Coverage['limits'] => ({pollMs:5000,staleMs:15000,candidates:500,textBytes:512,responseBytes:131072,recentGaps:20,sourceSessions:8,sourceTextBytes:8192,sourceReplyBytes:262144});
const provenance = (app: HistoryApp): HistoryProvenance => ({source: 'android-media-session', readerSchema: 'onn-metadata/2.0', semantics: app === 'youtube' ? 'selected-title-observed' : 'title-observed'});
const sourceId = (session: MetadataSession): string | null => {
  const id = session.metadata?.mediaId ?? null;
  return id !== null && id.length > 0 && !session.omissions.some(omission => omission.field === 'mediaId') ? id : null;
};
/** Uses the owner's existing lease. Intake belongs to its caller's outbox transaction; this class never commits. */
export class OnnHistoryStore {
  private readonly openedAtSequence: number;
  private readonly cursorKey: Buffer;
  constructor(readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS onn_history_key (id INTEGER PRIMARY KEY CHECK(id=1), key TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS onn_history_intakes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, intakeId TEXT UNIQUE NOT NULL, runId TEXT NOT NULL,
        poll INTEGER NOT NULL, receivedAtMs INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
        deviceElapsedMs INTEGER, gapCount INTEGER NOT NULL, reader TEXT) STRICT;
      CREATE INDEX IF NOT EXISTS onn_history_kind ON onn_history_intakes(kind, sequence DESC);
      CREATE TABLE IF NOT EXISTS onn_history_occurrences (id INTEGER PRIMARY KEY AUTOINCREMENT,
        app TEXT NOT NULL, firstObservedAtMs INTEGER NOT NULL, confidence TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS onn_history_observations (id INTEGER PRIMARY KEY AUTOINCREMENT,
        intakeSequence INTEGER NOT NULL REFERENCES onn_history_intakes(sequence),
        occurrenceId INTEGER NOT NULL REFERENCES onn_history_occurrences(id), app TEXT NOT NULL,
        receivedAtMs INTEGER NOT NULL, session TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS onn_history_app_evidence ON onn_history_observations(app,id DESC);
      CREATE INDEX IF NOT EXISTS onn_history_occurrence_evidence ON onn_history_observations(occurrenceId,intakeSequence DESC,id DESC);
      CREATE INDEX IF NOT EXISTS onn_history_occurrence_date ON onn_history_observations(occurrenceId,receivedAtMs DESC,id DESC);
      CREATE INDEX IF NOT EXISTS onn_history_occurrence_id ON onn_history_observations(occurrenceId,id DESC);
      CREATE INDEX IF NOT EXISTS onn_history_intake_observations ON onn_history_observations(intakeSequence DESC,id DESC);
      CREATE TABLE IF NOT EXISTS onn_history_gaps (sequence INTEGER PRIMARY KEY REFERENCES onn_history_intakes(sequence), reason TEXT NOT NULL) STRICT`);
    database.prepare('INSERT OR IGNORE INTO onn_history_key VALUES (1,?)').run(randomBytes(32).toString('hex'));
    this.cursorKey = Buffer.from((database.prepare('SELECT key FROM onn_history_key WHERE id=1').get() as {key: string}).key, 'hex');
    this.openedAtSequence = this.latest()?.sequence ?? 0;
  }
  private latest(cutoff = Number.MAX_SAFE_INTEGER): IntakeRow | undefined {
    return this.database.prepare('SELECT * FROM onn_history_intakes WHERE sequence<=? ORDER BY sequence DESC LIMIT 1').get(cutoff) as IntakeRow | undefined;
  }
  private sample(cutoff = Number.MAX_SAFE_INTEGER): SampleIntakeRow | undefined {
    return this.database.prepare("SELECT * FROM onn_history_intakes WHERE kind='sample' AND sequence<=? ORDER BY sequence DESC LIMIT 1").get(cutoff) as SampleIntakeRow | undefined;
  }
  private verifyIntake(input: Intake): void {
    if (!identifier(input.intakeId) || !identifier(input.runId) || !integer(input.poll) || !integer(input.receivedAtMs)) throw new SdkError(errorBody('invalid-request', {detail: 'invalid ONN history intake'}));
  }
  private duplicate(input: Intake, kind: string, payload: string): boolean {
    const previous = this.database.prepare('SELECT * FROM onn_history_intakes WHERE intakeId=?').get(input.intakeId) as IntakeRow | undefined;
    if (previous === undefined) return false;
    if (previous.runId !== input.runId || previous.poll !== input.poll || previous.receivedAtMs !== input.receivedAtMs || previous.kind !== kind || previous.payload !== payload) throw new SdkError(errorBody('duplicate-conflict', {detail: 'ONN history intake ID already has different evidence'}));
    return true;
  }
  private transaction(): void {
    if (!this.database.isTransaction) throw new SdkError(errorBody('invalid-state', {detail: 'ONN history intake needs the owner transaction'}));
  }
  private insert(input: Intake, kind: string, payload: string, elapsed: number | null, gap: GapReason | null): number {
    const gapCount = (this.latest()?.gapCount ?? 0) + (gap === null ? 0 : 1);
    const result = this.database.prepare('INSERT INTO onn_history_intakes(intakeId,runId,poll,receivedAtMs,kind,payload,deviceElapsedMs,gapCount,reader) VALUES (?,?,?,?,?,?,?,?,?)').run(input.intakeId,input.runId,input.poll,input.receivedAtMs,kind,payload,elapsed,gapCount,kind === 'sample' ? JSON.stringify({sha256:READER_SHA256,sourceVersion:READER_SOURCE_VERSION}) : null);
    const sequence = Number(result.lastInsertRowid);
    if (gap !== null) this.database.prepare('INSERT INTO onn_history_gaps VALUES (?,?)').run(sequence,gap);
    return sequence;
  }
  ingest(input: Intake & {sample: MetadataSample}): boolean {
    try {
      this.verifyIntake(input);
      const sample = validateMetadataSample(input.sample);
      if (sample === undefined) throw new SdkError(errorBody('invalid-request', {detail: 'invalid ONN metadata sample'}));
      const payload = canonical(sample);
      if (this.duplicate(input, 'sample', payload)) return false;
      this.transaction();
      const previous = this.latest();
      const accepted = this.sample();
      const hostDelta = accepted === undefined ? 0 : input.receivedAtMs - accepted.receivedAtMs;
      const deviceDelta = accepted?.deviceElapsedMs === null || accepted === undefined ? 0 : sample.deviceElapsedMs - accepted.deviceElapsedMs;
      const clock = accepted !== undefined && (hostDelta < 0 || (accepted.runId === input.runId && (deviceDelta < 0 || Math.abs(hostDelta - deviceDelta) > HISTORY_STALE_MS)));
      const continuous = !clock && previous?.kind === 'sample' && previous.sequence > this.openedAtSequence && previous.runId === input.runId && previous.poll + 1 === input.poll && hostDelta <= HISTORY_STALE_MS && deviceDelta <= HISTORY_STALE_MS;
      const priorRows = continuous ? this.database.prepare('SELECT * FROM onn_history_observations WHERE intakeSequence=? ORDER BY id').all(previous.sequence) as ObservationRow[] : [];
      const priorSessions = priorRows.map(row => ({row, session: JSON.parse(row.session) as MetadataSession}));
      const sequence = this.insert(input, 'sample', payload, sample.deviceElapsedMs, clock ? 'clock' : null);
      for (const session of sample.sessions) {
        const identity = sourceId(session);
        const ambiguous = sample.sessions.length > 1;
        const prior = identity === null || ambiguous ? undefined : priorSessions.find(item => item.session.app === session.app && sourceId(item.session) === identity && priorSessions.length === 1);
        let occurrenceId = prior?.row.occurrenceId;
        if (occurrenceId === undefined) occurrenceId = Number(this.database.prepare('INSERT INTO onn_history_occurrences(app,firstObservedAtMs,confidence) VALUES (?,?,?)').run(session.app,input.receivedAtMs,ambiguous ? 'ambiguous' : identity === null ? 'unsupported' : 'source-id').lastInsertRowid);
        this.database.prepare('INSERT INTO onn_history_observations(intakeSequence,occurrenceId,app,receivedAtMs,session) VALUES (?,?,?,?,?)').run(sequence,occurrenceId,session.app,input.receivedAtMs,JSON.stringify(session));
      }
      return true;
    } catch (error) {throw new SdkError(safeFailure(error));}
  }
  gap(input: Intake & {reason: GapReason}): boolean {
    try {
      this.verifyIntake(input);
      if (!['startup','unavailable','busy','storage','clock'].includes(input.reason)) throw new SdkError(errorBody('invalid-request', {detail: 'invalid ONN history gap'}));
      const payload = canonical({reason: input.reason});
      if (this.duplicate(input, 'gap', payload)) return false;
      this.transaction(); this.insert(input,'gap',payload,null,input.reason); return true;
    } catch (error) {throw new SdkError(safeFailure(error));}
  }
  private coverage(cutoff: number): Coverage {
    const collection = this.database.prepare('SELECT receivedAtMs FROM onn_history_intakes ORDER BY sequence LIMIT 1').get() as {receivedAtMs: number} | undefined;
    const gaps = this.database.prepare('SELECT i.intakeId,i.runId,i.poll,i.receivedAtMs,g.sequence,g.reason FROM onn_history_gaps g JOIN onn_history_intakes i ON i.sequence=g.sequence WHERE g.sequence<=? ORDER BY g.sequence DESC LIMIT 20').all(cutoff) as HistoryGap[];
    return {collectionStartedAtMs: collection?.receivedAtMs ?? null, gapCount: this.latest(cutoff)?.gapCount ?? 0, recentGaps: gaps.map(row=>({...row})),storageAvailable:true,pendingGap:null,
      limits: limits(),semantics:'observations-only'};
  }
  private accepted(row: SampleIntakeRow): AcceptedEvidence {
    return {intakeId:row.intakeId,runId:row.runId,poll:row.poll,receivedAtMs:row.receivedAtMs,sequence:row.sequence,deviceElapsedMs:row.deviceElapsedMs,reader:JSON.parse(row.reader) as AcceptedEvidence['reader']};
  }
  status(nowMs: number, enabled: boolean): HistoryState {
    try {return this.storedStatus(nowMs,enabled);} catch {
      return {schema:'onn-history-state/2.0',enabled,status:enabled ? 'unavailable' : 'disabled',current:[],ambiguous:false,currentEvidence:'none',lastAccepted:null,
        coverage:{collectionStartedAtMs:null,gapCount:0,recentGaps:[],storageAvailable:false,pendingGap:null,limits:limits(),semantics:'observations-only'}};
    }
  }
  private storedStatus(nowMs: number, enabled: boolean): HistoryState {
    const latest = this.latest(); const row = this.sample();
    const current = row === undefined ? [] : (JSON.parse(row.payload) as MetadataSample).sessions.map(project);
    const fresh = enabled && row !== undefined && latest?.kind === 'sample' && row.sequence > this.openedAtSequence && integer(nowMs) && nowMs >= row.receivedAtMs && nowMs - row.receivedAtMs < HISTORY_STALE_MS;
    return {schema:'onn-history-state/2.0',enabled,status:!enabled ? 'disabled' : latest === undefined || latest.kind === 'gap' ? 'unavailable' : fresh ? 'fresh' : 'stale',current,ambiguous:current.length>1,
      currentEvidence: row === undefined ? 'none' : fresh ? 'fresh-observation' : 'last-observed',lastAccepted:row === undefined ? null : this.accepted(row),coverage:this.coverage(latest?.sequence ?? 0)};
  }
  private sign(value: Cursor): string {
    const payload = Buffer.from(canonical(value)).toString('base64url');
    return `${payload}.${createHmac('sha256',this.cursorKey).update(payload).digest('base64url')}`;
  }
  private parseCursor(value: unknown, kind: Cursor['kind'], filters: HistoryFilters | DetailFilters): Cursor | undefined {
    if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return undefined;
    const [payload, signature] = value.split('.');
    if (payload === undefined || signature === undefined) return undefined;
    const expected = createHmac('sha256',this.cursorKey).update(payload).digest(); const received = Buffer.from(signature,'base64url');
    if (received.length !== expected.length || !timingSafeEqual(expected,received)) return undefined;
    try {
      const cursor: unknown = JSON.parse(Buffer.from(payload,'base64url').toString());
      if (!object(cursor) || !closed(cursor,['version','kind','filterDigest','cutoff','after']) || cursor.version !== 2 || cursor.kind !== kind || cursor.filterDigest !== filterDigest(filters) || !integer(cursor.cutoff) || !integer(cursor.after) || cursor.cutoff > (this.latest()?.sequence ?? 0)) return undefined;
      return cursor as Cursor;
    } catch {return undefined;}
  }
  private initial(kind: Cursor['kind'], filters: HistoryFilters | DetailFilters): Cursor {
    const cutoff = this.latest()?.sequence ?? 0;
    const row = this.database.prepare('SELECT id FROM onn_history_observations WHERE intakeSequence<=? ORDER BY intakeSequence DESC,id DESC LIMIT 1').get(cutoff) as {id: number} | undefined;
    return {version:2,kind,filterDigest:filterDigest(filters),cutoff,after:(row?.id ?? 0)+1};
  }
  private observation(row: ObservationRow): HistoryObservation {
    const intake = this.database.prepare('SELECT * FROM onn_history_intakes WHERE sequence=?').get(row.intakeSequence) as SampleIntakeRow;
    return {...this.accepted(intake),...project(JSON.parse(row.session) as MetadataSession),id:`obs-${row.id}`,provenance:provenance(row.app)};
  }
  private occurrence(row: ObservationRow): HistoryOccurrence {
    const occurrence = this.database.prepare('SELECT * FROM onn_history_occurrences WHERE id=?').get(row.occurrenceId) as OccurrenceRow;
    return {id:`occ-${occurrence.id}`,app:occurrence.app,firstObservedAtMs:occurrence.firstObservedAtMs,matchingObservedAtMs:row.receivedAtMs,identityConfidence:occurrence.confidence,observation:this.observation(row)};
  }
  private representative(occurrenceId: number, cutoff: number, filters: HistoryFilters): ObservationRow | undefined {
    const latest = this.database.prepare('SELECT * FROM onn_history_observations WHERE occurrenceId=? AND intakeSequence<=? ORDER BY intakeSequence DESC,id DESC LIMIT 1').get(occurrenceId,cutoff) as ObservationRow | undefined;
    if (latest === undefined) return undefined;
    // Host time is nondecreasing within one occurrence; clock discontinuity always creates another occurrence.
    const upper = Math.min(filters.toMs === null ? Number.MAX_SAFE_INTEGER : filters.toMs-1,latest.receivedAtMs);
    const equal = upper === latest.receivedAtMs;
    const row = this.database.prepare('SELECT * FROM onn_history_observations WHERE occurrenceId=? AND (receivedAtMs,id)<=(?,?) ORDER BY receivedAtMs DESC,id DESC LIMIT 1').get(occurrenceId,upper,equal ? latest.id : Number.MAX_SAFE_INTEGER) as ObservationRow | undefined;
    return row !== undefined && (filters.fromMs === null || row.receivedAtMs >= filters.fromMs) ? row : undefined;
  }
  history(query: unknown): HistoryPage | ErrorBody {
    try {
      if (!object(query) || !closed(query,['app','fromMs','toMs','title','limit','cursor']) || (query.app !== undefined && query.app !== 'youtube' && query.app !== 'stremio') || (query.fromMs !== undefined && !integer(query.fromMs)) || (query.toMs !== undefined && !integer(query.toMs)) || (query.fromMs !== undefined && query.toMs !== undefined && Number(query.fromMs) >= Number(query.toMs)) || (query.title !== undefined && (typeof query.title !== 'string' || query.title.length > 256)) || (query.limit !== undefined && (!integer(query.limit) || query.limit < 1 || query.limit > 100))) return invalid();
      const filters: HistoryFilters = {app:query.app as HistoryApp ?? null,fromMs:query.fromMs as number ?? null,toMs:query.toMs as number ?? null,title:query.title as string ?? null,limit:query.limit as number ?? 50};
      const cursor = query.cursor === undefined ? this.initial('history',filters) : this.parseCursor(query.cursor,'history',filters);
      if (cursor === undefined) return invalid();
      const candidates = (filters.app === null ? this.database.prepare('SELECT * FROM onn_history_observations WHERE id<? ORDER BY id DESC LIMIT ?').all(cursor.after,HISTORY_CANDIDATES+1) : this.database.prepare('SELECT * FROM onn_history_observations WHERE app=? AND id<? ORDER BY id DESC LIMIT ?').all(filters.app,cursor.after,HISTORY_CANDIDATES+1)) as ObservationRow[];
      const result: HistoryPage = {schema:'onn-history/2.0',cutoff:cursor.cutoff,ordering:'evidence-desc',items:[],nextCursor:null,coverage:this.coverage(cursor.cutoff),pageOmissions:[]};
      let after = cursor.after; let processed = 0;
      const representatives = new Map<number, ObservationRow | undefined>();
      for (const row of candidates.slice(0,HISTORY_CANDIDATES)) {
        if (!representatives.has(row.occurrenceId)) representatives.set(row.occurrenceId,this.representative(row.occurrenceId,cursor.cutoff,filters));
        const selected = representatives.get(row.occurrenceId);
        if (selected?.id === row.id) {
          const session = JSON.parse(row.session) as MetadataSession;
          const needle = filters.title?.toLowerCase();
          if (needle === undefined || [session.metadata?.title,session.metadata?.displayTitle,session.metadata?.subtitle].some(title => title?.toLowerCase().includes(needle) === true)) {
            const item = this.occurrence(row); result.items.push(item);
            if (Buffer.byteLength(JSON.stringify({...result,nextCursor:this.sign({...cursor,after:row.id})})) > HISTORY_RESPONSE_BYTES-256) {result.items.pop();result.pageOmissions.push({reason:'response-limit',continuation:true});break;}
          }
        }
        after = row.id; processed += 1;
        if (result.items.length >= filters.limit) break;
      }
      if (processed < candidates.length) result.nextCursor = this.sign({...cursor,after});
      return Buffer.byteLength(JSON.stringify(result)) <= HISTORY_RESPONSE_BYTES ? result : errorBody('capacity',{detail:'ONN history response exceeds its bound'});
    } catch (error) {return safeFailure(error);}
  }
  detail(query: unknown): HistoryDetail | ErrorBody {
    try {
      if (!object(query) || !closed(query,['id','limit','cursor']) || typeof query.id !== 'string' || !/^occ-[1-9][0-9]{0,15}$/.test(query.id) || !integer(Number(query.id.slice(4))) || (query.limit !== undefined && (!integer(query.limit) || query.limit < 1 || query.limit > 100))) return invalid();
      const filters: DetailFilters = {id:query.id,limit:query.limit as number ?? 50};
      const cursor = query.cursor === undefined ? this.initial('detail',filters) : this.parseCursor(query.cursor,'detail',filters);
      if (cursor === undefined) return invalid();
      const occurrenceId = Number(filters.id.slice(4));
      const selected = this.representative(occurrenceId,cursor.cutoff,{app:null,fromMs:null,toMs:null,title:null,limit:filters.limit});
      if (selected === undefined) return errorBody('not-found',{detail:'ONN history occurrence was not found'});
      const rows = this.database.prepare('SELECT * FROM onn_history_observations WHERE occurrenceId=? AND id<? ORDER BY id DESC LIMIT ?').all(occurrenceId,cursor.after,filters.limit+1) as ObservationRow[];
      const result: HistoryDetail = {schema:'onn-history-detail/2.0',cutoff:cursor.cutoff,occurrence:this.occurrence(selected),observations:[],nextCursor:null,coverage:this.coverage(cursor.cutoff),pageOmissions:[]};
      let after = cursor.after; let processed = 0;
      for (const row of rows.slice(0,filters.limit)) {
        result.observations.push(this.observation(row));
        if (Buffer.byteLength(JSON.stringify({...result,nextCursor:this.sign({...cursor,after:row.id})})) > HISTORY_RESPONSE_BYTES-256) {result.observations.pop();result.pageOmissions.push({reason:'response-limit',continuation:true});break;}
        after = row.id; processed += 1;
      }
      if (processed < rows.length) result.nextCursor = this.sign({...cursor,after});
      return Buffer.byteLength(JSON.stringify(result)) <= HISTORY_RESPONSE_BYTES ? result : errorBody('capacity',{detail:'ONN history response exceeds its bound'});
    } catch (error) {return safeFailure(error);}
  }
}
