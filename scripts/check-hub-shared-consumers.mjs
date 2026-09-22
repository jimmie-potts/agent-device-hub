// Actual pinned consumers, disposable state and no physical writer.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {startHub} from '../apps/hub/dist/server.js';
import {launchOwner,quiesceAndStop,stopOwner} from '../apps/hub/dist/migration.js';
import {stageProducer,stagePixooSource,routeDigest,releaseRoute} from '../apps/hub/dist/migration-routes.js';
import {planSetup,applySetup,planRemoval,removeSetup,producerPrincipal} from '../apps/hub/dist/setup.js';
import {pixooSetupAuthority,hubSetupAuthority} from '../apps/hub/dist/setup-authority.js';
import {prepareNanoleaf,rollbackNanoleaf} from '../apps/hub/dist/setup-consumer.js';
const [pixooSource,nanoleafSource]=process.argv.slice(2);assert.equal(resolve(pixooSource),pixooSource);assert.equal(resolve(nanoleafSource),nanoleafSource);
const pin=JSON.parse(await readFile(new URL('../apps/hub/fixtures/pixoo-source.json',import.meta.url),'utf8'));
for(const [path,hash] of Object.entries(pin.sourceFiles))assert.equal(createHash('sha256').update(await readFile(join(pixooSource,path))).digest('hex'),hash,path);
const nanoPin=JSON.parse(await readFile(new URL('../apps/hub/fixtures/nanoleaf-shared-source.json',import.meta.url),'utf8'));
for(const [path,hash] of Object.entries(nanoPin.files))assert.equal(createHash('sha256').update(await readFile(join(nanoleafSource,path))).digest('hex'),hash,path);
const {DashboardPager}=await import(pathToFileURL(join(pixooSource,'apps/server/dist/agent-dashboard.js')));const pager=new DashboardPager('pixoo');
const root=await mkdtemp(join(tmpdir(),'hub-shared-')),token='h'.repeat(43),headers={authorization:'Bearer '+token,'content-type':'application/json','x-pixoo-request':'1'};
const consumers=[{id:'pixoo',clearOnNewTurn:true},{id:'nanoleaf',clearOnNewTurn:true}],options=directory=>({directory,ownerId:'owner',consumers,controllers:[],credentials:[{id:'host',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','ingest','control','admin'],devices:[]}],port:0});
let hub,pixoo,oldHub;const routes=[];
const write=(p,v)=>writeFile(p,JSON.stringify(v),{mode:0o600});
async function child(executable,args,environment={},input){return new Promise((resolve,reject)=>{const c=spawn(executable,args,{env:environment,stdio:['pipe','pipe','pipe']});let out='',err='';c.stdout.on('data',v=>out+=v);c.stderr.on('data',v=>err+=v);c.on('error',reject);c.on('exit',code=>{if(code!==0)reject(new Error(`${args.find(arg=>/^(shared-|fixture-)/.test(arg))??'hook'}: ${err||out}`));else resolve(out);});c.stdin.end(input);});}
try{
 for(const name of ['embedded','host','rollback','nanoleaf'])await mkdir(join(root,name),{mode:0o700});
 const local=join(root,'embedded'),configPath=join(local,'agent-monitor/config.json');await mkdir(join(local,'agent-monitor'),{mode:0o700});await write(configPath,{version:1,mode:'embedded',ownerId:'owner',consumers});
 const {provisionCredential}=await import(pathToFileURL(join(pixooSource,'apps/server/dist/mcp-config.js')));const credential=await provisionCredential(join(local,'agent-monitor'),'migration',['read','control']);
 const launch=()=>launchOwner({kind:'pixoo',entrypoint:join(pixooSource,'apps/server/dist/main.js'),args:[],environment:{PIXOO_MODE:'simulator',PIXOO_DATA_DIR:local,PIXOO_PORT:'0',PIXOO_MONITOR_ENABLED:'1'},token:credential});
 pixoo=await launch();
 const setupDir=join(root,'setup');await mkdir(setupDir,{mode:0o700});const target=join(root,'hooks.json'),credentialFile=join(root,'producer-token');await write(target,{hooks:{}});
 const setup={directory:setupDir,target,source:{provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'SessionStart'},endpoint:pixoo.url+'/api/monitor/v1/events',node:process.execPath,hook:new URL('../apps/hub/bin/monitor-hook.mjs',import.meta.url).pathname,owner:'fixture-owner',qualified:false,credentialFile};
 const producerToken=await provisionCredential(join(local,'agent-monitor'),producerPrincipal(setup),['read','control']);await writeFile(credentialFile,producerToken,{mode:0o600});
 const access=pixooSetupAuthority({dataDirectory:local,endpoint:pixoo.url+'/api/monitor/v1',node:process.execPath,managementEntrypoint:join(pixooSource,'apps/server/dist/monitor-cli.js')});
 await applySetup(setup,(await planSetup(setup)).digest,access);const duplicateDirectory=join(root,'duplicate');await mkdir(duplicateDirectory,{mode:0o700});const duplicateTarget=join(root,'duplicate-hooks.json');await write(duplicateTarget,{});const duplicate={...setup,directory:duplicateDirectory,target:duplicateTarget};await assert.rejects(applySetup(duplicate,(await planSetup(duplicate)).digest,access),/source-ownership-conflict/);await assert.rejects(removeSetup(duplicateDirectory,(await planRemoval(duplicateDirectory)).digest,access),/source-ownership-conflict/);await removeSetup(setupDir,(await planRemoval(setupDir)).digest,access);
 assert.equal((await fetch(pixoo.url+'/api/monitor/v1/sessions',{headers:{authorization:'Bearer '+producerToken}})).status,401);
 const released=await quiesceAndStop(pixoo,join(root,'initial.json'));hub=await startHub(options(join(root,'host')),{staged:true,released});
 let activeSetup,activeAuthority,producer;
 async function installProducer(name){const directory=join(root,name);await mkdir(directory,{mode:0o700});const configuration=join(directory,'host.json');await write(configuration,options(hub.directory));activeAuthority=hubSetupAuthority(hub,configuration);const {credentialFile,...base}=setup;activeSetup={...base,directory,qualified:true,endpoint:hub.url+'/api/monitor/v1/events'};await applySetup(activeSetup,(await planSetup(activeSetup)).digest,activeAuthority);producer=join(directory,'producer.json');}
 await installProducer('standalone-setup');
 const nanoConfig=join(root,'nanoleaf.json'),readToken=join(root,'read-token');await writeFile(readToken,token,{mode:0o600});
 const command={executable:'/usr/bin/python3',args:[new URL('./hub-shared-nanoleaf.py',import.meta.url).pathname,nanoleafSource,join(root,'nanoleaf')],environment:{}};
 async function activate(){
  routes.push(await stageProducer(producer,await routeDigest(producer),hub.url+'/api/monitor/v1/events',JSON.parse(await readFile(producer,'utf8')).token),await stagePixooSource(configPath,await routeDigest(configPath),'owner',hub.url+'/api/monitor/v1',token));pixoo=await launch();
  hub.prepareConsumers();await write(nanoConfig,{version:1,ownerId:'owner',consumerId:'nanoleaf',endpoint:hub.url+'/api/monitor/v1',tokenFile:readToken,controlTokenFile:readToken,clearOnNewTurn:true,qualifiedSources:[{provider:'codex',client:'cli',hostId:'host',sourceId:'source'}],bindings:[]});
  const nanoleaf=await prepareNanoleaf(command,nanoConfig,hub.url+'/api/monitor/v1','owner');
  assert.equal((await fetch(hub.url+'/api/monitor/v1/events',{method:'POST',headers,body:'{}'})).status,503);
  await hub.activate({producers:[routes[0]],consumers:[{id:'pixoo',route:routes[1],owner:pixoo},{id:'nanoleaf',nanoleaf}]});for(const r of routes)await releaseRoute(r);routes.length=0;
 }
 await activate();
 async function emit(name,turn){const output=await child(process.execPath,[new URL('../apps/hub/bin/monitor-hook.mjs',import.meta.url).pathname,producer],{},JSON.stringify({hook_event_name:name,session_id:'identified',turn_id:turn,prompt:'PRIVATE_CANARY'}));assert.equal(output,'');}
 async function projections(activity,nanoStatus){
  const view=await (await fetch(hub.url+'/api/monitor/v1/sessions',{headers})).json();assert.equal(view.snapshot.sessions.length,1);
  const px=await (await fetch(pixoo.url+'/api/monitor/v1/sessions',{headers:{authorization:'Bearer '+credential}})).json();
  await child(command.executable,[...command.args,'fixture-poll']);const nl=JSON.parse(await child(command.executable,[...command.args,'shared-status']));
  for(const session of [px.snapshot.sessions[0],nl.sessions[0]]){
   assert.deepEqual(session.identity,view.snapshot.sessions[0].identity);assert.equal(session.activity,activity);
   assert.deepEqual(session.notices,view.snapshot.sessions[0].notices);
  }
  assert.equal(nl.revision,view.snapshot.revision);
  const row=pager.layout(px,Date.now()).rows[0];assert.equal(row.activity,activity);assert.equal(row.uncertain,true);
  assert.deepEqual(row.noticeIds,view.snapshot.sessions[0].notices.filter(n=>!n.acknowledgedBy.includes('pixoo')).map(n=>n.id));
  const rendered=JSON.parse(await child(command.executable,[...command.args,'fixture-projection']));assert.equal(rendered[0].status,nanoStatus);
  assert.doesNotMatch(JSON.stringify([view,px,nl]),/PRIVATE_CANARY/);return {view,px,nl};
 }
 await emit('UserPromptSubmit','turn');await projections('active','working');
 await emit('Stop','turn');let {nl}=await projections('idle','unread');
 // The real Nanoleaf command acknowledges its consumer only; Pixoo still has a notice.
 const acknowledgment=JSON.parse(await child(command.executable,[...command.args,'shared-acknowledge','--session',nl.sessions[0].id,'--notice',nl.sessions[0].notices[0].id]));assert.equal(acknowledgment.ok,true);
 let checked=await projections('idle','idle');assert.deepEqual(checked.px.snapshot.sessions[0].notices[0].acknowledgedBy,['nanoleaf']);
 await emit('UserPromptSubmit','next-turn');checked=await projections('active','working');assert.deepEqual(checked.view.snapshot.sessions[0].notices[0].acknowledgedBy,['nanoleaf','pixoo']);
 const selectedRevision=checked.view.snapshot.revision;
 await emit('Stop','turn');await emit('UserPromptSubmit','turn');checked=await projections('active','working');assert.equal(checked.view.snapshot.revision,selectedRevision);
 await emit('Stop','next-turn');const {view}=await projections('idle','unread');assert.equal(view.snapshot.sessions[0].notices.length,2);
 await rollbackNanoleaf(command);assert.equal(JSON.parse(await child(command.executable,[...command.args,'shared-status'])).source,'legacy');
 const revision=view.snapshot.revision;await removeSetup(activeSetup.directory,(await planRemoval(activeSetup.directory)).digest,activeAuthority);await stopOwner(pixoo);await hub.close();hub=undefined;const hubConfig=join(root,'host.json');await write(hubConfig,options(join(root,'host')));
 oldHub=await launchOwner({kind:'hub',entrypoint:new URL('../apps/hub/dist/cli.js',import.meta.url).pathname,args:['serve',hubConfig],environment:{},token});
 hub=await startHub(options(join(root,'rollback')),{staged:true,released:await quiesceAndStop(oldHub,join(root,'latest.json'))});await installProducer('rollback-setup');await activate();assert.equal((await (await fetch(hub.url+'/api/monitor/v1/sessions',{headers})).json()).snapshot.revision,revision);await rollbackNanoleaf(command);await removeSetup(activeSetup.directory,(await planRemoval(activeSetup.directory)).digest,activeAuthority);
 console.log(JSON.stringify({pixoo:pin.revision,nanoleaf:nanoPin.revision,embeddedCredentialRevocation:true,setupAcrossHandoff:true,ordinaryTurns:true,independentAcknowledgment:true,lateEventsRejected:true,bothConsumers:true,fenced:true,legacyRollback:true,latestStateRollback:true,physical:false}));
}finally{for(const r of routes)await releaseRoute(r);await hub?.close();if(pixoo)await stopOwner(pixoo);if(oldHub)await stopOwner(oldHub);await rm(root,{recursive:true,force:true});}
