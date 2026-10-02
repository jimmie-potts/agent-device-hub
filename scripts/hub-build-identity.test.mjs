import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceRevision} from './hub-build-identity.mjs';

test('clean commits, dirty trees, untracked files and unavailable provenance stamp truthfully',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-source-'));
 const git=(...args)=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const commit=()=>git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture');
 try{
  assert.equal(sourceRevision(directory),'unknown');
  git('init','--quiet');assert.equal(sourceRevision(directory),'unknown');
  await writeFile(join(directory,'package.json'),'{"version":"0.4.0"}');git('add','.');commit();
  const first=git('rev-parse','HEAD');assert.equal(sourceRevision(directory),first);
  await writeFile(join(directory,'package.json'),'{"version":"0.4.0","changed":true}');
  assert.equal(sourceRevision(directory),'unknown');git('add','.');assert.equal(sourceRevision(directory),'unknown');commit();
  const second=git('rev-parse','HEAD');assert.notEqual(first,second);assert.equal(sourceRevision(directory),second);
  await writeFile(join(directory,'untracked'),'new executable source');assert.equal(sourceRevision(directory),'unknown');
  await rm(join(directory,'untracked'));assert.equal(sourceRevision(directory),second);
  const nested=join(directory,'untracked-archive');await mkdir(nested);
  assert.equal(sourceRevision(nested),'unknown','a copied archive cannot claim its enclosing repository HEAD');
 }finally{await rm(directory,{recursive:true,force:true});}
});
