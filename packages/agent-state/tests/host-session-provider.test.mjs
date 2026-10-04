import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvent} from '@jimmie-potts/agent-lifecycle-contracts';
import * as providers from '../dist/providers.js';

const claude={provider:'claude',client:'code',hostId:'host',sourceId:'source',hook:'UserPromptSubmit'};
const raw={session_id:'session',prompt_id:'turn',cwd:'/work/project',prompt:'CONTENT_CANARY'};
const desktopId='local_0f8e2c4a-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const desktop={CLAUDE_CODE_ENTRYPOINT:'claude-desktop',CLAUDE_CODE_HOST_SESSION_ID:desktopId,ANTHROPIC_API_KEY:'SECRET_CANARY',HOME:'/PRIVATE_CANARY'};
const enrich=(environment,options={},input=raw,source=claude)=>providers.enrichHook(input,source,1000,{lifecycleVersion:'1.2',environment,...options});
function clean(event){
 const text=JSON.stringify(event);
 assert.ok(!/CANARY|ANTHROPIC|CLAUDE_CODE|claude-desktop|entrypoint/i.test(text),text);
 assert.equal(validateEvent(event).ok,true);assert.ok(Buffer.byteLength(text)<=2048);
}

test('a Claude Desktop hook environment adds only the validated host session ID on lifecycle 1.2',async()=>{
 const event=await enrich(desktop);
 assert.equal(event.apiVersion,'1.2');assert.equal(event.hostSessionId,desktopId);
 assert.equal(event.identity.sessionId,'session');assert.equal(event.event.kind,'turn.started');assert.equal(event.project,'project');clean(event);
 assert.equal((await enrich({...desktop,CLAUDE_CODE_HOST_SESSION_ID:'h'.repeat(128)})).hostSessionId,'h'.repeat(128));
});

test('CLI, missing, malformed and oversized environments add nothing and still emit the event',async()=>{
 const cases=[{},{CLAUDE_CODE_ENTRYPOINT:'cli',CLAUDE_CODE_HOST_SESSION_ID:desktopId},{CLAUDE_CODE_HOST_SESSION_ID:desktopId},
  {CLAUDE_CODE_ENTRYPOINT:'claude-desktop'},{...desktop,CLAUDE_CODE_ENTRYPOINT:'Claude-Desktop'},{...desktop,CLAUDE_CODE_ENTRYPOINT:' claude-desktop'},
  ...['','local id','local/../x','local_é','local_x\n','h'.repeat(129),'h'.repeat(70000)].map(value=>({...desktop,CLAUDE_CODE_HOST_SESSION_ID:value}))];
 for(const environment of cases){
  const event=await enrich(environment);
  assert.equal(event.apiVersion,'1.2');assert.equal(event.hostSessionId,undefined,JSON.stringify(environment).slice(0,120));assert.equal(event.event.kind,'turn.started');clean(event);
 }
});

test('throwing or non-plain environments fail open without the field',async()=>{
 const throwing=new Proxy({},{get(){throw new Error('PRIVATE_CANARY');},getOwnPropertyDescriptor(){throw new Error('PRIVATE_CANARY');},has(){throw new Error('PRIVATE_CANARY');}});
 const getter={};Object.defineProperty(getter,'CLAUDE_CODE_ENTRYPOINT',{enumerable:true,get(){throw new Error('PRIVATE_CANARY');}});
 for(const environment of [throwing,getter,null,'claude-desktop',[desktopId]]){
  const event=await enrich(environment);assert.equal(event.hostSessionId,undefined);assert.equal(event.event.kind,'turn.started');clean(event);
 }
});

test('older lifecycle selections, Codex sources and child events never carry the field',async()=>{
 for(const options of [{lifecycleVersion:'1.1'},{lifecycleVersion:undefined}]){
  const event=await enrich(desktop,options);assert.equal(event.apiVersion,'1.1');assert.equal(event.hostSessionId,undefined);clean(event);
 }
 const unselected=await providers.enrichHook(raw,claude,1000,{environment:desktop});assert.equal(unselected.apiVersion,'1.1');assert.equal(unselected.hostSessionId,undefined);
 const codex=await enrich(desktop,{codexHome:'/nonexistent-gh-784'},{session_id:'session',turn_id:'turn'},{...claude,provider:'codex',client:'cli'});
 assert.equal(codex.apiVersion,'1.2');assert.equal(codex.hostSessionId,undefined);clean(codex);
 for(const hook of ['SubagentStart','SubagentStop','UserPromptSubmit']){
  const child=await enrich(desktop,{},{...raw,agent_id:'child'},{...claude,hook});
  assert.equal(child.parent.status,'known');assert.equal(child.hostSessionId,undefined);clean(child);
 }
 const plain=providers.normalizeHook(raw,claude,1000);assert.equal(plain.apiVersion,'1.0');assert.equal(plain.hostSessionId,undefined);
});

test('the host session ID survives envelope trimming before title and project',async()=>{
 const big={session_id:'s'.repeat(128),prompt_id:'t'.repeat(128),cwd:'/'+'😀'.repeat(80)};
 const event=await enrich({...desktop,CLAUDE_CODE_HOST_SESSION_ID:'h'.repeat(128)},{},big,{...claude,hostId:'h'.repeat(128),sourceId:'s'.repeat(128)});
 assert.equal(event.hostSessionId,'h'.repeat(128));clean(event);
});

test('an unsupported lifecycle selection is refused without an event',async()=>{
 for(const lifecycleVersion of ['1.0','1.3',1.2])assert.equal(await enrich(desktop,{lifecycleVersion}),null);
});

test('owner-side Codex title enrichment keeps the 1.2 envelope version',async t=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const home=await mkdtemp(join(tmpdir(),'codex-home-12-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await writeFile(join(home,'session_index.jsonl'),JSON.stringify({id:'session',thread_name:'Desktop title'})+'\n');
 const base={apiVersion:'1.2',identity:{provider:'codex',client:'desktop',hostId:'host',sourceId:'source',sessionId:'session'},turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'turn.started'},observedAtMs:1000,ordering:{status:'unknown'}};
 const event=await providers.enrichCodexTitle(base,home);
 assert.equal(event.apiVersion,'1.2');assert.deepEqual(event.title,{value:'Desktop title',source:'provider'});clean(event);
 assert.equal((await providers.enrichCodexTitle({...base,apiVersion:'1.0'},home)).title,undefined);
});
