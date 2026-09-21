import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {hookCommand} from '../dist/setup.js';
async function run(config,payload){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[new URL('../bin/monitor-hook.mjs',import.meta.url).pathname,config],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));});}
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
