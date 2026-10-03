import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildTarget} from '../dist/install/build-target.js';
test('release preparation refuses dirty source before creating build or installation artifacts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-build-'));
 try{
  const repository=join(root,'source'),destination=join(root,'hub');await mkdir(repository);await mkdir(destination);
  const git=(...args)=>{const result=spawnSync('git',args,{cwd:repository,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  git('init','-b','main');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');await writeFile(join(repository,'file'),'base');git('add','.');git('commit','-m','base');git('remote','add','origin',repository);
  const target=git('rev-parse','HEAD');await writeFile(join(repository,'dirty'),'changed');
  await assert.rejects(buildTarget(repository,destination,target),/dirty-install-source/);
  assert.deepEqual(await readdir(destination),[]);assert.deepEqual((await readdir(repository)).sort(),['.git','dirty','file']);
 }finally{await rm(root,{recursive:true,force:true});}
});
