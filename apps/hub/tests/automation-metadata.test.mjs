import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createAutomation,parseEvent,DEFAULT_INTERRUPT_SET,DEFAULT_SETTINGS} from '../dist/automation.js';
import {AutomationStore} from '../dist/automation-store.js';

const events=JSON.parse(await readFile(new URL('../fixtures/moment-title-events.json',import.meta.url),'utf8'));
function open(file,calls){
 const db=new DatabaseSync(file);
 const store=new AutomationStore(db,()=>{},{interruptSet:[...DEFAULT_INTERRUPT_SET],settings:DEFAULT_SETTINGS});
 const automation=createAutomation({store,routed:()=>['wall'],active:()=>true,clock:()=>1000,monotonic:()=>1000,
  targets:async()=>({presentation:'content',alert:'none'}),sender:async(target,moment)=>{
   calls.push(structuredClone({target,moment}));return {kind:'uncertain',momentId:moment.momentId,start:null};
  }});
 return {automation,db,close:async()=>{await automation.close();db.close();}};
}
function rules(automation){
 for(const event of events)automation.create({name:'Named moment',kind:'event',enabled:true,
  trigger:{source:event.source,kind:event.kind},action:{mood:'celebrate',priorityClass:'event',durationMs:5000,targets:['wall']}},true);
}

test('#426 title metadata persists across restart while old events and log rows keep their shape',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-metadata-')),file=join(directory,'state.sqlite'),calls=[];
 let opened=open(file,calls);
 try{
  rules(opened.automation);
  const legacy={id:'old',source:'github',kind:'pull-request.merged',delivery:'live'};
  assert.equal(opened.automation.submit(legacy).accepted,true);
  await opened.automation.settled();
  const old=opened.automation.log(100)[0];
  assert.deepEqual(old.event,{id:'old',source:'github',kind:'pull-request.merged'});
  assert.equal(opened.db.prepare('SELECT detail FROM automation_log').get().detail,null);
  for(const event of events)assert.deepEqual(opened.automation.submit(event),{accepted:true,matched:1});
  await opened.automation.settled();
  const entries=opened.automation.log(100);
  assert.equal(entries.length,3);
  for(const {delivery,...event} of events)assert.deepEqual(entries.find(e=>e.event.id===event.id).event,event);
  for(const {moment} of calls)assert.deepEqual(Object.keys(moment).sort(),['coversStatus','durationMs','momentId','mood','priorityClass','startAtHubMs']);
  await opened.close();opened=open(file,calls);
  assert.deepEqual(opened.automation.log(100),entries);
  assert.deepEqual(opened.automation.submit({...events[0],pullRequestTitle:'Renamed'}),{accepted:false,reason:'duplicate'});
  assert.deepEqual(opened.automation.submit({...events[1],id:'history',delivery:'replay'}),{accepted:false,reason:'replay'});
  await opened.automation.settled();assert.equal(calls.length,3);
 }finally{await opened.close();await rm(directory,{recursive:true,force:true});}
});

test('#426 display metadata uses Unicode scalar bounds and rejects undeclared content and credentials',async()=>{
 const fields={pullRequestTitle:160,repositoryName:80,meetingTitle:160};
 const credentialSamples=['Bearer abcdefghijklmnopqrstuvwxyz','ghp_'+'a'.repeat(36),'sk-'+'a'.repeat(24),
  'token=private-value','password:private-value','-----BEGIN PRIVATE KEY-----'];
 for(const [field,bound] of Object.entries(fields)){
  const full={...events[0],[field]:'🐇'.repeat(bound)};
  assert.deepEqual(parseEvent(full),full,'bounds count Unicode scalars: '+field);
  for(const value of ['',null,undefined,7,'x'.repeat(bound+1),'🐇'.repeat(bound+1),'bad\ntext','bad\u007ftext','\ud800',...credentialSamples])
   assert.equal(parseEvent({...events[0],[field]:value}),null,field+' invalid metadata');
 }
 for(const field of ['prompt','response','transcript','attendees','path','title','metadata'])
  assert.equal(parseEvent({...events[0],[field]:'extra content'}),null,'closed intake: '+field);
 const calls=[],opened=open(':memory:',calls);
 try{
  rules(opened.automation);
  assert.deepEqual(opened.automation.submit({...events[0],pullRequestTitle:credentialSamples[0]}),{accepted:false,reason:'invalid-event'});
  assert.deepEqual(opened.automation.log(100),[]);
  assert.deepEqual(opened.automation.submit(events[0]),{accepted:true,matched:1},'invalid metadata does not consume the ID');
  await opened.automation.settled();
  const serialized=JSON.stringify(opened.automation.log(100));
  for(const credential of credentialSamples)assert.equal(serialized.includes(credential),false);
  assert.equal(calls.length,1);
 }finally{await opened.close();}
});

test('#426 blocked moments retain event titles without handing metadata or a moment to a device',async()=>{
 const calls=[],opened=open(':memory:',calls);
 try{
  rules(opened.automation);
  opened.automation.replaceSettings({...DEFAULT_SETTINGS,quietHours:{enabled:true,start:'00:00',end:'00:00',timeZone:'UTC'}});
  assert.deepEqual(opened.automation.submit(events[1]),{accepted:true,matched:1});
  await opened.automation.settled();
  const [{event,outcome,reason}]=opened.automation.log(100),{delivery,...expected}=events[1];
  assert.deepEqual(event,expected);assert.equal(outcome,'blocked');assert.equal(reason,'quiet-hours');
  assert.deepEqual(calls,[]);
 }finally{await opened.close();}
});
