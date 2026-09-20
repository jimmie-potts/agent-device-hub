import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentState,MemoryStorage,LIMITS} from '../dist/index.js';

const identity={provider:'codex',client:'cli',hostId:'host',sourceId:'source',sessionId:'session'};
const event=sequence=>({apiVersion:'1.0',identity,turn:{status:'known',id:'turn'},parent:{status:'unknown'},event:{kind:'activity.observed'},observedAtMs:sequence,ordering:{status:'known',epoch:'epoch',sequence}});
const options=storage=>({ownerId:'owner',storage,clock:()=>1000,consumers:['pixoo','nanoleaf','stalled'].map(id=>({id,clearOnNewTurn:true}))});

test('two healthy consumers progress while a stalled consumer stays bounded and resyncs',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  const a=owner.subscribe('pixoo',0),b=owner.subscribe('nanoleaf',0),stalled=owner.subscribe('stalled',0);
  for(let i=1;i<=260;i++){
    const first=a.next(),second=b.next();
    const receipt=await owner.ingest(event(i));
    assert.equal((await first).value.revision,receipt.revision);
    assert.equal((await second).value.revision,receipt.revision);
    assert.ok(stalled.stats().pending<=LIMITS.pendingEvents);
    assert.ok(stalled.stats().bytes<=LIMITS.pendingBytes);
  }
  const lost=(await stalled.next()).value;
  assert.equal(lost.kind,'resync');assert.equal(lost.revision,owner.snapshot().revision);assert.ok(lost.dropped>0);
  assert.deepEqual(Object.keys(lost).sort(),['apiVersion','dropped','kind','revision']);
  assert.equal(owner.snapshot().sessions[0].activity,'active');
  assert.ok(Object.isFrozen(owner.snapshot().sessions[0].identity));
  const waiting=stalled.next();await owner.shutdown();assert.equal((await waiting).done,true);
});

test('expired and invalid cursors require current snapshots and recent cursors retain only notifications',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  for(let i=1;i<=140;i++)await owner.ingest(event(i));
  const stale=owner.subscribe('pixoo',0);assert.equal((await stale.next()).value.kind,'resync');stale.close();
  const invalid=owner.subscribe('pixoo',9999);assert.equal((await invalid.next()).value.kind,'resync');invalid.close();
  const recent=owner.subscribe('pixoo',138);
  assert.equal((await recent.next()).value.revision,139);assert.equal((await recent.next()).value.revision,140);
  await assert.rejects((async()=>{const pending=recent.next();try{await recent.next();}finally{recent.close();await pending;}})(),/pending-read/);
  assert.throws(()=>owner.subscribe('unregistered'),/invalid-consumer/);
  await owner.shutdown();
});

test('saturated admission drops new events while an unsettled storage commit retains ownership',async()=>{
  const backing=new MemoryStorage();let release;let commits=0;
  const storage={async acquire(...args){const lease=await backing.acquire(...args);return {...lease,async commit(change,signal){if(change.revision===1){commits++;await new Promise(resolve=>{release=resolve;});}return lease.commit(change,signal);}};}};
  const owner=await createAgentState({...options(storage),storageTimeoutMs:25});
  const requests=[];for(let i=1;i<=130;i++)requests.push(owner.ingest(event(i)));
  const results=await Promise.all(requests);
  assert.equal(results.filter(r=>r.code==='capacity').length,2);
  assert.equal(commits,1);assert.equal(owner.snapshot().revision,0);
  await assert.rejects(createAgentState(options(backing)),/storage-unavailable/);
  release();await new Promise(resolve=>setImmediate(resolve));
  await owner.shutdown();const restored=await createAgentState(options(backing));
  assert.equal(restored.snapshot().sessions.length,0);await restored.shutdown();
});
