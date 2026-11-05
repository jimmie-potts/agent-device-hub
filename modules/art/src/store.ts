// The module's private SQLite store (ADR 0012: each module saves only the state it owns). A job row is durable before any
// provider call. Bytes live in `art_blobs`, keyed by their SHA-256, so they commit with the rows that refer to them and
// two compositions with one image share one copy. Records are JSON beside the columns the queries need.
import type {DatabaseSync} from 'node:sqlite';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {ArtAdmission, ArtComposition, ArtDisplayTarget, ArtFeedback, ArtOutcome, ArtPurpose, ArtReason, ArtTarget, ArtTargetOutcome} from '@jimmie-potts/event-contracts/v2/art-state';

export type JobTarget = {target: ArtTarget; outcome: ArtTargetOutcome; code: ErrorCode | null; reason: ArtReason | null; compositionId: string | null};
/** What a prompt may hold: the owner's text, imagination, time, season and weather condition words. */
export type PromptContext = {imagination: string; time: string; season: string} & (
  | {weather: null; weatherSource: 'none'}
  | {weather: string; weatherSource: 'request'}
  | {weather: string; weatherSource: 'observation'; weatherStaleAtMs: number}
);
export type Job = {
  requestId: string; artworkId: string; purpose: ArtPurpose; origin: {kind: 'owner' | 'schedule' | 'weather'; reference?: string};
  /** From the command family that admitted the job, never from its payload. */
  admittedBy: ArtAdmission;
  text: string | null; context: PromptContext; targets: JobTarget[]; variationOf: string | null;
  status: 'queued' | 'running' | 'finished'; cancelRequested: boolean; outcome: ArtOutcome | null; idea: string | null; traceparent: string; createdAtMs: number; finishedAtMs: number | null;
};
export type StoredComposition = ArtComposition & {compositionId: string; promptHash: string | null; originalId: string | null; gif: 'accepted' | 'rejected' | null};
export type Artwork = {artworkId: string; requestId: string; createdAtMs: number; favorite: boolean; feedback: ArtFeedback | null; variationOf: string | null; palette: string[]; generatedBy: 'openai' | 'local'; deletedAtMs: number | null};
export type StageStatus = 'pending' | 'succeeded' | 'failed' | 'uncertain';
export type StageRow = {requestId: string; artworkId: string; compositionId: string; target: ArtDisplayTarget; status: StageStatus; expiresAtMs: number | null; ambient: boolean};
export type IssuedAmbient = {requestId: string} & ({stageRequestId: string; artworkId: string} | {stageRequestId: null; artworkId: null});

