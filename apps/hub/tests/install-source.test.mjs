import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectSource} from '../dist/install/source.js';
test('read-only source resolution proves merged reachability, includes every commit and marks unavailable comparison',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-git-'));
 const git=(...args)=>{const p=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(p.status,0,p.stderr);return p.stdout.trim();};
 try{
  git('init','-b','main');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  await writeFile(join(root,'file'),'first');git('add','.');git('commit','-m','First (#12)');const first=git('rev-parse','HEAD');
  await writeFile(join(root,'file'),'second');git('commit','-am','Second (#13)');const second=git('rev-parse','HEAD');git('remote','add','origin',root);
  const before=git('status','--porcelain=v1');const result=inspectSource(root,'main',first);
  assert.equal(result.target,second);assert.equal(result.comparison.status,'complete');assert.deepEqual(result.commits.map(x=>x.sha),[second]);assert.deepEqual(result.commits[0].pullRequests,[13]);assert.deepEqual(result.components,['file']);assert.equal(git('status','--porcelain=v1'),before);
  const rollback=inspectSource(root,first,second);assert.deepEqual(rollback.commits,[]);assert.deepEqual(rollback.removedCommits.map(x=>x.sha),[second]);assert.deepEqual(rollback.components,['file']);
  assert.equal(inspectSource(root,'main',null).comparison.status,'unknown');
  git('checkout','-b','unmerged');await writeFile(join(root,'unmerged'),'bad');git('add','.');git('commit','-m','Unmerged');
  assert.throws(()=>inspectSource(root,'HEAD',first),/unmerged-install-source/);
  git('checkout','main');await writeFile(join(root,'dirty'),'untracked');assert.throws(()=>inspectSource(root,'main',first),/dirty-install-source/);
 }finally{await rm(root,{recursive:true,force:true});}
});
