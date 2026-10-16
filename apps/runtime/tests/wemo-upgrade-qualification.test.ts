import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import type {PowerLimitRecord} from '@jimmie-potts/event-contracts/v2/families';
void test('four separate current-source processes retain latest limit attempts and Wemo holds without replay',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'wemo-phases-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 type Snapshot={phase:string;pid:number;effects:number;limitSends:number;settings:PowerLimitRecord;requests:object[];outcomes:Array<{id:string;message:string}>};
 const snapshots:Snapshot[]=[];
 for(const phase of ['baseline','candidate','recovery','reupgrade']){
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./fixtures/wemo-upgrade-phase.js',import.meta.url)),directory,phase],{encoding:'utf8',timeout:15000});assert.equal(child.status,0,child.stderr);
  const current=JSON.parse(child.stdout) as Snapshot;assert.equal(current.phase,phase);assert.equal(current.effects,phase==='baseline'?1:0);assert.equal(current.limitSends,phase==='baseline'?1:0);
  const previous=snapshots.at(-1);if(previous!==undefined){assert.deepEqual(current.settings.lastAttempt,previous.settings.lastAttempt);assert.equal(current.settings.startedAtMs,previous.settings.startedAtMs);assert.equal(current.settings.enabled,true);assert.equal(current.settings.durationMs,6000);assert.equal(current.settings.settingsRevision,2);assert.deepEqual(current.requests,previous.requests);assert.deepEqual(current.outcomes,previous.outcomes);}
  snapshots.push(current);
 }
 assert.equal(new Set(snapshots.map(value=>value.pid)).size,4);
});
