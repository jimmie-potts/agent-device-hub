import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { emptySnapshot, validateSnapshot, type Snapshot } from '@jimmie-potts/wispr-contracts';
import { aggregate, contribution, type Contribution } from './numeric.js';
import type { SourceRow } from './reader-types.js';

export const MAX_STORE_BYTES = 1024 * 1024 * 1024;
type Metadata = {
  format: 1; namespace: string; sourceIdentity: string; timezone: string; generation: string;
  revision: number; captureAfter: number | null; snapshot: Snapshot; pending: boolean;
};
export type StoreOptions = { directory: string; namespace: string; sourceIdentity: string; timezone: string };

/** Private storage core. The CLI must hold the owner lease and qualify paths/ACLs before opening. */
export class NumericStore {
  private readonly db: DatabaseSync;
  constructor(options: StoreOptions) {
    this.db = new DatabaseSync(join(options.directory, 'analytics.sqlite'), { timeout: 1000, allowExtension: false });
    try {
      this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF');
      const pageSize = this.db.prepare('PRAGMA page_size').get()!.page_size as number;
      this.db.exec(`PRAGMA max_page_count=${Math.floor(MAX_STORE_BYTES/pageSize)}`);
      this.db.exec('CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS contributions(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,value TEXT NOT NULL,archived INTEGER NOT NULL CHECK(archived IN (0,1)))');
      const existing = this.db.prepare("SELECT value FROM metadata WHERE key='state'").get();
      if (existing) {
        const meta = this.metadata();
        if (meta.namespace !== options.namespace || meta.sourceIdentity !== options.sourceIdentity) throw new Error('binding-mismatch');
        if (meta.timezone !== options.timezone) throw new Error('zone-change-required');
      } else {
        const generation=randomUUID();
        const snapshot=emptySnapshot({namespace:options.namespace,generation,timezone:options.timezone,now:new Date().toISOString()});
        if(!validateSnapshot(snapshot).ok)throw new Error('invalid-store-config');
        this.save({format:1,namespace:options.namespace,sourceIdentity:options.sourceIdentity,timezone:options.timezone,generation,revision:0,captureAfter:null,snapshot,pending:false});
      }
    } catch(error) { this.db.close();throw error; }
  }

  private metadata(): Metadata {
    const row=this.db.prepare("SELECT value FROM metadata WHERE key='state'").get();
    if(!row||typeof row.value!=='string')throw new Error('invalid-store');
    const value=JSON.parse(row.value) as Metadata;
    if(value.format!==1||!validateSnapshot(value.snapshot).ok||value.revision!==value.snapshot.revision||value.generation!==value.snapshot.generation)throw new Error('invalid-store');
    return value;
  }
  private save(value: Metadata): void {
    this.db.prepare("INSERT INTO metadata(key,value) VALUES('state',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
  }
  private *contributions(): Iterable<Contribution> {
    for(const row of this.db.prepare('SELECT value,archived FROM contributions ORDER BY id').iterate()){
      const value=JSON.parse(row.value as string) as Contribution;
      yield {...value,archived:row.archived===1};
    }
  }
  private transaction<T>(body:()=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const result=body();
      const pages=this.db.prepare('PRAGMA page_count').get()!.page_count as number;
      const size=this.db.prepare('PRAGMA page_size').get()!.page_size as number;
      if(pages*size>MAX_STORE_BYTES)throw new Error('store-capacity');
      this.db.exec('COMMIT');return result;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  snapshot(): Snapshot { return this.metadata().snapshot; }
  pending(): Snapshot | null {const meta=this.metadata();return meta.pending?meta.snapshot:null;}

  /** Only call after a complete qualified read. A rejected scan must never call this method. */
  ingest(rows: SourceRow[], observedAt: string): Snapshot {
    return this.transaction(()=>{
      const meta=this.metadata();
      if(meta.pending)throw new Error('publication-pending');
      const ids=new Set<string>();
      for(const row of rows){if(ids.has(row.id))throw new Error('duplicate-source-id');ids.add(row.id);}
      this.db.exec('UPDATE contributions SET archived=1 WHERE archived=0');
      const upsert=this.db.prepare('INSERT INTO contributions(id,fingerprint,value,archived) VALUES(?,?,?,0) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,value=excluded.value,archived=0');
      for(const row of rows){const value=contribution(row,meta.captureAfter);upsert.run(value.id,value.fingerprint,JSON.stringify(value));}
      const snapshot=aggregate(this.contributions(),{namespace:meta.namespace,generation:meta.generation,revision:meta.revision+1,timezone:meta.timezone,now:observedAt,gaps:meta.snapshot.coverage.gaps});
      this.save({...meta,revision:snapshot.revision,snapshot,pending:true});
      return snapshot;
    });
  }
  markPublished(revision: number): void {
    this.transaction(()=>{
      const meta=this.metadata();
      if(meta.revision!==revision)throw new Error('revision-mismatch');
      this.save({...meta,pending:false});
    });
  }
  rebuildZone(timezone: string, generatedAt: string): Snapshot {
    return this.transaction(()=>{
      const meta=this.metadata();if(meta.pending)throw new Error('publication-pending');
      const snapshot=aggregate(this.contributions(),{namespace:meta.namespace,generation:meta.generation,revision:meta.revision+1,timezone,now:generatedAt,gaps:meta.snapshot.coverage.gaps});
      snapshot.lastSuccessAt=meta.snapshot.lastSuccessAt;
      if(!validateSnapshot(snapshot).ok)throw new Error('invalid-zone-rebuild');
      this.save({...meta,timezone,revision:snapshot.revision,snapshot,pending:true});return snapshot;
    });
  }
  close():void {this.db.close();}
}
