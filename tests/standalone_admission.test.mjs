import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {selectChecks} from '../scripts/ci-selection/selection.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/standalone_prs.json',import.meta.url),'utf8'));
const input=files=>({event:'pull_request',paths:files.flatMap(file=>[file.filename,file.previous_filename].filter(Boolean)),changes:files,complete:true});
for(const fixture of fixtures)test(`real PR #${fixture.pr} selects its complete standalone owner`,()=>{
 const selection=selectChecks(input(fixture.files));
 assert.equal(selection.mode,'standalone');
 assert.deepEqual(selection.owners,[fixture.pr===1386?'wemo':'microduck-browser']);
 assert.deepEqual(selection.groups,[]);
 assert.deepEqual(selection.jobs,{'runtime-unit':false,'runtime-scenarios':false,firmware:false,'app-verify':false,'runtime-verify-captures':false,'runtime-verify':false});
});
test('standalone route requires complete consistent modified regular-file metadata',()=>{
 const files=fixtures[1].files;
 for(const status of ['added','removed','renamed','copied','unchanged',undefined]){
  const changed=files.map((file,i)=>i===0?{...file,status}:file);
  assert.notEqual(selectChecks(input(changed)).mode,'standalone',String(status));
 }
 for(const extra of [{previous_filename:'before.test.ts'},{mode:'120000'},{beforeMode:'120000'},{mode:undefined}]){
  assert.notEqual(selectChecks(input(files.map((f,i)=>i===1?{...f,...extra}:f))).mode,'standalone');
 }
 assert.notEqual(selectChecks({...input(files),complete:false}).mode,'standalone');
 assert.notEqual(selectChecks({...input(files),changes:undefined}).mode,'standalone');
 assert.notEqual(selectChecks({...input(files),paths:[...input(files).paths,'unknown.ts']}).mode,'standalone');
});
test('mixed helper, fixture, product, contract and policy paths stay conservative',()=>{
 for(const filename of ['apps/runtime/dashboard/tests/harness.ts','tests/fixtures/data.json','modules/wemo/src/module.ts',
 'packages/event-contracts/src/v2/index.ts','package-lock.json','.github/workflows/checks.yml','docs/development.md',
 'AGENTS.md','docs/architecture.md','docs/project-maintenance.md','openspec/specs/focused-source-admission/spec.md','tests/new.test.ts']){
  assert.notEqual(selectChecks(input([...fixtures[1].files,{filename,status:'modified',beforeMode:'100644',mode:'100644'}])).mode,'standalone',filename);
 }
 assert.equal(selectChecks({...input(fixtures[1].files),event:'release_qualification'}).mode,'full');
});

import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {runSelect} from '../scripts/ci-selection/cli.mjs';
import {withFileModes} from '../scripts/ci-selection/standalone.mjs';
test('hosted standalone metadata binds exact comparison trees; unavailable or type-changing trees stay conservative',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'standalone-select-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const fixture=fixtures[1];
 const event=join(directory,'event.json');writeFileSync(event,JSON.stringify({pull_request:{base:{sha:fixture.base},head:{sha:fixture.head}}}));
 for(const mode of ['100644','120000','unavailable','truncated']){
  const requests=[];
  const selection=await runSelect({env:{GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:event,GITHUB_REPOSITORY:'owner/repo',GITHUB_OUTPUT:join(directory,mode)},fetch:async url=>{
   requests.push(url);
   if(url.includes('/compare/'))return {ok:true,json:async()=>({merge_base_commit:{sha:fixture.base},files:fixture.files.map(({filename,status})=>({filename,status}))})};
   return {ok:mode!=='unavailable',json:async()=>({truncated:mode==='truncated',tree:fixture.files.map(file=>({path:file.filename,type:'blob',mode:mode==='120000'?'120000':'100644'}))})};
  }});
  assert.equal(selection.mode==='standalone',mode==='100644',mode);assert.equal(requests.length,3);
  assert.ok(requests[1].includes(fixture.base));assert.ok(requests[2].includes(fixture.head));
 }
 const missing=withFileModes(fixture.files.map(({filename,status})=>({filename,status})),{truncated:true,tree:[]},{truncated:false,tree:[]});
 assert.equal(missing[0].mode,undefined);
 const supplied=withFileModes(fixture.files,{truncated:true,tree:[]},{truncated:false,tree:[]});
 assert.equal(supplied[0].mode,undefined,'unverified caller mode cannot bypass tree evidence');
});

