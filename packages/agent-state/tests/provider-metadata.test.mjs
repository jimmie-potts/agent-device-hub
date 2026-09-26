import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as providers from '../dist/providers.js';
const source={provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'UserPromptSubmit'};
const raw={session_id:'session',turn_id:'turn',cwd:'/work/café-project',prompt:'CONTENT_CANARY',token:'SECRET_CANARY'};
async function folder(t){const dir=await mkdtemp(join(tmpdir(),'title-fixture-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('Codex reader uses latest matching index title and project basename, including rename',async t=>{
 const dir=await folder(t),path=join(dir,'session_index.jsonl');
 await writeFile(path,[{id:'other',thread_name:'Other'},{id:'session',thread_name:'First title'},{id:'session',thread_name:'Renamed café'}].map(JSON.stringify).join('\n')+'\n');
 const event=await providers.enrichHook(raw,source,1000,{codexHome:dir});
 assert.deepEqual(event.title,{value:'Renamed café',source:'provider'});assert.equal(event.project,'café-project');assert.equal(event.apiVersion,'1.1');assert.ok(!JSON.stringify(event).includes('CANARY'));assert.ok(!JSON.stringify(event).includes('/work/'));
 await writeFile(path,JSON.stringify({id:'session',thread_name:'Another rename'})+'\n');assert.equal((await providers.enrichHook(raw,source,1001,{codexHome:dir})).title.value,'Another rename');
});
test('Claude prefers latest custom-title over ai-title and never copies conversation records',async t=>{
 const dir=await folder(t),path=join(dir,'session.jsonl');
 await writeFile(path,[{type:'user',message:{content:'CONTENT_CANARY'}},{type:'custom-title',customTitle:'Owner title',sessionId:'session'},{type:'ai-title',aiTitle:'AI title',sessionId:'session'}].map(JSON.stringify).join('\n')+'\n');
 const event=await providers.enrichHook({...raw,transcript_path:path},{...source,provider:'claude',client:'code'},1000);
 assert.deepEqual(event.title,{value:'Owner title',source:'user'});assert.ok(!JSON.stringify(event).includes('CANARY'));assert.ok(!JSON.stringify(event).includes(path));
 await writeFile(path,JSON.stringify({type:'ai-title',aiTitle:'AI only',sessionId:'session'})+'\n');assert.deepEqual((await providers.enrichHook({...raw,transcript_path:path},{...source,provider:'claude',client:'code'},1001)).title,{value:'AI only',source:'provider'});
});
test('missing, malformed, secret-bearing and symlinked sources fail open; child metadata is not inherited',async t=>{
 const dir=await folder(t),path=join(dir,'session_index.jsonl');
 for(const text of [null,'not json\n',JSON.stringify({id:'session',thread_name:'Bearer '+'s'.repeat(43)})+'\n',JSON.stringify({id:'session',thread_name:'Title\u2028Bearer '+'s'.repeat(43)})+'\n']){
  if(text!==null)await writeFile(path,text);
  const event=await providers.enrichHook(raw,source,1000,{codexHome:dir});assert.equal(event.event.kind,'turn.started');assert.equal(event.title,undefined);
 }
 const target=join(dir,'target');await writeFile(target,JSON.stringify({id:'session',thread_name:'Do not follow'})+'\n');await rm(path);await symlink(target,path);
 assert.equal((await providers.enrichHook(raw,source,1000,{codexHome:dir})).title,undefined);
 const child=await providers.enrichHook({...raw,agent_id:'child'},source,1000,{codexHome:dir});assert.equal(child.title,undefined);assert.equal(child.project,undefined);
});

test('bounded tails, malformed records and Windows project names do not change lifecycle identity',async t=>{
 const dir=await folder(t),path=join(dir,'session_index.jsonl');
 await writeFile(path,'x'.repeat(1024*1024)+'\n'+JSON.stringify({id:'session',thread_name:'Last valid title'})+'\n');
 const event=await providers.enrichHook({...raw,cwd:'C:\\work\\project'},source,1000,{codexHome:dir});assert.equal(event.title.value,'Last valid title');assert.equal(event.project,'project');assert.equal(event.identity.sessionId,'session');
 const transcript=join(dir,'session.jsonl');await writeFile(transcript,'x'.repeat(1024*1024)+'\n'+JSON.stringify({type:'ai-title',aiTitle:'Cannot displace an unseen custom title',sessionId:'session'})+'\n');
 assert.equal((await providers.enrichHook({...raw,transcript_path:transcript},{...source,provider:'claude',client:'code'},1000)).title,undefined);
 await writeFile(path,JSON.stringify({id:'s'.repeat(128),thread_name:'😀'.repeat(160)})+'\n');
 const full=await providers.enrichHook({session_id:'s'.repeat(128),turn_id:'t'.repeat(128),cwd:'/'+ '😀'.repeat(80)},{...source,hostId:'h'.repeat(128),sourceId:'s'.repeat(128)},1000,{codexHome:dir});
 assert.ok(Buffer.byteLength(JSON.stringify(full))<=2048);assert.equal(full.event.kind,'turn.started');
});
