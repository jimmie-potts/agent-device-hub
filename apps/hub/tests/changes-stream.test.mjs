import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeHook} from '@jimmie-potts/agent-state/providers';
import {startHub} from '../dist/server.js';

const token='a'.repeat(43),readToken='b'.repeat(43);
const hash=value=>createHash('sha256').update(value).digest('hex');
const credentials=[{id:'writer',digest:hash(token),scopes:['read','ingest','control','admin'],devices:[]},
  {id:'reader',digest:hash(readToken),scopes:['read'],devices:[]}];
const event=(sessionId)=>({apiVersion:'1.0',identity:{provider:'codex',client:'cli',hostId:'h',sourceId:'s',sessionId},
  turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'session.started'},observedAtMs:Date.now(),ordering:{status:'unknown'}});
const marker=ids=>JSON.stringify({'local-projects':{},'electron-thread-read-state-v1':{version:1,unreadByIdentity:{host:{'local:a':ids}},legacyMigration:{}}});
const hook=(name,raw,at=Date.now())=>normalizeHook(raw,{provider:'codex',client:'desktop',hostId:'host',sourceId:'desktop',hook:name},at);

// A day-long heartbeat interval means any observed push must come from the commit
// notification, not the periodic timer that also covers non-commit changes.
const NO_TIMER = 86400000;

async function openReader(hub,credential=readToken){
  const response=await fetch(hub.url+'/api/monitor/v1/changes',{headers:{authorization:`Bearer ${credential}`},signal:AbortSignal.timeout(10000)});
  const raw=response.body.getReader();const decoder=new TextDecoder();let buffer='';
  return {async next(){
    for(;;){
      const index=buffer.indexOf('\n\n');
      if(index>=0){const frame=buffer.slice(0,index+2);buffer=buffer.slice(index+2);return frame;}
      const {value,done}=await raw.read();if(done)throw new Error('stream-closed');
      buffer+=decoder.decode(value,{stream:true});
    }
  },cancel:()=>raw.cancel().catch(()=>{})};
}

test('a committed event reaches an open stream immediately, without waiting for the heartbeat timer',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hub-push-immediate-'));let hub,reader;
  try{
    hub=await startHub({directory,ownerId:'owner',consumers:[],credentials,controllers:[],feedIntervalMs:NO_TIMER});
    reader=await openReader(hub);
    assert.match(await reader.next(),/"revision":0/);
    const headers={authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'};
    const started=Date.now();
    const response=await fetch(hub.url+'/api/monitor/v1/events',{method:'POST',headers,body:JSON.stringify(event('one'))});
    assert.equal(response.status,200);
    const frame=await Promise.race([reader.next(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('timed-out')),3000))]);
    assert.match(frame,/"revision":1/);
    assert.ok(Date.now()-started<3000);
  } finally {await reader?.cancel();await hub?.close();await rm(directory,{recursive:true,force:true});}
});

test('a burst of commits coalesces into one flush and a paused reader does not delay ingest or other readers',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hub-push-burst-'));let hub,reader,paused;
  try{
    hub=await startHub({directory,ownerId:'owner',consumers:[],credentials,controllers:[],feedIntervalMs:NO_TIMER});
    reader=await openReader(hub);
    assert.match(await reader.next(),/"revision":0/);
    // Connected but never read: this reader must not slow ingest or the live reader below.
    paused=await fetch(hub.url+'/api/monitor/v1/changes',{headers:{authorization:`Bearer ${readToken}`},signal:AbortSignal.timeout(10000)});
    const headers={authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'};
    const started=Date.now();
    const responses=await Promise.all(['burst-1','burst-2','burst-3'].map(sessionId =>
      fetch(hub.url+'/api/monitor/v1/events',{method:'POST',headers,body:JSON.stringify(event(sessionId))})));
    assert.ok(responses.every(response => response.status===200));
    assert.ok(Date.now()-started<3000,'a paused reader must not delay ingest');
    // The three commits arrive in a single flush: each remains its own SSE frame, but no
    // further network wait separates them, unlike a delivery spread across timer ticks.
    let revision=0;
    for(let frames=0;revision<3;frames++){
      assert.ok(frames<3,'more frames than committed revisions');
      const frame=await Promise.race([reader.next(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('timed-out')),200))]);
      revision=Number(frame.match(/"revision":(\d+)/)[1]);
    }
    assert.equal(revision,3);
    await assert.rejects(Promise.race([reader.next(),new Promise((_,reject)=>setTimeout(reject,200))]));
  } finally {await reader?.cancel();await paused?.body?.cancel().catch(()=>{});await hub?.close();await rm(directory,{recursive:true,force:true});}
});

test('a commit from the in-process Codex Desktop reader reaches an open stream before its own poll would repeat',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hub-push-desktop-')),home=await mkdtemp(join(tmpdir(),'hub-push-desktop-home-'));
  let hub,reader;
  try{
    await writeFile(join(home,'.codex-global-state.json'),marker(['one']));
    hub=await startHub({directory,ownerId:'owner',consumers:[],credentials,controllers:[],feedIntervalMs:NO_TIMER,codexDesktop:{home,hostId:'host',sourceId:'desktop'}});
    const headers={authorization:`Bearer ${token}`,'content-type':'application/json','x-pixoo-request':'1'};
    const call=input=>fetch(hub.url+'/api/monitor/v1/events',{method:'POST',headers,body:JSON.stringify(input)});
    for(const name of ['UserPromptSubmit','Stop'])assert.equal((await call(hook(name,{session_id:'one',turn_id:'turn-1'}))).status,200);
    reader=await openReader(hub);
    const initial=await reader.next();
    const initialRevision=Number(initial.match(/"revision":(\d+)/)[1]);
    assert.ok(initialRevision<=2,initial);
    const frame=await Promise.race([reader.next(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('timed-out')),5000))]);
    assert.ok(Number(frame.match(/"revision":(\d+)/)[1])>initialRevision,frame);
  } finally {await reader?.cancel();await hub?.close();await rm(directory,{recursive:true,force:true});await rm(home,{recursive:true,force:true});}
});
