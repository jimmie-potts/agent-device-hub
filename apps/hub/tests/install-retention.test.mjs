import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256} from '../dist/install/files.js';
import {pruneReleases,selectRollback} from '../dist/install/retention.js';
const cases=JSON.parse(await readFile(new URL('../fixtures/install-receipt-v1.json',import.meta.resolve('@jimmie-potts/device-contracts')),'utf8'));
test('retention keeps current plus three previous successes, protects references and never follows another owner link',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-retain-'));try{
  for(const name of ['releases','receipts','provenance','legacy','backups','install.lock','other'])await mkdir(join(root,name),{mode:0o700});
  await writeFile(join(root,'other/marker'),'other-owner');await writeFile(join(root,'legacy/history'),'keep');await writeFile(join(root,'backups/history'),'keep');
  const identities=[],receipts=[];
  for(let i=1;i<=7;i++){
   const sha=String(i).repeat(40),path=join(root,'releases',sha),manifest=JSON.stringify({artifact:'@jimmie-potts/hub',version:'v',sourceRevision:sha,files:{'app.js':sha256(String(i))},dependencyFiles:{}});
   await mkdir(path);await writeFile(join(path,'app.js'),String(i));await writeFile(join(path,'manifest.json'),manifest);
   const id={kind:'release',sourceRevision:sha,version:'v',archiveSha256:String(i).repeat(64),manifestSha256:sha256(manifest)};identities.push(id);await writeFile(join(root,'provenance',sha+'.json'),JSON.stringify(id));
   const r=structuredClone(cases.cases.find(c=>c.id==='upgrade-success').value);r.operationId='op-'+String(i).repeat(8);r.target=id;r.previous=identities.at(-2)??id;r.running.identity=id;r.startedAt=r.updatedAt=r.completedAt=`2026-10-02T12:00:0${i}Z`;
   const receipt=join(root,'receipts',r.operationId+'.json');await writeFile(receipt,JSON.stringify(r));receipts.push(receipt);
  }
  await symlink(join(root,'releases',identities[6].sourceRevision),join(root,'current'));
  assert.deepEqual((await selectRollback(root,identities[6])).identity,identities[5]);
  await symlink(join(root,'other'),join(root,'releases','f'.repeat(40)));
  const result=await pruneReleases(root,receipts[6],[identities[1]]);
  assert.deepEqual(result.removed.sort(),[identities[0].sourceRevision,identities[2].sourceRevision]);
  for(const i of [1,3,4,5,6])assert((await lstat(join(root,'releases',identities[i].sourceRevision))).isDirectory());
  assert((await lstat(join(root,'releases','f'.repeat(40)))).isSymbolicLink());assert.equal(await readFile(join(root,'other/marker'),'utf8'),'other-owner');
  assert.equal(await readFile(join(root,'legacy/history'),'utf8'),'keep');assert.equal(await readFile(join(root,'backups/history'),'utf8'),'keep');
  await assert.rejects(selectRollback(root,identities[6],identities[0].sourceRevision),/ENOENT/);
  const unresolved=structuredClone(cases.cases.find(c=>c.value.outcome==='in-progress').value);unresolved.operationId='op-aaaaaaaa';await writeFile(join(root,'receipts/op-aaaaaaaa.json'),JSON.stringify(unresolved));
  await assert.rejects(pruneReleases(root,receipts[6],[]),/install-operation-unresolved/);
 }finally{await rm(root,{recursive:true,force:true});}
});
