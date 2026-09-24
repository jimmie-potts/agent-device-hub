import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,open,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createAgentState,MemoryStorage} from '@jimmie-potts/agent-state';
import {normalizeHook} from '@jimmie-potts/agent-state/providers';
import {codexDesktopOptions,createDesktopRead,unreadSessions} from '../dist/codex-desktop.js';
import {startHub} from '../dist/server.js';

const marker=(ids,version=1)=>JSON.stringify({'local-projects':{},'electron-thread-read-state-v1':{version,unreadByIdentity:{host:{'local:a':ids}},legacyMigration:{}}});
const hook=(name,raw,{client='desktop',sourceId='desktop'}={},at=1000)=>normalizeHook(raw,{provider:'codex',client,hostId:'host',sourceId,hook:name},at);

async function fixture(){
  const home=await mkdtemp(join(tmpdir(),'hub-codex-home-'));let clock=1000;
  const owner=await createAgentState({storage:new MemoryStorage(),ownerId:'owner',consumers:[{id:'nanoleaf',clearOnNewTurn:false}],clock:()=>clock});
  const reader=createDesktopRead({home,hostId:'host',sourceId:'desktop'},owner,()=>clock);
  const complete=async(session,turn)=>{await owner.ingest(hook('UserPromptSubmit',{session_id:session,turn_id:turn},{},clock));await owner.ingest(hook('Stop',{session_id:session,turn_id:turn},{},clock));};
  const read=session=>owner.snapshot().sessions.find(item=>item.identity.sessionId===session&&item.identity.client==='desktop'&&item.identity.sourceId==='desktop')?.read;
  return {home,owner,reader,complete,read,write:ids=>writeFile(join(home,'.codex-global-state.json'),typeof ids==='string'?ids:marker(ids)),
    advance:ms=>{clock+=ms;},close:async()=>{await owner.shutdown();await rm(home,{recursive:true,force:true});}};
}

test('the unread marker parser accepts only the known Desktop shape',()=>{
  assert.deepEqual([...unreadSessions(marker(['one','two']))],['one','two']);
  const twoHosts=JSON.parse(marker(['one']));twoHosts['electron-thread-read-state-v1'].unreadByIdentity.other={'local:b':['three']};
  assert.deepEqual([...unreadSessions(JSON.stringify(twoHosts))].sort(),['one','three']);
  assert.deepEqual([...unreadSessions(marker([]))],[]);
  for(const invalid of [marker(['one'],2),marker([1]),marker(['has space']),marker('one'),'{"electron-thread-read-state-v1":{"version":1}}',
    JSON.stringify({'electron-persisted-atom-state':{'unread-thread-ids-by-host-v1':{local:['one']}}}),'[]','not json'])
    assert.equal(unreadSessions(invalid),null,invalid);
});

test('Desktop configuration requires an absolute Codex home and neutral source IDs',()=>{
  const valid={home:'/mnt/c/Users/person/.codex',hostId:'host',sourceId:'desktop'};
  assert.deepEqual(codexDesktopOptions(valid),valid);
  for(const invalid of [null,{...valid,extra:true},{hostId:'host',sourceId:'desktop'},{...valid,home:'relative/.codex'},{...valid,home:'/a/../b'},
    {...valid,home:'/a\0b'},{...valid,hostId:'has space'},{...valid,sourceId:''}])
    assert.throws(()=>codexDesktopOptions(invalid),/invalid-configuration/);
});

