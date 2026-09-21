import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {startHub} from '../dist/server.js';
import {launchOwner,quiesceAndStop,stopOwner} from '../dist/migration.js';
const token='m'.repeat(43),credentials=[{id:'migration',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','control','admin','ingest'],devices:[]}];
const options=directory=>({directory,ownerId:'owner',consumers:[],controllers:[],credentials,port:0});
const headers={authorization:`Bearer ${token}`,'x-pixoo-request':'1','content-type':'application/json'};
test('verified process handoff imports once, remains fenced across restart and rejects forged release',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hub-migration-'));let source,destination;
 try{
  for(const name of ['source','destination','other'])await mkdir(join(root,name),{mode:0o700});
  const configuration=join(root,'source.json');await writeFile(configuration,JSON.stringify(options(join(root,'source'))),{mode:0o600});
  source=await launchOwner({kind:'hub',entrypoint:new URL('../dist/cli.js',import.meta.url).pathname,args:['serve',configuration],environment:{},token});
  const receipt=await quiesceAndStop(source,join(root,'export.json'));
  await assert.rejects(startHub(options(join(root,'destination')),{released:receipt}),/invalid-migration/);
  await assert.rejects(startHub(options(join(root,'destination')),{staged:false,released:receipt}),/invalid-migration/);
  destination=await startHub(options(join(root,'destination')),{staged:true,released:receipt});
  const view=await (await fetch(destination.url+'/api/monitor/v1/sessions',{headers})).json();
  assert.equal(view.snapshot.collector,'quiesced');
  await assert.rejects(startHub(options(join(root,'other')),{staged:true,released:receipt}),/consumed/);
  await assert.rejects(startHub(options(join(root,'other')),{staged:true,released:{ownerId:'owner',revision:0}}),/invalid/);
  await destination.close();destination=undefined;
  await assert.rejects(startHub(options(join(root,'destination'))),/owner-quiesced/);
  destination=await startHub(options(join(root,'destination')),{staged:true});
  assert.equal((await (await fetch(destination.url+'/api/monitor/v1/sessions',{headers})).json()).snapshot.collector,'quiesced');
 }finally{await destination?.close();if(source)await stopOwner(source);await rm(root,{recursive:true,force:true});}
});

test('staged routes activate only with valid authority and preserve producer identities',async()=>{
 const {stageProducer,routeDigest,releaseRoute}=await import('../dist/migration-routes.js');
 const root=await mkdtemp(join(tmpdir(),'hub-activation-'));let source,destination,route;
 try{
  for(const name of ['source','destination'])await mkdir(join(root,name),{mode:0o700});
  const configuration=join(root,'source.json');await writeFile(configuration,JSON.stringify(options(join(root,'source'))),{mode:0o600});
  source=await launchOwner({kind:'hub',entrypoint:new URL('../dist/cli.js',import.meta.url).pathname,args:['serve',configuration],environment:{},token});
  const receipt=await quiesceAndStop(source,join(root,'export.json'));destination=await startHub(options(join(root,'destination')),{staged:true,released:receipt});
  const path=join(root,'producer.json'),identity={provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'Stop'};
  await writeFile(path,JSON.stringify({enabled:true,qualified:true,source:identity,endpoint:source.url+'/api/monitor/v1/events',token}),{mode:0o600});
  route=await stageProducer(path,await routeDigest(path),destination.url+'/api/monitor/v1/events',token);
  await destination.activate({producers:[route],consumers:[]});assert.equal(destination.staged(),false);
  const {readFile}=await import('node:fs/promises');const saved=JSON.parse(await readFile(path,'utf8'));assert.equal(saved.enabled,true);assert.deepEqual(saved.source,identity);assert.equal(saved.qualified,true);
  assert.equal((await fetch(destination.url+'/api/hub/v1/health',{headers})).status,200);
  await assert.rejects(destination.activate({producers:[route],consumers:[]}),/activation-unavailable/);
 }finally{if(route)await releaseRoute(route);await destination?.close();if(source)await stopOwner(source);await rm(root,{recursive:true,force:true});}
});

test('concurrent release, changed route and wrong producer credentials fail closed',async()=>{
 const {stageProducer,routeDigest,releaseRoute}=await import('../dist/migration-routes.js');
 const root=await mkdtemp(join(tmpdir(),'hub-migration-failure-'));let source,destination,route;
 try{
  for(const name of ['source','destination'])await mkdir(join(root,name),{mode:0o700});
  const configuration=join(root,'source.json');await writeFile(configuration,JSON.stringify(options(join(root,'source'))),{mode:0o600});
  source=await launchOwner({kind:'hub',entrypoint:new URL('../dist/cli.js',import.meta.url).pathname,args:['serve',configuration],environment:{},token});
  const first=quiesceAndStop(source,join(root,'export.json'));await assert.rejects(quiesceAndStop(source,join(root,'export.json')),/source-not-running/);
  destination=await startHub(options(join(root,'destination')),{staged:true,released:await first});
  const path=join(root,'producer.json');const producer={enabled:true,qualified:true,source:{provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'Stop'},endpoint:source.url+'/api/monitor/v1/events',token};
  await writeFile(path,JSON.stringify(producer),{mode:0o600});
  await assert.rejects(stageProducer(path,'0'.repeat(64),destination.url+'/api/monitor/v1/events',token),/route-changed/);
  route=await stageProducer(path,await routeDigest(path),destination.url+'/api/monitor/v1/events','z'.repeat(43));
  await assert.rejects(stageProducer(path,await routeDigest(path),destination.url+'/api/monitor/v1/events',token),/route-owner-live/);
  await assert.rejects(destination.activate({producers:[route],consumers:[]}),/route-not-ready/);assert.equal(destination.staged(),true);
  const event={apiVersion:'1.0',identity:{provider:'codex',client:'cli',hostId:'h',sourceId:'s',sessionId:'one'},turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:1,ordering:{status:'unknown'}};
  assert.equal((await fetch(destination.url+'/api/monitor/v1/events',{method:'POST',headers,body:JSON.stringify(event)})).status,503);
  await destination.close();destination=undefined;
  await assert.rejects(startHub(options(join(root,'destination'))),/owner-quiesced/);
 }finally{if(route)await releaseRoute(route);await destination?.close();if(source)await stopOwner(source);await rm(root,{recursive:true,force:true});}
});

test('dead coordinator recovery retains original enabled intent and rejects a live lock',async()=>{
 const {spawnSync}=await import('node:child_process');const {readFile}=await import('node:fs/promises');
 const {recoverRoute,routeDigest,releaseRoute}=await import('../dist/migration-routes.js');
 const root=await mkdtemp(join(tmpdir(),'hub-route-recovery-'));let source,destination,route;
 try{
  for(const name of ['source','destination'])await mkdir(join(root,name),{mode:0o700});
  const configuration=join(root,'source.json');await writeFile(configuration,JSON.stringify(options(join(root,'source'))),{mode:0o600});
  source=await launchOwner({kind:'hub',entrypoint:new URL('../dist/cli.js',import.meta.url).pathname,args:['serve',configuration],environment:{},token});
  destination=await startHub(options(join(root,'destination')),{staged:true,released:await quiesceAndStop(source,join(root,'export.json'))});
  const path=join(root,'producer.json');await writeFile(path,JSON.stringify({enabled:true,qualified:true,source:{provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'Stop'},endpoint:source.url+'/api/monitor/v1/events',token}),{mode:0o600});
  const script=`import {stageProducer,routeDigest} from ${JSON.stringify(new URL('../dist/migration-routes.js',import.meta.url).href)};await stageProducer(process.argv[1],await routeDigest(process.argv[1]),process.argv[2],process.argv[3]);`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,path,destination.url+'/api/monitor/v1/events',token],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
  assert.equal(JSON.parse(await readFile(path,'utf8')).enabled,false);
  route=await recoverRoute(path,await routeDigest(path));
  await assert.rejects(recoverRoute(path,await routeDigest(path)),/route-owner-live/);
  await destination.activate({producers:[route],consumers:[]});assert.equal(JSON.parse(await readFile(path,'utf8')).enabled,true);
 }finally{if(route)await releaseRoute(route);await destination?.close();if(source)await stopOwner(source);await rm(root,{recursive:true,force:true});}
});

