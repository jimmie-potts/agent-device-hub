import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { emptySnapshot, validateSnapshot, type Snapshot } from '@jimmie-potts/wispr-contracts';
import { aggregate, contribution, validContribution, type Contribution } from './numeric.js';
import type { SourceRow } from './reader-types.js';
import { initializeControl, readControl, writeControl, type Control } from './control.js';

export const MAX_STORE_BYTES = 1024 * 1024 * 1024;
type Metadata = {
  format: 1; namespace: string; sourceIdentity: string; timezone: string; generation: string;
  dataEpoch: string; textEpoch: number; revision: number; captureAfter: number | null; snapshot: Snapshot; pending: boolean;
};
export type StoreOptions = { directory: string; namespace: string; sourceIdentity: string; timezone: string; maxStoreBytes?:number };

/** Private storage core. The CLI must hold the owner lease and qualify paths/ACLs before opening. */
export class NumericStore {
  private readonly db: DatabaseSync;
  private readonly directory: string;
  private readonly maxStoreBytes:number;
  static savedIdentity(directory:string):string|null {
    const path=join(directory,'analytics.sqlite');if(!existsSync(path))return null;
    const db=new DatabaseSync(path,{readOnly:true,allowExtension:false,timeout:1000});
    try{
      const row=db.prepare("SELECT value FROM metadata WHERE key='state'").get();
      if(typeof row?.value!=='string')throw new Error('invalid-store');
      const meta=JSON.parse(row.value);if(typeof meta.sourceIdentity!=='string')throw new Error('invalid-store');return meta.sourceIdentity;
    }finally{db.close();}
  }
  constructor(options: StoreOptions) {
    this.directory=options.directory;
    this.maxStoreBytes=options.maxStoreBytes??MAX_STORE_BYTES;
    if(!Number.isSafeInteger(this.maxStoreBytes)||this.maxStoreBytes<32768||this.maxStoreBytes>MAX_STORE_BYTES)throw new Error('invalid-store-capacity');
    const control=initializeControl(options.directory,options.namespace);
    if(control.namespace!==options.namespace)throw new Error('binding-mismatch');
    this.db = new DatabaseSync(join(options.directory, 'analytics.sqlite'), { timeout: 1000, allowExtension: false });
    try {
      this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA secure_delete=ON; PRAGMA cache_size=-8192');
      const pageSize = this.db.prepare('PRAGMA page_size').get()!.page_size as number;
      this.db.exec(`PRAGMA max_page_count=${Math.floor(this.maxStoreBytes/pageSize)}`);
      this.db.exec('CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS contributions(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,value TEXT NOT NULL,archived INTEGER NOT NULL CHECK(archived IN (0,1)),capture_exempt INTEGER NOT NULL DEFAULT 0 CHECK(capture_exempt IN (0,1))); CREATE TABLE IF NOT EXISTS language(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
      const existing = this.db.prepare("SELECT value FROM metadata WHERE key='state'").get();
      if (existing) {
        const meta = this.metadata();
        if (meta.namespace !== options.namespace || meta.sourceIdentity !== options.sourceIdentity) throw new Error('binding-mismatch');
        if (meta.timezone !== options.timezone) throw new Error('zone-change-required');
      } else {
        const generation=control.generation;
        const snapshot=emptySnapshot({namespace:options.namespace,generation,timezone:options.timezone,now:new Date().toISOString()});
        if(!validateSnapshot(snapshot).ok)throw new Error('invalid-store-config');
        this.save({format:1,namespace:options.namespace,sourceIdentity:options.sourceIdentity,timezone:options.timezone,generation,dataEpoch:control.dataEpoch,textEpoch:control.textEpoch,revision:0,captureAfter:control.captureAfter,snapshot,pending:false});
      }
      this.reconcileControl();
      if(readControl(this.directory).cleanupPending)this.finishCleanup();
    } catch(error) { this.db.close();throw error; }
  }

  private metadata(): Metadata {
    return this.readMetadata(this.db);
  }
  private readMetadata(db: DatabaseSync): Metadata {
    const row=db.prepare("SELECT value FROM metadata WHERE key='state'").get();
    if(!row||typeof row.value!=='string')throw new Error('invalid-store');
    const value=JSON.parse(row.value) as Metadata;
    if(value.format!==1||typeof value.dataEpoch!=='string'||!Number.isSafeInteger(value.textEpoch)||!validateSnapshot(value.snapshot).ok||value.revision!==value.snapshot.revision||value.generation!==value.snapshot.generation)throw new Error('invalid-store');
    return value;
  }
  private save(value: Metadata): void {
    if(!validateSnapshot(value.snapshot).ok)throw new Error('invalid-store-snapshot');
    this.db.prepare("INSERT INTO metadata(key,value) VALUES('state',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
  }
  private *contributions(): Iterable<Contribution> {
    for(const row of this.db.prepare('SELECT value,archived FROM contributions ORDER BY id').iterate()){
      const value=JSON.parse(row.value as string) as Contribution;
      if(!validContribution(value))throw new Error('invalid-contribution');
      yield {...value,archived:row.archived===1};
    }
  }
  private transaction<T>(body:()=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const result=body();
      const pages=this.db.prepare('PRAGMA page_count').get()!.page_count as number;
      const size=this.db.prepare('PRAGMA page_size').get()!.page_size as number;
      if(pages*size>this.maxStoreBytes)throw new Error('store-capacity');
      this.db.exec('COMMIT');return result;
    }catch(error){if(this.db.isTransaction)this.db.exec('ROLLBACK');if((error as {errcode?:number}).errcode===13)throw new Error('store-capacity');throw error;}
  }
  capacity():{bytes:number;limit:number;nearLimit:boolean} {
    const bytes=Number(this.db.prepare('PRAGMA page_count').get()!.page_count)*Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
    return {bytes,limit:this.maxStoreBytes,nearLimit:bytes>=this.maxStoreBytes*0.9};
  }
  private reconcileControl(): void {
    const control=readControl(this.directory),meta=this.metadata();
    if(meta.namespace!==control.namespace)throw new Error('binding-mismatch');
    if(meta.generation===control.generation&&meta.dataEpoch===control.dataEpoch&&meta.textEpoch===control.textEpoch)return;
    this.transaction(()=>{
      const all=meta.dataEpoch!==control.dataEpoch;
      if(all)this.db.exec('DELETE FROM contributions');
      this.db.exec('DELETE FROM language');
      const revision=Math.max(meta.revision+1,control.revisionFloor);
      const snapshot=all?emptySnapshot({namespace:meta.namespace,generation:control.generation,now:control.changedAt,timezone:meta.timezone}):aggregate(this.contributions(),{namespace:meta.namespace,generation:control.generation,revision,timezone:meta.timezone,now:control.changedAt,gaps:meta.snapshot.coverage.gaps});
      snapshot.revision=revision;snapshot.lastSuccessAt=meta.snapshot.lastSuccessAt;
      this.save({...meta,dataEpoch:control.dataEpoch,textEpoch:control.textEpoch,generation:control.generation,captureAfter:control.captureAfter,revision,snapshot,pending:true});
    });
  }
  snapshot(): Snapshot { return this.metadata().snapshot; }
  pending(): Snapshot | null {const meta=this.metadata();return meta.pending?meta.snapshot:null;}
  bindSource(identity:string,confirmSameSource=false):void {
    this.transaction(()=>{const meta=this.metadata();if(meta.sourceIdentity===identity)return;if(meta.sourceIdentity!=='unbound'&&!confirmSameSource)throw new Error('binding-mismatch');this.save({...meta,sourceIdentity:identity});});
  }

  /** Only call after a complete qualified read. A rejected scan must never call this method. */
  ingest(rows: SourceRow[], observedAt: string): Snapshot {
    return this.transaction(()=>{
      const meta=this.metadata();
      if(meta.pending)throw new Error('publication-pending');
      const ids=new Set<string>();
      for(const row of rows){if(ids.has(row.id))throw new Error('duplicate-source-id');ids.add(row.id);}
      this.db.exec('UPDATE contributions SET archived=1 WHERE archived=0');
      const exemption=this.db.prepare('SELECT capture_exempt FROM contributions WHERE id=?');
      const upsert=this.db.prepare('INSERT INTO contributions(id,fingerprint,value,archived,capture_exempt) VALUES(?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,value=excluded.value,archived=0');
      for(const row of rows){const exempt=exemption.get(row.id)?.capture_exempt===1;const value=contribution(row,exempt?null:meta.captureAfter);upsert.run(value.id,value.fingerprint,JSON.stringify(value),exempt?1:0);}
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
  private clear(now: string, all: boolean, historicalReimport=false) {
    if(!Number.isFinite(Date.parse(now)))throw new Error('invalid-clear-time');
    const current=readControl(this.directory),meta=this.metadata();
    if(now<meta.snapshot.generatedAt)throw new Error('invalid-clear-time');
    const next:Control={...current,generation:randomUUID(),dataEpoch:all?randomUUID():current.dataEpoch,textEpoch:current.textEpoch+1,languageEnabled:false,cleanupPending:true,captureAfter:all?(historicalReimport?null:Date.parse(now)):current.captureAfter,revisionFloor:meta.revision+1,changedAt:now};
    // This authority is deliberately outside backups. Recovery applies it before exposing old state.
    writeControl(this.directory,next);
    this.reconcileControl();
    const removedManagedBackups=this.finishCleanup();
    return {snapshot:this.snapshot(),removedManagedBackups,unmanagedCopiesRecallable:false as const};
  }
  clearAll(now: string, options: {historicalReimport?:boolean}={}) {return this.clear(now,true,options.historicalReimport===true);}
  clearText(now: string) {return this.clear(now,false);}

  private backupPath(name: string): string {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name))throw new Error('invalid-backup-name');
    return join(this.directory,'backups',name+'.sqlite');
  }
  async backup(name: string): Promise<void> {
    if(this.metadata().pending)throw new Error('publication-pending');
    const path=this.backupPath(name);
    mkdirSync(join(this.directory,'backups'),{recursive:true,mode:0o700});
    if(existsSync(path))throw new Error('backup-exists');
    const temporary=path+'.'+randomUUID()+'.pending';
    try{
      await sqliteBackup(this.db,temporary);
      if(statSync(temporary).size>MAX_STORE_BYTES)throw new Error('backup-capacity');
      const fd=openSync(temporary,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
      renameSync(temporary,path);
    }catch(error){try{unlinkSync(temporary);}catch{}throw error;}
  }
  private openBackup(name: string): DatabaseSync {
    const path=this.backupPath(name);
    if(!existsSync(path))throw new Error('backup-unavailable');
    if(lstatSync(path).isSymbolicLink()||!statSync(path).isFile()||statSync(path).size>MAX_STORE_BYTES)throw new Error('invalid-backup');
    const db=new DatabaseSync(path,{readOnly:true,allowExtension:false,timeout:1000});
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA cache_size=-8192');return db;
  }
  private removeTextBackups(): number {
    const directory=join(this.directory,'backups');if(!existsSync(directory))return 0;
    let removed=0;
    for(const filename of readdirSync(directory)){
      if(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.sqlite\.[0-9a-f-]{36}\.pending$/.test(filename)){unlinkSync(join(directory,filename));removed++;continue;}
      if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.sqlite$/.test(filename))continue;
      const name=filename.slice(0,-7),db=this.openBackup(name);
      let text=false;
      try{text=this.readMetadata(db).snapshot.language.availability==='available'||Number(db.prepare('SELECT count(*) AS n FROM language').get()!.n)>0;}finally{db.close();}
      if(text){unlinkSync(this.backupPath(name));removed++;}
    }
    return removed;
  }
  private finishCleanup(): number {
    const removed=this.removeTextBackups();
    for(const name of readdirSync(this.directory))if(/^\.(aggregate|status)\.json\.[0-9a-f-]{36}\.pending$/.test(name))unlinkSync(join(this.directory,name));
    writeControl(this.directory,{...readControl(this.directory),cleanupPending:false});
    return removed;
  }
  restore(name: string, generatedAt: string, options:{historicalReimport?:boolean}={}): Snapshot {
    const saved=this.openBackup(name);
    try{
      const backup=this.readMetadata(saved),control=readControl(this.directory),current=this.metadata();
      if(current.pending)throw new Error('publication-pending');
      if(backup.namespace!==current.namespace||backup.sourceIdentity!==current.sourceIdentity)throw new Error('binding-mismatch');
      const historical=backup.dataEpoch!==control.dataEpoch||backup.captureAfter!==control.captureAfter;
      if(historical&&options.historicalReimport!==true)throw new Error('backup-before-clear');
      return this.transaction(()=>{
        this.db.exec('DELETE FROM contributions; DELETE FROM language');
        const insert=this.db.prepare('INSERT INTO contributions(id,fingerprint,value,archived,capture_exempt) VALUES(?,?,?,?,?)');
        for(const row of saved.prepare('SELECT id,fingerprint,value,archived,capture_exempt FROM contributions').iterate()){
          const value=JSON.parse(String(row.value));
          if(!validContribution(value)||value.id!==row.id||value.fingerprint!==row.fingerprint||(row.archived!==0&&row.archived!==1)||(row.capture_exempt!==0&&row.capture_exempt!==1))throw new Error('invalid-backup');
          // An explicit historical restore approves only the backed-up contributions,
          // not every old row that might still exist in the live source.
          const exempt=historical?(value.sourceTime!==null&&value.exclusion!=='before-capture'?1:0):row.capture_exempt;
          insert.run(row.id,row.fingerprint,row.value,row.archived,exempt);
        }
        const revision=Math.max(current.revision,control.revisionFloor)+1;
        const snapshot=aggregate(this.contributions(),{namespace:current.namespace,generation:control.generation,revision,timezone:current.timezone,now:generatedAt,gaps:backup.snapshot.coverage.gaps});
        snapshot.lastSuccessAt=backup.snapshot.lastSuccessAt;
        // Numeric restore cannot reenable language or reuse its old publication tables.
        this.save({...current,dataEpoch:control.dataEpoch,textEpoch:control.textEpoch,generation:control.generation,revision,snapshot,pending:true});return snapshot;
      });
    }finally{saved.close();}
  }
  close():void {this.db.close();}
}
