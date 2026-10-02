import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {qualifyCompatibility,dependencyEntrypoint} from '../dist/install/compatibility.js';

const program=fileURLToPath(new URL('..',import.meta.url));
test('target writes every durable record kind; previous reopens it and consumed events never repeat fake effects',async()=>{
 const result=await qualifyCompatibility(program,program);
 assert.equal(result.status,'compatible',JSON.stringify(result));
 assert.equal(result.probe.agentState,true);assert.equal(result.probe.automation,true);assert.equal(result.probe.repeatedEffects,0);
 assert.deepEqual(result.probe.records,['owner','source','revision','labels','notices','acknowledgments','attention','retirements','ordering','journal','rules','settings','interrupt-set','automation-log','budgets','consumed-events','fence']);
});
test('unknown durable implementation refuses qualification without attempting a recovery process',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-unknown-'));
 try{
  await mkdir(join(root,'dist'));await cp(join(program,'dist/storage.js'),join(root,'dist/storage.js'));
  await cp(join(program,'dist/automation-store.js'),join(root,'dist/automation-store.js'));await cp(join(program,'dist/automation.js'),join(root,'dist/automation.js'));
  await cp(join(program,'package.json'),join(root,'package.json'));
  // Only the fixture uses external dependency resolution; installed releases must pass complete inventory verification first.
  await mkdir(join(root,'node_modules/@jimmie-potts'),{recursive:true});
  for(const name of ['agent-state','agent-lifecycle-contracts'])await symlink(dirname(dirname(await dependencyEntrypoint(program,name))),join(root,'node_modules/@jimmie-potts',name));
  await writeFile(join(root,'dist/storage.js'),'throw new Error("must never execute unknown code");');
  const result=await qualifyCompatibility(root,program);assert.equal(result.status,'unknown');assert.equal(result.reason,'durable-implementation-unqualified');assert.equal(result.probe,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
