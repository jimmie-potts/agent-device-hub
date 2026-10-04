// Internal synthetic probe. The updater supplies a fresh private scratch directory,
// never an installed store. Run each release in a separate process/module graph.
import assert from 'node:assert/strict';
import {dependencyEntrypoint} from '../dist/install/compatibility.js';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {readFile,writeFile,readdir} from 'node:fs/promises';
const [program,directory,mode]=process.argv.slice(2);
assert(['write','reopen'].includes(mode));
const {createAgentState}=await import(pathToFileURL(await dependencyEntrypoint(program,'agent-state')).href);
const {HubStorage}=await import(pathToFileURL(join(program,'dist/storage.js')).href);
const {createAutomation,DEFAULT_SETTINGS}=await import(pathToFileURL(join(program,'dist/automation.js')).href);
const marker=join(directory,'synthetic-install-probe.json');
if(mode==='write')assert.deepEqual(await readdir(directory),[]);
else assert.equal(JSON.parse(await readFile(marker,'utf8')).synthetic,true);
const identity={provider:'codex',client:'cli',hostId:'probe-host',sourceId:'probe-source',sessionId:'probe-session'};
const consumers=[{id:'probe-consumer',clearOnNewTurn:false}];
const at=10000,clock=()=>at;
let sequence=0;
const event=(kind,session=identity,extra={})=>({apiVersion:'1.1',identity:session,turn:{status:'known',id:'probe-turn'},parent:{status:'unknown'},event:{kind},observedAtMs:at,ordering:{status:'known',epoch:'probe-epoch',sequence:++sequence},eventId:'probe-'+sequence,...extra});
let lease;
const owner=await createAgentState({storage:{acquire:async(id,signal)=>lease=await new HubStorage(directory).acquire(id,signal)},ownerId:'probe-owner',consumers,clock});
let calls=0;
const automation=createAutomation({store:lease.automation,routed:()=>['fake'],targets:async()=>({presentation:'content',alert:'none'}),
 sender:async(_target,moment)=>{calls++;return {kind:'uncertain',momentId:moment.momentId,start:null};},clock,monotonic:clock,active:()=>true});
const consumed={source:'github',id:'already-consumed',kind:'pull-request.merged',delivery:'live',agent:'probe-agent',task:'probe-task'};
const capture=async()=>({state:await owner.exportState(),rules:lease.automation.rules(),settings:lease.automation.settings(),interruptSet:lease.automation.interruptSet(),log:lease.automation.readLog(100),budget:lease.automation.handedForTask('probe-agent','probe-task'),fence:lease.fenced()});
try{
 if(mode==='write'){
  // Lifecycle 1.1 metadata and a known parent cover every stored session field.
  assert.equal((await owner.ingest(event('session.started',identity,{title:{value:'Probe title',source:'provider'},project:'probe-project',projectId:'probe-project-id'}))).ok,true);
  assert.equal((await owner.setLabel(identity,'Preserved label')).ok,true);
  assert.equal((await owner.ingest(event('turn.ended'))).ok,true);
  const notice=owner.snapshot().sessions[0].notices[0];assert(notice);
  assert.equal((await owner.acknowledge(identity,notice.id,consumers[0].id)).ok,true);
  assert.equal((await owner.ingest(event('attention.input',identity,{event:{kind:'attention.input',attention:{status:'known',id:'input'}}}))).ok,true);
  const child={...identity,sessionId:'probe-child'};
  assert.equal((await owner.ingest(event('session.started',child,{parent:{status:'known',identity}}))).ok,true);
  assert.equal((await owner.setLabel(child,'Agent label','agent')).ok,true);
  const retired={...identity,sessionId:'retired'};
  assert.equal((await owner.ingest(event('session.started',retired))).ok,true);
  assert.equal((await owner.ingest(event('runtime.ended',retired))).ok,true);
  automation.create({name:'Preserved rule',kind:'event',enabled:true,trigger:{source:'github',kind:'pull-request.merged'},action:{mood:'celebrate',priorityClass:'flourish',durationMs:1000,targets:['fake']}},true);
  automation.replaceInterruptSet({kinds:['pull-request.merged']});
  automation.replaceSettings({...DEFAULT_SETTINGS,budgets:{...DEFAULT_SETTINGS.budgets,perAgentTask:3}});
  assert.equal(automation.submit(consumed).accepted,true);await automation.settled();assert.equal(calls,1);
  lease.setFence(true);
  const expected=await capture();assert.equal(expected.state.formatVersion,'2.1');assert.equal(expected.state.retirements.length,1);assert(expected.state.journal.length>0);
  assert.equal(expected.state.sessions[0].attention.length,1);assert(expected.state.sessions[0].seen.length>0);assert(expected.state.sessions[0].watermarks.length>0);assert.equal(expected.budget,1);
  const [main,stored]=expected.state.sessions;
  assert.deepEqual([main.title,main.project,main.projectId,main.labelOrigin,main.metadataObservedAtMs],[{value:'Probe title',source:'provider'},'probe-project','probe-project-id','user',at]);
  assert.deepEqual([stored.parent,stored.label,stored.labelOrigin],[{status:'known',identity},'Agent label','agent']);
  await writeFile(marker,JSON.stringify({synthetic:true,expected}),{mode:0o600,flag:'wx'});
 }else{
  const {expected}=JSON.parse(await readFile(marker,'utf8'));
  assert.deepEqual(automation.submit(consumed),{accepted:false,reason:'duplicate'});await automation.settled();assert.equal(calls,0);
  assert.deepEqual(await capture(),expected);
 }
 process.stdout.write(JSON.stringify({ok:true,mode,calls})+'\n');
}finally{await automation.close();await owner.shutdown();}
