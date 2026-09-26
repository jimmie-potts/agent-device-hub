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
  const code=`import {acquireWriterLease} from ${JSON.stringify(new URL('../dist/runner.js',import.meta.url).href)};
    const release=acquireWriterLease('device',${JSON.stringify(root)});
    process.once('exit',release);
    for(let i=0;i<3;i++){global.gc();await new Promise(setImmediate);}
    console.log('leased');setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--expose-gc','--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});
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
  const titled = { ...event, apiVersion: '1.1', title: { value: 'Launch review', source: 'provider' }, project: 'Device hub', observedAtMs: Date.now() + 1 };
  assert.equal((await owner.ingest(titled)).ok, true);
  let feedCalls=0,pushes=0,removals=0;
  const requested=[];
  const server=createServer((req,res)=>{feedCalls++;requested.push(req.url);res.end(JSON.stringify({apiVersion:'1.0',ownerId:'owner',connection:'current',snapshot:owner.snapshot('1.2')}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  let sent;const pushed=new Promise(resolve=>{sent=resolve;});
  const connection={capabilities:{backend:'tidbyt-cloud',backgroundPush:{supported:true},foregroundPush:{supported:false},installationRead:{supported:true},installationRemove:{supported:true}},
    async push(webp){pushes++;sent(webp);return {outcome:'sent'};},async remove(){removals++;return {outcome:'sent'};},async readInstallation(){return {ok:true,present:true};}};
  const config={...loadRunnerConfig(s.configFile),hubUrl:`http://127.0.0.1:${server.address().port}`};
  const runner=startStatusRunner(config,{connection,leaseRoot:join(s.dir,'locks')});t.after(()=>runner.stop());
  const webp = await pushed;
  assert.deepEqual(requested, ['/api/monitor/v1/sessions?snapshotVersion=1.2']);
  const { statusView, statusFrame, renderFrame } = await import('../dist/index.js');
  const view = statusView(owner.snapshot('1.2'));
  assert.equal(view.rows[0].label, 'LAUNCH REV');
  assert.deepEqual(webp, renderFrame(statusFrame(view)).webp);
  assert.throws(()=>startStatusRunner(config,{connection,leaseRoot:join(s.dir,'locks')}),/writer-unavailable/);
  await runner.stop();await runner.stop();
  assert.equal(pushes,1);assert.equal(removals,0);assert.equal(feedCalls,1);
  acquireWriterLease('device',join(s.dir,'locks'))();
});

test('runner exposes its one controller through the package runner export', async t=>{
  const s=privateSetup(t);
  const exported=await import('@jimmie-potts/tidbyt-controller/runner');
  assert.equal(exported.startStatusRunner,startStatusRunner);
  const connection={capabilities:{backend:'tidbyt-cloud',backgroundPush:{supported:true},foregroundPush:{supported:false},installationRead:{supported:true},installationRemove:{supported:true}},
    async push(){return {outcome:'sent'};},async remove(){return {outcome:'sent'};},async readInstallation(){return {ok:true,present:false};}};
  const runner=startStatusRunner(loadRunnerConfig(s.configFile),{connection,leaseRoot:join(s.dir,'locks')});t.after(()=>runner.stop());
  const {controller}=runner.controller.snapshot();
  assert.deepEqual([controller.identity.controllerId,controller.identity.deviceId,controller.identity.sourceId],['tidbyt-status','tidbyt','tidbyt-cloud']);
  const receipt=runner.controller.submit({apiVersion:'1.0',controllerId:'tidbyt-status',deviceId:'tidbyt',requestId:controller.nextRequestId,
    expectedConfigurationRevision:controller.configurationRevision,expectedGeneration:controller.generation,command:{kind:'power.set',on:false}});
  assert.equal(receipt.decision,'unsupported-capability');
  await runner.stop();
});

import { HubPlaybackFeed, runnerConnection } from '../dist/runner.js';

const playbackSnapshot=(extra={})=>({apiVersion:'1.0',sourceId:'ht-a9',availability:'available',observedAtMs:Date.now(),ageMs:400,
  playback:{status:'playing',title:'Harvest Moon',artist:'Neil Young',controls:['pause']},...extra});

