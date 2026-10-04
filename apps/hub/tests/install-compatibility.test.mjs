import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,writeFile,symlink,rm,chmod,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {qualifyCompatibility,dependencyEntrypoint,durableFingerprint} from '../dist/install/compatibility.js';
import {program,copyRelease} from './durable-release-fixture.mjs';

const records=['owner','source','revision','labels','notices','acknowledgments','attention','retirements','ordering','journal','rules','settings','interrupt-set','automation-log','budgets','consumed-events','fence','metadata','parents'];
const refused=(result,reason)=>{assert.equal(result.status,'unknown',JSON.stringify(result));assert.equal(result.reason,reason);assert.equal(result.probe,null);};
async function withRelease(change,check){
 const release=await copyRelease();
 try{await change(release);await check(release.root);}finally{await release.dispose();}
}

test('durable fingerprint ignores private installation modes',async()=>{
 await withRelease(async()=>{},async root=>{
  const makePrivate=async path=>{for(const entry of await readdir(path,{withFileTypes:true})){const child=join(path,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory()){await chmod(child,0o700);await makePrivate(child);}else await chmod(child,0o600);}};
  await makePrivate(root);assert.equal(await durableFingerprint(root),await durableFingerprint(program));
 });
});
test('target writes every durable record kind; previous reopens it and consumed events never repeat fake effects',async()=>{
 const result=await qualifyCompatibility(program,program);
 assert.equal(result.status,'compatible',JSON.stringify(result));
 assert.equal(result.probe.agentState,true);assert.equal(result.probe.automation,true);assert.equal(result.probe.repeatedEffects,0);
 assert.deepEqual(result.probe.records,records);
});

// Acceptance example 1: content and lifecycle changes that leave the durable surface unchanged.
test('reducer, coordination, constants, snapshot and lifecycle changes qualify in both directions',async()=>{
 await withRelease(async release=>{
  await release.append('state','dist/reducer.js','\n// reducer change\n');
  await release.append('state','dist/index.js','\n// snapshot or coordination change\n');
  await release.replace('state','dist/types.js',"export const VERSION = '3.4.0';","export const VERSION = '3.99.0';");
  await release.append('state','schemas/snapshot-v1.2.schema.json');
  await release.write('state','schemas/snapshot-v1.3.schema.json','{}\n');
  await release.append('lifecycle','dist/index.js','\n// lifecycle version change\n');
  await release.write('lifecycle','schemas/lifecycle-v1.2.schema.json','{}\n');
 },async root=>{
  assert.equal(await durableFingerprint(root),await durableFingerprint(program));
  for(const [previous,target] of [[program,root],[root,program]]){
   const result=await qualifyCompatibility(previous,target);
   assert.equal(result.status,'compatible',JSON.stringify(result));assert.deepEqual(result.probe.records,records);
  }
 });
});

// Acceptance example 2: stored-state and frozen lifecycle schemas.
for(const [name,change] of [
 ['stored schema newline',release=>release.append('state','schemas/durable-v2.1.schema.json')],
 ['new stored schema version',release=>release.write('state','schemas/durable-v2.2.schema.json','{}\n')],
 ['unclassified agent-state schema',release=>release.write('state','schemas/stored-records.json','{}\n')],
 ['edited lifecycle 1.0 schema',release=>release.append('lifecycle','schemas/lifecycle-v1.schema.json')],
 ['edited lifecycle 1.1 schema',release=>release.append('lifecycle','schemas/lifecycle-v1.1.schema.json')],
 ['unclassified lifecycle schema',release=>release.write('lifecycle','schemas/identity.json','{}\n')]
])test('durable schema change refuses: '+name,async()=>{
 await withRelease(change,async root=>{
  refused(await qualifyCompatibility(root,program),'durable-implementation-unqualified');
  refused(await qualifyCompatibility(program,root),'durable-implementation-unqualified');
 });
});

// Acceptance example 3: storage and validator modules, including unclassified ones. None may execute.
const poison='throw new Error("must never execute unknown code");\n';
for(const [name,change] of [
 ['Hub storage adapter',release=>release.write('hub','storage.js',poison)],
 ['Hub automation store',release=>release.append('hub','automation-store.js','\n//\n')],
 ['Hub automation validation',release=>release.append('hub','automation.js','\n//\n')],
 ['Hub automation validators',release=>release.append('hub','common.js','\n//\n')],
 ['new Hub SQLite module',release=>release.write('hub','journal-store.js',"import {DatabaseSync} from 'node:sqlite';\n"+poison)],
 ['agent-state durable validator',release=>release.write('state','dist/validation.js',poison)],
 ['agent-state identity key',release=>release.append('state','dist/memory-storage.js','\n//\n')],
 ['unclassified agent-state module',release=>release.write('state','dist/durable-store.js',poison)],
 ['unclassified lifecycle module',release=>release.write('lifecycle','dist/identity.js',poison)]
])test('durable module change refuses without executing it: '+name,async()=>{
 await withRelease(change,async root=>{
  refused(await qualifyCompatibility(root,program),'durable-implementation-unqualified');
  refused(await qualifyCompatibility(program,root),'durable-implementation-unqualified');
 });
});

// Acceptance example 4: the extended probe reaches a reducer that leaks a field into storage.
test('target whose reducer stores a field the previous release rejects fails the probe',async()=>{
 await withRelease(release=>release.replace('state','dist/reducer.js','session.title = event.title;',"session.title = event.title; session.hostSessionId = 'local_probe';"),async root=>{
  assert.equal(await durableFingerprint(root),await durableFingerprint(program));
  refused(await qualifyCompatibility(program,root),'durable-reopen-probe-failed');
 });
});

// Acceptance example 5: missing durable files or packages.
for(const [name,change] of [
 ['Hub storage adapter',release=>release.remove('hub','storage.js')],
 ['agent-state durable validator',release=>release.remove('state','dist/validation.js')],
 ['current stored schema',release=>release.remove('state','schemas/durable-v2.1.schema.json')],
 ['lifecycle 1.0 schema',release=>release.remove('lifecycle','schemas/lifecycle-v1.schema.json')],
 ['agent-state package',release=>release.remove('state','')]
])test('missing durable dependency refuses as unavailable: '+name,async()=>{
 await withRelease(change,async root=>{
  refused(await qualifyCompatibility(root,program),'durable-implementation-unavailable');
  refused(await qualifyCompatibility(program,root),'durable-implementation-unavailable');
 });
});

test('unknown durable implementation behind linked dependencies refuses without attempting a recovery process',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-unknown-'));
 try{
  await mkdir(join(root,'dist'));
  for(const name of ['storage.js','automation-store.js','automation.js','common.js'])await cp(join(program,'dist',name),join(root,'dist',name));
  await cp(join(program,'package.json'),join(root,'package.json'));
  // Only the fixture uses external dependency resolution; installed releases must pass complete inventory verification first.
  await mkdir(join(root,'node_modules/@jimmie-potts'),{recursive:true});
  for(const name of ['agent-state','agent-lifecycle-contracts'])await symlink(dirname(dirname(await dependencyEntrypoint(program,name))),join(root,'node_modules/@jimmie-potts',name));
  await writeFile(join(root,'dist/storage.js'),poison);
  refused(await qualifyCompatibility(root,program),'durable-implementation-unqualified');
 }finally{await rm(root,{recursive:true,force:true});}
});
