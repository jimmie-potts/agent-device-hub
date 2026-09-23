import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,lstat,mkdir,writeFile,readFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {startHub} from '../dist/server.js';
import {requestBrowserLaunch} from '../dist/browser-launch.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
const post=(url,body,headers={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-pixoo-request':'1',...headers},body:JSON.stringify(body)});

test('owner launch is private, single-use and issues only bounded browser authority',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-browser-launch-'));let hub;
 try{
  hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[{id:'wall',kind:'nanoleaf',controllerId:'c',deviceId:'d',endpoint:'http://127.0.0.1:1/controller/v1',token:'n'.repeat(43)}],credentials:[{id:'producer',digest:digest('p'.repeat(43)),scopes:['ingest'],devices:[]}],mcp:true});
  const socket=await lstat(join(directory,'bunny-launch.sock'));assert.equal(socket.isSocket(),true);assert.equal(socket.mode&0o077,0);
  const launch=await requestBrowserLaunch(directory);assert.equal(launch.url,hub.url);assert.match(launch.code,/^[A-Za-z0-9_-]{43}$/);
  assert.equal((await post(hub.url+'/api/dashboard/v1/launch',{code:launch.code},{origin:'http://evil.invalid'})).status,403);
  const issued=await post(hub.url+'/api/dashboard/v1/launch',{code:launch.code},{origin:hub.url});assert.equal(issued.status,200);const {token}=await issued.json();assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal((await post(hub.url+'/api/dashboard/v1/launch',{code:launch.code},{origin:hub.url})).status,401);
  const headers={authorization:`Bearer ${token}`};
  const context=await fetch(hub.url+'/api/dashboard/v1/context',{headers});assert.equal(context.status,200);const view=await context.json();assert.equal(view.control,true);assert.deepEqual(view.components.map(c=>c.id),['wall']);
  assert.equal((await fetch(hub.url+'/api/hub/v1/authority?scope=ingest',{headers})).status,403);
  assert.equal((await post(hub.url+'/api/monitor/v1/events',{},headers)).status,403);
  assert.equal((await fetch(hub.url+'/mcp',{headers:{...headers,accept:'application/json, text/event-stream'}})).status,401);
  assert.equal((await fetch(hub.url+'/api/controllers/v1/other/snapshot',{headers})).status,403);
  assert.equal((await post(hub.url+'/api/dashboard/v1/logout',{},headers)).status,200);
  assert.equal((await fetch(hub.url+'/api/dashboard/v1/context',{headers})).status,401);
  const next=await requestBrowserLaunch(directory);const session=await post(hub.url+'/api/dashboard/v1/launch',{code:next.code},{origin:hub.url});assert.equal(session.status,200);const nextToken=(await session.json()).token;
  hub.replaceCredentials([{id:'producer',digest:digest('p'.repeat(43)),scopes:['ingest'],devices:[]}]);
  assert.equal((await fetch(hub.url+'/api/dashboard/v1/context',{headers:{authorization:`Bearer ${nextToken}`}})).status,401);
 }finally{await hub?.close();await rm(directory,{recursive:true,force:true});}
});

test('launch codes are unavailable after expiry and direct visits remain unauthenticated',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-browser-expiry-'));let hub;
 try{
  hub=await startHub({directory,ownerId:'owner',consumers:[],controllers:[],credentials:[{id:'reader',digest:digest('r'.repeat(43)),scopes:['read'],devices:[]}]});
  assert.equal((await fetch(hub.url+'/api/dashboard/v1/context')).status,401);
  assert.equal((await post(hub.url+'/api/dashboard/v1/launch',{code:'x'.repeat(43)},{origin:hub.url})).status,401);
  const launch=await requestBrowserLaunch(directory);assert.equal((await post(hub.url+'/api/dashboard/v1/launch',{code:launch.code},{'sec-fetch-site':'cross-site',origin:hub.url})).status,403);
  const original=Date.now,start=original();
  try{Date.now=()=>start+31000;assert.equal((await post(hub.url+'/api/dashboard/v1/launch',{code:launch.code},{origin:hub.url})).status,401);}finally{Date.now=original;}
  assert.equal((await fetch(hub.url+'/api/dashboard/v1/context',{headers:{authorization:'Bearer '+'r'.repeat(43)}})).status,200);
  const fresh=await requestBrowserLaunch(directory),issued=await post(hub.url+'/api/dashboard/v1/launch',{code:fresh.code},{origin:hub.url});const browserToken=(await issued.json()).token;
  const now=Date.now,begin=now();
  try{Date.now=()=>begin+8*60*60*1000+1;assert.equal((await fetch(hub.url+'/api/dashboard/v1/context',{headers:{authorization:`Bearer ${browserToken}`}})).status,401);}finally{Date.now=now;}
 }finally{await hub?.close();await rm(directory,{recursive:true,force:true});}
});

test('owner CLI opens one-time URL without printing the code',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-browser-opener-'));let hub;
 try{
  const state=join(directory,'state'),bin=join(directory,'bin'),capture=join(directory,'opened-url');await mkdir(state,{mode:0o700});await mkdir(bin,{mode:0o700});
  const configuration=join(directory,'host.json'),options={directory:state,ownerId:'owner',consumers:[],controllers:[],port:0,credentials:[{id:'reader',digest:digest('r'.repeat(43)),scopes:['read'],devices:[]}]};
  await writeFile(configuration,JSON.stringify(options),{mode:0o600});
  const opener=join(bin,'cmd.exe');await writeFile(opener,'#!/bin/sh\nprintf %s "$4" > "$BUNNY_CAPTURE"\n');await chmod(opener,0o700);
  hub=await startHub(options);
  const child=spawn(process.execPath,[new URL('../dist/cli.js',import.meta.url).pathname,'open',configuration],{env:{...process.env,WSL_DISTRO_NAME:'Ubuntu',PATH:bin+':'+process.env.PATH,BUNNY_CAPTURE:capture},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const [code]=await once(child,'exit');assert.equal(code,0,stderr);const url=await readFile(capture,'utf8');const parsed=new URL(url);assert.equal(parsed.origin,hub.url);assert.match(parsed.hash,/^#launch=[A-Za-z0-9_-]{43}$/);assert.equal(stdout.includes(parsed.hash.slice(8)),false);
  const response=await post(hub.url+'/api/dashboard/v1/launch',{code:parsed.hash.slice(8)},{origin:hub.url});assert.equal(response.status,200);
 }finally{await hub?.close();await rm(directory,{recursive:true,force:true});}
});
