import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {captureState,statePreserved} from '../dist/install/state.js';
const program=fileURLToPath(new URL('..',import.meta.url));
test('read-only durable evidence covers all tables and rejects older records or missing dedup history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-state-'));
 try{
  const probe=spawnSync(process.execPath,[join(program,'bin/install-compatibility-probe.mjs'),program,root,'write'],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);
  const bytes=await readFile(join(root,'state.sqlite')),before=await captureState(root);
  assert.deepEqual(await readFile(join(root,'state.sqlite')),bytes);assert.equal(statePreserved(before,await captureState(root)),true);
  const db=new DatabaseSync(join(root,'state.sqlite'));
  db.prepare('INSERT INTO automation_events VALUES(?,?)').run('github:newer',100);db.close();
  const newer=await captureState(root);assert.equal(statePreserved(before,newer),true);assert.equal(statePreserved(newer,before),false);
  const lost=structuredClone(newer);lost.state.sessions[0].notices[0].acknowledgedBy=[];assert.equal(statePreserved(newer,lost),false);
  const old=structuredClone(newer);old.state.revision--;assert.equal(statePreserved(newer,old),false);
  const relabelled=structuredClone(newer);relabelled.state.sessions[0].label='Old label';assert.equal(statePreserved(newer,relabelled),false);
  const changed=structuredClone(newer);changed.tables.automation_settings=[];assert.equal(statePreserved(newer,changed),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
