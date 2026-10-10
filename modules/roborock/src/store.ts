import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { errorBody, isErrorCode, type ErrorCode } from '@jimmie-potts/event-contracts/v2';
import { SdkError } from '@jimmie-potts/sdk';
import type { BatterySample, CollectionGap, RunRecord, VacuumStatus, Value } from './contracts.js';
import { activity, normalizeStatus } from './normalize.js';
export type Operation = 'status' | 'consumables' | 'summary' | 'record' | 'rooms' | 'map';
export type Observation = {
    id: string;
    operation: Operation;
    requestedRecordId?: number;
    observedAtMs: number;
    generation: number;
    normalizationVersion?: number;
} & ({
    value: unknown;
    failureCode?: never;
} | {
    failureCode: ErrorCode;
    value?: never;
});
export type Episode = {
    id: string;
    generation: number;
    startAtMs: number;
    lastObservedAtMs: number;
    startObservationId: string;
    lastObservationId: string;
    endAtMs: number | null;
    runId: number | null;
    /** Observed dock boundary, separate from a record-supported end/completion. */
    terminal?: { observationId: string; observedAtMs: number };
};
export type Sample = {
    id: string;
    episodeId: string;
    observedAtMs: number;
    batteryPercent: number;
    runId: number | null;
};
export type Gap = {
    id: string;
    episodeId: string | null;
    startAtMs: number;
    endAtMs: number | null;
    reason: CollectionGap['reason'];
};
export type Checkpoint = {
    generation: number;
    lastObservationId: string | null;
    lastObservedAtMs: number | null;
    activeEpisodeId: string | null;
};
export type QueueItem = {
    recordId: number;
    attempts: number;
    firstSeenAtMs: number;
    lastSeenAtMs: number;
    nextAttemptAtMs: number;
    lastFailure: ErrorCode | null;
};
export type ValidatedWindow = {
    episodeId: string;
    recordId: number;
    startAtMs: number;
    endAtMs: number;
    externallyValidated: true;
};
export type MapReason = 'candidate-window' | 'capture-failed' | 'restart' | 'gap' | 'late' | 'newer-run' | 'identity-conflict' | 'ambiguous-window';
export type MapCapture = {
    id: string;
    candidateRunId: number | null;
    requestAtMs: number;
    responseAtMs: number;
    generation: number;
    preObservationIds: string[];
    postObservationIds: string[];
    mapIndex: number | null;
    mapSequence: number | null;
    association: 'unverified';
    reasons: MapReason[];
};
export type StoredMapCapture = MapCapture & {
    blobHash: string | null;
};
export type Page<T> = {
    items: T[];
    next: string | null;
};
export type SampleSlice = {
    samples: BatterySample[];
    gaps: CollectionGap[];
    next: string | null;
};
export type Counts = {
    observations: number;
    runs: number;
    samples: number;
    unattachedSamples: number;
    episodes: number;
    gaps: number;
    queuedRecords: number;
    mapBlobs: number;
    mapCaptures: number;
};
export type EpisodeRecoveryItem = {
    sequence: number;
    episode: Episode;
};
export type RunCandidates = {
    runs: RunRecord[];
    overflow: boolean;
};
type GapRecoveryRow = {
    generation: number;
    high: number;
    after_seq: number;
    recovered_at: number | null;
    recovery_at: number | null;
};
/** Internal archive boundary; does not clone or invoke accessors. */
export function validateObservationValue(value: unknown): void {
    json(value);
}
const RUN_FIELDS = ['endAtMs', 'durationSeconds', 'areaMm2', 'cleanedAreaMm2', 'errorCode', 'complete', 'startType', 'cleanType', 'finishReason', 'avoidCount', 'washCount'] as const;
type RunField = typeof RUN_FIELDS[number];
const MAP_RANK: Record<RunRecord['map']['reason'], number> = { 'not-observed': 0, 'capture-failed': 1, 'candidate-window': 2, 'ambiguous-window': 3 };
// Existing links remain private evidence when later input makes them ineligible.
const ELIGIBLE_SAMPLE = `s.run_id IS NOT NULL AND r.end_at_ms IS NOT NULL
 AND json_extract(e.data,'$.runId')=s.run_id
 AND json_extract(e.data,'$.endAtMs') IS NOT NULL
 AND json_extract(e.data,'$.endAtMs')>=json_extract(e.data,'$.lastObservedAtMs')
 AND e.start_at_ms>=r.begin_at_ms AND json_extract(e.data,'$.lastObservedAtMs')<=r.end_at_ms
 AND s.observed_at_ms BETWEEN r.begin_at_ms AND r.end_at_ms
 AND s.observed_at_ms BETWEEN e.start_at_ms AND json_extract(e.data,'$.lastObservedAtMs')
 AND NOT EXISTS(SELECT 1 FROM rr_run_conflicts c WHERE c.record_id=r.record_id)
 AND NOT EXISTS(SELECT 1 FROM rr_runs other WHERE other.record_id<>r.record_id AND other.begin_at_ms<=r.end_at_ms AND(other.end_at_ms IS NULL OR other.end_at_ms>=r.begin_at_ms))
 AND NOT EXISTS(SELECT 1 FROM rr_episodes other WHERE other.id<>e.id AND other.start_at_ms<=r.end_at_ms AND(COALESCE(other.end_at_ms,json_extract(other.data,'$.terminal.observedAtMs')) IS NULL OR COALESCE(other.end_at_ms,json_extract(other.data,'$.terminal.observedAtMs'))>=r.begin_at_ms))
 AND NOT EXISTS(SELECT 1 FROM rr_gaps g WHERE g.start_at_ms<=s.observed_at_ms AND(g.end_at_ms IS NULL OR g.end_at_ms>=s.observed_at_ms))`;
const MAX_JSON = 128 * 1024, MAX_MAP = 2 * 1024 * 1024;
const OPERATIONS: readonly Operation[] = ['status', 'consumables', 'summary', 'record', 'rooms', 'map'];
const REASONS: readonly MapReason[] = ['candidate-window', 'capture-failed', 'restart', 'gap', 'late', 'newer-run', 'identity-conflict', 'ambiguous-window'];
const GAP_REASONS: readonly Gap['reason'][] = ['restart', 'unavailable', 'missed-poll', 'storage'];
function refuse(code: 'invalid-request' | 'invalid-state' | 'unsupported-capability'): never { throw new SdkError(errorBody(code, { detail: 'The private observation store operation was refused.' })); }
function present<T>(value: T | undefined): T { if (value === undefined)
    refuse('invalid-state'); return value; }
const integer = (value: number, min = 0): number => { if (!Number.isSafeInteger(value) || value < min)
    refuse('invalid-request'); return value; };
const identifier = (value: string): void => { if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[^A-Za-z0-9_-]/u.test(value))
    refuse('invalid-request'); };
const limit = (value: number, max: number): void => { if (integer(value, 1) > max)
    refuse('invalid-request'); };
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const same = (a: string, b: string): void => { if (a !== b)
    refuse('invalid-state'); };
