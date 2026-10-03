import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import * as reader from '../dist/reader-engine.js';
import {SOURCE_LIMITS} from '../dist/reader-types.js';
const root=process.env.WISPR_TEST_TMPDIR??resolve('.local/scratch/wispr-tests');mkdirSync(root,{recursive:true});
function source(t){const dir=mkdtempSync(join(root,'language-reader-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'source.sqlite'),db=new DatabaseSync(path);db.exec('CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER,asrText TEXT,formattedText TEXT,editedText TEXT,detectedLanguage TEXT,editedTextStatus TEXT,editObservationEnd TEXT,additionalContext TEXT)');return {path,db};}
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const scan=async(path,enabled)=>{const rows=[];await reader.scanSource(path,SOURCE_LIMITS,async batch=>rows.push(...batch),{language:enabled});return rows;};

test('opted-in fixed profile reads bounded stages and qualifies explicit observation metadata',async t=>{
 const {path,db}=source(t);const insert=db.prepare('INSERT INTO History VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 for(const [id,state,end] of [['complete','complete','2026-10-02T10:01:00Z'],['partial','partial',null],['unknown','invented','2026-10-02T10:01:00Z'],['invalid-end','complete','invalid'],['absent',null,null]])insert.run(id,'2026-10-02T10:00:00Z','formatted',2,'hello there','hello world','hello friend','en',state,end,'NEVER_SELECT_CONTEXT');
 db.close();const before=hash(path),rows=await scan(path,true);
 assert.equal(rows[0].language.raw,'hello there');assert.equal(rows[0].language.observation,'complete');
 assert.deepEqual(rows.slice(1).map(r=>r.language.observation),['partial','unknown','unknown','unknown']);
 assert.ok(!JSON.stringify(rows).includes('NEVER_SELECT_CONTEXT'));assert.equal(hash(path),before);
 const numeric=await scan(path,false);assert.ok(numeric.every(r=>r.language===undefined));assert.ok(!JSON.stringify(numeric).includes('hello'));
});

test('oversized stages never materialize and leave valid numeric rows intact',async t=>{
 const {path,db}=source(t);db.prepare('INSERT INTO History(id,timestamp,status,numWords,asrText,detectedLanguage) VALUES(?,?,?,?,?,?)').run('big','2026-10-02T10:00:00Z','formatted',10,'x'.repeat(100_000),'en');db.close();
 const rows=await scan(path,true);assert.equal(rows[0].numWords,10);assert.equal(rows[0].language.raw,null);assert.deepEqual(rows[0].language.oversized,['raw']);
});

test('an unknown or incompatible detected language never falls back to a configured English preference',async t=>{
 const {path,db}=source(t);db.exec('ALTER TABLE History ADD COLUMN language TEXT');
 db.prepare('INSERT INTO History(id,timestamp,status,numWords,asrText,detectedLanguage,language) VALUES(?,?,?,?,?,?,?)').run('unknown','2026-10-02T10:00:00Z','formatted',2,'bonjour ami',null,'en');db.close();
 assert.equal((await scan(path,true))[0].language.language,null);
});
