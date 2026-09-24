import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentState, MemoryStorage} from '../dist/index.js';
import {normalizeHook} from '../dist/providers.js';

// #225: a newer turn proves that an approval without a request ID on the retired turn was answered.
const source={provider:'codex',client:'desktop',hostId:'host',sourceId:'desktop'};
const identity={...source,sessionId:'session'};
const hook=(name,turn)=>normalizeHook({session_id:'session',turn_id:turn},{...source,hook:name},1000);
const options=storage=>({storage,ownerId:'owner',consumers:[{id:'nanoleaf',clearOnNewTurn:true}],clock:()=>1000});
const approvals=owner=>owner.snapshot().sessions[0].attention.filter(item=>item.kind==='approval')
  .map(item=>[item.turn.id,item.id.status==='known'?item.id.id:'no-id']);

test('a no-ID approval clears when a newer turn starts',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(hook('UserPromptSubmit','turn-1'));await owner.ingest(hook('PermissionRequest','turn-1'));
  assert.deepEqual(approvals(owner),[['turn-1','no-id']]);
  await owner.ingest(hook('Stop','turn-1'));
  assert.deepEqual(approvals(owner),[['turn-1','no-id']]);
  await owner.ingest(hook('UserPromptSubmit','turn-2'));
  assert.deepEqual(approvals(owner),[]);
  assert.equal(owner.snapshot().sessions[0].turn.id,'turn-2');
  // Earlier uncertainty stays visible after the marker is forgotten.
  assert.ok(owner.snapshot().sessions[0].unavailable.some(item=>item.dimension==='attention'&&item.reason==='ambiguous'));
  await owner.shutdown();
});

test('no-ID questions and input requests on a retired turn stay',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(hook('UserPromptSubmit','turn-1'));
  for(const kind of ['attention.input','question.continuing'])
    await owner.ingest({...hook('PermissionRequest','turn-1'),event:{kind,attention:{status:'unknown'}}});
  await owner.ingest(hook('UserPromptSubmit','turn-2'));
  assert.deepEqual(owner.snapshot().sessions[0].attention.map(item=>[item.kind,item.turn.id]).sort(),[['input','turn-1'],['question','turn-1']]);
  await owner.shutdown();
});

test('markers on the current or an unselected turn stay when another turn starts',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(hook('UserPromptSubmit','turn-1'));
  await owner.ingest(hook('PermissionRequest','turn-9'));
  await owner.ingest(hook('UserPromptSubmit','turn-2'));await owner.ingest(hook('PermissionRequest','turn-2'));
  assert.deepEqual(approvals(owner),[['turn-9','no-id'],['turn-2','no-id']]);
  await owner.shutdown();
});

test('a late no-ID approval for a retired turn is not retained',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(hook('UserPromptSubmit','turn-1'));await owner.ingest(hook('UserPromptSubmit','turn-2'));
  await owner.ingest(hook('PermissionRequest','turn-1'));
  assert.deepEqual(approvals(owner),[]);
  await owner.shutdown();
});

test('an approval with a request ID on a retired turn stays',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(hook('UserPromptSubmit','turn-1'));
  await owner.ingest({...hook('PermissionRequest','turn-1'),event:{kind:'attention.approval',attention:{status:'known',id:'request'}}});
  await owner.ingest(hook('UserPromptSubmit','turn-2'));
  assert.deepEqual(approvals(owner),[['turn-1','request']]);
  await owner.shutdown();
});

test('stored no-ID approvals on retired turns clear at startup in one revision',async()=>{
  const source=await createAgentState(options(new MemoryStorage()));
  await source.ingest(hook('UserPromptSubmit','turn-1'));await source.ingest(hook('UserPromptSubmit','turn-2'));
  await source.ingest(hook('PermissionRequest','turn-2'));
  const state=structuredClone(await source.exportState());await source.shutdown();
  // A store written before #225 can hold a marker on a turn it already retired.
  const session=state.sessions[0];
  assert.ok(session.retiredTurns.includes('turn-1'));
  session.attention.push({id:{status:'unknown'},kind:'approval',turn:{status:'known',id:'turn-1'}});
  const storage=new MemoryStorage();
  let owner=await createAgentState({...options(storage),importState:state});
  assert.deepEqual(approvals(owner),[['turn-2','no-id']]);
  assert.equal(owner.snapshot().revision,state.revision+1);
  assert.equal(owner.journal().length,state.journal.length);
  await owner.shutdown();
  owner=await createAgentState(options(storage));
  assert.deepEqual(approvals(owner),[['turn-2','no-id']]);
  await owner.shutdown();
});