/** Parsed JSON only: do not invoke accessors, toJSON or coercion hooks. */
function json(value: unknown): string {
    const path = new Set<object>();
    let nodes = 0;
    function inspect(x: unknown, depth: number): void {
        if (++nodes > 65536 || depth > 64)
            refuse('invalid-request');
        if (x === null || typeof x === 'boolean')
            return;
        if (typeof x === 'string') {
            if (x.length > MAX_JSON)
                refuse('invalid-request');
            return;
        }
        if (typeof x === 'number') {
            if (!Number.isFinite(x))
                refuse('invalid-request');
            return;
        }
        if (typeof x !== 'object' || path.has(x))
            refuse('invalid-request');
        const array = Array.isArray(x), proto: unknown = Object.getPrototypeOf(x);
        if (!array && proto !== Object.prototype && proto !== null)
            refuse('invalid-request');
        path.add(x);
        const descriptors = Object.getOwnPropertyDescriptors(x), keys = Reflect.ownKeys(descriptors);
        if (array) {
            if (x.length > 65536 || keys.length !== x.length + 1)
                refuse('invalid-request');
            for (let i = 0; i < x.length; i++) {
                const d = descriptors[String(i)];
                if (d === undefined || !('value' in d) || d.enumerable !== true)
                    refuse('invalid-request');
                inspect(d.value, depth + 1);
            }
        }
        else {
            for (const key of keys) {
                if (typeof key !== 'string')
                    refuse('invalid-request');
                const d = descriptors[key];
                if (d === undefined || !('value' in d) || d.enumerable !== true)
                    refuse('invalid-request');
                inspect(d.value, depth + 1);
            }
        }
        path.delete(x);
    }
    inspect(value, 0);
    let encoded: string | undefined;
    try {
        encoded = JSON.stringify(value);
    }
    catch {
        refuse('invalid-request');
    }
    if (encoded === undefined || Buffer.byteLength(encoded) > MAX_JSON)
        refuse('invalid-request');
    return encoded;
}
function cursor(value: string, prefix: string, count: number): number[] { if (value.length > 128)
    refuse('invalid-request'); const parts = value.split('.'); if (parts.length !== count + 1 || parts[0] !== prefix)
    refuse('invalid-request'); return parts.slice(1).map(p => { const n = Number(p); if (!Number.isSafeInteger(n) || n < 0 || String(n) !== p)
    refuse('invalid-request'); return n; }); }
