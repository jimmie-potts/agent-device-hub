import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
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
