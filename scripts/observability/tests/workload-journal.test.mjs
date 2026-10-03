import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkloadJournal,createQueryJournal } from '../workload-journal.mjs';

test('workload evidence is exclusive, bounded and retains its prefix after a refused write', async t => {
  const directory=await mkdtemp(join(tmpdir(),'wj-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const journal=createWorkloadJournal(directory);
  journal.record({kind:'application-start',pid:123,startTicks:'42'});
  journal.sync();
  assert.throws(()=>createWorkloadJournal(directory),{code:'EEXIST'});
  assert.throws(()=>journal.record({kind:'sample',text:'x'.repeat(65536)}),/limit/);
  assert.throws(()=>journal.record({kind:'sample'}),/closed|failed/);
  journal.close();journal.close();
  const rows=(await readFile(join(directory,'workload.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,1);assert.equal(rows[0].sequence,0);assert.equal(rows[0].event.pid,123);
});

test('a preexisting journal symlink cannot redirect evidence', async t => {
  const directory=await mkdtemp(join(tmpdir(),'wj-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await symlink(join(directory,'other'),join(directory,'workload.jsonl'));
  assert.throws(()=>createWorkloadJournal(directory));
});

test('a large query retains every bounded row and a completion marker without exceeding record size',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'qj-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const journal=createQueryJournal(directory),records=Array.from({length:300},(_,index)=>({index,text:'x'.repeat(1000)}));
  journal.record({kind:'query',round:1,type:'logs',receipt:{records,sha256:'a'.repeat(64),bytes:400000}});journal.close();
  const lines=(await readFile(journal.path,'utf8')).trim().split('\n');assert.ok(lines.every(line=>Buffer.byteLength(line)<65536));
  const events=lines.map(line=>JSON.parse(line).event);
  assert.deepEqual(events.filter(e=>e.kind==='query-record').map(e=>e.value),records);
  assert.equal(events[0].recordCount,300);assert.equal(events.at(-1).kind,'query-event-end');
});
