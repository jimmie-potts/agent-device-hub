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
import {prepareNanoleaf,rollbackNanoleaf} from '../apps/hub/dist/setup-consumer.js';
const [pixooSource,nanoleafSource]=process.argv.slice(2);assert.equal(resolve(pixooSource),pixooSource);assert.equal(resolve(nanoleafSource),nanoleafSource);
const pin=JSON.parse(await readFile(new URL('../apps/hub/fixtures/pixoo-source.json',import.meta.url),'utf8'));
for(const [path,hash] of Object.entries(pin.sourceFiles))assert.equal(createHash('sha256').update(await readFile(join(pixooSource,path))).digest('hex'),hash,path);
const nanoPin=JSON.parse(await readFile(new URL('../apps/hub/fixtures/nanoleaf-shared-source.json',import.meta.url),'utf8'));
for(const [path,hash] of Object.entries(nanoPin.files))assert.equal(createHash('sha256').update(await readFile(join(nanoleafSource,path))).digest('hex'),hash,path);
const root=await mkdtemp(join(tmpdir(),'hub-shared-')),token='h'.repeat(43),headers={authorization:'Bearer '+token,'content-type':'application/json','x-pixoo-request':'1'};
const consumers=[{id:'pixoo',clearOnNewTurn:true},{id:'nanoleaf',clearOnNewTurn:true}],options=directory=>({directory,ownerId:'owner',consumers,controllers:[],credentials:[{id:'host',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','ingest','control','admin'],devices:[]}],port:0});
let hub,pixoo,oldHub;const routes=[];
const write=(p,v)=>writeFile(p,JSON.stringify(v),{mode:0o600});
async function child(executable,args,environment={},input){return new Promise((resolve,reject)=>{const c=spawn(executable,args,{env:environment,stdio:['pipe','pipe','pipe']});let out='',err='';c.stdout.on('data',v=>out+=v);c.stderr.on('data',v=>err+=v);c.on('error',reject);c.on('exit',code=>{if(code!==0)reject(new Error(err||out));else resolve(out);});c.stdin.end(input);});}
try{
 for(const name of ['embedded','host','rollback','nanoleaf'])await mkdir(join(root,name),{mode:0o700});
 const local=join(root,'embedded'),configPath=join(local,'agent-monitor/config.json');await mkdir(join(local,'agent-monitor'),{mode:0o700});await write(configPath,{version:1,mode:'embedded',ownerId:'owner',consumers});
 const {provisionCredential}=await import(pathToFileURL(join(pixooSource,'apps/server/dist/mcp-config.js')));const credential=await provisionCredential(join(local,'agent-monitor'),'migration',['read','control']);
 const launch=()=>launchOwner({kind:'pixoo',entrypoint:join(pixooSource,'apps/server/dist/main.js'),args:[],environment:{PIXOO_MODE:'simulator',PIXOO_DATA_DIR:local,PIXOO_PORT:'0',PIXOO_MONITOR_ENABLED:'1'},token:credential});
 pixoo=await launch();const released=await quiesceAndStop(pixoo,join(root,'initial.json'));hub=await startHub(options(join(root,'host')),{staged:true,released});
 const producer=join(root,'producer.json'),source={provider:'codex',client:'cli',hostId:'host',sourceId:'source',hook:'SessionStart'};await write(producer,{enabled:true,qualified:true,source,endpoint:pixoo.url+'/api/monitor/v1/events',token:credential});
 const nanoConfig=join(root,'nanoleaf.json'),readToken=join(root,'read-token');await writeFile(readToken,token,{mode:0o600});
 const command={executable:'/usr/bin/python3',args:[new URL('./hub-shared-nanoleaf.py',import.meta.url).pathname,nanoleafSource,join(root,'nanoleaf')],environment:{}};
 async function activate(){
  routes.push(await stageProducer(producer,await routeDigest(producer),hub.url+'/api/monitor/v1/events',token),await stagePixooSource(configPath,await routeDigest(configPath),'owner',hub.url+'/api/monitor/v1',token));pixoo=await launch();
  hub.prepareConsumers();await write(nanoConfig,{version:1,ownerId:'owner',consumerId:'nanoleaf',endpoint:hub.url+'/api/monitor/v1',tokenFile:readToken,clearOnNewTurn:true,qualifiedSources:[{provider:'codex',client:'cli',hostId:'host',sourceId:'source'}],bindings:[]});
  const nanoleaf=await prepareNanoleaf(command,nanoConfig,hub.url+'/api/monitor/v1','owner');
  assert.equal((await fetch(hub.url+'/api/monitor/v1/events',{method:'POST',headers,body:'{}'})).status,503);
  await hub.activate({producers:[routes[0]],consumers:[{id:'pixoo',route:routes[1],owner:pixoo},{id:'nanoleaf',nanoleaf}]});for(const r of routes)await releaseRoute(r);routes.length=0;
 }
 await activate();
 await child(process.execPath,[new URL('../apps/hub/bin/monitor-hook.mjs',import.meta.url).pathname,producer],{},JSON.stringify({hook_event_name:'Stop',session_id:'identified',turn_id:'turn',prompt:'PRIVATE_CANARY'}));
 const view=await (await fetch(hub.url+'/api/monitor/v1/sessions',{headers})).json();assert.equal(view.snapshot.sessions.length,1);
 const px=await (await fetch(pixoo.url+'/api/monitor/v1/sessions',{headers:{authorization:'Bearer '+credential}})).json();assert.deepEqual(px.snapshot.sessions[0].identity,view.snapshot.sessions[0].identity);
 await child(command.executable,[...command.args,'fixture-poll']);const nl=JSON.parse(await child(command.executable,[...command.args,'shared-status']));assert.deepEqual(nl.sessions[0].identity,view.snapshot.sessions[0].identity);assert.equal(nl.revision,view.snapshot.revision);
 await rollbackNanoleaf(command);assert.equal(JSON.parse(await child(command.executable,[...command.args,'shared-status'])).source,'legacy');
 const revision=view.snapshot.revision;await stopOwner(pixoo);await hub.close();hub=undefined;const hubConfig=join(root,'host.json');await write(hubConfig,options(join(root,'host')));
 oldHub=await launchOwner({kind:'hub',entrypoint:new URL('../apps/hub/dist/cli.js',import.meta.url).pathname,args:['serve',hubConfig],environment:{},token});
 hub=await startHub(options(join(root,'rollback')),{staged:true,released:await quiesceAndStop(oldHub,join(root,'latest.json'))});await activate();assert.equal((await (await fetch(hub.url+'/api/monitor/v1/sessions',{headers})).json()).snapshot.revision,revision);await rollbackNanoleaf(command);
 console.log(JSON.stringify({pixoo:pin.revision,nanoleaf:nanoPin.revision,identifiedEvent:true,bothConsumers:true,fenced:true,legacyRollback:true,latestStateRollback:true,physical:false}));
}finally{for(const r of routes)await releaseRoute(r);await hub?.close();if(pixoo)await stopOwner(pixoo);if(oldHub)await stopOwner(oldHub);await rm(root,{recursive:true,force:true});}
