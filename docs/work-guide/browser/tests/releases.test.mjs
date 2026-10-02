import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildCandidate,checkCandidate} from '../build.mjs';
import {datasetIdentity} from '../runtime/records.mjs';
const fixture=async()=>JSON.parse(await readFile(new URL('../../contracts/epic-guide/fixtures/dataset.json',import.meta.url),'utf8'));
const output=resolve('.local/scratch/gh-511-release-tests');
test('invalid refresh and unsafe public text preserve last good candidate',async()=> {
 await mkdir(output,{recursive:true});
 try {
  await buildCandidate(await fixture(),{output});const original=await readFile(output+'/index.html','utf8');
  const bad=await fixture();bad.issues[0].title='ghp_'+'A'.repeat(30);bad.datasetId=datasetIdentity(bad);
  await assert.rejects(buildCandidate(bad,{output}),/unsafe/);
  assert.equal(await readFile(output+'/index.html','utf8'),original);
  const partial=await fixture();partial.repositories[0].inventory.complete=false;partial.repositories[0].inventory.reason='truncated';partial.datasetId=datasetIdentity(partial);
  await assert.rejects(buildCandidate(partial,{output}),/candidate rejected/);
  assert.equal(await readFile(output+'/index.html','utf8'),original);
  assert.ok(await checkCandidate(output));
 } finally {await rm(output,{recursive:true,force:true});}
});
test('mixed asset bytes fail release validation',async()=> {
 await mkdir(output,{recursive:true});
 try {
  const manifest=await buildCandidate(await fixture(),{output});
  await writeFile(output+'/releases/'+manifest.releaseId.slice(7)+'/records.json','{}');
  await assert.rejects(checkCandidate(output));
 } finally {await rm(output,{recursive:true,force:true});}
});
