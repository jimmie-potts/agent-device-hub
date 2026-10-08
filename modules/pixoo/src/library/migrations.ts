import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite';
import { LibraryError } from './contracts.js';
export const APPLICATION_ID=0x50584c42;
export const MIGRATIONS=[
  {version:1,sql:`
    CREATE TABLE assets(id TEXT PRIMARY KEY, content_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, source_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE renditions(id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TRIGGER immutable_rendition BEFORE UPDATE ON renditions BEGIN SELECT RAISE(ABORT,'immutable rendition'); END;
    CREATE TABLE cleanup_jobs(asset_id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, rendition_ids TEXT NOT NULL);
  `},
  {version:2,sql:`
    CREATE TABLE playlists(id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0 AND revision<=9007199254740991), repeat INTEGER NOT NULL CHECK(repeat IN (0,1)), shuffle INTEGER NOT NULL CHECK(shuffle IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE items(id TEXT PRIMARY KEY, playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position>=0), rendition_id TEXT NOT NULL REFERENCES renditions(id) ON DELETE RESTRICT, policy_json TEXT NOT NULL, UNIQUE(playlist_id,position));
    CREATE INDEX items_rendition ON items(rendition_id);
    CREATE TABLE sessions(id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE session_refs(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, rendition_id TEXT NOT NULL REFERENCES renditions(id) ON DELETE RESTRICT, PRIMARY KEY(session_id,rendition_id));
    CREATE INDEX session_rendition ON session_refs(rendition_id);
  `},
  {version:3,sql:`
    CREATE TABLE playback_checkpoint(slot INTEGER PRIMARY KEY CHECK(slot=1), session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE RESTRICT, payload TEXT NOT NULL);
  `},
  {version:4,sql:`
    CREATE TABLE catalog_revision(slot INTEGER PRIMARY KEY CHECK(slot=1),revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991));
    INSERT INTO catalog_revision VALUES(1,0);
    ${['assets','renditions','playlists','items'].flatMap(table=>['INSERT','UPDATE','DELETE'].map(operation=>`CREATE TRIGGER catalog_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN UPDATE catalog_revision SET revision=revision+1 WHERE slot=1; END;`)).join('\n')}
  `},
] as const;
/** The row of a query that always returns one, such as a PRAGMA or an aggregate. A missing row is a database fault. */
export function one(db:DatabaseSync,sql:string,...params:SQLInputValue[]):Record<string,SQLOutputValue> {
  const row=db.prepare(sql).get(...params);
  if(row===undefined)throw new Error(`No row from ${sql}`);
  return row;
}
/**
 * Runs `action` in one transaction. A COMMIT that fails, as on a full disk, has already rolled the transaction back, so
 * only a transaction still open is rolled back here, and the error that ended it is the one thrown (Hub #931).
 */
export function transaction<T>(db:DatabaseSync,action:()=>T):T {
  db.exec('BEGIN IMMEDIATE');
  try {const result=action();db.exec('COMMIT');return result;} catch(e) {if(db.isTransaction)db.exec('ROLLBACK');throw e;}
}
/** `others` names tables of a shared database that are not the catalog's, so they do not count as an unknown schema. */
export function migrate(db:DatabaseSync,migrations:readonly {version:number;sql:string}[]=MIGRATIONS,others?:RegExp):void {
  try {
    const app=Number(one(db,'PRAGMA application_id').application_id);
    const version=Number(one(db,'PRAGMA user_version').user_version);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().filter(row=>others===undefined||!others.test(String(row.name)));
    if(version<0 || version>migrations.length || app!==0 && app!==APPLICATION_ID ||
      version===0 && tables.length>0 || version>0 && app!==APPLICATION_ID) throw new Error();
    if(migrations.some((migration,index)=>migration.version!==index+1)) throw new Error();
    if(version>0) {
      const rows=db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
      if(rows.length!==version)throw new Error();
      for(const [i,row] of rows.entries()) {
        const migration=migrations[i];
        if(migration===undefined || row.version!==i+1 || row.checksum!==createHash('sha256').update(migration.sql).digest('hex'))throw new Error();
      }
    }
    for(const migration of migrations.filter(m=>m.version>version)) transaction(db,()=>{
      db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)');
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(migration.version,createHash('sha256').update(migration.sql).digest('hex'));
      db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${migration.version}`);
    });
  } catch(error) {throw new LibraryError('migration-error',{},{cause:error});}
}
