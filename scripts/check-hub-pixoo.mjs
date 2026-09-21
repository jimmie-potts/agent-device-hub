// Source compatibility check. The argument is an explicitly prepared, pinned Pixoo checkout.
// Uses only temporary simulator data, never an installed runtime or device.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {startHub} from '../apps/hub/dist/server.js';
import {launchOwner,quiesceAndStop,stopOwner} from '../apps/hub/dist/migration.js';
import {routeDigest,stageProducer,stagePixooSource,releaseRoute} from '../apps/hub/dist/migration-routes.js';
import {ControllerClient} from '../apps/hub/dist/controllers.js';
const source=resolve(process.argv[2]??'');assert.equal(source,process.argv[2],'absolute prepared source required');
const pin=JSON.parse(await readFile(new URL('../apps/hub/fixtures/pixoo-source.json',import.meta.url),'utf8'));
for(const [path,expected] of Object.entries(pin.sourceFiles))assert.equal(createHash('sha256').update(await readFile(join(source,path))).digest('hex'),expected,path);
const {provisionCredential}=await import(pathToFileURL(join(source,'apps/server/dist/mcp-config.js')).href);
const root=await mkdtemp(join(tmpdir(),'hub-pixoo-cutover-')),local=join(root,'pixoo'),host=join(root,'hub'),rollback=join(root,'rollback');
const hubToken='h'.repeat(43),consumer='pixoo';
const options=directory=>({directory,ownerId:'owner',consumers:[{id:consumer,clearOnNewTurn:true}],controllers:[],port:0,credentials:[{id:'migration',digest:createHash('sha256').update(hubToken).digest('hex'),scopes:['read','control','admin','ingest'],devices:[]}]});
let pixoo,hub,sourceHub,client;let routes=[];
const headers=token=>({authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'});
async function request(url,path,token,body){const response=await fetch(url+path,{headers:headers(token),...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});assert.equal(response.status,200,await response.clone().text());return response.json();}
try{
 for(const directory of [local,host,rollback])await mkdir(directory,{mode:0o700});
 const monitor=join(local,'agent-monitor');await mkdir(monitor,{mode:0o700});
 const configPath=join(monitor,'config.json');await writeFile(configPath,JSON.stringify({version:1,mode:'embedded',ownerId:'owner',consumers:options(host).consumers}),{mode:0o600});
 const monitorToken=await provisionCredential(monitor,'monitor',['read','control']);const controllerToken=await provisionCredential(local,'hub',['read','control']);
 const launchPixoo=()=>launchOwner({kind:'pixoo',entrypoint:join(source,'apps/server/dist/main.js'),args:[],environment:{PIXOO_MODE:'simulator',PIXOO_DATA_DIR:local,PIXOO_PORT:'0',PIXOO_MONITOR_ENABLED:'1',PIXOO_CONTROLLER_ENABLED:'1'},token:monitorToken});
 pixoo=await launchPixoo();
 client=new ControllerClient({id:'desk',kind:'pixoo',controllerId:'pixoo-controller',deviceId:'pixoo-local',endpoint:pixoo.url+'/controller/v1',token:controllerToken});
 await client.snapshot();let settings=await client.integrationSnapshot();
 for(const action of [{operation:'view',filter:{projectId:'project'},cadenceMs:2000},{operation:'mode',mode:'monitor'},{operation:'mode',mode:'media'}]){
  const command={apiVersion:settings.apiVersion,controllerId:'pixoo-controller',deviceId:'pixoo-local',requestId:settings.nextRequestId,expectedConfigurationRevision:settings.configurationRevision,expectedGeneration:settings.generation,action};
  const result=await client.integrationCommand(command);assert.deepEqual(await client.integrationCommand(command),result);settings=await client.integrationSnapshot();
 }
 await assert.rejects(client.integrationCommand({apiVersion:settings.apiVersion,controllerId:'pixoo-controller',deviceId:'pixoo-local',requestId:settings.nextRequestId,expectedConfigurationRevision:0,expectedGeneration:settings.generation,action:{operation:'mode',mode:'monitor'}}),error=>error.code==='revision-conflict');client.close();client=undefined;
 const identity={provider:'codex',client:'cli',hostId:'host',sourceId:'source',sessionId:'session'};
 const event={apiVersion:'1.0',identity,projectId:'project',turn:{status:'known',id:'turn'},parent:{status:'unknown'},ordering:{status:'known',epoch:'epoch',sequence:1},observedAtMs:Date.now(),event:{kind:'turn.ended'}};
 assert.equal((await request(pixoo.url,'/api/monitor/v1/events',monitorToken,event)).ok,true);
 const release=await quiesceAndStop(pixoo);hub=await startHub(options(host),{staged:true,released:release});
 const producer=join(root,'producer.json');await writeFile(producer,JSON.stringify({enabled:true,qualified:true,source:{provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'Stop'},endpoint:pixoo.url+'/api/monitor/v1/events',token:monitorToken}),{mode:0o600});
 async function selectAndActivate(){
  routes=[await stageProducer(producer,await routeDigest(producer),hub.url+'/api/monitor/v1/events',hubToken),await stagePixooSource(configPath,await routeDigest(configPath),'owner',hub.url+'/api/monitor/v1',hubToken)];
  pixoo=await launchPixoo();
  let view=await request(pixoo.url,'/api/integration/v1/view',monitorToken);assert.equal(view.source.ownerId,'owner');assert.equal(view.source.snapshot.collector,'quiesced');assert.equal(view.integration.configuration.filter.projectId,'project');assert.equal(view.integration.participating,false);
  const denied=await fetch(pixoo.url+'/api/integration/v1/shared-actions',{method:'POST',headers:headers(monitorToken),body:JSON.stringify({operation:'label',requestId:view.source.nextRequestId,identity,label:'must not apply'})});assert.equal(denied.status,503);
  await hub.activate({producers:[routes[0]],consumers:[{id:consumer,route:routes[1],endpoint:pixoo.url+'/api/monitor/v1',token:monitorToken}]});
  for(const route of routes)await releaseRoute(route);routes=[];
  view=await request(pixoo.url,'/api/integration/v1/view',monitorToken);assert.equal(view.source.snapshot.collector,'running');return view;
 }
 let view=await selectAndActivate();
 assert.equal((await request(pixoo.url,'/api/integration/v1/shared-actions',monitorToken,{operation:'label',requestId:view.source.nextRequestId,identity,label:'After cutover'})).ok,true);
 view=await request(pixoo.url,'/api/integration/v1/view',monitorToken);const notice=view.source.snapshot.sessions[0].notices[0];
 assert.equal((await request(pixoo.url,'/api/integration/v1/shared-actions',monitorToken,{operation:'acknowledge',requestId:view.source.nextRequestId,identity,noticeId:notice.id})).ok,true);
 // Exercise the actual producer entrypoint asynchronously; do not block the host event loop.
 const {spawn}=await import('node:child_process');const emitter=spawn(process.execPath,[join(source,'scripts/monitor-hook.mjs'),producer],{stdio:['pipe','ignore','pipe']});emitter.stderr.resume();emitter.stdin.end(JSON.stringify({session_id:'after-cutover',turn_id:'new'}));assert.equal(await new Promise(r=>emitter.once('exit',r)),0);
 view=await request(pixoo.url,'/api/integration/v1/view',monitorToken);assert.equal(view.source.snapshot.sessions.length,2);
 const beforeRollback=view.source.snapshot.revision;await stopOwner(pixoo);await hub.close();hub=undefined;
 // Relaunch the same current host under supervision, then export its latest writes.
 const hubConfig=join(root,'hub.json');await writeFile(hubConfig,JSON.stringify(options(host)),{mode:0o600});
 sourceHub=await launchOwner({kind:'hub',entrypoint:new URL('../apps/hub/dist/cli.js',import.meta.url).pathname,args:['serve',hubConfig],environment:{},token:hubToken});
 const latest=await quiesceAndStop(sourceHub);assert.equal(latest.revision,beforeRollback);
 hub=await startHub(options(rollback),{staged:true,released:latest});view=await selectAndActivate();
 const restored=view.source.snapshot.sessions.find(s=>s.identity.sessionId==='session');assert.equal(restored.label,'After cutover');assert.deepEqual(restored.notices[0].acknowledgedBy,['pixoo']);assert.equal(view.source.snapshot.sessions.length,2);assert.equal(view.source.snapshot.revision,beforeRollback);
 // Renderer uses the selected owner; recovery must not reactivate its physical presentation.
 const deadline=Date.now()+4000;while(view.dashboard.rendition?.layout.revision!==beforeRollback&&Date.now()<deadline){await new Promise(r=>setTimeout(r,50));view=await request(pixoo.url,'/api/integration/v1/view',monitorToken);}
 assert.equal(view.dashboard.rendition?.layout.revision,beforeRollback);assert.equal(view.integration.participating,false);
 console.log(JSON.stringify({source:pin.revision,simulator:true,settings:true,sourceExit:true,fencedImport:true,facade:true,producer:true,label:true,acknowledgment:true,rollbackAfterWrites:true,renderer:true,physical:false}));
}finally{for(const route of routes)await releaseRoute(route);client?.close();await hub?.close();if(pixoo)await stopOwner(pixoo);if(sourceHub)await stopOwner(sourceHub);await rm(root,{recursive:true,force:true});}
