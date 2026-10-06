import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, MIGRATIONS, APPLICATION_ID } from '../../packages/library/src/migrations.js';
const roots:string[]=[];
const databases:DatabaseSync[]=[];
afterEach(async()=>{for(const db of databases) db.close();databases.length=0;for(const root of roots) await rm(root,{recursive:true,force:true});roots.length=0;});
async function database() {
  const root=await mkdtemp(join(tmpdir(),'pixoo-migration-'));roots.push(root);
  const db=new DatabaseSync(join(root,'catalog.sqlite')); databases.push(db);return db;
}
it('creates the current schema and upgrades a populated catalog without rewriting assets',async()=>{
  const db=await database();migrate(db,MIGRATIONS.slice(0,1));
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run('legacy','hash','legacy.gif','{}','earlier');
  const before=db.prepare('SELECT * FROM assets').all();
  migrate(db);
  expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(4);
  expect(db.prepare('SELECT * FROM assets').all()).toEqual(before);
  expect(db.prepare('SELECT * FROM playlists').all()).toEqual([]);
  migrate(db);
  expect(db.prepare('SELECT * FROM schema_migrations').all()).toHaveLength(4);
  expect(()=>db.prepare('INSERT INTO renditions VALUES (?,?,?,?)').run('id','missing','{}','now')).toThrow();
  db.prepare('INSERT INTO renditions VALUES (?,?,?,?)').run('id','legacy','{}','now');
  expect(()=>db.exec("UPDATE renditions SET manifest_json='different'")).toThrow('immutable rendition');
});
it('rolls back the failing migration and retains earlier data and version',async()=>{
  const db=await database();migrate(db,MIGRATIONS.slice(0,1));
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run('asset','hash','kept.gif','{}','earlier');
  expect(()=>migrate(db,[MIGRATIONS[0],{version:2,sql:'CREATE TABLE partial(id); DELETE FROM assets; INVALID SQL;'}])).toThrow('migration failed');
  expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(1);
  expect(db.prepare('SELECT id FROM assets').all()).toEqual([{id:'asset'}]);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='partial'").all()).toEqual([]);
  migrate(db);
  expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(4);
});
it('rejects foreign, newer, changed-checksum and inconsistent catalogs without resetting them',async()=>{
  for(const preparation of [
    (db:DatabaseSync)=>db.exec('CREATE TABLE foreign_data(id)'),
    (db:DatabaseSync)=>db.exec('PRAGMA application_id=123'),
    (db:DatabaseSync)=>{migrate(db);db.exec('PRAGMA user_version=99');},
    (db:DatabaseSync)=>{migrate(db);db.exec("UPDATE schema_migrations SET checksum='changed' WHERE version=1");},
    (db:DatabaseSync)=>db.exec(`PRAGMA application_id=${APPLICATION_ID}; CREATE TABLE unexpected(id)`),
    (db:DatabaseSync)=>db.exec('PRAGMA user_version=-1'),
  ]) {
    const db=await database();preparation(db);
    const before=db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
    const version=db.prepare('PRAGMA user_version').get();
    expect(()=>migrate(db)).toThrow('incompatible');
    expect(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()).toEqual(before);
    expect(db.prepare('PRAGMA user_version').get()).toEqual(version);
  }
});