test('read state follows the marker for configured top-level Desktop sessions',async()=>{
  const {owner,reader,complete,read,write,advance,close}=await fixture();
  try{
    await complete('one','turn-1');
    await owner.ingest(hook('SubagentStart',{session_id:'one',agent_id:'child'}));await owner.ingest(hook('SubagentStop',{session_id:'one',agent_id:'child'}));
    await owner.ingest(hook('Stop',{session_id:'other',turn_id:'turn-1'},{sourceId:'other'}));
    await owner.ingest(hook('Stop',{session_id:'cli',turn_id:'turn-1'},{client:'cli'}));
    await write(['one','child','other','cli']);
    await reader.tick();
    assert.equal(read('one'),'unread');
    const others=owner.snapshot().sessions.filter(item=>item.identity.sessionId!=='one');
    assert.equal(others.length,3);assert.ok(others.every(item=>item.read==='unknown'));
    let revision=owner.snapshot().revision;
    advance(10000);await reader.tick();
    assert.equal(owner.snapshot().revision,revision);
    await write([]);await reader.tick();
    assert.equal(read('one'),'read');
    assert.deepEqual(owner.snapshot().sessions.find(item=>item.identity.sessionId==='one').notices.map(notice=>notice.acknowledgedBy),[[]]);
    await complete('one','turn-2');advance(10000);await reader.tick();
    assert.equal(read('one'),'read');
    await write(['one']);await reader.tick();
    assert.equal(read('one'),'unread');
    revision=owner.snapshot().revision;
    await reader.tick();assert.equal(owner.snapshot().revision,revision);
  }finally{await close();}
});

test('an unlisted completion becomes read only after the flag has had time to appear',async()=>{
  const {owner,reader,complete,read,write,advance,close}=await fixture();
  try{
    await complete('viewed','turn-1');
    await owner.ingest(hook('UserPromptSubmit',{session_id:'running',turn_id:'turn-1'}));
    await write([]);
    advance(4999);await reader.tick();
    assert.equal(read('viewed'),'unknown');
    advance(1);await reader.tick();
    assert.equal(read('viewed'),'read');
    advance(600000);await reader.tick();
    assert.equal(read('running'),'unknown');
  }finally{await close();}
});

test('missing, oversized, malformed or changed-format markers produce no read evidence',async()=>{
  const {home,reader,complete,read,write,advance,close}=await fixture();
  try{
    await reader.tick();
    await complete('one','turn-1');advance(10000);
    await reader.tick();assert.equal(read('one'),'unknown');
    await write(['one']);await reader.tick();assert.equal(read('one'),'unread');
    for(const input of ['{"truncated":',marker([],2),JSON.stringify({'electron-persisted-atom-state':{}})]){
      await write(input);advance(10000);await reader.tick();assert.equal(read('one'),'unread',input);
    }
    const file=await open(join(home,'.codex-global-state.json'),'w');
    try{await file.truncate(16*1024*1024+1);}finally{await file.close();}
    await reader.tick();assert.equal(read('one'),'unread');
    await rm(join(home,'.codex-global-state.json'));
    await reader.tick();assert.equal(read('one'),'unread');
    await write([]);await reader.tick();assert.equal(read('one'),'read');
  }finally{await close();}
});

test('the host polls a configured Codex home and rejects invalid Desktop configuration',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hub-desktop-read-')),home=await mkdtemp(join(tmpdir(),'hub-codex-home-'));
  const token='a'.repeat(43),credentials=[{id:'writer',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','ingest'],devices:[]}];
  const base={directory,ownerId:'owner',consumers:[],credentials,controllers:[]};
  let hub;
  try{
    await assert.rejects(startHub({...base,codexDesktop:{home:'relative',hostId:'host',sourceId:'desktop'}}),/invalid-configuration/);
    await writeFile(join(home,'.codex-global-state.json'),marker(['one']));
    hub=await startHub({...base,codexDesktop:{home,hostId:'host',sourceId:'desktop'}});
    const call=(path,body)=>fetch(hub.url+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'x-pixoo-request':'1','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    for(const name of ['UserPromptSubmit','Stop'])assert.equal((await call('/api/monitor/v1/events',hook(name,{session_id:'one',turn_id:'turn-1'},{},Date.now()))).status,200);
    let state;
    for(const deadline=Date.now()+6000;Date.now()<deadline;await new Promise(resolve=>setTimeout(resolve,100))){
      state=(await (await call('/api/monitor/v1/sessions')).json()).snapshot.sessions[0].read;if(state==='unread')break;
    }
    assert.equal(state,'unread');
  }finally{await hub?.close();await rm(directory,{recursive:true,force:true});await rm(home,{recursive:true,force:true});}
});
