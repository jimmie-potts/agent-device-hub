import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkloadJournal } from '../workload-journal.mjs';

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