test('playback feed reads the loopback snapshot for its source and rejects everything else', async t=>{
  let mode='good',redirectCalls=0;const calls=[];
  const server=createServer((req,res)=>{
    calls.push([req.method,req.url,req.headers.authorization]);
    if(req.url==='/redirect'){redirectCalls++;res.end('{}');return;}
    if(mode==='timeout'){res.writeHead(200);res.write('{');return;}
    if(mode==='failed'){res.statusCode=403;res.end('{"error":"forbidden"}');return;}
    if(mode==='redirect'){res.writeHead(302,{Location:'/redirect'});res.end();return;}
    if(mode==='oversized'){res.end(' '.repeat(64*1024+1));return;}
    if(mode==='malformed'){res.end('not json');return;}
    res.end(JSON.stringify(mode==='source'?playbackSnapshot({sourceId:'other'}):mode==='availability'?playbackSnapshot({availability:'fresh'}):playbackSnapshot()));
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const feed=new HubPlaybackFeed({hubUrl:`http://127.0.0.1:${server.address().port}`,sourceId:'ht-a9',token:'p'.repeat(43)});
  assert.equal((await feed.snapshot()).playback.title,'Harvest Moon');
  assert.deepEqual(calls,[['GET','/api/playback/v1/snapshot','Bearer '+'p'.repeat(43)]]);
  for(mode of ['source','availability','malformed','failed','redirect','oversized','timeout'])await assert.rejects(feed.snapshot(),{message:'feed-unavailable'},mode);
  assert.equal(redirectCalls,0);
  for(const options of [{sourceId:'bad id'},{sourceId:''},{token:'short'},{hubUrl:'http://localhost:8788'}]){
    assert.throws(()=>new HubPlaybackFeed({hubUrl:'http://127.0.0.1:8788',sourceId:'ht-a9',token:'p'.repeat(43),...options}),{message:'invalid-runner-config'});
  }
});

test('an optional now-playing block is validated like the rest of the private configuration', t=>{
  const s=privateSetup(t);
  const playbackTokenFile=join(s.dir,'playback-token');writeFileSync(playbackTokenFile,'p'.repeat(43),{mode:0o600});
  assert.equal(loadRunnerConfig(s.configFile).nowPlaying,undefined);
  const write=nowPlaying=>writeFileSync(s.configFile,JSON.stringify({...s.value,nowPlaying}));
  write({tokenFile:playbackTokenFile,sourceId:'ht-a9'});
  assert.deepEqual(loadRunnerConfig(s.configFile).nowPlaying,{token:'p'.repeat(43),sourceId:'ht-a9',installationId:'nowplaying'});
  write({tokenFile:playbackTokenFile,sourceId:'ht-a9',installationId:'music'});
  assert.equal(loadRunnerConfig(s.configFile).nowPlaying.installationId,'music');
  const bad=[null,'ht-a9',[],{sourceId:'ht-a9'},{tokenFile:playbackTokenFile},{tokenFile:playbackTokenFile,sourceId:'ht-a9',extra:1},
    {tokenFile:playbackTokenFile,sourceId:'bad id'},{tokenFile:playbackTokenFile,sourceId:'ht-a9',installationId:'agentdevicehub'},
    {tokenFile:playbackTokenFile,sourceId:'ht-a9',installationId:'has-dash'},{tokenFile:'relative',sourceId:'ht-a9'}];
  for(const value of bad){write(value);assert.throws(()=>loadRunnerConfig(s.configFile),{message:'invalid-runner-config'},JSON.stringify(value));}
  write({tokenFile:playbackTokenFile,sourceId:'ht-a9'});chmodSync(playbackTokenFile,0o644);
  assert.throws(()=>loadRunnerConfig(s.configFile),{message:'invalid-runner-config'});
});

test('with now-playing configured, the runner writes both tiles through one controller', async t=>{
  const s=privateSetup(t);
  const playbackTokenFile=join(s.dir,'playback-token');writeFileSync(playbackTokenFile,'p'.repeat(43),{mode:0o600});
  writeFileSync(s.configFile,JSON.stringify({...s.value,nowPlaying:{tokenFile:playbackTokenFile,sourceId:'ht-a9'}}));
  const owner=await createAgentState({storage:new MemoryStorage(),ownerId:'owner',consumers:[]});t.after(()=>owner.shutdown());
  const {normalizeHook}=await import('@jimmie-potts/agent-state/providers');
  const event=normalizeHook({session_id:'test',turn_id:'turn',prompt_id:'turn'},{provider:'claude',client:'code',hostId:'host',sourceId:'source',sessionId:'test',hook:'UserPromptSubmit'},Date.now());
  assert.equal((await owner.ingest(event)).ok,true);
  const routes=[];
  const server=createServer((req,res)=>{
    routes.push([req.url,req.headers.authorization.slice(-3)]);
    res.end(JSON.stringify(req.url==='/api/playback/v1/snapshot'?playbackSnapshot():{apiVersion:'1.0',ownerId:'owner',connection:'current',snapshot:owner.snapshot('1.2')}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const writes=[];let done;const both=new Promise(resolve=>{done=resolve;});
  const connection={capabilities:{backend:'tidbyt-cloud',backgroundPush:{supported:true},foregroundPush:{supported:false},installationRead:{supported:true},installationRemove:{supported:true}},
    additionalInstallations:['nowplaying'],
    async push(_webp,_signal,installation){writes.push(['push',installation]);if(writes.length===2)done();return {outcome:'sent'};},
    async remove(_signal,installation){writes.push(['remove',installation]);return {outcome:'sent'};},async readInstallation(){return {ok:true,present:true};}};
  const config={...loadRunnerConfig(s.configFile),hubUrl:`http://127.0.0.1:${server.address().port}`};
  const runner=startStatusRunner(config,{connection,leaseRoot:join(s.dir,'locks')});t.after(()=>runner.stop());
  await both;
  await runner.stop();
  assert.deepEqual(writes.map(([kind,installation])=>[kind,installation??'default']).sort(),[['push','default'],['push','nowplaying']]);
  assert.deepEqual(routes.map(([url])=>url).sort(),['/api/monitor/v1/sessions?snapshotVersion=1.2','/api/playback/v1/snapshot']);
  assert.deepEqual(Object.fromEntries(routes),{'/api/monitor/v1/sessions?snapshotVersion=1.2':'ttt','/api/playback/v1/snapshot':'ppp'},'each route uses its own token');
  assert.equal(runner.state().nowPlaying.installation,'present');
});

test('the cloud connection lists the now-playing installation only when it is configured', t=>{
  const s=privateSetup(t);
  assert.deepEqual(runnerConnection(loadRunnerConfig(s.configFile)).additionalInstallations,[]);
  const playbackTokenFile=join(s.dir,'playback-token');writeFileSync(playbackTokenFile,'p'.repeat(43),{mode:0o600});
  writeFileSync(s.configFile,JSON.stringify({...s.value,nowPlaying:{tokenFile:playbackTokenFile,sourceId:'ht-a9'}}));
  assert.deepEqual(runnerConnection(loadRunnerConfig(s.configFile)).additionalInstallations,['nowplaying']);
});


test('SIGTERM the instant the runner announces readiness closes cleanly ten times', async t=>{
  const s=privateSetup(t);
  for(let run=0;run<10;run++){
    const child=spawn(process.execPath,['--experimental-test-module-mocks','--import',new URL('./cli-fixture.mjs',import.meta.url).href,new URL('../dist/cli.js',import.meta.url).pathname,s.configFile],{stdio:['ignore','pipe','pipe']});
    const closed=once(child,'close');
    const timer=setTimeout(()=>child.kill('SIGKILL'),7000);
    let stdout='',signalled=false;
    child.stdout.on('data',chunk=>{
      stdout+=chunk;
      if(!signalled&&stdout.includes('tidbyt-status-started')){signalled=true;child.kill('SIGTERM');}
    });
    try{
      assert.deepEqual(await closed,[0,null],`run ${run}`);
      assert.equal(signalled,true,`run ${run} reached readiness`);
      assert.equal(stdout,'tidbyt-status-started\ntidbyt-status-stopped\n',`run ${run}`);
      acquireWriterLease('device',join(s.dir,'locks'))();
    }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}
  }
});


for(const signal of ['SIGINT','SIGTERM']) test(`${signal} during runner startup is honored after startup finishes`,async t=>{
  const s=privateSetup(t);
  const child=spawn(process.execPath,['--experimental-test-module-mocks','--import',new URL('./cli-fixture.mjs',import.meta.url).href,new URL('../dist/cli.js',import.meta.url).pathname,s.configFile],{env:{...process.env,TEST_START_SIGNAL:signal},stdio:['ignore','pipe','pipe']});
  const closed=once(child,'close');
  const timer=setTimeout(()=>child.kill('SIGKILL'),7000);
  let stdout='';child.stdout.on('data',chunk=>{stdout+=chunk;});
  try{
    assert.deepEqual(await closed,[0,null]);
    assert.equal(stdout,'tidbyt-status-started\ntidbyt-status-stopped\n');
    acquireWriterLease('device',join(s.dir,'locks'))();
  }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}
});