const json = <T>(row: unknown): T => JSON.parse((row as {record: string}).record) as T;
export class ArtStore {
  constructor(readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS art_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,gifs_accepted INTEGER NOT NULL,gifs_rejected INTEGER NOT NULL) STRICT;
      INSERT OR IGNORE INTO art_meta VALUES(1,0,0,0);
      CREATE TABLE IF NOT EXISTS art_receipts(request_id TEXT PRIMARY KEY,digest TEXT NOT NULL,at_ms INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS art_jobs(request_id TEXT PRIMARY KEY,artwork_id TEXT NOT NULL,status TEXT NOT NULL,created_at_ms INTEGER NOT NULL,record TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS art_jobs_artwork ON art_jobs(artwork_id);
      CREATE TABLE IF NOT EXISTS art_calls(call_id TEXT PRIMARY KEY,request_id TEXT NOT NULL,target TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,admitted_by TEXT NOT NULL,
        month TEXT NOT NULL,day TEXT NOT NULL,reserved_at_ms INTEGER NOT NULL,dispatched_at_ms INTEGER,reserved_micros INTEGER NOT NULL,cost_micros INTEGER,price_key TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS art_calls_month ON art_calls(provider,month);
      CREATE TABLE IF NOT EXISTS art_artworks(artwork_id TEXT PRIMARY KEY,created_at_ms INTEGER NOT NULL,favorite INTEGER NOT NULL,deleted INTEGER NOT NULL,record TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS art_compositions(artwork_id TEXT NOT NULL,target TEXT NOT NULL,composition_id TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(artwork_id,target)) STRICT;
      CREATE INDEX IF NOT EXISTS art_compositions_id ON art_compositions(composition_id);
      CREATE TABLE IF NOT EXISTS art_blobs(id TEXT PRIMARY KEY,type TEXT NOT NULL,bytes BLOB NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS art_stages(request_id TEXT PRIMARY KEY,artwork_id TEXT NOT NULL,composition_id TEXT NOT NULL,target TEXT NOT NULL,status TEXT NOT NULL,expires_at_ms INTEGER,ambient INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS art_ambient(id INTEGER PRIMARY KEY CHECK(id=1),request_id TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS art_ambient_issued(id INTEGER PRIMARY KEY CHECK(id=1),record TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS art_feedback(id INTEGER PRIMARY KEY AUTOINCREMENT,artwork_id TEXT NOT NULL,signal TEXT NOT NULL,at_ms INTEGER NOT NULL) STRICT;`);
  }
  revision(): number {return (this.db.prepare('SELECT revision FROM art_meta').get() as {revision: number}).revision;}
  bump(): number {this.db.prepare('UPDATE art_meta SET revision=revision+1').run(); return this.revision();}
  gifs(): {accepted: number; rejected: number} {
    const row = this.db.prepare('SELECT gifs_accepted AS accepted,gifs_rejected AS rejected FROM art_meta').get() as {accepted: number; rejected: number};
    return {accepted: row.accepted, rejected: row.rejected};
  }
  countGif(accepted: boolean): void {this.db.prepare(`UPDATE art_meta SET ${accepted ? 'gifs_accepted=gifs_accepted+1' : 'gifs_rejected=gifs_rejected+1'}`).run();}

  receipt(requestId: string): string | undefined {return (this.db.prepare('SELECT digest FROM art_receipts WHERE request_id=?').get(requestId) as {digest: string} | undefined)?.digest;}
  remember(requestId: string, digest: string, atMs: number): void {this.db.prepare('INSERT INTO art_receipts VALUES(?,?,?)').run(requestId, digest, atMs);}

  job(requestId: string): Job | undefined {const row = this.db.prepare('SELECT record FROM art_jobs WHERE request_id=?').get(requestId); return row === undefined ? undefined : json<Job>(row);}
  jobOfArtwork(artworkId: string): Job | undefined {const row = this.db.prepare('SELECT record FROM art_jobs WHERE artwork_id=?').get(artworkId); return row === undefined ? undefined : json<Job>(row);}
  saveJob(job: Job): void {
    this.db.prepare('INSERT INTO art_jobs VALUES(?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET status=excluded.status,record=excluded.record').run(job.requestId, job.artworkId, job.status, job.createdAtMs, JSON.stringify(job));
  }
  unfinished(): Job[] {return this.db.prepare("SELECT record FROM art_jobs WHERE status<>'finished' ORDER BY created_at_ms,request_id").all().map(row => json<Job>(row));}
  recentJobs(limit: number): Job[] {return this.db.prepare('SELECT record FROM art_jobs ORDER BY created_at_ms DESC,rowid DESC LIMIT ?').all(limit).map(row => json<Job>(row));}
  pendingJobs(): number {return (this.db.prepare("SELECT COUNT(*) AS jobs FROM art_jobs WHERE status<>'finished'").get() as {jobs: number}).jobs;}

  artwork(artworkId: string): Artwork | undefined {const row = this.db.prepare('SELECT record FROM art_artworks WHERE artwork_id=?').get(artworkId); return row === undefined ? undefined : json<Artwork>(row);}
  saveArtwork(artwork: Artwork): void {
    this.db.prepare('INSERT INTO art_artworks VALUES(?,?,?,?,?) ON CONFLICT(artwork_id) DO UPDATE SET favorite=excluded.favorite,deleted=excluded.deleted,record=excluded.record')
      .run(artwork.artworkId, artwork.createdAtMs, artwork.favorite ? 1 : 0, artwork.deletedAtMs === null ? 0 : 1, JSON.stringify(artwork));
  }
  /** Saved artworks a viewer may see, newest first. */
  artworks(after: number, limit: number): {artworks: Artwork[]; nextAfter: number | null} {
    const rows = this.db.prepare('SELECT rowid AS position,record FROM art_artworks WHERE deleted=0 AND (?=0 OR rowid<?) ORDER BY rowid DESC LIMIT ?').all(after, after, limit + 1) as {position: number; record: string}[];
    const page = rows.slice(0, limit);
    return {artworks: page.map(row => json<Artwork>(row)), nextAfter: rows.length > limit ? page.at(-1)?.position ?? null : null};
  }
  counts(): {recent: number; favorites: number} {
    const row = this.db.prepare('SELECT COALESCE(SUM(favorite=0),0) AS recent,COALESCE(SUM(favorite=1),0) AS favorites FROM art_artworks WHERE deleted=0').get() as {recent: number; favorites: number};
    return {recent: row.recent, favorites: row.favorites};
  }
  /** Unsaved art past the recent limit, oldest first. References are the caller's to check. */
  pruneCandidates(recentLimit: number): Artwork[] {
    return this.db.prepare('SELECT record FROM art_artworks WHERE favorite=0 AND deleted=0 ORDER BY created_at_ms DESC,rowid DESC LIMIT -1 OFFSET ?').all(recentLimit).map(row => json<Artwork>(row)).reverse();
  }
  deletedArtworks(): Artwork[] {return this.db.prepare('SELECT record FROM art_artworks WHERE deleted=1').all().map(row => json<Artwork>(row));}

  compositions(artworkId: string): StoredComposition[] {return this.db.prepare('SELECT record FROM art_compositions WHERE artwork_id=? ORDER BY target').all(artworkId).map(row => json<StoredComposition>(row));}
  composition(compositionId: string): {artworkId: string; composition: StoredComposition} | undefined {
    const row = this.db.prepare('SELECT artwork_id,record FROM art_compositions WHERE composition_id=? ORDER BY rowid DESC LIMIT 1').get(compositionId) as {artwork_id: string; record: string} | undefined;
    return row === undefined ? undefined : {artworkId: row.artwork_id, composition: json<StoredComposition>(row)};
  }
  saveComposition(artworkId: string, composition: StoredComposition): void {
    this.db.prepare('INSERT INTO art_compositions VALUES(?,?,?,?) ON CONFLICT(artwork_id,target) DO UPDATE SET composition_id=excluded.composition_id,record=excluded.record').run(artworkId, composition.target, composition.compositionId, JSON.stringify(composition));
  }

  blob(id: string): {type: string; bytes: Uint8Array} | undefined {return this.db.prepare('SELECT type,bytes FROM art_blobs WHERE id=?').get(id) as {type: string; bytes: Uint8Array} | undefined;}
  saveBlob(id: string, type: string, bytes: Uint8Array): void {this.db.prepare('INSERT OR IGNORE INTO art_blobs VALUES(?,?,?)').run(id, type, bytes);}
  /** Removes an artwork's rows, then each of its blobs that no remaining composition refers to. */
  purge(artworkId: string): void {
    const blobs = this.compositions(artworkId).flatMap(composition => [composition.originalId, ...composition.renditions.map(rendition => rendition.renditionId)]);
    this.db.prepare('DELETE FROM art_compositions WHERE artwork_id=?').run(artworkId);
    this.db.prepare('DELETE FROM art_artworks WHERE artwork_id=?').run(artworkId);
    this.db.prepare('DELETE FROM art_feedback WHERE artwork_id=?').run(artworkId);
    this.db.prepare('DELETE FROM art_stages WHERE artwork_id=?').run(artworkId);
    const others = new Set(this.db.prepare('SELECT record FROM art_compositions').all().map(row => json<StoredComposition>(row)).flatMap(composition => [composition.originalId, ...composition.renditions.map(rendition => rendition.renditionId)]));
    for (const id of blobs) if (id !== null && !others.has(id)) this.db.prepare('DELETE FROM art_blobs WHERE id=?').run(id);
  }

  /** Bounds the rows that outlive their art. The call ledger is never trimmed. */
  trim(keepFinishedJobs: number, receiptsBeforeMs: number): void {
    this.db.prepare("DELETE FROM art_jobs WHERE status='finished' AND artwork_id NOT IN (SELECT artwork_id FROM art_artworks) AND rowid NOT IN (SELECT rowid FROM art_jobs ORDER BY rowid DESC LIMIT ?)").run(keepFinishedJobs);
    this.db.prepare('DELETE FROM art_receipts WHERE at_ms<?').run(receiptsBeforeMs);
  }
  addFeedback(artworkId: string, signal: ArtFeedback, atMs: number): void {this.db.prepare('INSERT INTO art_feedback(artwork_id,signal,at_ms) VALUES(?,?,?)').run(artworkId, signal, atMs);}

  stage(requestId: string): StageRow | undefined {
    const row = this.db.prepare('SELECT * FROM art_stages WHERE request_id=?').get(requestId) as RawStage | undefined;
    return row === undefined ? undefined : toStage(row);
  }
  saveStage(stage: StageRow): void {
    this.db.prepare('INSERT INTO art_stages VALUES(?,?,?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET status=excluded.status,expires_at_ms=excluded.expires_at_ms').run(stage.requestId, stage.artworkId, stage.compositionId, stage.target, stage.status, stage.expiresAtMs, stage.ambient ? 1 : 0);
  }
  /** Copies a device confirmed and that have not expired, soonest-ending last per composition. */
  liveStages(nowMs: number): StageRow[] {
    return (this.db.prepare("SELECT * FROM art_stages WHERE status='succeeded' AND expires_at_ms>? ORDER BY expires_at_ms DESC").all(nowMs) as RawStage[]).map(toStage);
  }
  /** Any stage that may still be holding a device's copy: a live one, one still pending, or one whose fate is unknown. */
  referenced(artworkId: string, nowMs: number): boolean {
    return this.db.prepare("SELECT 1 FROM art_stages WHERE artwork_id=? AND status<>'failed' AND expires_at_ms>? LIMIT 1").get(artworkId, nowMs) !== undefined;
  }
  pendingStages(): StageRow[] {return (this.db.prepare("SELECT * FROM art_stages WHERE status='pending'").all() as RawStage[]).map(toStage);}
  selectAmbient(requestId: string | null): void {
    if (requestId === null) this.db.prepare('DELETE FROM art_ambient').run();
    else this.db.prepare('INSERT INTO art_ambient VALUES(1,?) ON CONFLICT(id) DO UPDATE SET request_id=excluded.request_id').run(requestId);
  }
  /** Last issued tile selection, not evidence that a device displayed it. Renewal does not replace this record. */
  issuedAmbient(): IssuedAmbient | undefined {
    const row = this.db.prepare('SELECT record FROM art_ambient_issued').get();
    return row === undefined ? undefined : json<IssuedAmbient>(row);
  }
  issueAmbient(issued: IssuedAmbient | undefined): void {
    if (issued === undefined) this.db.prepare('DELETE FROM art_ambient_issued').run();
    else this.db.prepare('INSERT INTO art_ambient_issued VALUES(1,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(JSON.stringify(issued));
  }
  /** The selected stage is durable, independent of receipt order or deletion of older rows. */
  ambient(): StageRow | undefined {
    const row = this.db.prepare('SELECT s.* FROM art_stages s JOIN art_ambient a ON a.request_id=s.request_id').get() as RawStage | undefined;
    return row === undefined ? undefined : toStage(row);
  }
}
type RawStage = {request_id: string; artwork_id: string; composition_id: string; target: ArtDisplayTarget; status: StageStatus; expires_at_ms: number | null; ambient: number};
const toStage = (row: RawStage): StageRow => ({requestId: row.request_id, artworkId: row.artwork_id, compositionId: row.composition_id, target: row.target, status: row.status, expiresAtMs: row.expires_at_ms, ambient: row.ambient === 1});
