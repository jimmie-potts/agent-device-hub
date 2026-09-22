import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {hookCommand} from '../dist/setup.js';
import {startHub} from '../dist/server.js';
async function run(config,payload){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[new URL('../bin/monitor-hook.mjs',import.meta.url).pathname,config],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));});}
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
