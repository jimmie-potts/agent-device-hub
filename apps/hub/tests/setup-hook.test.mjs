import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {enrichHook} from '@jimmie-potts/agent-state/providers';
import {hookCommand} from '../dist/setup.js';
import {startHub} from '../dist/server.js';
async function run(config,payload,env={}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[new URL('../bin/monitor-hook.mjs',import.meta.url).pathname,config],{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));});}
test('packaged Desktop hook drives successive turns through the real host and existing store',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-hook-current-')),token='k'.repeat(43);let hub;
 t.after(async()=>{await hub?.close();await rm(directory,{recursive:true,force:true});});
 const options={directory:join(directory,'state'),ownerId:'owner',consumers:[{id:'pixoo',clearOnNewTurn:true},{id:'nanoleaf',clearOnNewTurn:false}],controllers:[],port:0,
  credentials:[{id:'producer',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','ingest'],devices:[]}]};
 const config=join(directory,'producer.json'),headers={authorization:'Bearer '+token};
 async function open(){hub=await startHub(options);await writeFile(config,JSON.stringify({enabled:true,qualified:true,source:{provider:'codex',client:'desktop',hostId:'host',sourceId:'source',hook:'SessionStart'},endpoint:hub.url+'/api/monitor/v1/events',token}),{mode:0o600});}
 const view=async()=>{const response=await fetch(hub.url+'/api/monitor/v1/sessions',{headers});assert.equal(response.status,200);return (await response.json()).snapshot;};
 async function emit(name,turn,session='ordinary'){assert.deepEqual(await run(config,{hook_event_name:name,session_id:session,turn_id:turn,event_id:'unqualified-repeated-id',prompt:'PRIVATE_CANARY',cwd:'/private/secret'}),{code:0,stdout:'',stderr:''});}
 await mkdir(options.directory,{mode:0o700});
 await open();await emit('UserPromptSubmit','a');assert.equal((await view()).sessions[0].activity,'active');
 await emit('Stop','a');let snapshot=await view();assert.equal(snapshot.sessions[0].activity,'idle');assert.equal(snapshot.sessions[0].notices.length,1);
 await emit('UserPromptSubmit','b');snapshot=await view();const revision=snapshot.revision;
 assert.equal(snapshot.sessions[0].activity,'active');assert.equal(snapshot.sessions[0].turn.id,'b');assert.deepEqual(snapshot.sessions[0].ordering,{status:'unknown'});
 assert.deepEqual(snapshot.sessions[0].notices[0].acknowledgedBy,['pixoo']);
 for(const [name,turn] of [['UserPromptSubmit','b'],['Stop','a'],['UserPromptSubmit','a']])await emit(name,turn);
 assert.equal((await view()).revision,revision);
 await emit('Stop','other-turn','other-session');snapshot=await view();assert.equal(snapshot.sessions[0].turn.id,'b');assert.equal(snapshot.sessions[1].activity,'idle');
 assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE_CANARY|\/private\/secret|unqualified-repeated-id/);
 await hub.close();hub=undefined;await open();assert.equal((await view()).sessions[0].restartUncertain,true);
 await emit('Stop','b');snapshot=await view();assert.equal(snapshot.sessions[0].activity,'idle');assert.equal(snapshot.sessions[0].restartUncertain,false);assert.equal(snapshot.sessions[0].notices.length,2);
});
test('qualified Codex and Claude hooks authenticate metadata and discard private content',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-hook-'));t.after(()=>rm(directory,{recursive:true,force:true}));const requests=[];
 const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{requests.push({headers:req.headers,body:JSON.parse(body)});res.end('{}');});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 for(const [provider,client] of [['codex','cli'],['claude','code']]){
 const path=join(directory,'producer.json');await writeFile(path,JSON.stringify({enabled:true,qualified:true,source:{provider,client,hostId:'host',sourceId:'source',hook:'SessionStart'},endpoint:`http://127.0.0.1:${server.address().port}/api/monitor/v1/events`,token:'t'.repeat(43)}),{mode:0o600});
 assert.deepEqual(await run(path,{hook_event_name:'UserPromptSubmit',session_id:'session',turn_id:'turn',prompt_id:'prompt',prompt:'PRIVATE_CANARY',cwd:'/private/secret'}),{code:0,stdout:'',stderr:''});
 }
 assert.equal(requests.length,2);assert.ok(requests.every(r=>r.headers.authorization==='Bearer '+'t'.repeat(43)));assert.ok(requests.every(r=>r.body.event.kind==='turn.started'));assert.ok(!JSON.stringify(requests).includes('PRIVATE_CANARY'));assert.ok(!JSON.stringify(requests).includes('/private/secret'));
});
test('WSL construction quotes paths and refuses Windows shell expansion',()=>{
 assert.match(hookCommand('/usr/bin/node','/opt/a hook.mjs','/private/source.json','Ubuntu').commandWindows,/"--exec" "\/usr\/bin\/node" "\/opt\/a hook.mjs"/);
 assert.throws(()=>hookCommand('/usr/bin/node','/opt/%HOME%.mjs','/private/source.json','Ubuntu'),/unsupported/);
});
test('disabled, invalid, offline and hung input exit silently within the hard deadline',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-hook-offline-'));t.after(()=>rm(directory,{recursive:true,force:true}));const path=join(directory,'producer.json');
 for(const enabled of [false,true]){await writeFile(path,JSON.stringify({enabled,qualified:true,source:{provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'SessionStart'},endpoint:'http://127.0.0.1:1/api/monitor/v1/events',token:'t'.repeat(43)}),{mode:0o600});const start=performance.now();assert.deepEqual(await run(path,{hook_event_name:'Stop',session_id:'s'}),{code:0,stdout:'',stderr:''});assert.ok(performance.now()-start<3300);}
 await writeFile(path,'not-json',{mode:0o600});assert.deepEqual(await run(path,{}),{code:0,stdout:'',stderr:''});
});
test('open stdin cannot hold the hook beyond its own deadline',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-hook-stall-'));t.after(()=>rm(directory,{recursive:true,force:true}));const path=join(directory,'producer.json');await writeFile(path,JSON.stringify({enabled:true,qualified:true,source:{provider:'codex',client:'cli',hostId:'h',sourceId:'s',hook:'SessionStart'},endpoint:'http://127.0.0.1:1/api/monitor/v1/events',token:'t'.repeat(43)}),{mode:0o600});
 const start=performance.now();const child=spawn(process.execPath,[new URL('../bin/monitor-hook.mjs',import.meta.url).pathname,path],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);const code=await new Promise(r=>child.once('exit',r));assert.equal(code,0);assert.equal(output,'');assert.ok(performance.now()-start<3300);child.stdin.destroy();
});
test('setup receipt blocks incomplete, foreign and malformed installations after a producer rename',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-receipt-hook-'));t.after(()=>rm(directory,{recursive:true,force:true}));let requests=0;
 const server=createServer((req,res)=>{requests++;req.resume();res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const path=join(directory,'producer.json'),receiptPath=join(directory,'receipt.json'),source={provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'SessionStart'},token='t'.repeat(43),endpoint=`http://127.0.0.1:${server.address().port}/api/monitor/v1/events`;
 await writeFile(path,JSON.stringify({enabled:true,qualified:true,source,endpoint,token}),{mode:0o600});const receipt={version:1,state:'installed',token,input:{directory,source,endpoint,qualified:true}};
 for(const value of [{...receipt,state:'applying'},{...receipt,state:'removing'},{...receipt,state:'removed'},{...receipt,token:'z'.repeat(43)},{...receipt,input:{...receipt.input,source:{...source,sourceId:'foreign'}}},null]){
  await writeFile(receiptPath,value===null?'{invalid':JSON.stringify(value),{mode:0o600});assert.deepEqual(await run(path,{hook_event_name:'Stop',session_id:'session'}),{code:0,stdout:'',stderr:''});assert.equal(requests,0);
 }
 await writeFile(receiptPath,JSON.stringify(receipt),{mode:0o600});await run(path,{hook_event_name:'Stop',session_id:'session'});assert.equal(requests,1);
});

// The hook gives the title read a 100 ms deadline and then sends the event without a title. A loaded
// host can miss that deadline in a fresh hook process. The hook-level title test therefore stretches only
// that timer through a test-only preload, and the in-process test proves the deadline with a mocked clock.
const expectedTitle={value:'Rewrite café prompts',source:'user'};
const titlePayload=transcript=>({hook_event_name:'UserPromptSubmit',session_id:'session',prompt_id:'turn',transcript_path:transcript,cwd:'/private/work/project',prompt:'CONTENT_CANARY'});
async function titleFixture(t,prefix){
 const directory=await mkdtemp(join(tmpdir(),prefix));t.after(()=>rm(directory,{recursive:true,force:true}));const path=join(directory,'producer.json'),transcript=join(directory,'session.jsonl');
 const requests=[];const server=createServer(async(req,res)=>{let data='';for await(const b of req)data+=b;requests.push(JSON.parse(data));res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const common={enabled:true,qualified:true,source:{provider:'claude',client:'code',hostId:'host',sourceId:'source',hook:'SessionStart'},endpoint:`http://127.0.0.1:${server.address().port}/api/monitor/v1/events`,token:'t'.repeat(43)};
 await writeFile(transcript,JSON.stringify({type:'custom-title',customTitle:expectedTitle.value,sessionId:'session'})+'\n');
 return {directory,path,transcript,requests,common};
}

test('explicit lifecycle 1.1 produces bounded shared names; old configuration keeps 1.0',async t=>{
 const {directory,path,transcript,requests,common}=await titleFixture(t,'hub-title-hook-');const payload=titlePayload(transcript);
 // The preload gives 5 s to a timer whose immediate caller is agent-state's metadata module, the title read's deadline,
 // so the hook cannot miss the title under load. The hook's own 2.9 s exit timer and every other timer are untouched.
 const stretch=join(directory,'stretch.mjs');await writeFile(stretch,"const setTimer=globalThis.setTimeout;globalThis.setTimeout=function(callback,delay,...rest){const caller=new Error().stack.split('\\n')[2]??'';return setTimer.call(this,callback,/agent-state[/]dist[/]metadata[.]js:/.test(caller)?5000:delay,...rest);};");
 for(const config of [common,{...common,lifecycleVersion:'1.1'}]){await writeFile(path,JSON.stringify(config),{mode:0o600});assert.deepEqual(await run(path,payload,{CODEX_HOME:directory,NODE_OPTIONS:`--import=${pathToFileURL(stretch).href}`}),{code:0,stdout:'',stderr:''});}
 assert.equal(requests.length,2);assert.equal(requests[0].apiVersion,'1.0');assert.equal(requests[0].project,undefined);assert.equal(requests[0].title,undefined);
 assert.equal(requests[1].apiVersion,'1.1');assert.deepEqual(requests[1].title,expectedTitle);assert.equal(requests[1].project,'project');assert.ok(!JSON.stringify(requests).includes('CONTENT_CANARY'));assert.ok(!JSON.stringify(requests).includes('/private/'));
});

test('lifecycle 1.1 enrichment reads the session title and fails open at the 100 ms deadline',async t=>{
 const {transcript,common}=await titleFixture(t,'hub-title-read-');const payload=titlePayload(transcript);
 const enrich=()=>enrichHook(payload,{...common.source,hook:payload.hook_event_name},1000,{lifecycleVersion:'1.1'});
 // A mocked clock cannot reach the deadline unless the test advances it, so host load cannot drop the title.
 t.mock.timers.enable({apis:['setTimeout']});
 const event=await enrich();assert.equal(event.apiVersion,'1.1');assert.deepEqual(event.title,expectedTitle);assert.equal(event.project,'project');
 // enrichHook starts the deadline before its first await, so a synchronous tick lands before the read can finish.
 let pending=enrich();t.mock.timers.tick(99);assert.deepEqual((await pending).title,expectedTitle);
 pending=enrich();t.mock.timers.tick(100);const late=await pending;assert.equal(late.title,undefined);assert.equal(late.apiVersion,'1.1');assert.equal(late.project,'project');
});

test('a hung or missing title read still sends the event within the hook deadline',async t=>{
 const {directory,path,transcript,requests,common}=await titleFixture(t,'hub-title-stall-');await writeFile(path,JSON.stringify({...common,lifecycleVersion:'1.1'}),{mode:0o600});
 // The preload never settles a transcript open in the hook process, like a stalled disk; other files open normally.
 const stall=join(directory,'stall.mjs');await writeFile(stall,"import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';const open=fs.open;fs.open=(file,...rest)=>String(file).endsWith('.jsonl')?new Promise(()=>{}):open(file,...rest);syncBuiltinESMExports();");
 for(const [payload,env] of [[titlePayload(transcript),{NODE_OPTIONS:`--import=${pathToFileURL(stall).href}`}],[titlePayload(join(directory,'missing.jsonl')),{}]]){
  assert.deepEqual(await run(path,payload,env),{code:0,stdout:'',stderr:''});
 }
 // The hook exits at its own 2.9 s deadline without sending, so an event that arrives proves the title read gave up
 // first. Without the title deadline, the hung read would hold the hook until that exit and nothing would be sent.
 assert.equal(requests.length,2);for(const request of requests){assert.equal(request.apiVersion,'1.1');assert.equal(request.project,'project');assert.equal(request.title,undefined);}
});

test('a PostToolUse payload above 64 KiB still resolves attention',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-hook-large-'));t.after(()=>rm(directory,{recursive:true,force:true}));const requests=[];
 const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{requests.push(JSON.parse(body));res.end('{}');});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const path=join(directory,'producer.json');await writeFile(path,JSON.stringify({enabled:true,qualified:true,source:{provider:'claude',client:'code',hostId:'host',sourceId:'source',hook:'SessionStart'},endpoint:`http://127.0.0.1:${server.address().port}/api/monitor/v1/events`,token:'t'.repeat(43)}),{mode:0o600});
 const payload={hook_event_name:'PostToolUse',session_id:'session',prompt_id:'prompt',tool_use_id:'toolu_01',tool_name:'Read',tool_response:{content:'PRIVATE_CANARY'.repeat(80000)}};
 assert.ok(JSON.stringify(payload).length>1024*1024);
 assert.deepEqual(await run(path,payload),{code:0,stdout:'',stderr:''});
 assert.equal(requests.length,1);assert.deepEqual(requests[0].event,{kind:'attention.resolved',attention:{status:'known',id:'toolu_01'}});
 assert.ok(!JSON.stringify(requests).includes('PRIVATE_CANARY'));
});

test('explicit lifecycle 1.2 adds only the Claude Desktop session ID from the hook environment',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-host-session-hook-'));t.after(()=>rm(directory,{recursive:true,force:true}));const path=join(directory,'producer.json');
 const requests=[];const server=createServer(async(req,res)=>{let data='';for await(const b of req)data+=b;requests.push(JSON.parse(data));res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const common={enabled:true,qualified:true,source:{provider:'claude',client:'code',hostId:'host',sourceId:'source',hook:'SessionStart'},endpoint:`http://127.0.0.1:${server.address().port}/api/monitor/v1/events`,token:'t'.repeat(43)};
 const payload={hook_event_name:'UserPromptSubmit',session_id:'session',prompt_id:'turn',prompt:'CONTENT_CANARY'};
 const desktop={CLAUDE_CODE_ENTRYPOINT:'claude-desktop',CLAUDE_CODE_HOST_SESSION_ID:'local_0f8e2c4a-5b6d-4e7f-8a9b-0c1d2e3f4a5b',PRIVATE_SETTING:'PRIVATE_CANARY'};
 for(const [config,env] of [[common,desktop],[{...common,lifecycleVersion:'1.1'},desktop],[{...common,lifecycleVersion:'1.2'},desktop],
  [{...common,lifecycleVersion:'1.2'},{...desktop,CLAUDE_CODE_ENTRYPOINT:'cli'}],[{...common,lifecycleVersion:'1.2'},{...desktop,CLAUDE_CODE_HOST_SESSION_ID:'local id'}],[{...common,lifecycleVersion:'1.3'},desktop]]){
  await writeFile(path,JSON.stringify(config),{mode:0o600});assert.deepEqual(await run(path,payload,env),{code:0,stdout:'',stderr:''});
 }
 assert.deepEqual(requests.map(r=>[r.apiVersion,r.hostSessionId??null]),[['1.0',null],['1.1',null],['1.2',desktop.CLAUDE_CODE_HOST_SESSION_ID],['1.2',null],['1.2',null]]);
 assert.doesNotMatch(JSON.stringify(requests),/CANARY|PRIVATE_SETTING|CLAUDE_CODE|claude-desktop/);
});
