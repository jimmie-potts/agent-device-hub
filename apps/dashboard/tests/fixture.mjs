import {createServer} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startHub} from '../../hub/dist/server.js';
import {validate} from '@jimmie-potts/device-contracts';
import {validateRequest} from '../../hub/dist/vendor/nanoleaf-integration.js';
import {validatePixooRequest} from '../../hub/dist/pixoo-integration.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function fixture({empty=false,playback=false,panels=false}={}){
 const corpus=JSON.parse(await readFile('packages/contracts/fixtures/controller-v1.json','utf8'));
 const template=corpus.schemaCases.find(c=>c.definition==='snapshot'&&c.valid).value;
 const project='project-'+'a'.repeat(64),task='task-'+'b'.repeat(64),sceneA='scene-'+'a'.repeat(64),sceneB='scene-'+'b'.repeat(64);
 const nano={apiVersion:'nanoleaf.integration/1.0',identity:{controllerId:'wall-controller',deviceId:'wall',sourceId:'source',controllerEpoch:'epoch'},configurationRevision:0,revision:'b'.repeat(64),mode:'Work',settings:{style:'classic',coverage:'whole'},source:'shared',projects:[{id:project,color:'#a9c3ff'},{id:'project-'+'c'.repeat(64),color:'#ff0000'}],tasks:[{id:task,projectId:project,overrideProjectId:null}],elements:[{id:'1:2',projectId:project,signature:0},{id:'2:3',projectId:null,signature:1}],wallPending:null,pending:[],outcomes:[],nextRequestId:{epoch:'a'.repeat(32),sequence:0},scenes:[{id:sceneA,name:'Beach Waves'},{id:sceneB}],capabilities:Object.fromEntries(['settings.set','elements.assign','task.assign','project.color','mode.set'].map(k=>[k,{supported:true,scope:'control',...(k==='mode.set'?{route:'/controller/v1/commands'}:{})}])),limits:{maxItems:1000,maxPending:1,maxReceipts:256,maxBodyBytes:65536}};
 // codex-nanoleaf#113: the Panels share the Lines' controller, and their extension snapshot is read-only. It keeps the exact key set, lists no elements or requests and marks the four configuration operations unsupported.
 const sceneC='scene-'+'c'.repeat(64),sceneD='scene-'+'d'.repeat(64);
 const readOnly={...structuredClone(nano),identity:{...nano.identity,deviceId:'panels'},revision:'c'.repeat(64),mode:'Free',elements:[],nextRequestId:{epoch:'c'.repeat(32),sequence:0},scenes:[{id:sceneC,name:'Forest'},{id:sceneD,name:'Sunset'}],
  capabilities:{...Object.fromEntries(['settings.set','elements.assign','task.assign','project.color'].map(k=>[k,{supported:false,scope:'control'}])),'mode.set':nano.capabilities['mode.set']}};
 const pixoo=JSON.parse(await readFile('apps/hub/fixtures/pixoo-integration.json','utf8')).snapshot;
 pixoo.identity={controllerId:'pixel-controller',deviceId:'pixel',sourceId:'pixel'};
 const ids=['wall','pixel',...(panels?['panels']:[])],nanoleaf=id=>id!=='pixel',states=Object.fromEntries(ids.map(id=>[id,structuredClone(template)]));
 for(const [id,s] of Object.entries(states)){s.identity={controllerId:nanoleaf(id)?'wall-controller':'pixel-controller',deviceId:id,sourceId:id,controllerEpoch:'epoch'};s.state.desired.mode={status:'known',value:id==='wall'?'Work':id==='panels'?'Free':'Media'};s.state.externalControl={status:'unknown'};s.state.observation={status:'unknown'};s.state.lastSuccessfulSend={status:'unknown'};s.state.lastOutcome={status:'unknown'};s.state.pending=[];}
 // Pixoo main c81bc31 declares power, brightness 0-100 and media with six actions plus discovered playlist IDs; controller v1 modes are unsupported and Monitor/Media use the integration extension. Nanoleaf declares only Work/Quiet/Free.
 states.pixel.capabilities={power:{supported:true},brightness:{supported:true,minimum:0,maximum:100},media:{supported:true,actions:['pause','resume','stop','next','previous','clear'],playlistIds:['playlist-morning','playlist-evening'],renditionIds:[]},zones:{supported:false},scenes:{supported:false},preview:{supported:false},modes:{supported:false}};
 states.pixel.state.desired={power:{status:'known',value:true},brightness:{status:'known',value:60},mode:{status:'unknown'}};
 // Nanoleaf main 8062849 (#64) declares power, brightness 0-100 and discovered saved scenes; media, zones and preview stay unsupported. Desired power and brightness are known only while an override is active.
 states.wall.capabilities={power:{supported:true},brightness:{supported:true,minimum:0,maximum:100},media:{supported:false},zones:{supported:false},scenes:{supported:true,sceneIds:[sceneA,sceneB]},preview:{supported:false},modes:{supported:true,values:['Work','Quiet','Free']}};
 states.wall.state.desired.power={status:'unknown'};states.wall.state.desired.brightness={status:'unknown'};
 if(panels){states.panels.capabilities={...structuredClone(states.wall.capabilities),scenes:{supported:true,sceneIds:[sceneC,sceneD]}};states.panels.state.desired.power={status:'unknown'};states.panels.state.desired.brightness={status:'unknown'};}
 const media={playlistId:null,actions:[]},scenes={activated:[]};
 const supports=(c,command)=>command.kind==='mode.set'?!!c.modes?.supported&&c.modes.values.includes(command.mode):command.kind==='power.set'?c.power.supported:command.kind==='brightness.set'?c.brightness.supported:command.kind==='media.start'?c.media.supported&&c.media.playlistIds.includes(command.playlistId):command.kind==='media.control'?c.media.supported&&c.media.actions.includes(command.action):command.kind==='scene.activate'?c.scenes.supported&&c.scenes.sceneIds.includes(command.sceneId):false;
 const writes=[],requests=[];let offline=false,uncertain=false,delay=0,queued=false;
 const controllers=[];
 for(const id of ids){
  const server=createServer(async(req,res)=>{
   requests.push({id,method:req.method,url:req.url});
   if(id==='pixel'&&offline){res.writeHead(503,{'content-type':'application/json'});res.end('{"failure":{"code":"transport-failure"}}');return;}
   if(id==='pixel'&&delay)await new Promise(r=>setTimeout(r,delay));
   let body='';for await(const chunk of req)body+=chunk;
   const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
   const integration=req.url.includes('integration');const state=states[id],ext=id==='wall'?nano:id==='panels'?readOnly:pixoo;
   if(req.method==='GET'){send(200,integration?ext:state);return;}
   const command=JSON.parse(body);writes.push({id,integration,command});
   if(uncertain){req.socket.destroy();return;}
   if(!integration){if(!validate('request',command)){send(400,{failure:{code:'invalid-request'}});return;}
    // Like the real controllers, a configuration change conflicts and a retired generation is stale; both fail before any effect.
    const conflict=command.expectedConfigurationRevision!==state.configurationRevision?'revision-conflict':JSON.stringify(command.expectedGeneration)!==JSON.stringify(state.generation)?'stale-generation':undefined;
    // Like the real Nanoleaf controller, a scene outside Free fails typed before any write; the mode never changes as a side effect.
    const gated=nanoleaf(id)&&command.command.kind==='scene.activate'&&state.state.desired.mode.value!=='Free';
    const failure=conflict??(gated||!supports(state.capabilities,command.command)?'unsupported-capability':undefined);
    const receipt={apiVersion:'1.0',controllerId:state.identity.controllerId,deviceId:id,requestId:command.requestId,configurationRevision:state.configurationRevision,generation:state.generation,outcome:failure?'failed':'queued',priorEffects:'none',completedOperations:[],uncertainOperations:[],...(failure?{failure:{code:failure}}:{})};
    // Like Nanoleaf main 08b6b83, any mode command ends power and brightness overrides; the same mode with nothing to reapply is admitted, which advances the configuration revision, then cancelled with no effects.
    const overridden=state.state.desired.power.status==='known'||state.state.desired.brightness.status==='known';
    if(!failure&&nanoleaf(id)&&command.command.kind==='mode.set'&&state.state.desired.mode.value===command.command.mode&&!overridden){state.configurationRevision++;state.nextRequestId.sequence++;const cancelled={...receipt,configurationRevision:state.configurationRevision,outcome:'cancelled'};state.state.lastOutcome={status:'known',receipt:cancelled};send(200,cancelled);return;}
    if(!failure){const c=command.command;state.configurationRevision++;state.nextRequestId.sequence++;
     if(c.kind==='mode.set'){state.state.desired.mode={status:'known',value:c.mode};if(nanoleaf(id)){ext.mode=c.mode;state.state.desired.power={status:'unknown'};state.state.desired.brightness={status:'unknown'};}}
     else {if(c.kind==='power.set')state.state.desired.power={status:'known',value:c.on};if(c.kind==='brightness.set')state.state.desired.brightness={status:'known',value:c.percent};if(c.kind==='media.start')media.playlistId=c.playlistId;if(c.kind==='media.control')media.actions.push(c.action);if(c.kind==='scene.activate')scenes.activated.push(c.sceneId);
      // Like the real controller, general commands are queued first and report a sent outcome on the next snapshot; the mode never changes as a side effect.
      state.state.lastSuccessfulSend={status:'known',requestId:structuredClone(command.requestId),clock:state.sampleClock,operationIds:[c.kind]};state.state.lastOutcome={status:'known',receipt:{...structuredClone(receipt),outcome:'sent',priorEffects:'confirmed-transmission',completedOperations:[c.kind]}};}}
    send(conflict?409:failure?422:200,receipt);return;
   }
   // Like the real owner, every extension command for a read-only device fails before any reservation.
   if(id==='panels'){send(422,{failure:{code:'unsupported-capability'}});return;}
   if(id==='wall'){
    if(!validateRequest(command)){send(400,{failure:{code:'invalid-request'}});return;}
    const conflict=command.expectedRevision!==nano.revision;
    if(queued&&!conflict){nano.pending=[command];send(202,{apiVersion:nano.apiVersion,requestId:command.requestId,outcome:'queued',priorEffects:'none',physicalOutcome:'unknown'});return;}
    const result={apiVersion:nano.apiVersion,requestId:command.requestId,outcome:conflict?'failed':'applied',priorEffects:conflict?'none':'configuration',physicalOutcome:'unknown',...(conflict?{failure:{code:'revision-conflict'}}:{})};
    if(!conflict){const c=command.command;if(c.kind==='settings.set')Object.assign(nano.settings,Object.fromEntries(Object.entries(c).filter(([k])=>k!=='kind')));if(c.kind==='elements.assign')Object.assign(nano.elements.find(e=>e.id===c.elements[0].id),c.elements[0]);if(c.kind==='task.assign')nano.tasks[0].overrideProjectId=c.projectId;if(c.kind==='project.color')nano.projects.find(p=>p.id===c.projectId).color=c.color;nano.nextRequestId.sequence++;nano.configurationRevision++;nano.revision=hash(String(nano.configurationRevision));}send(conflict?409:200,result);
   }else{
    if(!validatePixooRequest(command)){send(400,{error:{code:'invalid-input'}});return;}
    if(command.expectedConfigurationRevision!==pixoo.configurationRevision){send(409,{error:{code:'revision-conflict'}});return;}
    if(command.expectedGeneration!==pixoo.generation){send(409,{error:{code:'stale-generation'}});return;}
    // Like Pixoo main 01da65d, a Monitor mode command presents only while the screen is requested on, including when Monitor is already configured.
    if(command.action.operation==='view'){pixoo.configuration.filter=command.action.filter;pixoo.configuration.cadenceMs=command.action.cadenceMs;}else{pixoo.configuration.mode=command.action.mode;pixoo.participating=command.action.mode==='monitor'&&states.pixel.state.desired.power.value!==false;}
    pixoo.configurationRevision++;pixoo.generation++;pixoo.nextRequestId=pixoo.serverId+':'+(Number(pixoo.nextRequestId.split(':')[1])+1);const result=structuredClone(pixoo);delete result.identity;send(200,result);
   }
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));controllers.push({id,server});
 }
 // A fake Sony HT-A9 like playback.test.mjs: `sony.state` is the AirPlay state, `sony.reads` 'ok' or 'down', `sony.commands` 'sent', 'failed' or 'hang'.
 const sony={state:'PLAYING',reads:'ok',commands:'sent',calls:[],skew:0};let receiver;
 if(playback){
  receiver=createServer(async(req,res)=>{
   let text='';for await(const chunk of req)text+=chunk;const request=JSON.parse(text);const read=request.method==='getPlayingContentInfo';
   if(!read){sony.calls.push(request.method);if(sony.commands==='hang')return;}
   if(read&&sony.reads==='down'){res.writeHead(500);res.end();return;}
   const body=read?{result:[[{source:'extInput:airPlay',stateInfo:{state:sony.state},title:'Song',artist:'Artist',albumName:'Album'}]]}:sony.commands==='failed'?{error:[40000,'refused']}:{result:[]};
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:request.id,...body}));
  });
  await new Promise(r=>receiver.listen(0,'127.0.0.1',r));
 }
 const devices=[...ids,...(playback?['ht-a9']:[])];
 const directory=await mkdtemp(join(tmpdir(),'dashboard-browser-')),token='d'.repeat(43),reader='r'.repeat(43),native='n'.repeat(43);
 const hub=await startHub({directory,ownerId:'fixture-owner',consumers:[{id:'dashboard',clearOnNewTurn:false}],credentials:[{id:'browser',digest:hash(token),scopes:['read','control','ingest'],devices},{id:'reader',digest:hash(reader),scopes:['read'],devices}],...(playback?{clock:()=>Date.now()+sony.skew,playback:{selected:'ht-a9',sources:[{id:'ht-a9',kind:'sony',endpoint:`http://127.0.0.1:${receiver.address().port}/sony`}]}}:{}),controllers:controllers.map(({id,server})=>({id,kind:nanoleaf(id)?'nanoleaf':'pixoo',controllerId:nanoleaf(id)?'wall-controller':'pixel-controller',deviceId:id,endpoint:`http://127.0.0.1:${server.address().port}/controller/v1`,token:native})),editorLinks:{wall:'http://127.0.0.1:8765/wall',pixel:'http://127.0.0.1:3000/playlists'}});
 const headers={authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'};
 const identity={provider:'codex',client:'cli',hostId:'local',sourceId:'codex',sessionId:'task-one'};
 let seq=0;
 async function event(kind,extra={}){const value={apiVersion:'1.0',identity,turn:{status:'known',id:'turn-one'},parent:{status:'unknown'},event:{kind},observedAtMs:Date.now(),ordering:{status:'known',epoch:'fixture',sequence:seq++},...extra};const r=await fetch(hub.url+'/api/monitor/v1/events',{method:'POST',headers,body:JSON.stringify(value)});if(!r.ok)throw new Error('fixture-event-'+r.status);return r.json();}
 if(!empty)await event('session.started',{label:{origin:'user',value:'Build the integration'}});
 return {hub,token,reader,media,scenes,sceneA,sceneB,sceneC,sceneD,readOnly,reconnect({scopes=['read','control','ingest'],granted=devices}={}){hub.replaceCredentials([{id:'browser',digest:hash(token),scopes,devices:granted},{id:'reader',digest:hash(reader),scopes:['read'],devices}]);},sony,writes,requests,states,nano,pixoo,identity,headers,event,setQueued:v=>queued=v,setOffline:v=>offline=v,setUncertain:v=>uncertain=v,setDelay:v=>delay=v,advance:id=>{states[id].generation.sequence++;},async close(){await hub.close();for(const {server} of controllers)await new Promise(r=>{server.close(r);server.closeAllConnections();});if(receiver)await new Promise(r=>{receiver.close(r);receiver.closeAllConnections();});await rm(directory,{recursive:true,force:true});}};
}