type Data = {
    data: string;
};
/** One runtime-owned connection; mutations belong to the caller's Outbox transaction. */
export class RoborockStore {
    constructor(readonly database: DatabaseSync) {
        database.exec('CREATE TABLE IF NOT EXISTS rr_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT');
        const v = this.one<{
            value: string;
        }>("SELECT value FROM rr_meta WHERE key='schema'");
        if (v && v.value !== '1')
            refuse('unsupported-capability');
        database.exec(`
 CREATE TABLE IF NOT EXISTS rr_observations(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,operation TEXT NOT NULL,observed_at_ms INTEGER NOT NULL,generation INTEGER NOT NULL,data TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS rr_projection(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,publish_needed INTEGER NOT NULL CHECK(publish_needed IN(0,1)),data TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS rr_runs(seq INTEGER PRIMARY KEY AUTOINCREMENT,record_id INTEGER NOT NULL UNIQUE,observed_at_ms INTEGER NOT NULL,begin_at_ms INTEGER NOT NULL,end_at_ms INTEGER,data TEXT NOT NULL) STRICT;
 CREATE INDEX IF NOT EXISTS rr_runs_window ON rr_runs(begin_at_ms,end_at_ms);
 CREATE TABLE IF NOT EXISTS rr_run_versions(seq INTEGER PRIMARY KEY AUTOINCREMENT,record_id INTEGER NOT NULL REFERENCES rr_runs(record_id),digest TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(record_id,digest)) STRICT;
 CREATE TABLE IF NOT EXISTS rr_run_fields(record_id INTEGER NOT NULL REFERENCES rr_runs(record_id),field TEXT NOT NULL,observed_at_ms INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(record_id,field)) STRICT;
 CREATE TABLE IF NOT EXISTS rr_run_conflicts(record_id INTEGER PRIMARY KEY REFERENCES rr_runs(record_id),reason TEXT NOT NULL CHECK(reason='conflicting-end'),observed_at_ms INTEGER NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS rr_queue(seq INTEGER PRIMARY KEY AUTOINCREMENT,record_id INTEGER NOT NULL UNIQUE,first_seen_at_ms INTEGER NOT NULL,last_seen_at_ms INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at_ms INTEGER NOT NULL,last_failure TEXT,pending INTEGER NOT NULL CHECK(pending IN(0,1))) STRICT;
 CREATE INDEX IF NOT EXISTS rr_queue_due ON rr_queue(pending,next_attempt_at_ms,seq);
 CREATE TABLE IF NOT EXISTS rr_episodes(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,start_at_ms INTEGER NOT NULL,end_at_ms INTEGER,data TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS rr_episode_versions(seq INTEGER PRIMARY KEY AUTOINCREMENT,episode_id TEXT NOT NULL REFERENCES rr_episodes(id),digest TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(episode_id,digest)) STRICT;
 CREATE TABLE IF NOT EXISTS rr_samples(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE REFERENCES rr_observations(id),episode_id TEXT NOT NULL REFERENCES rr_episodes(id),observed_at_ms INTEGER NOT NULL,battery_percent INTEGER NOT NULL CHECK(battery_percent BETWEEN 0 AND 100),run_id INTEGER REFERENCES rr_runs(record_id),data TEXT NOT NULL) STRICT;
 CREATE INDEX IF NOT EXISTS rr_samples_episode ON rr_samples(episode_id,observed_at_ms,seq);
 CREATE TABLE IF NOT EXISTS rr_sample_links(seq INTEGER PRIMARY KEY AUTOINCREMENT,sample_id TEXT NOT NULL UNIQUE REFERENCES rr_samples(id),run_id INTEGER NOT NULL REFERENCES rr_runs(record_id)) STRICT;
 CREATE TABLE IF NOT EXISTS rr_gaps(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,episode_id TEXT REFERENCES rr_episodes(id),start_at_ms INTEGER NOT NULL,end_at_ms INTEGER,reason TEXT NOT NULL,data TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS rr_gap_versions(seq INTEGER PRIMARY KEY AUTOINCREMENT,gap_id TEXT NOT NULL REFERENCES rr_gaps(id),digest TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(gap_id,digest)) STRICT;
 CREATE TABLE IF NOT EXISTS rr_checkpoint(singleton INTEGER PRIMARY KEY CHECK(singleton=1),data TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS rr_map_blobs(hash TEXT PRIMARY KEY,bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 1 AND ${String(MAX_MAP)})) STRICT;
 CREATE TABLE IF NOT EXISTS rr_map_captures(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,candidate_run_id INTEGER REFERENCES rr_runs(record_id),blob_hash TEXT REFERENCES rr_map_blobs(hash),data TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS rr_map_checks(seq INTEGER PRIMARY KEY AUTOINCREMENT,capture_id TEXT NOT NULL REFERENCES rr_map_captures(id),at_ms INTEGER NOT NULL,reason TEXT NOT NULL,UNIQUE(capture_id,at_ms,reason)) STRICT;
CREATE INDEX IF NOT EXISTS rr_episodes_recovery
 ON rr_episodes(seq)
 WHERE json_extract(data,'$.runId') IS NULL;

CREATE INDEX IF NOT EXISTS rr_episodes_observed_window
 ON rr_episodes(start_at_ms,json_extract(data,'$.lastObservedAtMs'));

CREATE INDEX IF NOT EXISTS rr_gaps_open_unavailable
 ON rr_gaps(seq)
 WHERE end_at_ms IS NULL AND reason='unavailable';

CREATE TABLE IF NOT EXISTS rr_gap_recovery(
 generation INTEGER PRIMARY KEY,
 high INTEGER NOT NULL,
 after_seq INTEGER NOT NULL DEFAULT 0,
 recovered_at INTEGER,
 CHECK(high>=0 AND after_seq>=0 AND after_seq<=high),
 CHECK(recovered_at IS NULL OR recovered_at>=0)
) STRICT;

CREATE INDEX IF NOT EXISTS rr_gap_recovery_pending
 ON rr_gap_recovery(generation)
 WHERE after_seq<high;

CREATE INDEX IF NOT EXISTS rr_gap_recovery_success
 ON rr_gap_recovery(generation)
 WHERE recovered_at IS NOT NULL;`);
        database.prepare("INSERT OR IGNORE INTO rr_meta VALUES('schema','1')").run();
    }
    bindIdentity(id: string): void { if (!this.database.isTransaction)
        refuse('invalid-state'); identifier(id); const row = this.one<{
        value: string;
    }>("SELECT value FROM rr_meta WHERE key='robot'"); if (row)
        same(row.value, id);
    else
        this.run("INSERT INTO rr_meta VALUES('robot',?)", id); }
    hasIdentity(): boolean { return this.one("SELECT value FROM rr_meta WHERE key='robot'") !== undefined; }
    identity(): string { const row = this.one<{
        value: string;
    }>("SELECT value FROM rr_meta WHERE key='robot'"); if (!row)
        refuse('invalid-state'); return row.value; }
    appendObservation(o: Observation): boolean { this.write(); identifier(o.id); integer(o.observedAtMs); integer(o.generation); integer(o.normalizationVersion ?? 1, 1); if (!OPERATIONS.includes(o.operation))
        refuse('invalid-request'); if (o.requestedRecordId !== undefined && (integer(o.requestedRecordId, 1) > 0xffffffff || o.operation !== 'record'))
        refuse('invalid-request'); const value = Object.hasOwn(o, 'value'), failure = Object.hasOwn(o, 'failureCode'); if (value === failure || (failure && !isErrorCode(o.failureCode)))
        refuse('invalid-request'); const data = json({ ...o, normalizationVersion: o.normalizationVersion ?? 1 }), old = this.one<Data>('SELECT data FROM rr_observations WHERE id=?', o.id); if (old) {
        same(old.data, data);
        return false;
    } this.run('INSERT INTO rr_observations(id,operation,observed_at_ms,generation,data) VALUES(?,?,?,?,?)', o.id, o.operation, o.observedAtMs, o.generation, data); return true; }
    getObservation(id: string): Observation | undefined { this.identity(); identifier(id); return this.read<Observation>('SELECT data FROM rr_observations WHERE id=?', id); }
    loadProjection(): VacuumStatus | undefined { this.identity(); return this.read('SELECT data FROM rr_projection WHERE singleton=1'); }
    saveProjection(status: VacuumStatus, needed: boolean): void { this.write(); integer(status.revision); if (status.schema !== 'roborock-vacuum/2.0' || typeof needed !== 'boolean')
        refuse('invalid-request'); const data = json(status), old = this.one<Data & {
        revision: number;
    }>('SELECT data,revision FROM rr_projection WHERE singleton=1'); if (old) {
        if (status.revision < old.revision)
            refuse('invalid-state');
        if (status.revision === old.revision)
            same(old.data, data);
    } this.run('INSERT INTO rr_projection VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,publish_needed=excluded.publish_needed,data=excluded.data', status.revision, needed ? 1 : 0, data); }
    needsPublication(): boolean { this.identity(); return this.one<{
        publish_needed: number;
    }>('SELECT publish_needed FROM rr_projection WHERE singleton=1')?.publish_needed === 1; }
    putRun(run: RunRecord): void {
        this.write();
        if (integer(run.recordId, 1) > 0xffffffff || integer(run.startAtMs) !== run.recordId * 1000)
            refuse('invalid-request');
        integer(run.observedAtMs);
        integer(run.battery.samples);
        const end = run.endAtMs.status === 'known' ? integer(run.endAtMs.value) : null;
        if ((end !== null && end < run.startAtMs) || run.battery.clock !== 'unqualified' || !['missing', 'unverified'].includes(run.map.availability))
            refuse('invalid-request');
        const data = json(run), old = this.read<RunRecord>('SELECT data FROM rr_runs WHERE record_id=?', run.recordId);
        this.run('INSERT INTO rr_runs(record_id,observed_at_ms,begin_at_ms,end_at_ms,data) VALUES(?,?,?,?,?) ON CONFLICT(record_id) DO NOTHING', run.recordId, run.observedAtMs, run.startAtMs, end, data);
        this.run('INSERT OR IGNORE INTO rr_run_versions(record_id,digest,data) VALUES(?,?,?)', run.recordId, hash(data), data);
        const fields = this.mergeRunFields(run, old), count = Math.max(old?.battery.samples ?? 0, run.battery.samples);
        const reason = old && MAP_RANK[old.map.reason] > MAP_RANK[run.map.reason] ? old.map.reason : run.map.reason;
        const canonical: RunRecord = { ...run, ...fields, observedAtMs: Math.max(old?.observedAtMs ?? 0, run.observedAtMs),
            battery: { availability: count > 0 || old?.battery.availability === 'partial' || run.battery.availability === 'partial' ? 'partial' : 'missing', samples: count, clock: 'unqualified' },
            map: { availability: old?.map.availability === 'unverified' || run.map.availability === 'unverified' ? 'unverified' : 'missing', reason } };
        this.run('UPDATE rr_runs SET observed_at_ms=?,end_at_ms=?,data=? WHERE record_id=?', canonical.observedAtMs, canonical.endAtMs.status === 'known' ? canonical.endAtMs.value : null, json(canonical), run.recordId);
    }
    getRun(id: number): RunRecord | undefined { this.identity(); integer(id, 1); const r = this.read<RunRecord>('SELECT data FROM rr_runs WHERE record_id=?', id); return r ? this.runView(r) : undefined; }
    listRuns(token?: string, size = 25): Page<RunRecord> { this.identity(); limit(size, 25); const max = this.maximum('rr_runs'); let high = max, before = high + 1; if (token !== undefined) {
        [high, before] = cursor(token, 'r1', 2) as [
            number,
            number
        ];
        if (high > max || before < 1 || before > high + 1)
            refuse('invalid-request');
    } const rows = this.many<Data & {
        seq: number;
    }>('SELECT seq,data FROM rr_runs WHERE seq<=? AND seq<? ORDER BY seq DESC LIMIT ?', high, before, size + 1), selected = rows.slice(0, size); return { items: selected.map(r => this.runView(JSON.parse(r.data) as RunRecord)), next: rows.length > size ? `r1.${String(high)}.${String(present(selected.at(-1)).seq)}` : null }; }
    enqueueRecordIds(ids: readonly number[], at: number): {
        added: number;
        invalid: number;
    } { this.write(); integer(at); const input: unknown = ids; if (!Array.isArray(input) || ids.length > 32768)
        refuse('invalid-request'); const unique = new Set<number>(); let invalid = 0, added = 0; for (const id of ids) {
        if (!Number.isSafeInteger(id) || id < 1 || id > 0xffffffff)
            invalid++;
        else
            unique.add(id);
    } for (const id of unique) {
        if (this.one('SELECT 1 FROM rr_queue WHERE record_id=?', id) === undefined)
            added++;
        this.run(`INSERT INTO rr_queue(record_id,first_seen_at_ms,last_seen_at_ms,next_attempt_at_ms,pending) VALUES(?,?,?,?,1) ON CONFLICT(record_id) DO UPDATE SET last_seen_at_ms=MAX(rr_queue.last_seen_at_ms,excluded.last_seen_at_ms),next_attempt_at_ms=CASE WHEN rr_queue.pending=0 THEN excluded.next_attempt_at_ms ELSE rr_queue.next_attempt_at_ms END,last_failure=CASE WHEN rr_queue.pending=0 THEN NULL ELSE rr_queue.last_failure END,pending=1`, id, at, at, at);
    } return { added, invalid }; }
    listReconciliation(at: number, size = 25): QueueItem[] { this.identity(); integer(at); limit(size, 25); return this.many<{
        record_id: number;
        attempts: number;
        first_seen_at_ms: number;
        last_seen_at_ms: number;
        next_attempt_at_ms: number;
        last_failure: ErrorCode | null;
    }>('SELECT * FROM rr_queue WHERE pending=1 AND next_attempt_at_ms<=? ORDER BY next_attempt_at_ms,seq LIMIT ?', at, size).map(r => ({ recordId: r.record_id, attempts: r.attempts, firstSeenAtMs: r.first_seen_at_ms, lastSeenAtMs: r.last_seen_at_ms, nextAttemptAtMs: r.next_attempt_at_ms, lastFailure: r.last_failure })); }
    getReconciliation(id: number): QueueItem | undefined { this.identity(); integer(id, 1); const r = this.one<{
        record_id: number;
        attempts: number;
        first_seen_at_ms: number;
        last_seen_at_ms: number;
        next_attempt_at_ms: number;
        last_failure: ErrorCode | null;
    }>('SELECT * FROM rr_queue WHERE record_id=? AND pending=1', id); return r ? { recordId: r.record_id, attempts: r.attempts, firstSeenAtMs: r.first_seen_at_ms, lastSeenAtMs: r.last_seen_at_ms, nextAttemptAtMs: r.next_attempt_at_ms, lastFailure: r.last_failure } : undefined; }
    failReconciliation(id: number, code: ErrorCode, next: number): void { this.write(); integer(id, 1); integer(next); if (!isErrorCode(code))
        refuse('invalid-request'); if (this.run('UPDATE rr_queue SET attempts=attempts+1,last_failure=?,next_attempt_at_ms=? WHERE record_id=? AND pending=1', code, next, id) !== 1)
        refuse('invalid-state'); }
    completeReconciliation(id: number): void { this.write(); if (!this.getRun(id) || this.run('UPDATE rr_queue SET pending=0,last_failure=NULL WHERE record_id=?', id) !== 1)
        refuse('invalid-state'); }
    getEpisode(id: string): Episode | undefined { this.identity(); identifier(id); return this.read('SELECT data FROM rr_episodes WHERE id=?', id); }
    listEpisodes(after = 0, size = 100): {
        sequence: number;
        episode: Episode;
    }[] { this.identity(); integer(after); limit(size, 100); return this.many<Data & {
        seq: number;
    }>('SELECT seq,data FROM rr_episodes WHERE seq>? ORDER BY seq LIMIT ?', after, size).map(r => ({ sequence: r.seq, episode: JSON.parse(r.data) as Episode })); }
    putEpisode(e: Episode): void {
        this.write();
        identifier(e.id); integer(e.generation); integer(e.startAtMs); integer(e.lastObservedAtMs);
        if (e.lastObservedAtMs < e.startAtMs || (e.endAtMs !== null && integer(e.endAtMs) < e.lastObservedAtMs))
            refuse('invalid-request');
        const first = this.getObservation(e.startObservationId), last = this.getObservation(e.lastObservationId);
        if (!first || !last || first.operation !== 'status' || last.operation !== 'status'
            || !Object.hasOwn(first, 'value') || !Object.hasOwn(last, 'value')
            || first.generation !== e.generation || last.generation !== e.generation
            || first.observedAtMs !== e.startAtMs || last.observedAtMs !== e.lastObservedAtMs)
            refuse('invalid-state');
        if (e.terminal !== undefined) {
            identifier(e.terminal.observationId); integer(e.terminal.observedAtMs);
            const observation = this.getObservation(e.terminal.observationId);
            const status = observation?.operation === 'status' && Object.hasOwn(observation, 'value')
                ? normalizeStatus(observation.value) : undefined;
            if (observation === undefined || status === undefined || observation.generation !== e.generation
                || observation.observedAtMs !== e.terminal.observedAtMs
                || activity(status) !== 'other' || status.stateCode.kind !== 'known'
                || (status.stateCode.value !== 8 && status.stateCode.value !== 100)
                || e.terminal.observedAtMs < e.lastObservedAtMs
                || (e.endAtMs !== null && e.endAtMs > e.terminal.observedAtMs))
                refuse('invalid-state');
        }
        const old = this.getEpisode(e.id);
        if (old ? (old.generation !== e.generation || old.startAtMs !== e.startAtMs
            || old.startObservationId !== e.startObservationId || e.lastObservedAtMs < old.lastObservedAtMs
            || (old.endAtMs !== null && old.endAtMs !== e.endAtMs) || old.runId !== e.runId
            || (old.terminal !== undefined && JSON.stringify(old.terminal) !== JSON.stringify(e.terminal))
            || (old.terminal !== undefined && old.lastObservedAtMs !== e.lastObservedAtMs)) : e.runId !== null)
            refuse('invalid-state');
        this.storeEpisode(e);
    }
    appendSample(s: Sample): boolean { this.write(); identifier(s.id); identifier(s.episodeId); integer(s.observedAtMs); if (integer(s.batteryPercent) > 100 || s.runId !== null)
        refuse('invalid-request'); const o = this.getObservation(s.id), e = this.getEpisode(s.episodeId); if (!o || !e || o.operation !== 'status' || !Object.hasOwn(o, 'value') || o.observedAtMs !== s.observedAtMs || o.generation !== e.generation || s.observedAtMs < e.startAtMs || (e.endAtMs !== null && s.observedAtMs > e.endAtMs))
        refuse('invalid-state'); if (e.terminal !== undefined && s.observedAtMs > e.terminal.observedAtMs)
        refuse('invalid-state'); const data = json(s), old = this.one<Data>('SELECT data FROM rr_samples WHERE id=?', s.id); if (old) {
        same(old.data, data);
        return false;
    } this.run('INSERT INTO rr_samples(id,episode_id,observed_at_ms,battery_percent,run_id,data) VALUES(?,?,?,?,NULL,?)', s.id, s.episodeId, s.observedAtMs, s.batteryPercent, data); return true; }
    getSample(id: string): Sample | undefined { this.identity(); identifier(id); const r = this.one<Data & {
        run_id: number | null;
    }>(`SELECT s.data,CASE WHEN ${ELIGIBLE_SAMPLE} THEN s.run_id ELSE NULL END AS run_id FROM rr_samples s LEFT JOIN rr_runs r ON r.record_id=s.run_id LEFT JOIN rr_episodes e ON e.id=s.episode_id WHERE s.id=?`, id); return r ? { ...JSON.parse(r.data) as Sample, runId: r.run_id } : undefined; }
    attachEpisode(w: ValidatedWindow): {
        attached: boolean;
        samples: number;
    } { this.write(); if (w.externallyValidated !== true)
        refuse('invalid-request'); identifier(w.episodeId); integer(w.recordId, 1); integer(w.startAtMs); integer(w.endAtMs); if (w.endAtMs < w.startAtMs)
        refuse('invalid-request'); const r = this.getRun(w.recordId), e = this.getEpisode(w.episodeId), no = { attached: false, samples: 0 }; if (!r || !e || r.endAtMs.status !== 'known' || e.endAtMs === null || (e.runId !== null && e.runId !== w.recordId) || r.startAtMs !== w.startAtMs || r.endAtMs.value !== w.endAtMs || e.startAtMs < w.startAtMs || e.lastObservedAtMs > w.endAtMs || this.conflictingRunWindow(w.recordId))
        return no; if (this.one('SELECT 1 FROM rr_runs WHERE record_id<>? AND begin_at_ms<=? AND (end_at_ms IS NULL OR end_at_ms>=?) LIMIT 1', w.recordId, w.endAtMs, w.startAtMs) !== undefined || this.one("SELECT 1 FROM rr_episodes WHERE id<>? AND start_at_ms<=? AND (COALESCE(end_at_ms,json_extract(data,'$.terminal.observedAtMs')) IS NULL OR COALESCE(end_at_ms,json_extract(data,'$.terminal.observedAtMs'))>=?) LIMIT 1", w.episodeId, w.endAtMs, w.startAtMs) !== undefined || this.one('SELECT 1 FROM rr_samples WHERE episode_id=? AND run_id IS NOT NULL AND run_id<>? LIMIT 1', w.episodeId, w.recordId) !== undefined)
        return no; const added = this.run(`INSERT OR IGNORE INTO rr_sample_links(sample_id,run_id) SELECT s.id,? FROM rr_samples s WHERE s.episode_id=? AND s.run_id IS NULL AND s.observed_at_ms BETWEEN ? AND ? AND s.observed_at_ms<=? AND NOT EXISTS(SELECT 1 FROM rr_gaps g WHERE g.start_at_ms<=s.observed_at_ms AND(g.end_at_ms IS NULL OR g.end_at_ms>=s.observed_at_ms)) ORDER BY s.observed_at_ms,s.seq`, w.recordId, w.episodeId, w.startAtMs, w.endAtMs, e.lastObservedAtMs); this.run('UPDATE rr_samples SET run_id=? WHERE episode_id=? AND run_id IS NULL AND EXISTS(SELECT 1 FROM rr_sample_links l WHERE l.sample_id=rr_samples.id AND l.run_id=?)', w.recordId, w.episodeId, w.recordId); this.storeEpisode({ ...e, runId: w.recordId }); return { attached: true, samples: added }; }
    appendGap(g: Gap): boolean { this.write(); identifier(g.id); integer(g.startAtMs); if ((g.endAtMs !== null && integer(g.endAtMs) < g.startAtMs) || !GAP_REASONS.includes(g.reason))
        refuse('invalid-request'); if (g.episodeId !== null && !this.getEpisode(g.episodeId))
        refuse('invalid-state'); const data = json(g), old = this.one<Data>('SELECT data FROM rr_gaps WHERE id=?', g.id); if (old) {
        same(old.data, data);
        return false;
    } this.run('INSERT INTO rr_gaps(id,episode_id,start_at_ms,end_at_ms,reason,data) VALUES(?,?,?,?,?,?)', g.id, g.episodeId, g.startAtMs, g.endAtMs, g.reason, data); this.run('INSERT INTO rr_gap_versions(gap_id,digest,data) VALUES(?,?,?)', g.id, hash(data), data); return true; }
    getGap(id: string): Gap | undefined { this.identity(); identifier(id); return this.read('SELECT data FROM rr_gaps WHERE id=?', id); }
    closeGap(id: string, at: number): void { this.write(); integer(at); const old = this.getGap(id); if (!old || at < old.startAtMs || (old.endAtMs !== null && old.endAtMs !== at))
        refuse('invalid-state'); const data = json({ ...old, endAtMs: at }); this.run('UPDATE rr_gaps SET end_at_ms=?,data=? WHERE id=?', at, data, id); this.run('INSERT OR IGNORE INTO rr_gap_versions(gap_id,digest,data) VALUES(?,?,?)', id, hash(data), data); }
    listGaps(after = 0, size = 100): {
        sequence: number;
        gap: Gap;
    }[] { this.identity(); integer(after); limit(size, 100); return this.many<Data & {
        seq: number;
    }>('SELECT seq,data FROM rr_gaps WHERE seq>? ORDER BY seq LIMIT ?', after, size).map(r => ({ sequence: r.seq, gap: JSON.parse(r.data) as Gap })); }
    listSamples(id: number, token?: string, sampleSize = 100, gapSize = 100): SampleSlice { this.identity(); integer(id, 1); limit(sampleSize, 100); limit(gapSize, 100); const r = this.getRun(id); if (!r)
        refuse('invalid-request'); const currentL = this.maximum('rr_sample_links'), currentG = this.maximum('rr_gaps'); let highL = currentL, lastAt = 0, lastSeq = 0, highG = currentG, afterG = 0; if (token !== undefined) {
        const parts = cursor(token, 's1', 6);
        if (parts[0] !== id)
            refuse('invalid-request');
        [, highL, lastAt, lastSeq, highG, afterG] = parts as [
            number,
            number,
            number,
            number,
            number,
            number
        ];
        if (highL > currentL || highG > currentG || afterG > highG)
            refuse('invalid-request');
    } const all = this.many<{
        seq: number;
        id: string;
        observed_at_ms: number;
        battery_percent: number;
    }>(`SELECT s.seq,s.id,s.observed_at_ms,s.battery_percent FROM rr_samples s JOIN rr_sample_links l ON l.sample_id=s.id AND l.run_id=s.run_id JOIN rr_runs r ON r.record_id=s.run_id JOIN rr_episodes e ON e.id=s.episode_id WHERE l.run_id=? AND l.seq<=? AND ${ELIGIBLE_SAMPLE} AND(s.observed_at_ms>? OR(s.observed_at_ms=? AND s.seq>?)) ORDER BY s.observed_at_ms,s.seq LIMIT ?`, id, highL, lastAt, lastAt, lastSeq, sampleSize + 1); const gaps = this.many<Data & {
        seq: number;
    }>('SELECT seq,data FROM rr_gaps WHERE seq>? AND seq<=? AND start_at_ms<=? AND(end_at_ms IS NULL OR end_at_ms>=?) ORDER BY seq LIMIT ?', afterG, highG, r.endAtMs.status === 'known' ? r.endAtMs.value : Number.MAX_SAFE_INTEGER, r.startAtMs, gapSize + 1); const selected = all.slice(0, sampleSize), gs = gaps.slice(0, gapSize), last = selected[selected.length - 1], gLast = gs[gs.length - 1]; return { samples: selected.map(s => ({ observationId: s.id, observedAtMs: s.observed_at_ms, batteryPercent: s.battery_percent })), gaps: gs.map(row => { const g = JSON.parse(row.data) as Gap; return { startAtMs: g.startAtMs, endAtMs: g.endAtMs === null ? { status: 'unknown' } : { status: 'known', value: g.endAtMs }, reason: g.reason }; }), next: all.length > sampleSize || gaps.length > gapSize ? ['s1', id, highL, last?.observed_at_ms ?? lastAt, last?.seq ?? lastSeq, highG, gLast?.seq ?? afterG].join('.') : null }; }
    loadCheckpoint(): Checkpoint | undefined { this.identity(); return this.read('SELECT data FROM rr_checkpoint WHERE singleton=1'); }
    saveCheckpoint(c: Checkpoint): void { this.write(); integer(c.generation); if ((c.lastObservationId === null) !== (c.lastObservedAtMs === null))
        refuse('invalid-request'); if (c.lastObservationId !== null) {
        const o = this.getObservation(c.lastObservationId);
        if (!o || o.observedAtMs !== c.lastObservedAtMs || o.generation !== c.generation)
            refuse('invalid-state');
    } if (c.activeEpisodeId !== null && !this.getEpisode(c.activeEpisodeId))
        refuse('invalid-state'); const old = this.loadCheckpoint(); if (old && c.generation < old.generation)
        refuse('invalid-state'); this.run('INSERT INTO rr_checkpoint VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET data=excluded.data', json(c)); }
    saveMapCapture(c: MapCapture, bytes?: Uint8Array): string | null { this.write(); identifier(c.id); integer(c.generation); integer(c.requestAtMs); integer(c.responseAtMs); if (c.responseAtMs < c.requestAtMs || c.association !== 'unverified' || (c.candidateRunId !== null && !this.getRun(c.candidateRunId)))
        refuse('invalid-request'); for (const n of [c.mapIndex, c.mapSequence])
        if (n !== null && integer(n) > 0xffffffff)
            refuse('invalid-request'); if (!Array.isArray(c.reasons) || c.reasons.length < 1 || c.reasons.length > REASONS.length || c.reasons.some(r => !REASONS.includes(r)))
        refuse('invalid-request'); for (const [ids, before] of [[c.preObservationIds, true], [c.postObservationIds, false]] as const) {
        if (!Array.isArray(ids) || ids.length > 4)
            refuse('invalid-request');
        for (const id of ids) {
            const o = this.getObservation(id);
            if (!o || o.generation !== c.generation || (o.operation !== 'status' && o.operation !== 'summary') || (before ? o.observedAtMs > c.requestAtMs : o.observedAtMs < c.responseAtMs))
                refuse('invalid-state');
        }
    } let digest: string | null = null; if (bytes !== undefined) {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_MAP)
            refuse('invalid-request');
        digest = hash(bytes);
    }
    else if (!c.reasons.includes('capture-failed'))
        refuse('invalid-request'); const data = json(c), old = this.one<Data & {
        blob_hash: string | null;
    }>('SELECT data,blob_hash FROM rr_map_captures WHERE id=?', c.id); if (old) {
        same(old.data, data);
        if (old.blob_hash !== digest)
            refuse('invalid-state');
        return digest;
    } if (digest !== null && bytes !== undefined) {
        const existing = this.one<{
            bytes: Uint8Array;
        }>('SELECT bytes FROM rr_map_blobs WHERE hash=?', digest);
        if (existing && !Buffer.from(existing.bytes).equals(Buffer.from(bytes)))
            refuse('invalid-state');
        this.run('INSERT OR IGNORE INTO rr_map_blobs VALUES(?,?)', digest, bytes);
    } this.run('INSERT INTO rr_map_captures(id,candidate_run_id,blob_hash,data) VALUES(?,?,?,?)', c.id, c.candidateRunId, digest, data); return digest; }
    appendMapReason(id: string, at: number, reason: MapReason): void { this.write(); integer(at); if (!REASONS.includes(reason) || !this.getMapCapture(id))
        refuse('invalid-request'); this.run('INSERT OR IGNORE INTO rr_map_checks(capture_id,at_ms,reason) VALUES(?,?,?)', id, at, reason); }
    getMapCapture(id: string): StoredMapCapture | undefined { this.identity(); identifier(id); const row = this.one<Data & {
        blob_hash: string | null;
    }>('SELECT data,blob_hash FROM rr_map_captures WHERE id=?', id); if (!row)
        return undefined; const c = JSON.parse(row.data) as MapCapture, checks = this.many<{
        reason: MapReason;
    }>('SELECT DISTINCT reason FROM rr_map_checks WHERE capture_id=? ORDER BY reason', id); return { ...c, association: 'unverified', reasons: [...new Set([...c.reasons, ...checks.map(r => r.reason), ...(c.candidateRunId !== null && this.conflictingRunWindow(c.candidateRunId) ? ['ambiguous-window' as const] : [])])], blobHash: row.blob_hash }; }
    listMapCaptures(id: number, after = 0, size = 25): {
        sequence: number;
        capture: StoredMapCapture;
    }[] { this.identity(); integer(id, 1); integer(after); limit(size, 25); return this.many<{
        seq: number;
        id: string;
    }>('SELECT seq,id FROM rr_map_captures WHERE candidate_run_id=? AND seq>? ORDER BY seq LIMIT ?', id, after, size).map(r => ({ sequence: r.seq, capture: present(this.getMapCapture(r.id)) })); }
    readMapBlob(digest: string): Buffer | undefined { this.identity(); if (!/^[a-f0-9]{64}$/u.test(digest))
        refuse('invalid-request'); const row = this.one<{
        bytes: Uint8Array;
    }>('SELECT bytes FROM rr_map_blobs WHERE hash=?', digest); return row ? Buffer.from(row.bytes) : undefined; }
    counts(): Counts { this.identity(); return present(this.one<Counts>(`SELECT (SELECT COUNT(*) FROM rr_observations)AS observations,(SELECT COUNT(*) FROM rr_runs)AS runs,(SELECT COUNT(*) FROM rr_samples)AS samples,((SELECT COUNT(*) FROM rr_samples)-(SELECT COUNT(*) FROM rr_samples s JOIN rr_runs r ON r.record_id=s.run_id JOIN rr_episodes e ON e.id=s.episode_id WHERE ${ELIGIBLE_SAMPLE}))AS unattachedSamples,(SELECT COUNT(*) FROM rr_episodes)AS episodes,(SELECT COUNT(*) FROM rr_gaps)AS gaps,(SELECT COUNT(*) FROM rr_queue WHERE pending=1)AS queuedRecords,(SELECT COUNT(*) FROM rr_map_blobs)AS mapBlobs,(SELECT COUNT(*) FROM rr_map_captures)AS mapCaptures`)); }
    beginRecovery(generation: number): void {
        this.write();
        integer(generation, 1);
        // A retry retains the original fence. Gaps created by this generation
        // are excluded from its prior-process recovery pass.
        this.run(`INSERT OR IGNORE INTO rr_gap_recovery
     (generation,high,after_seq,recovered_at) VALUES(?,?,0,NULL)`, generation, this.maximum('rr_gaps'));
    }
    markSuccessfulStatus(generation: number, at: number): void {
        this.write();
        integer(generation, 1);
        integer(at);
        if (this.one('SELECT 1 FROM rr_gap_recovery WHERE generation=?', generation) === undefined) {
            refuse('invalid-state');
        }
        this.run(`UPDATE rr_gap_recovery SET recovered_at=?
     WHERE generation=? AND recovered_at IS NULL`, at, generation);
    }
    loadEpisodeRecoveryCursor(): number {
        this.identity();
        const row = this.one<{
            value: string;
        }>("SELECT value FROM rr_meta WHERE key='episode-recovery-after'");
        if (row === undefined)
            return 0;
        const value = Number(row.value);
        if (!Number.isSafeInteger(value) || value < 0 || String(value) !== row.value) {
            refuse('invalid-state');
        }
        return value;
    }
    saveEpisodeRecoveryCursor(after: number): void {
        this.write();
        integer(after);
        this.run(`INSERT INTO rr_meta(key,value) VALUES('episode-recovery-after',?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(after));
    }
    hasHistoricalEpisodes(generation: number): boolean {
        this.identity();
        integer(generation, 1);
        return this.one(`SELECT 1 FROM rr_episodes
     WHERE json_extract(data,'$.runId') IS NULL
       AND (json_extract(data,'$.generation')<? OR (json_extract(data,'$.generation')=? AND json_extract(data,'$.terminal.observedAtMs') IS NOT NULL))
     LIMIT 1`, generation, generation) !== undefined;
    }
    listUnresolvedEpisodes(generation: number, after = 0, size = 25): EpisodeRecoveryItem[] {
        this.identity();
        integer(generation, 1);
        integer(after);
        limit(size, 25);
        return this.many<Data & {
            seq: number;
        }>(`SELECT seq,data FROM rr_episodes
     WHERE json_extract(data,'$.runId') IS NULL
       AND (json_extract(data,'$.generation')<? OR (json_extract(data,'$.generation')=? AND json_extract(data,'$.terminal.observedAtMs') IS NOT NULL))
       AND seq>?
     ORDER BY seq LIMIT ?`, generation, generation, after, size).map(row => ({
            sequence: row.seq,
            episode: JSON.parse(row.data) as Episode,
        }));
    }
    findRunsOverlappingEpisode(id: string, size = 25): RunCandidates {
        this.identity();
        identifier(id);
        limit(size, 25);
        const episode = this.getEpisode(id);
        if (episode === undefined)
            refuse('invalid-request');
        const rows = this.many<Data & {
            seq: number;
        }>(`SELECT seq,data FROM rr_runs
     WHERE begin_at_ms<=?
       AND(end_at_ms IS NULL OR end_at_ms>=?)
     ORDER BY seq LIMIT ?`, episode.lastObservedAtMs, episode.startAtMs, size);
        const last = rows.at(-1);
        const overflow = last !== undefined && this.one(`SELECT 1 FROM rr_runs
     WHERE begin_at_ms<=?
       AND(end_at_ms IS NULL OR end_at_ms>=?)
       AND seq>?
     LIMIT 1`, episode.lastObservedAtMs, episode.startAtMs, last.seq) !== undefined;
        return {
            runs: rows.map(row => JSON.parse(row.data) as RunRecord),
            overflow,
        };
    }
    runWindowConflicts(id: number): boolean {
        this.identity();
        integer(id, 1);
        return this.conflictingRunWindow(id);
    }
    /**
     * Closure is supported by the explicit record, not an invented terminal
     * observation. A conservative sample-attachment refusal retains runId=null.
     */
    reconcileHistoricalEpisode(episodeId: string, recordId: number, generation: number, checkedAt: number): {
        resolved: boolean;
        attached: boolean;
    } {
        this.write();
        identifier(episodeId);
        integer(recordId, 1);
        integer(generation, 1);
        integer(checkedAt);
        const no = { resolved: false, attached: false };
        const episode = this.getEpisode(episodeId);
        const run = this.getRun(recordId);
        if (episode === undefined || run === undefined
            || episode.generation > generation
            || (episode.generation === generation && episode.terminal === undefined)
            || episode.runId !== null
            || run.recordId * 1000 !== run.startAtMs
            || run.complete.status !== 'known' || run.complete.value !== 1
            || run.endAtMs.status !== 'known'
            || run.endAtMs.value > checkedAt
            || episode.startAtMs < run.startAtMs
            || episode.lastObservedAtMs > run.endAtMs.value
            || (episode.terminal !== undefined && run.endAtMs.value > episode.terminal.observedAtMs)
            || (episode.endAtMs !== null && episode.endAtMs !== run.endAtMs.value)
            || this.conflictingRunWindow(recordId))
            return no;
        // Actual overlapping positive observation windows are ambiguous.
        // An older unknown end is still handled conservatively by attachEpisode.
        if (this.one(`SELECT 1 FROM rr_episodes
     WHERE id<>? AND start_at_ms<=?
       AND json_extract(data,'$.lastObservedAtMs')>=?
     LIMIT 1`, episodeId, episode.lastObservedAtMs, episode.startAtMs) !== undefined)
            return no;
        this.putEpisode({ ...episode, endAtMs: run.endAtMs.value });
        const attachment = this.attachEpisode({
            episodeId,
            recordId,
            startAtMs: run.startAtMs,
            endAtMs: run.endAtMs.value,
            externallyValidated: true,
        });
        return { resolved: true, attached: attachment.attached };
    }
    listOpenUnavailableGaps(after: number, through: number, size = 100): {
        sequence: number;
        gap: Gap;
    }[] {
        this.identity();
        integer(after);
        integer(through);
        limit(size, 100);
        if (after > through)
            refuse('invalid-request');
        return this.many<Data & {
            seq: number;
        }>(`SELECT seq,data FROM rr_gaps
     WHERE end_at_ms IS NULL AND reason='unavailable'
       AND seq>? AND seq<=?
     ORDER BY seq LIMIT ?`, after, through, size).map(row => ({
            sequence: row.seq,
            gap: JSON.parse(row.data) as Gap,
        }));
    }
    hasGapRecoveryWork(): boolean {
        this.identity();
        return this.pendingGapRecovery() !== undefined;
    }
    /**
     * One page per call. Earlier unfinished generations retain their first
     * successful recovery instant, including across a subsequent restart.
     */
    recoverOpenGaps(size = 100): {
        closed: number;
        incompatible: number;
    } {
        this.write();
        limit(size, 100);
        const pass = this.pendingGapRecovery();
        if (pass === undefined)
            return { closed: 0, incompatible: 0 };
        const at = pass.recovery_at;
        if (at === null)
            refuse('invalid-state');
        if (pass.recovered_at === null) {
            this.run('UPDATE rr_gap_recovery SET recovered_at=? WHERE generation=?', at, pass.generation);
        }
        const page = this.listOpenUnavailableGaps(pass.after_seq, pass.high, size);
        let closed = 0;
        let incompatible = 0;
        for (const { gap } of page) {
            if (gap.startAtMs > at) {
                // Retain the open original when the clock evidence cannot support closure.
                incompatible += 1;
                continue;
            }
            this.closeGap(gap.id, at);
            closed += 1;
        }
        const last = page.at(-1);
        this.run('UPDATE rr_gap_recovery SET after_seq=? WHERE generation=?', last === undefined ? pass.high : last.sequence, pass.generation);
        return { closed, incompatible };
    }
    private pendingGapRecovery(): GapRecoveryRow | undefined {
        return this.one<GapRecoveryRow>(`SELECT p.generation,p.high,p.after_seq,p.recovered_at,
       COALESCE(p.recovered_at,(
         SELECT later.recovered_at FROM rr_gap_recovery later
         WHERE later.generation>p.generation
           AND later.recovered_at IS NOT NULL
         ORDER BY later.generation LIMIT 1
       )) AS recovery_at
     FROM rr_gap_recovery p
     WHERE p.after_seq<p.high
       AND(p.recovered_at IS NOT NULL OR EXISTS(
         SELECT 1 FROM rr_gap_recovery later
         WHERE later.generation>p.generation
           AND later.recovered_at IS NOT NULL
       ))
     ORDER BY p.generation LIMIT 1`);
    }
    private mergeRunFields(incoming: RunRecord, previous: RunRecord | undefined): Pick<RunRecord, RunField> {
        const selected = {} as Record<RunField, Value<number>>;
        for (const field of RUN_FIELDS) {
            const prior = previous?.[field];
            if (prior?.status === 'known')
                this.run('INSERT OR IGNORE INTO rr_run_fields VALUES(?,?,?,?)', incoming.recordId, field, present(previous).observedAtMs, json(prior));
            let existing = this.one<Data & {
                observed_at_ms: number;
            }>('SELECT observed_at_ms,data FROM rr_run_fields WHERE record_id=? AND field=?', incoming.recordId, field);
            const value = incoming[field];
            if (value.status === 'known') {
                if (field === 'endAtMs' && existing) {
                    const retained = JSON.parse(existing.data) as Value<number>;
                    if (retained.status === 'known' && retained.value !== value.value)
                        this.run(`INSERT INTO rr_run_conflicts VALUES(?,'conflicting-end',?) ON CONFLICT(record_id) DO UPDATE SET observed_at_ms=MAX(rr_run_conflicts.observed_at_ms,excluded.observed_at_ms)`, incoming.recordId, incoming.observedAtMs);
                }
                // Equal-time conflicts retain the established value; all inputs stay in the version archive.
                if (!existing || incoming.observedAtMs > existing.observed_at_ms) {
                    const data = json(value);
                    this.run('INSERT INTO rr_run_fields VALUES(?,?,?,?) ON CONFLICT(record_id,field) DO UPDATE SET observed_at_ms=excluded.observed_at_ms,data=excluded.data', incoming.recordId, field, incoming.observedAtMs, data);
                    existing = { observed_at_ms: incoming.observedAtMs, data };
                }
            }
            selected[field] = existing ? JSON.parse(existing.data) as Value<number> : { status: 'unknown' };
        }
        return selected;
    }
    private conflictingRunWindow(id: number): boolean {
        return this.one('SELECT 1 FROM rr_run_conflicts WHERE record_id=?', id) !== undefined || this.one(`SELECT 1 FROM rr_runs r JOIN rr_runs other ON other.record_id<>r.record_id WHERE r.record_id=? AND r.end_at_ms IS NOT NULL AND other.begin_at_ms<=r.end_at_ms AND(other.end_at_ms IS NULL OR other.end_at_ms>=r.begin_at_ms) LIMIT 1`, id) !== undefined;
    }
    private runView(r: RunRecord): RunRecord {
        const count = present(this.one<{
            n: number;
        }>(`SELECT COUNT(*)AS n FROM rr_samples s JOIN rr_runs r ON r.record_id=s.run_id JOIN rr_episodes e ON e.id=s.episode_id WHERE s.run_id=? AND ${ELIGIBLE_SAMPLE}`, r.recordId)).n;
        return { ...r, battery: { availability: count > 0 ? 'partial' : 'missing', samples: count, clock: 'unqualified' }, map: r.map.availability === 'unverified' && this.conflictingRunWindow(r.recordId) ? { ...r.map, reason: 'ambiguous-window' } : r.map };
    }
    private storeEpisode(e: Episode): void { const data = json(e); this.run('INSERT INTO rr_episodes(id,start_at_ms,end_at_ms,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET end_at_ms=excluded.end_at_ms,data=excluded.data', e.id, e.startAtMs, e.endAtMs, data); this.run('INSERT OR IGNORE INTO rr_episode_versions(episode_id,digest,data) VALUES(?,?,?)', e.id, hash(data), data); }
    private write(): void { if (!this.database.isTransaction)
        refuse('invalid-state'); this.identity(); }
    private maximum(table: 'rr_runs' | 'rr_sample_links' | 'rr_gaps'): number { const n = present(this.one<{
        n: number;
    }>(`SELECT COALESCE(MAX(seq),0) AS n FROM ${table}`)).n; if (!Number.isSafeInteger(n) || n < 0 || n >= Number.MAX_SAFE_INTEGER)
        refuse('invalid-state'); return n; }
    private read<T>(sql: string, ...args: SQLInputValue[]): T | undefined { const row = this.one<Data>(sql, ...args); return row ? JSON.parse(row.data) as T : undefined; }
    private one<T = unknown>(sql: string, ...args: SQLInputValue[]): T | undefined { return this.database.prepare(sql).get(...args) as unknown as T | undefined; }
    private many<T>(sql: string, ...args: SQLInputValue[]): T[] { return this.database.prepare(sql).all(...args) as unknown as T[]; }
    private run(sql: string, ...args: SQLInputValue[]): number { return Number(this.database.prepare(sql).run(...args).changes); }
}