import {localPaths,localChanges,selectedCommands} from '../scripts/ci-selection/local.mjs';
import YAML from 'yaml';
test('local committed status and modes agree with hosted owners; dirty or type-changing input stays conservative',()=>{
 const git=args=>args[0]==='status'?'':args[0]==='diff'?'M\0modules/wemo/tests/module.test.ts\0':args[0]==='merge-base'?'a'.repeat(40):'100644 blob '+ 'b'.repeat(40)+'\tmodules/wemo/tests/module.test.ts\0';
 const changes=localChanges({base:'base',git});
 assert.equal(selectChecks(input(changes)).mode,'standalone');
 assert.equal(localChanges({git:()=> ' M dirty.ts'}),undefined);
 const links=localChanges({git:args=>args[0]==='ls-tree'?'120000 blob '+ 'b'.repeat(40)+'\tmodules/wemo/tests/module.test.ts\0':git(args)});
 assert.notEqual(selectChecks(input(links)).mode,'standalone');
});
test('local command list prints the actual complete owning commands and only selected browser setup',()=>{
 const workflow=YAML.parse(readFileSync(new URL('../.github/workflows/checks.yml',import.meta.url),'utf8'));
 for(const fixture of fixtures){
  const selection=selectChecks(input(fixture.files));
  const jobs=selectedCommands(workflow,selection),commands=jobs.flatMap(job=>job.commands);
  assert.ok(commands.includes('npm run build'));assert.ok(commands.includes('npm run typecheck'));assert.ok(commands.includes('npm run lint:js'));
  assert.ok(jobs.filter(job=>job.id!=='core').every(job=>!job.selected));
  if(fixture.pr===1386){assert.ok(commands.includes('npm run test:wemo:built'));assert.ok(!commands.some(cmd=>cmd.includes('playwright install')));}
  else {assert.ok(commands.includes('npm run test:runtime-dashboard:smoke'));assert.ok(commands.includes('npm run test:microduck:browser'));assert.ok(commands.some(cmd=>cmd.includes('playwright install')));}
 }
});

import {execFileSync} from 'node:child_process';
test('real Git preserves whitespace-bearing unknown paths and never admits them as a known owner',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'standalone-git-paths-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8'});
 const commit=message=>git(['-c','user.name=jimmie-potts','-c','user.email=49133657+jimmie-potts@users.noreply.github.com','commit','--quiet','-m',message]);
 const known='modules/wemo/tests/module.test.ts';
 const variants=[known+' ',' '+known,known+'\t',known+'\n','modules/wemo/tests/ module.test.ts',
  'unknown path ',' unknown path','unknown\tpath','unknown\npath'];
 for(const name of [known,...variants]){mkdirSync(dirname(join(directory,name)),{recursive:true});writeFileSync(join(directory,name),'before\n');}
 git(['init','--quiet']);git(['add','--all']);commit('synthetic base');
 const base=git(['rev-parse','HEAD']).trim();
 for(const name of [...variants,known])await t.test(JSON.stringify(name),()=>{
  git(['checkout','--quiet','--detach',base]);writeFileSync(join(directory,name),'after\n');git(['add','--all']);commit('modify literal synthetic path');
  const paths=localPaths({base,git}),changes=localChanges({base,git});
  assert.deepEqual(paths,[name],'local path list must preserve every filename character');
  assert.equal(changes.length,1);assert.equal(changes[0].filename,name);assert.equal(changes[0].status,'modified');
  assert.equal(selectChecks({event:'pull_request',paths,changes,complete:true}).mode==='standalone',name===known,'only the literal existing owner qualifies');
 });
 git(['checkout','--quiet','--detach',base]);
 const renamed='renamed \t\n.ts ';
 git(['mv','--',known,renamed]);
 assert.deepEqual(new Set(localPaths({base,git})),new Set([known,renamed]));
 assert.equal(localChanges({base,git}),undefined,'dirty status does not establish committed ownership');
 commit('rename literal synthetic path');
 const renamedChanges=localChanges({base,git});
 assert.deepEqual(Object.fromEntries(renamedChanges.map(row=>[row.filename,row.status])),{[known]:'D',[renamed]:'A'});
 assert.notEqual(selectChecks({event:'pull_request',paths:localPaths({base,git}),changes:renamedChanges,complete:true}).mode,'standalone');
 const untracked=' untracked\t\n.ts ';
 writeFileSync(join(directory,untracked),'private synthetic untracked\n');
 assert.ok(localPaths({base,git}).includes(untracked),'untracked names are literal too');
 assert.equal(localChanges({base,git}),undefined);
});

test('local Git refuses incomplete status/path records and mismatched tree paths',()=>{
 assert.throws(()=>localPaths({git:()=> 'modules/wemo/tests/module.test.ts'}),/incomplete NUL/);
 const known='modules/wemo/tests/module.test.ts';
 const git=args=>args[0]==='status'?'':args[0]==='diff'?'M\0'+known+'\0':args[0]==='merge-base'?'a'.repeat(40):'100644 blob '+'b'.repeat(40)+'\t'+known+' \0';
 const changes=localChanges({git});
 assert.notEqual(selectChecks(input(changes)).mode,'standalone','mode evidence for a different literal path cannot qualify');
 for(const output of ['M\0','M\0'+known,'M\0\0'])assert.throws(()=>localChanges({git:args=>args[0]==='diff'?output:git(args)}),/incomplete|invalid/);
});
