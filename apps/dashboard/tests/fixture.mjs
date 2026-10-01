import {pixooCatalogFixture} from '../../hub/tests/pixoo-catalog-fixture.mjs';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startHub} from '../../hub/dist/server.js';
import {validate,admit,downgradeSnapshot,evaluate} from '@jimmie-potts/device-contracts';
import {validateRequest} from '../../hub/dist/vendor/nanoleaf-integration.js';
import {validatePixooRequest} from '../../hub/dist/pixoo-integration.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const identityOf=deviceId=>({controllerId:'wall-controller',deviceId,sourceId:'source',controllerEpoch:'epoch'});
const round=v=>Math.round(v*1000)/1000;
/** A Lines layout in the geometry route's shape (codex-nanoleaf#169): 12 connectors on a triangular lattice joined by 15 Lines, every join on a connector's six flat faces, in display coordinates. Zone ids 101–130; element ids are the sorted zone pair. */
export function linesGeometry(deviceId='wall'){
 const S=100,h=S*Math.sqrt(3)/2,nodes=[],index={};let n=0;
 for(let j=0;j<3;j++)for(let i=0;i<4;i++){index[`${i},${j}`]=String(++n);nodes.push({id:String(n),x:round(i*S+j*S/2),y:round(-j*h)});}
 const edges=[];for(let j=0;j<3;j++)for(let i=0;i<3;i++)edges.push([`${i},${j}`,`${i+1},${j}`]);
 for(const [i,j] of [[0,0],[1,0],[2,0],[3,0],[0,1],[2,1]])edges.push([`${i},${j}`,`${i},${j+1}`]);
 const elements=[],lines=[];
 edges.forEach(([a,b],k)=>{const zones=[101+2*k,102+2*k],id=zones.join(':'),A=nodes[+index[a]-1],B=nodes[+index[b]-1];elements.push({id,number:k+1,zones,points:[[A.x,A.y],[round((A.x+B.x)/2),round((A.y+B.y)/2)],[B.x,B.y]]});lines.push({id,a:index[a],b:index[b]});});
 return {apiVersion:'nanoleaf.integration/1.0',identity:identityOf(deviceId),kind:'lines',elements,connectors:{nodes,lines}};
}
/** An NL22 Panels layout of 18 edge-adjacent triangles in two rows, three corners per element as the geometry route serves them (apex at 90° + o + 120°k around each centroid, Y inverted for the screen). Panel ids 4001–4018. */
export function panelsGeometry(deviceId='panels'){
 const S=100,r=S/Math.sqrt(3),h=1.5*r,triangles=[];
 for(let k=0;k<5;k++)triangles.push({cx:k*S,cy:r/2,o:0});for(let k=0;k<4;k++)triangles.push({cx:k*S+S/2,cy:r,o:60});
 for(let k=0;k<4;k++)triangles.push({cx:k*S+S/2,cy:h+r/2,o:0});for(let k=0;k<5;k++)triangles.push({cx:k*S,cy:h+r,o:60});
 const elements=triangles.map((t,i)=>({id:String(4001+i),number:i+1,zones:[4001+i],points:[0,1,2].map(k=>{const a=(90+t.o+120*k)*Math.PI/180;return [round(t.cx+r*Math.cos(a)),round(-(t.cy+r*Math.sin(a)))];})}));
 return {apiVersion:'nanoleaf.integration/1.0',identity:identityOf(deviceId),kind:'panels',elements,connectors:null};
}
/** `geometry`: 'layout' serves the layouts above on the read-only geometry route (codex-nanoleaf#169), 'none' serves an explicit empty result for the wall, 'older' answers like an owner that predates the route, 'undrawable' serves a hub-valid Lines layout with a connector no Line joins, which the renderer rejects, and 'flaky' fails the first geometry read with a transport failure and serves the layout afterwards. `token`, `reader`, `port`, `directory`, `editorLinks`, `placeLinks` and `endpointFor` let a verification run (Hub #494, #495) use run-generated credentials, a recorded port, a short private directory (so the hub's Unix socket path stays under 108 bytes), editor links and Places destinations that never point at an installed service, and a stand-in in front of a fake controller for its fault scenarios; the defaults keep the browser suites unchanged. `moments` (Hub #336), `true` or overrides of the `moments` capability, makes the wall serve controller contract 1.1 with moments; see `wallMoments` below. */
export async function fixture({empty=false,playback=false,panels=false,geometry='layout',browserAccess,beforeRead,token='d'.repeat(43),reader='r'.repeat(43),port,directory:given,previewProof,editorLinks={wall:'http://127.0.0.1:8765/wall',pixel:'http://127.0.0.1:3000/playlists'},placeLinks,endpointFor=(id,url)=>url,moments,catalog=false}={}){
 const corpus=JSON.parse(await readFile('packages/contracts/fixtures/controller-v1.json','utf8'));
 const template=corpus.schemaCases.find(c=>c.definition==='snapshot'&&c.valid).value;
 const project='project-'+'a'.repeat(64),task='task-'+'b'.repeat(64),sceneA='scene-'+'a'.repeat(64),sceneB='scene-'+'b'.repeat(64);
 const nano={apiVersion:'nanoleaf.integration/1.0',identity:{controllerId:'wall-controller',deviceId:'wall',sourceId:'source',controllerEpoch:'epoch'},configurationRevision:0,revision:'b'.repeat(64),mode:'Work',settings:{style:'classic',coverage:'whole'},source:'shared',projects:[{id:project,color:'#a9c3ff'},{id:'project-'+'c'.repeat(64),color:'#ff0000'}],tasks:[{id:task,projectId:project,overrideProjectId:null}],elements:linesGeometry().elements.map((e,index)=>({id:e.id,projectId:index===0?project:null,signature:index===1?1:0})),wallPending:null,pending:[],outcomes:[],nextRequestId:{epoch:'a'.repeat(32),sequence:0},scenes:[{id:sceneA,name:'Beach Waves'},{id:sceneB}],capabilities:Object.fromEntries(['settings.set','elements.assign','task.assign','project.color','mode.set'].map(k=>[k,{supported:true,scope:'control',...(k==='mode.set'?{route:'/controller/v1/commands'}:{})}])),limits:{maxItems:1000,maxPending:1,maxReceipts:256,maxBodyBytes:65536}};
 // codex-nanoleaf#113: the Panels share the Lines' controller, and their extension snapshot is read-only. It keeps the exact key set, lists no elements or requests and marks the four configuration operations unsupported.
 const sceneC='scene-'+'c'.repeat(64),sceneD='scene-'+'d'.repeat(64);
 const readOnly={...structuredClone(nano),identity:{...nano.identity,deviceId:'panels'},revision:'c'.repeat(64),mode:'Free',elements:[],nextRequestId:{epoch:'c'.repeat(32),sequence:0},scenes:[{id:sceneC,name:'Forest'},{id:sceneD,name:'Sunset'}],
  capabilities:{...Object.fromEntries(['settings.set','elements.assign','task.assign','project.color'].map(k=>[k,{supported:false,scope:'control'}])),'mode.set':nano.capabilities['mode.set']}};
 const undrawable=()=>{const g=linesGeometry();g.connectors.nodes.push({id:'99',x:900,y:900});return g;};
 const geometries={wall:geometry==='none'?{apiVersion:nano.apiVersion,identity:identityOf('wall'),kind:null,elements:[],connectors:null}:geometry==='undrawable'?undrawable():linesGeometry(),panels:panelsGeometry()};let geometryReads=0;
 const catalogData=catalog?pixooCatalogFixture():undefined;
 const pixoo=JSON.parse(await readFile('apps/hub/fixtures/pixoo-integration.json','utf8')).snapshot;
 pixoo.identity={controllerId:'pixel-controller',deviceId:'pixel',sourceId:'pixel'};
 const ids=['wall','pixel',...(panels?['panels']:[])],nanoleaf=id=>id!=='pixel',states=Object.fromEntries(ids.map(id=>[id,structuredClone(template)]));
 for(const [id,s] of Object.entries(states)){s.identity={controllerId:nanoleaf(id)?'wall-controller':'pixel-controller',deviceId:id,sourceId:id,controllerEpoch:'epoch'};s.state.desired.mode={status:'known',value:id==='wall'?'Work':id==='panels'?'Free':'Media'};s.state.externalControl={status:'unknown'};s.state.observation={status:'unknown'};s.state.lastSuccessfulSend={status:'unknown'};s.state.lastOutcome={status:'unknown'};s.state.pending=[];}
 // Pixoo main c81bc31 declares power, brightness 0-100 and media with six actions plus discovered playlist IDs; controller v1 modes are unsupported and Monitor/Media use the integration extension. Nanoleaf declares only Work/Quiet/Free.
 states.pixel.capabilities={power:{supported:true},brightness:{supported:true,minimum:0,maximum:100},media:{supported:true,actions:['pause','resume','stop','next','previous','clear'],playlistIds:['playlist-morning','playlist-evening'],renditionIds:[]},zones:{supported:false},scenes:{supported:false},preview:{supported:false},modes:{supported:false}};
 if(catalogData)states.pixel.capabilities.media.playlistIds=catalogData.playlists.map(p=>p.id);
 states.pixel.state.desired={power:{status:'known',value:true},brightness:{status:'known',value:60},mode:{status:'unknown'}};
 // Nanoleaf main 8062849 (#64) declares power, brightness 0-100 and discovered saved scenes; media, zones and preview stay unsupported. Desired power and brightness are known only while an override is active.
 states.wall.capabilities={power:{supported:true},brightness:{supported:true,minimum:0,maximum:100},media:{supported:false},zones:{supported:false},scenes:{supported:true,sceneIds:[sceneA,sceneB]},preview:{supported:false},modes:{supported:true,values:['Work','Quiet','Free']}};
 states.wall.state.desired.power={status:'unknown'};states.wall.state.desired.brightness={status:'unknown'};
 if(panels){states.panels.capabilities={...structuredClone(states.wall.capabilities),scenes:{supported:true,sceneIds:[sceneC,sceneD]}};states.panels.state.desired.power={status:'unknown'};states.panels.state.desired.brightness={status:'unknown'};}
 const media={playlistId:null,actions:[]},scenes={activated:[]};
 const supports=(c,command)=>command.kind==='mode.set'?!!c.modes?.supported&&c.modes.values.includes(command.mode):command.kind==='power.set'?c.power.supported:command.kind==='brightness.set'?c.brightness.supported:command.kind==='media.start'?c.media.supported&&c.media.playlistIds.includes(command.playlistId):command.kind==='media.control'?c.media.supported&&c.media.actions.includes(command.action):command.kind==='scene.activate'?c.scenes.supported&&c.scenes.sceneIds.includes(command.sceneId):false;
 const writes=[],requests=[];let offline='',uncertain=false,delay=0,queued=false;
 // Hub #336: with `moments`, the wall serves controller contract 1.1 on versioned reads and admits 1.1 moment requests through the
 // contract's reference `admit`. Its writer is the contract's `moment` reference operation on a live device clock, so Quiet, status
 // cover, alerts, supersede, completion and missed starts follow the contract. Unversioned reads get the contract's 1.0 view.
 // Knobs: `lead` reports the sample clock that far ahead of the writer's clock, so a moment the hub starts now shows as scheduled;
 // `stallNext(ms)` moves the writer's clock on before it takes the next moment, so that moment misses its window; `advance(ms)`
 // moves the clock on (a moment ends sooner); `alert(kind)` raises or clears a status alert; `refuseNextVersionedRead()` answers
 // one versioned read with invalid-request, as a controller that serves only 1.0 does, then restarts with a new controller epoch.
 const momentsCapability=moments?{supported:true,moods:['celebrate','setback','reminder'],maxDurationMs:30000,coversStatus:true,...(moments===true?{}:moments)}:undefined;
 const presentationOf=mode=>mode==='Quiet'?'quiet':mode==='Free'?'content':'status';
 const clockOrigin=performance.now();
 const wallMoments={offset:0,lead:0,stall:0,refuse:'',restarts:0,cache:[],admitted:new Map(),
  device:{clockEpoch:'clock-wall',presentation:presentationOf(states.wall.state.desired.mode.value),canCoverStatus:!!momentsCapability?.coversStatus,base:'agent status',alert:'none',recentMomentIds:[],current:{status:'none'},last:{status:'none'}}};
 const deviceNow=()=>Math.round(performance.now()-clockOrigin)+1000+wallMoments.offset;
 const sameTicket=(a,b)=>a.epoch===b.epoch&&a.sequence===b.sequence;
 /** A writer receipt change as the full 1.1 receipt the snapshot's lastOutcome carries. */
 const fullReceipt=(admitted,change)=>{
  const {failure:_failure,...base}=admitted;
  const receipt={...base,outcome:change.outcome,priorEffects:change.outcome==='sent'?'confirmed-transmission':'none',completedOperations:change.outcome==='sent'?['moment']:[],uncertainOperations:[],...(change.failure?{failure:{code:change.failure}}:{})};
  if(!validate('receiptV1_1',receipt))throw new Error('fixture moment receipt must validate');
  return receipt;
 };
 function writer(event){
  const {steps,device}=evaluate({operation:'moment',device:wallMoments.device,events:[event]});
  wallMoments.device=device;
  for(const change of steps[0].receipts){const admitted=wallMoments.admitted.get(change.requestId.sequence);if(admitted&&sameTicket(admitted.requestId,change.requestId))states.wall.state.lastOutcome={status:'known',receipt:fullReceipt(admitted,change)};}
  return steps[0];
 }
 /** The writer reaches the present: a scheduled start that is due begins, and a playing moment whose time is up completes. */
 const tick=()=>{for(let i=0;i<3;i++){const before=JSON.stringify(wallMoments.device.current);writer({kind:'tick',nowMs:deviceNow()});if(JSON.stringify(wallMoments.device.current)===before)break;}};
 const wallV11=()=>{
  const s=states.wall;
  const value={...structuredClone(s),apiVersion:'1.1',sampleClock:{domain:'controller-monotonic',epoch:wallMoments.device.clockEpoch,sampledAtMs:deviceNow()+wallMoments.lead},
   capabilities:{...structuredClone(s.capabilities),moments:structuredClone(momentsCapability)},
   state:{...structuredClone(s.state),moment:{current:structuredClone(wallMoments.device.current),last:structuredClone(wallMoments.device.last)}}};
  if(!validate('snapshotV1_1',value))throw new Error('fixture 1.1 wall snapshot must validate');
  return value;
 };
 /** The wall's mode changed, through a command or elsewhere: a current moment is interrupted and precedence follows the new presentation. */
 const wallMode=mode=>{if(momentsCapability){tick();writer({kind:'mode',nowMs:deviceNow(),presentation:presentationOf(mode),base:'agent status'});}};
 const controllers=[];
 for(const id of ids){
  const server=createServer(async(req,res)=>{
   const request={id,method:req.method,url:req.url,finished:false};requests.push(request);
   res.once('finish',()=>{request.finished=true;});
   if(req.method==='GET'&&beforeRead)await beforeRead(request);
   if(id===offline){res.writeHead(503,{'content-type':'application/json'});res.end('{"failure":{"code":"transport-failure"}}');return;}
   if(id==='pixel'&&delay)await new Promise(r=>setTimeout(r,delay));
   let body='';for await(const chunk of req)body+=chunk;
   const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
   if(id==='pixel'&&req.method==='GET'&&catalogData?.serve(req,res,pixoo))return;
   const integration=req.url.includes('integration');const state=states[id],ext=id==='wall'?nano:id==='panels'?readOnly:pixoo;
   // The read-only geometry route (codex-nanoleaf#169): an older owner answers 404 like any unknown route.
   if(req.method==='GET'&&req.url.startsWith('/controller/integration/v1/geometry')){if(geometry==='older'){send(404,{failure:{code:'invalid-request'}});return;}if(geometry==='flaky'&&geometryReads++===0){send(503,{failure:{code:'transport-failure'}});return;}send(200,geometries[id]);return;}
   if(req.method==='GET'&&momentsCapability&&id==='wall'&&!integration){
    tick();
    const versioned=new URL(req.url,'http://fake.invalid').searchParams.has('apiVersion');
    if(versioned&&wallMoments.refuse==='armed'){wallMoments.refuse='refused';send(400,{failure:{code:'invalid-request'}});return;}
    const value=wallV11();send(200,versioned?value:downgradeSnapshot(value));
    // The unversioned read after the refusal still came from the old epoch; the controller then restarts serving 1.1 again.
    if(!versioned&&wallMoments.refuse==='refused'){wallMoments.refuse='';state.identity.controllerEpoch=`epoch-${++wallMoments.restarts}`;}
    return;
   }
   if(req.method==='GET'){send(200,integration?ext:state);return;}
   const command=JSON.parse(body);writes.push({id,integration,command});
   if(uncertain){req.socket.destroy();return;}
   if(!integration&&momentsCapability&&id==='wall'&&command?.apiVersion==='1.1'){
    tick();
    const snapshot=wallV11();
    const result=admit({request:command,bodyBytes:Buffer.byteLength(body),auth:{credential:{kind:'machine',status:'active',declared:true,devices:['wall'],scopes:['read','control']},deviceId:'wall',scope:'control',hostAllowed:true,originPresent:false,originAllowed:true,fetchMetadataAllowed:true},
     state:{controllerId:state.identity.controllerId,deviceId:'wall',epoch:state.nextRequestId.epoch,nextSequence:state.nextRequestId.sequence,configurationRevision:state.configurationRevision,generation:state.generation,capabilities:snapshot.capabilities,
      apiVersions:['1.0','1.1'],maxBodyBytes:state.limits.maxBodyBytes,maxInFlight:32,maxQueue:32,maxReceipts:256,inFlight:0,queueDepth:0,cache:wallMoments.cache,pending:[]}});
    const status={'invalid-request':400,'unauthenticated':401,'forbidden':403,'unknown-device':404,'revision-conflict':409,'stale-generation':409,'request-conflict':409,'request-order':409,'request-expired':410,'unsupported-capability':422,'capacity':429};
    if(!result.receipt){send(status[result.decision]??400,{failure:{code:result.decision}});return;}
    if(!result.reserved){send(result.receipt.failure?status[result.receipt.failure.code]??200:200,result.receipt);return;}
    state.nextRequestId.sequence=result.nextSequence;
    const entry={request:command,receipt:result.receipt};wallMoments.cache.push(entry);
    if(result.decision!=='queued'){send(status[result.receipt.failure?.code]??200,result.receipt);return;}
    wallMoments.admitted.set(result.receipt.requestId.sequence,result.receipt);
    if(wallMoments.stall){wallMoments.offset+=wallMoments.stall;wallMoments.stall=0;}
    const step=writer({kind:'deliver',nowMs:deviceNow(),requestId:command.requestId,command:command.command});
    // A moment the writer drops on arrival answers its failed receipt; one it schedules or starts answers the queued admission.
    const dropped=step.receipts.find(change=>sameTicket(change.requestId,command.requestId)&&change.outcome==='failed');
    if(dropped){entry.receipt=fullReceipt(result.receipt,dropped);send(200,entry.receipt);return;}
    send(202,result.receipt);return;
   }
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
     // Any explicit command interrupts the wall's current moment; a mode change also changes what may cover it.
     if(momentsCapability&&id==='wall'){if(c.kind==='mode.set')wallMode(c.mode);else{tick();writer({kind:'command',nowMs:deviceNow()});}}
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
 const directory=given??await mkdtemp(join(tmpdir(),'dashboard-browser-')),native='n'.repeat(43);
 const endpoints=Object.fromEntries(await Promise.all(controllers.map(async({id,server})=>[id,await endpointFor(id,`http://127.0.0.1:${server.address().port}/controller/v1`)])));
 const hub=await startHub({directory,ownerId:'fixture-owner',consumers:[{id:'dashboard',clearOnNewTurn:false}],credentials:[{id:'browser',digest:hash(token),scopes:['read','control','ingest'],devices},{id:'reader',digest:hash(reader),scopes:['read'],devices}],...(playback?{clock:()=>Date.now()+sony.skew,playback:{id:'ht-a9',sources:[{kind:'sony',endpoint:`http://127.0.0.1:${receiver.address().port}/sony`}]}}:{}),controllers:controllers.map(({id,server})=>({id,kind:nanoleaf(id)?'nanoleaf':'pixoo',controllerId:nanoleaf(id)?'wall-controller':'pixel-controller',deviceId:id,endpoint:endpoints[id],token:native})),editorLinks,...(placeLinks!==undefined?{placeLinks}:{}),...(browserAccess?{browserAccess}:{}),...(port!==undefined?{port}:{})},undefined,previewProof);
 const headers={authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'};
 const identity={provider:'codex',client:'cli',hostId:'local',sourceId:'codex',sessionId:'task-one'};
 let seq=0;
 async function event(kind,extra={}){const value={apiVersion:'1.0',identity,turn:{status:'known',id:'turn-one'},parent:{status:'unknown'},event:{kind},observedAtMs:Date.now(),ordering:{status:'known',epoch:'fixture',sequence:seq++},...extra};const r=await fetch(hub.url+'/api/monitor/v1/events',{method:'POST',headers,body:JSON.stringify(value)});if(!r.ok)throw new Error('fixture-event-'+r.status);return r.json();}
 if(!empty)await event('session.started',{label:{origin:'user',value:'Build the integration'}});
 return {hub,token,reader,catalogData,endpoints:controllers.map(({id,server})=>({id,port:server.address().port})),media,scenes,sceneA,sceneB,sceneC,sceneD,readOnly,geometries,reconnect({scopes=['read','control','ingest'],granted=devices}={}){hub.replaceCredentials([{id:'browser',digest:hash(token),scopes,devices:granted},{id:'reader',digest:hash(reader),scopes:['read'],devices}]);},sony,writes,requests,states,nano,pixoo,identity,headers,event,setQueued:v=>queued=v,wallMoments:{lead:ms=>{wallMoments.lead=ms;},stallNext:ms=>{wallMoments.stall=ms;},advance:ms=>{wallMoments.offset+=ms;},alert:kind=>{tick();writer({kind:'alert',nowMs:deviceNow(),alert:kind});},refuseNextVersionedRead:()=>{wallMoments.refuse='armed';},state:()=>structuredClone(wallMoments.device)},setMode:(id,mode)=>{states[id].state.desired.mode={status:'known',value:mode};if(id==='wall'){nano.mode=mode;wallMode(mode);}},setOffline:(v,id='pixel')=>offline=v?id:'',setUncertain:v=>uncertain=v,setDelay:v=>delay=v,advance:id=>{states[id].generation.sequence++;},async close(){await hub.close();for(const {server} of controllers)await new Promise(r=>{server.close(r);server.closeAllConnections();});if(receiver)await new Promise(r=>{receiver.close(r);receiver.closeAllConnections();});await rm(directory,{recursive:true,force:true});}};
}
