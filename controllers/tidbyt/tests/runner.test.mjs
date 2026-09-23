import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createAgentState, MemoryStorage } from '@jimmie-potts/agent-state';
import { HubStatusFeed } from '../dist/runner.js';

test('feed reads a real shared snapshot and rejects a source switch', async t => {
  const owner = await createAgentState({storage:new MemoryStorage(),ownerId:'owner',consumers:[]});
  t.after(() => owner.shutdown());
  let ownerId='owner'; const calls=[];
  const server=createServer((req,res)=>{calls.push([req.method,req.url,req.headers.authorization]);res.end(JSON.stringify({apiVersion:'1.0',ownerId,connection:'current',snapshot:owner.snapshot()}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const feed=new HubStatusFeed({hubUrl:`http://127.0.0.1:${server.address().port}`,ownerId:'owner',token:'t'.repeat(43)});
  assert.equal((await feed.snapshot()).collector,'running');
  assert.deepEqual(calls,[['GET','/api/monitor/v1/sessions','Bearer '+'t'.repeat(43)]]);
  ownerId='other';await assert.rejects(feed.snapshot(),/feed-unavailable/);
});

import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadRunnerConfig, acquireWriterLease, startStatusRunner } from '../dist/runner.js';

function privateSetup(t) {
  const dir=mkdtempSync(join(tmpdir(),'tidbyt-runner-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const tokenFile=join(dir,'token'),credentialsFile=join(dir,'credentials'),configFile=join(dir,'config.json');
  writeFileSync(tokenFile,'t'.repeat(43),{mode:0o600});
  writeFileSync(credentialsFile,'TIDBYT_DEVICE_ID=device\nTIDBYT_API_KEY=private-key-sentinel\n',{mode:0o600});
  const value={hubUrl:'http://127.0.0.1:8788',ownerId:'owner',tokenFile,credentialsFile};
  writeFileSync(configFile,JSON.stringify(value),{mode:0o600});
  return {dir,tokenFile,credentialsFile,configFile,value};
}

test('private configuration rejects unsafe inputs without echoing their contents', t=>{
  const s=privateSetup(t);
  assert.equal(loadRunnerConfig(s.configFile).credentials.deviceId,'device');
  for(const file of [s.configFile,s.tokenFile,s.credentialsFile]){
    chmodSync(file,0o644);assert.throws(()=>loadRunnerConfig(s.configFile),{message:'invalid-runner-config'});chmodSync(file,0o600);
  }
  const link=join(s.dir,'link');symlinkSync(s.credentialsFile,link);
  writeFileSync(s.configFile,JSON.stringify({...s.value,credentialsFile:link}));
  assert.throws(()=>loadRunnerConfig(s.configFile),{message:'invalid-runner-config'});
  for(const hubUrl of ['https://127.0.0.1:8788','http://localhost:8788','http://127.1:8788','http://127.0.0.1:8788/a','http://127.0.0.1:8788?x=1','http://127.0.0.1:99999']){
    writeFileSync(s.configFile,JSON.stringify({...s.value,hubUrl}));
    assert.throws(()=>loadRunnerConfig(s.configFile),{message:'invalid-runner-config'});
  }
  for(const ownerId of [null,true,123,['owner'],{}]){
    writeFileSync(s.configFile,JSON.stringify({...s.value,ownerId}));
    assert.throws(()=>loadRunnerConfig(s.configFile),{message:'invalid-runner-config'});
  }
  writeFileSync(s.configFile,JSON.stringify(s.value));
  mkdirSync(join(s.dir,'.git'));writeFileSync(join(s.dir,'.git/HEAD'),'ref: refs/heads/main');
  assert.throws(()=>loadRunnerConfig(s.configFile),{message:'invalid-runner-config'});
});

test('feed rejects incompatible, failed, redirected, oversized and stalled responses', async t=>{
  let mode='version',redirectCalls=0;
  const owner=await createAgentState({storage:new MemoryStorage(),ownerId:'owner',consumers:[]});t.after(()=>owner.shutdown());
  const server=createServer((req,res)=>{
    if(req.url==='/redirect'){redirectCalls++;res.end('{}');return;}
    if(mode==='timeout'){res.writeHead(200);res.write('{');return;}
    if(mode==='failed'){res.statusCode=401;res.end('private-key-sentinel');return;}
    if(mode==='redirect'){res.writeHead(302,{Location:'/redirect'});res.end();return;}
    if(mode==='oversized'){res.end(' '.repeat(1024*1024+1));return;}
    const value={apiVersion:'1.0',ownerId:'owner',connection:'current',snapshot:owner.snapshot()};
    if(mode==='version')value.apiVersion='2.0';
    if(mode==='connection')value.connection='stale';
    if(mode==='snapshot')value.snapshot={};
    res.end(mode==='malformed'?'not json':JSON.stringify(value));
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const feed=new HubStatusFeed({hubUrl:`http://127.0.0.1:${server.address().port}`,ownerId:'owner',token:'t'.repeat(43)});
  for(mode of ['version','connection','snapshot','malformed','failed','redirect','oversized','timeout'])await assert.rejects(feed.snapshot(),{message:'feed-unavailable'});
  assert.equal(redirectCalls,0);
  mode='good';assert.equal((await feed.snapshot()).collector,'running');
});

test('a cloud device lease excludes other installations and is released by process death', async t=>{
  const s=privateSetup(t);const root=join(s.dir,'locks');
  const release=acquireWriterLease('device',root);
  assert.throws(()=>acquireWriterLease('device',root),/writer-unavailable/);
  const probe=`import {acquireWriterLease} from ${JSON.stringify(new URL('../dist/runner.js',import.meta.url).href)};acquireWriterLease('device',${JSON.stringify(root)})();`;
  assert.notEqual(spawnSync(process.execPath,['--input-type=module','-e',probe]).status,0,'failed same-process acquisition must not release the original OS lock');
  const other=acquireWriterLease('different-device',root);other();release();release();
  const code=`import {acquireWriterLease} from ${JSON.stringify(new URL('../dist/runner.js',import.meta.url).href)};acquireWriterLease('device',${JSON.stringify(root)});console.log('leased');setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill('SIGKILL'));
  await once(child.stdout,'data');
  assert.throws(()=>acquireWriterLease('device',root),/writer-unavailable/);
  child.kill('SIGKILL');await once(child,'exit');
  acquireWriterLease('device',root)();
});

test('runner consumes a real owner feed through its queue and stops without deleting', async t=>{
  const s=privateSetup(t);
  const owner=await createAgentState({storage:new MemoryStorage(),ownerId:'owner',consumers:[]});t.after(()=>owner.shutdown());
  const {normalizeHook}=await import('@jimmie-potts/agent-state/providers');
  const event=normalizeHook({session_id:'test',turn_id:'turn',prompt_id:'turn'},{provider:'claude',client:'code',hostId:'host',sourceId:'source',sessionId:'test',hook:'UserPromptSubmit'},Date.now());
  assert.equal((await owner.ingest(event)).ok,true);
  let feedCalls=0,pushes=0,removals=0;
  const server=createServer((req,res)=>{feedCalls++;res.end(JSON.stringify({apiVersion:'1.0',ownerId:'owner',connection:'current',snapshot:owner.snapshot()}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  let sent;const pushed=new Promise(resolve=>{sent=resolve;});
  const connection={capabilities:{backend:'tidbyt-cloud',backgroundPush:{supported:true},foregroundPush:{supported:false},installationRead:{supported:true},installationRemove:{supported:true}},
    async push(){pushes++;sent();return {outcome:'sent'};},async remove(){removals++;return {outcome:'sent'};},async readInstallation(){return {ok:true,present:true};}};
  const config={...loadRunnerConfig(s.configFile),hubUrl:`http://127.0.0.1:${server.address().port}`};
  const runner=startStatusRunner(config,{connection,leaseRoot:join(s.dir,'locks')});t.after(()=>runner.stop());
  await pushed;
  assert.throws(()=>startStatusRunner(config,{connection,leaseRoot:join(s.dir,'locks')}),/writer-unavailable/);
  await runner.stop();await runner.stop();
  assert.equal(pushes,1);assert.equal(removals,0);assert.equal(feedCalls,1);
  acquireWriterLease('device',join(s.dir,'locks'))();
});
