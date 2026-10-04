import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {validateEvent} from '@jimmie-potts/agent-lifecycle-contracts/v1.2';

const bin=fileURLToPath(new URL('../bin/hook.mjs',import.meta.url));
const source={provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'Stop'};
const raw=JSON.stringify({session_id:'session',turn_id:'turn',prompt:'PRIVATE_CANARY',transcript_path:'/PRIVATE_CANARY',tool_input:{secret:'PRIVATE_CANARY'}});
async function invoke(t,config,input=raw,{end=true,env}={}){
  const directory=await mkdtemp(join(tmpdir(),'agent-hook-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'config.json');await writeFile(path,JSON.stringify(config));
  const started=performance.now(),child=spawn(process.execPath,[bin,path],{stdio:['pipe','pipe','pipe'],...(env?{env:{...process.env,...env}}:{})});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.stdin.on('error',()=>{});
  if(end)child.stdin.end(input);else child.stdin.write(input);
  const watchdog=setTimeout(()=>child.kill(),4000);
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr,elapsed:performance.now()-started}));});
  clearTimeout(watchdog);assert.equal(result.code,0,JSON.stringify(result));assert.equal(result.signal,null);
  assert.equal(result.stdout,'');assert.equal(result.stderr,'');assert.ok(result.elapsed<3000,JSON.stringify(result));return result;
}
async function collector(t,handler){
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return `http://127.0.0.1:${server.address().port}/v1/agent-events`;
}
test('hook transports allowlisted metadata once and never emits agent output',async t=>{
  const received=[];const endpoint=await collector(t,(request,response)=>{let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{received.push({url:request.url,method:request.method,body});response.writeHead(204);response.end();});});
  await invoke(t,{source,endpoint,enabled:true,qualified:true,timeoutMs:250});
  assert.equal(received.length,1);assert.equal(received[0].method,'POST');assert.equal(received[0].url,'/v1/agent-events');
  assert.doesNotMatch(received[0].body,/PRIVATE_CANARY|prompt|transcript|tool_input/);assert.ok(Buffer.byteLength(received[0].body)<=2048);
  assert.equal(validateEvent(JSON.parse(received[0].body)).ok,true);
});
test('hook fails open on unavailable, failed and stalled collectors',async t=>{
  for(const mode of ['fail','disconnect','stall']){
    const endpoint=await collector(t,(request,response)=>{request.resume();if(mode==='disconnect')request.socket.destroy();else if(mode==='fail'){response.writeHead(500);response.end('PRIVATE_CANARY');}});
    await invoke(t,{source,endpoint,enabled:true,qualified:true,timeoutMs:100});
  }
  await invoke(t,{source,endpoint:'http://127.0.0.1:1/v1/agent-events',enabled:true,qualified:true,timeoutMs:100});
});
test('disabled, invalid, oversized and nonlocal paths send nothing',async t=>{
  let calls=0;const endpoint=await collector(t,(_request,response)=>{calls++;response.end();});
  const config={source,endpoint,enabled:true,qualified:true,timeoutMs:100};
  for(const extra of [{enabled:false},{qualified:false},{endpoint:'https://example.invalid/v1/agent-events'},
    {endpoint:endpoint+'?PRIVATE_CANARY'},{timeoutMs:3001},{source:{...source,hook:'Unsupported'}},{extra:'PRIVATE_CANARY'}])await invoke(t,{...config,...extra});
  for(const input of ['{PRIVATE_CANARY','x'.repeat(65537),JSON.stringify({prompt:'PRIVATE_CANARY'})])await invoke(t,config,input);
  await invoke(t,config,'',{end:false});assert.equal(calls,0);
});
test('lifecycle 1.2 hooks carry the Claude Desktop host session ID from the process environment only',async t=>{
  const received=[];const endpoint=await collector(t,(request,response)=>{let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{received.push(JSON.parse(body));response.writeHead(204);response.end();});});
  const claude={provider:'claude',client:'code',hostId:'host',sourceId:'source',hook:'UserPromptSubmit'};
  const input=JSON.stringify({session_id:'session',prompt_id:'turn',prompt:'PRIVATE_CANARY'});
  const env={CLAUDE_CODE_ENTRYPOINT:'claude-desktop',CLAUDE_CODE_HOST_SESSION_ID:'local_0f8e2c4a-5b6d-4e7f-8a9b-0c1d2e3f4a5b',PRIVATE_SETTING:'PRIVATE_CANARY'};
  for(const lifecycleVersion of [undefined,'1.1','1.2'])await invoke(t,{source:claude,endpoint,enabled:true,qualified:true,timeoutMs:500,...(lifecycleVersion?{lifecycleVersion}:{})},input,{env});
  await invoke(t,{source:claude,endpoint,enabled:true,qualified:true,timeoutMs:500,lifecycleVersion:'1.2'},input,{env:{...env,CLAUDE_CODE_ENTRYPOINT:'cli'}});
  await invoke(t,{source:claude,endpoint,enabled:true,qualified:true,timeoutMs:500,lifecycleVersion:'1.3'},input,{env});
  assert.deepEqual(received.map(event=>[event.apiVersion,event.hostSessionId]),[['1.0',undefined],['1.1',undefined],['1.2',env.CLAUDE_CODE_HOST_SESSION_ID],['1.2',undefined]]);
  for(const event of received){assert.equal(validateEvent(event).ok,true);assert.doesNotMatch(JSON.stringify(event),/PRIVATE_CANARY|PRIVATE_SETTING|CLAUDE_CODE|claude-desktop/);}
});