test('failed supervised startup terminates its own SIGTERM-resistant child',async()=>{
 const {readFile}=await import('node:fs/promises');const root=await mkdtemp(join(tmpdir(),'hub-launch-failure-'));
 try{
  const entrypoint=join(root,'fixture.mjs'),pidPath=join(root,'pid');await writeFile(entrypoint,"import {writeFileSync} from 'node:fs';writeFileSync(process.argv[2],String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);",{mode:0o600});
  await assert.rejects(launchOwner({kind:'hub',entrypoint,args:[pidPath],environment:{},token}),/owner-start-timeout/);
  const pid=Number(await readFile(pidPath,'utf8'));assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('post-rename sync failure preserves recoverable original producer intent',async()=>{
 const {open,readFile,realpath}=await import('node:fs/promises');
 const {stageProducer,recoverRoute,routeDigest,releaseRoute,prepareActivation}=await import('../dist/migration-routes.js');
 const root=await mkdtemp(join(tmpdir(),'hub-route-sync-'));let route,hub;
 const probe=await open(join(root,'probe'),'wx',0o600),prototype=Object.getPrototypeOf(probe),original=prototype.sync;await probe.close();
 try{
  const state=join(root,'state');await mkdir(state,{mode:0o700});hub=await startHub(options(state));
  const path=join(root,'producer.json');await writeFile(path,JSON.stringify({enabled:true,qualified:true,source:{provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'Stop'},endpoint:'http://127.0.0.1:1/api/monitor/v1/events',token}),{mode:0o600});
  let injected=false;
  prototype.sync=async function(){if(!injected&&await realpath('/proc/self/fd/'+this.fd)===root&&JSON.parse(await readFile(path,'utf8')).enabled===false){injected=true;throw Object.assign(new Error('injected-directory-sync'),{code:'EIO'});}return original.call(this);};
  await assert.rejects(stageProducer(path,await routeDigest(path),hub.url+'/api/monitor/v1/events',token),/injected-directory-sync/);assert.equal(injected,true);prototype.sync=original;
  route=await recoverRoute(path,await routeDigest(path));await releaseRoute(route);route=undefined;
  // Releasing an unfinished attempt must retain the original enabled flag too.
  route=await recoverRoute(path,await routeDigest(path));
  await prepareActivation({producers:[route],consumers:[]},hub.url,'owner',[],()=>{throw new Error('no consumers');});
  assert.equal(JSON.parse(await readFile(path,'utf8')).enabled,true);
 }finally{prototype.sync=original;if(route)await releaseRoute(route);await hub?.close();await rm(root,{recursive:true,force:true});}
});

test('death before publishing initial intent leaves the original route available',async()=>{
 const {spawnSync}=await import('node:child_process');const {readFile,readdir}=await import('node:fs/promises');
 const {stageProducer,routeDigest,releaseRoute}=await import('../dist/migration-routes.js');
 const root=await mkdtemp(join(tmpdir(),'hub-route-init-'));let route;
 try{
  const path=join(root,'producer.json');await writeFile(path,JSON.stringify({enabled:true,qualified:true,source:{provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'Stop'},endpoint:'http://127.0.0.1:1/api/monitor/v1/events',token}),{mode:0o600});
  const before=await routeDigest(path);
  const script=`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';const mkdir=fs.mkdir;fs.mkdir=async(...args)=>{const result=await mkdir(...args);if(String(args[0]).includes('.migration-lock.')&&String(args[0]).endsWith('.tmp'))process.exit(0);return result;};syncBuiltinESMExports();const {stageProducer,routeDigest}=await import(${JSON.stringify(new URL('../dist/migration-routes.js',import.meta.url).href)});await stageProducer(process.argv[1],await routeDigest(process.argv[1]),process.argv[2],process.argv[3]);process.exit(99);`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,path,'http://127.0.0.1:2/api/monitor/v1/events',token],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
  assert.equal(await routeDigest(path),before);assert.ok((await readdir(root)).some(name=>name.endsWith('.tmp')));
  route=await stageProducer(path,before,'http://127.0.0.1:2/api/monitor/v1/events',token);assert.equal(JSON.parse(await readFile(path,'utf8')).enabled,false);
 }finally{if(route)await releaseRoute(route);await rm(root,{recursive:true,force:true});}
});

test('activation rejects the host masquerading as a missing Pixoo consumer',async()=>{
 const {routeDigest,stageProducer,stagePixooSource,releaseRoute}=await import('../dist/migration-routes.js');
 const root=await mkdtemp(join(tmpdir(),'hub-missing-facade-'));let hub,source;const routes=[];
 try{
  const directory=join(root,'host');await mkdir(directory,{mode:0o700});
  const sourceDir=join(root,'source');await mkdir(sourceDir,{mode:0o700});const configPath=join(root,'source.json');const configOptions={...options(sourceDir),consumers:[{id:'pixoo',clearOnNewTurn:true}]};await writeFile(configPath,JSON.stringify(configOptions),{mode:0o600});
  source=await launchOwner({kind:'hub',entrypoint:new URL('../dist/cli.js',import.meta.url).pathname,args:['serve',configPath],environment:{},token});const released=await quiesceAndStop(source,join(root,'export.json'));
  hub=await startHub({...configOptions,directory},{staged:true,released});
  const producer=join(root,'producer.json'),config=join(root,'config.json');
  await writeFile(producer,JSON.stringify({enabled:true,qualified:true,source:{provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'Stop'},endpoint:'http://127.0.0.1:1/api/monitor/v1/events',token}),{mode:0o600});
  await writeFile(config,JSON.stringify({version:1,mode:'embedded',ownerId:'owner'}),{mode:0o600});
  routes.push(await stageProducer(producer,await routeDigest(producer),hub.url+'/api/monitor/v1/events',token));
  routes.push(await stagePixooSource(config,await routeDigest(config),'owner',hub.url+'/api/monitor/v1',token));
  await assert.rejects(hub.activate({producers:[routes[0]],consumers:[{id:'pixoo',route:routes[1],endpoint:hub.url+'/api/monitor/v1',token}]}),/consumer-not-ready/);
  assert.equal(hub.staged(),true);
 }finally{for(const route of routes)await releaseRoute(route);await hub?.close();if(source)await stopOwner(source);await rm(root,{recursive:true,force:true});}
});

test('consumer proof rejects copied handles, wrong startup config and stopped processes',async()=>{
 const {managedPixooConsumer}=await import('../dist/migration.js');
 const root=await mkdtemp(join(tmpdir(),'hub-consumer-proof-'));let owner;
 try{
  const monitor=join(root,'agent-monitor');await mkdir(monitor,{mode:0o700});const path=join(monitor,'config.json'),bytes=JSON.stringify({version:1,mode:'remote',ownerId:'owner'});
  await writeFile(path,bytes,{mode:0o600});const digest=createHash('sha256').update(bytes).digest('hex');
  const entrypoint=join(root,'child.mjs');await writeFile(entrypoint,"process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);console.log('Pixoo simulator listening on http://127.0.0.1:49123');");
  owner=await launchOwner({kind:'pixoo',entrypoint,args:[],environment:{PIXOO_DATA_DIR:root},token});
  assert.equal(managedPixooConsumer(owner,path,digest).endpoint,owner.url+'/api/monitor/v1');
  assert.throws(()=>managedPixooConsumer({...owner},path,digest),/consumer-not-ready/);
  assert.throws(()=>managedPixooConsumer(owner,path+'.other',digest),/consumer-not-ready/);
  assert.throws(()=>managedPixooConsumer(owner,path,'0'.repeat(64)),/consumer-not-ready/);
  await stopOwner(owner);assert.throws(()=>managedPixooConsumer(owner,path,digest),/consumer-not-ready/);
 }finally{if(owner)await stopOwner(owner);await rm(root,{recursive:true,force:true});}
});
