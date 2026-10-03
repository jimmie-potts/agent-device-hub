import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startHub} from '../dist/server.js';
import {sha256} from '../dist/install/files.js';
import {probeHealth,observeRunningBuild} from '../dist/install/service.js';
test('Hub health verifies served assets, security and launch socket without treating offline controllers as Hub failure',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hi-health-'));let hub;
 try{
  const token='r'.repeat(43),tokenFile=join(directory,'read-token');await writeFile(tokenFile,token,{mode:0o600});
  hub=await startHub({directory,ownerId:'owner',consumers:[],credentials:[{id:'reader',digest:sha256(token),scopes:['read'],devices:[]}],controllers:[{id:'offline',kind:'nanoleaf',controllerId:'offline',deviceId:'offline',endpoint:'http://127.0.0.1:9/controller/v1',token:'t'.repeat(43)}],browserAccess:'trusted-loopback'});
  const program=fileURLToPath(new URL('..',import.meta.url)),identity={kind:'legacy',legacyId:'legacy-'+('a'.repeat(64)),sourceRevision:'unknown',contentSha256:'a'.repeat(64),manifestSha256:'b'.repeat(64)};
  const observe=async()=>({state:'active',pid:123,start:'new-start',executable:process.execPath,entry:join(program,'dist/cli.js'),build:null});
  const options={endpoint:hub.url,tokenFile,state:directory,browserAccess:'trusted-loopback',observe};
  const resources=hub.resources();const status=await observeRunningBuild(options);assert.equal(status.state,'active');assert.equal(typeof status.build.sourceRevision,'string');assert.equal(hub.resources().browserSessions,resources.browserSessions);assert.equal(hub.resources().launchCodes,resources.launchCodes);
  const proof=await probeHealth(options,program,identity);assert.equal(proof.owner,'owner');assert.equal(proof.collector,'running');assert.equal(proof.assets,true);assert.equal(proof.launchSocket,true);assert.equal(proof.browserSecurity,true);assert.equal(hub.resources().browserSessions,0);
  await assert.rejects(probeHealth({...options,endpoint:'https://example.invalid'},program,identity),/invalid-install-endpoint/);
  await writeFile(tokenFile,'x'.repeat(43));await assert.rejects(probeHealth(options,program,identity),/install-health-request/);
 }finally{await hub?.close();await rm(directory,{recursive:true,force:true});}
});
test('a queued owner write survives a concurrent inspection without faulting the collector',{timeout:15000},async()=>{
 const {inspectPausedOwner}=await import('../dist/install/service.js');
 const {captureStateIsolated}=await import('../dist/install/state.js');
 const directory=await mkdtemp(join(tmpdir(),'hi-pause-')),program=fileURLToPath(new URL('..',import.meta.url));let child;
 try{
  const probe=spawnSync(process.execPath,[join(program,'bin/install-compatibility-probe.mjs'),program,directory,'write'],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);
  const before=await captureStateIsolated(directory);
  child=spawn(process.execPath,['--input-type=module','-e',`
   import {createAgentState} from '@jimmie-potts/agent-state';
   import {HubStorage} from './dist/storage.js';
   const state=JSON.parse(process.env.TEST_STATE);
   const owner=await createAgentState({storage:new HubStorage(process.env.TEST_DIRECTORY),ownerId:state.ownerId,consumers:state.consumers,clock:()=>10000});
   process.on('message',async()=>{const result=await owner.setLabel(state.sessions[0].identity,'Written after inspection');process.send({result,collector:owner.snapshot().collector});});
   process.send('ready');
  `],{cwd:program,env:{...process.env,TEST_STATE:JSON.stringify(before.state),TEST_DIRECTORY:directory},stdio:['ignore','ignore','pipe','ipc']});
  let errors='';child.stderr.on('data',part=>{errors+=part;});
  assert.deepEqual(await once(child,'message'),['ready',undefined],errors);
  const isFrozen=async()=>/\) T /.test(await readFile(`/proc/${child.pid}/stat`,'utf8'));
  const pause={isFrozen,freeze:async()=>{child.kill('SIGSTOP');for(let i=0;i<100&&!await isFrozen();i++)await delay(5);},thaw:async()=>{child.kill('SIGCONT');for(let i=0;i<100&&await isFrozen();i++)await delay(5);}};
  const result=once(child,'message');let received=false;result.then(()=>{received=true;});
  await inspectPausedOwner(pause,async()=>{
   const db=new DatabaseSync(join(directory,'state.sqlite'),{readOnly:true});
   try{db.exec('BEGIN');db.prepare('SELECT * FROM state').all();child.send('write');await delay(100);assert.equal(received,false);assert.deepEqual((await captureStateIsolated(directory)).state,before.state);}
   finally{db.close();}
  });
  const [message]=await result;assert.equal(message.result.ok,true,JSON.stringify(message));assert.equal(message.collector,'running');
 }finally{if(child){child.kill('SIGCONT');const exited=once(child,'exit');child.kill('SIGTERM');await exited;}await rm(directory,{recursive:true,force:true});}
});
test('state inspection resumes the paused owner before checking health, including read failures',async()=>{
 const {inspectPausedOwner}=await import('../dist/install/service.js');
 for(const failure of [false,true]){
  const calls=[];let frozen=false;
  const pause={freeze:async()=>{calls.push('freeze');frozen=true;},thaw:async()=>{calls.push('thaw');frozen=false;},isFrozen:async()=>frozen};
  const inspect=()=>inspectPausedOwner(pause,async()=>{calls.push('read');assert.equal(frozen,true);if(failure)throw new Error('invalid-install-state');return 'snapshot';});
  if(failure)await assert.rejects(inspect(),/invalid-install-state/);else assert.equal(await inspect(),'snapshot');
  assert.deepEqual(calls,['freeze','read','thaw']);assert.equal(frozen,false);
 }
});
test('unverified pause and resume fail inspection rather than claiming success',async()=>{
 const {inspectPausedOwner}=await import('../dist/install/service.js');
 let reads=0,thaws=0;
 await assert.rejects(inspectPausedOwner({isFrozen:async()=>false,freeze:async()=>{},thaw:async()=>{thaws++;}},async()=>{reads++;}),/install-owner-pause-unverified/);
 assert.equal(reads,0);assert.equal(thaws,1);
 let frozen=false;
 await assert.rejects(inspectPausedOwner({isFrozen:async()=>frozen,freeze:async()=>{frozen=true;},thaw:async()=>{}},async()=>{reads++;}),/install-owner-resume-unverified/);
 assert.equal(reads,1);
 await assert.rejects(inspectPausedOwner({isFrozen:async()=>true,freeze:async()=>assert.fail(),thaw:async()=>assert.fail()},async()=>assert.fail()),/install-owner-already-paused/);
});
