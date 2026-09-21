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
export async function fixture(){
 const corpus=JSON.parse(await readFile('packages/contracts/fixtures/controller-v1.json','utf8'));
 const template=corpus.schemaCases.find(c=>c.definition==='snapshot'&&c.valid).value;
 const project='project-'+'a'.repeat(64),task='task-'+'b'.repeat(64);
 const nano={apiVersion:'nanoleaf.integration/1.0',identity:{controllerId:'wall-controller',deviceId:'wall',sourceId:'source',controllerEpoch:'epoch'},configurationRevision:0,revision:'b'.repeat(64),mode:'Work',settings:{style:'classic',coverage:'whole'},source:'shared',projects:[{id:project,color:'#a9c3ff'}],tasks:[{id:task,projectId:project,overrideProjectId:null}],elements:[{id:'1:2',projectId:null,signature:0}],wallPending:null,pending:[],outcomes:[],nextRequestId:{epoch:'a'.repeat(32),sequence:0},capabilities:Object.fromEntries(['settings.set','elements.assign','task.assign','project.color','mode.set'].map(k=>[k,{supported:true,scope:'control',...(k==='mode.set'?{route:'/controller/v1/commands'}:{})}])),limits:{maxItems:1000,maxPending:1,maxReceipts:256,maxBodyBytes:65536}};
 const pixoo=JSON.parse(await readFile('apps/hub/fixtures/pixoo-integration.json','utf8')).snapshot;
 pixoo.identity={controllerId:'pixel-controller',deviceId:'pixel',sourceId:'pixel'};
 const states={wall:structuredClone(template),pixel:structuredClone(template)};
 for(const [id,s] of Object.entries(states)){s.identity={controllerId:id==='wall'?'wall-controller':'pixel-controller',deviceId:id,sourceId:id,controllerEpoch:'epoch'};s.capabilities.modes={supported:true,values:id==='wall'?['Work','Quiet','Free']:['Monitor','Media']};s.state.desired.mode={status:'known',value:id==='wall'?'Work':'Media'};s.state.externalControl={status:'unknown'};s.state.observation={status:'unknown'};s.state.lastSuccessfulSend={status:'unknown'};s.state.lastOutcome={status:'unknown'};s.state.pending=[];}
 const writes=[],requests=[];let offline=false,uncertain=false,delay=0;
 const controllers=[];
 for(const id of ['wall','pixel']){
  const server=createServer(async(req,res)=>{
   requests.push({id,method:req.method,url:req.url});
   if(id==='pixel'&&offline){res.writeHead(503,{'content-type':'application/json'});res.end('{"failure":{"code":"transport-failure"}}');return;}
   if(id==='pixel'&&delay)await new Promise(r=>setTimeout(r,delay));
   let body='';for await(const chunk of req)body+=chunk;
   const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
   const integration=req.url.includes('integration');const state=states[id],ext=id==='wall'?nano:pixoo;
   if(req.method==='GET'){send(200,integration?ext:state);return;}
   const command=JSON.parse(body);writes.push({id,integration,command});
   if(uncertain){req.socket.destroy();return;}
   if(!integration){if(!validate('request',command)){send(400,{failure:{code:'invalid-request'}});return;}
    const conflict=command.expectedConfigurationRevision!==state.configurationRevision||JSON.stringify(command.expectedGeneration)!==JSON.stringify(state.generation);
    const receipt={apiVersion:'1.0',controllerId:state.identity.controllerId,deviceId:id,requestId:command.requestId,configurationRevision:state.configurationRevision,generation:state.generation,outcome:conflict?'failed':'queued',priorEffects:'none',completedOperations:[],uncertainOperations:[],...(conflict?{failure:{code:'revision-conflict'}}:{})};
    if(!conflict){state.configurationRevision++;state.nextRequestId.sequence++;state.state.desired.mode={status:'known',value:command.command.mode};if(id==='wall')nano.mode=command.command.mode;else pixoo.configuration.mode=command.command.mode.toLowerCase();}
    send(conflict?409:200,receipt);return;
   }
   if(id==='wall'){
    if(!validateRequest(command)){send(400,{failure:{code:'invalid-request'}});return;}
    const conflict=command.expectedRevision!==nano.revision;
    const result={apiVersion:nano.apiVersion,requestId:command.requestId,outcome:conflict?'failed':'applied',priorEffects:conflict?'none':'configuration',physicalOutcome:'unknown',...(conflict?{failure:{code:'revision-conflict'}}:{})};
    if(!conflict){const c=command.command;if(c.kind==='settings.set')Object.assign(nano.settings,Object.fromEntries(Object.entries(c).filter(([k])=>k!=='kind')));if(c.kind==='elements.assign')Object.assign(nano.elements[0],c.elements[0]);if(c.kind==='task.assign')nano.tasks[0].overrideProjectId=c.projectId;if(c.kind==='project.color')nano.projects[0].color=c.color;nano.nextRequestId.sequence++;nano.configurationRevision++;nano.revision=hash(String(nano.configurationRevision));}send(conflict?409:200,result);
   }else{
    if(!validatePixooRequest(command)){send(400,{error:{code:'invalid-input'}});return;}
    if(command.expectedConfigurationRevision!==pixoo.configurationRevision){send(409,{error:{code:'revision-conflict'}});return;}
    if(command.action.operation==='view'){pixoo.configuration.filter=command.action.filter;pixoo.configuration.cadenceMs=command.action.cadenceMs;}else pixoo.configuration.mode=command.action.mode;
    pixoo.configurationRevision++;pixoo.generation++;pixoo.nextRequestId=pixoo.serverId+':'+(Number(pixoo.nextRequestId.split(':')[1])+1);const result=structuredClone(pixoo);delete result.identity;send(200,result);
   }
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));controllers.push({id,server});
 }
 const directory=await mkdtemp(join(tmpdir(),'dashboard-browser-')),token='d'.repeat(43),reader='r'.repeat(43),native='n'.repeat(43);
 const hub=await startHub({directory,ownerId:'fixture-owner',consumers:[{id:'dashboard',clearOnNewTurn:false}],credentials:[{id:'browser',digest:hash(token),scopes:['read','control','ingest'],devices:['wall','pixel']},{id:'reader',digest:hash(reader),scopes:['read'],devices:['wall','pixel']}],controllers:controllers.map(({id,server})=>({id,kind:id==='wall'?'nanoleaf':'pixoo',controllerId:id==='wall'?'wall-controller':'pixel-controller',deviceId:id,endpoint:`http://127.0.0.1:${server.address().port}/controller/v1`,token:native})),editorLinks:{wall:'http://127.0.0.1:8765/wall',pixel:'http://127.0.0.1:3000/playlists'}});
 const headers={authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'};
 const identity={provider:'codex',client:'cli',hostId:'local',sourceId:'codex',sessionId:'task-one'};
 let seq=0;
 async function event(kind,extra={}){const value={apiVersion:'1.0',identity,turn:{status:'known',id:'turn-one'},parent:{status:'unknown'},event:{kind},observedAtMs:Date.now(),ordering:{status:'known',epoch:'fixture',sequence:seq++},...extra};const r=await fetch(hub.url+'/api/monitor/v1/events',{method:'POST',headers,body:JSON.stringify(value)});if(!r.ok)throw new Error('fixture-event-'+r.status);return r.json();}
 await event('session.started',{label:{origin:'user',value:'Build the integration'}});
 return {hub,token,reader,reconnect(){hub.replaceCredentials([{id:'browser',digest:hash(token),scopes:['read','control','ingest'],devices:['wall','pixel']},{id:'reader',digest:hash(reader),scopes:['read'],devices:['wall','pixel']}]);},writes,requests,states,nano,pixoo,identity,headers,event,setOffline:v=>offline=v,setUncertain:v=>uncertain=v,setDelay:v=>delay=v,async close(){await hub.close();for(const {server} of controllers)await new Promise(r=>{server.close(r);server.closeAllConnections();});await rm(directory,{recursive:true,force:true});}};
}
