import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentState, MemoryStorage} from '../dist/index.js';
import {normalizeHook} from '../dist/providers.js';

// #225: a newer turn proves that an approval without a request ID on the retired turn was answered.
const source={provider:'codex',client:'desktop',hostId:'host',sourceId:'desktop'};
const hook=(name,turn)=>normalizeHook({session_id:'session',turn_id:turn},{...source,hook:name},1000);
const options=storage=>({storage,ownerId:'owner',consumers:[{id:'nanoleaf',clearOnNewTurn:true}],clock:()=>1000});
const approvals=owner=>owner.snapshot().sessions[0].attention.filter(item=>item.kind==='approval')
  .map(item=>[item.turn.id,item.id.status==='known'?item.id.id:'no-id']);

test('a no-ID approval clears when a newer turn starts',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(hook('UserPromptSubmit','turn-1'));await owner.ingest(hook('PermissionRequest','turn-1'));
  assert.deepEqual(approvals(owner),[['turn-1','no-id']]);
  // No Stop: an interrupted dialog leaves the marker until the next turn.
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

// #456: tool completion or the end of the same turn proves a no-ID approval on that turn was answered.
const claude={provider:'claude',client:'code',hostId:'host',sourceId:'claude'};
const claudeHook=(name,prompt,extra={},session='session')=>normalizeHook({session_id:session,...(prompt?{prompt_id:prompt}:{}),...extra},{...claude,hook:name},1000);
const used=(prompt,id='tool-x',name='PostToolUse',session)=>claudeHook(name,prompt,{tool_use_id:id,tool_name:'Bash',tool_input:{command:'CANARY'},tool_response:{stdout:'CANARY'}},session);
const markers=owner=>owner.snapshot().sessions.flatMap(session=>session.attention.map(item=>[session.identity.sessionId,item.kind,item.turn.id,item.id.status==='known'?item.id.id:'no-id']));

for(const name of ['PostToolUse','PostToolUseFailure'])test(`${name} on the approval's turn clears the no-ID marker`,async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(claudeHook('UserPromptSubmit','p0'));await owner.ingest(claudeHook('Stop','p0'));
  await owner.ingest(claudeHook('UserPromptSubmit','p1'));await owner.ingest(claudeHook('PermissionRequest','p1'));
  const before=owner.snapshot().sessions[0];
  assert.deepEqual(markers(owner),[['session','approval','p1','no-id']]);
  assert.equal((await owner.ingest(used('p1','tool-x',name))).outcome,'applied');
  const after=owner.snapshot().sessions[0];
  assert.deepEqual(markers(owner),[]);
  assert.equal(after.activity,'active');assert.equal(after.turn.id,'p1');
  assert.deepEqual(after.notices,before.notices);assert.deepEqual(after.notices[0].acknowledgedBy,['nanoleaf']);
  assert.doesNotMatch(JSON.stringify(await owner.exportState()),/CANARY|tool-x|Bash/);
  await owner.shutdown();
});

test('a tool completion without a marker changes no attention and adds no ambiguity',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(claudeHook('UserPromptSubmit','p1'));
  assert.equal((await owner.ingest(used('p1'))).outcome,'applied');
  const session=owner.snapshot().sessions[0];
  assert.deepEqual(session.attention,[]);
  assert.ok(!session.unavailable.some(item=>item.dimension==='attention'));
  await owner.shutdown();
});

test('a tool completion on another turn, session or source leaves the marker',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(claudeHook('UserPromptSubmit','p1'));await owner.ingest(claudeHook('PermissionRequest','p1'));
  await owner.ingest(used('p2'));
  await owner.ingest(claudeHook('UserPromptSubmit','p1',{},'other'));await owner.ingest(used('p1','tool-x','PostToolUse','other'));
  const foreign=used('p1');
  await owner.ingest({...foreign,identity:{...foreign.identity,sourceId:'elsewhere'}});
  assert.deepEqual(markers(owner).filter(([session])=>session==='session'),[['session','approval','p1','no-id']]);
  await owner.shutdown();
});

test('Stop on the approval turn clears the marker; Stop on an earlier or unknown turn does not',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(claudeHook('UserPromptSubmit','p0'));await owner.ingest(claudeHook('UserPromptSubmit','p1'));
  await owner.ingest(claudeHook('PermissionRequest','p1'));
  await owner.ingest(claudeHook('Stop','p0'));await owner.ingest(claudeHook('Stop',null));
  assert.deepEqual(markers(owner),[['session','approval','p1','no-id']]);
  await owner.ingest(claudeHook('Stop','p1'));
  assert.deepEqual(markers(owner),[]);
  await owner.shutdown();
});

test('Codex turn end clears its own turn no-ID approval',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(hook('UserPromptSubmit','turn-1'));await owner.ingest(hook('PermissionRequest','turn-1'));
  await owner.ingest(hook('Stop','turn-1'));
  assert.deepEqual(approvals(owner),[]);
  await owner.shutdown();
});

test('a new approval after a tool completion on the same turn creates a marker',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(claudeHook('UserPromptSubmit','p1'));await owner.ingest(claudeHook('PermissionRequest','p1'));
  await owner.ingest(used('p1'));
  await owner.ingest(normalizeHook({session_id:'session',prompt_id:'p1'},{...claude,hook:'PermissionRequest'},2000));
  assert.deepEqual(markers(owner),[['session','approval','p1','no-id']]);
  await owner.shutdown();
});

test('the same resolution twice is a duplicate without a new revision',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(claudeHook('UserPromptSubmit','p1'));await owner.ingest(claudeHook('PermissionRequest','p1'));
  const first=await owner.ingest(used('p1'));
  const second=await owner.ingest(used('p1'));
  assert.equal(second.outcome,'duplicate');assert.equal(second.revision,first.revision);
  assert.equal(owner.snapshot().revision,first.revision);
  await owner.shutdown();
});

test('a resolution for another request ID leaves a known-ID approval',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(claudeHook('UserPromptSubmit','p1'));
  await owner.ingest({...claudeHook('PermissionRequest','p1'),event:{kind:'attention.approval',attention:{status:'known',id:'request'}}});
  await owner.ingest(used('p1','tool-y'));await owner.ingest(claudeHook('Stop','p1'));
  assert.deepEqual(markers(owner),[['session','approval','p1','request']]);
  await owner.shutdown();
});

test('question and input markers survive tool completion and turn end',async()=>{
  const owner=await createAgentState(options(new MemoryStorage()));
  await owner.ingest(claudeHook('UserPromptSubmit','p1'));
  for(const kind of ['attention.input','question.continuing'])
    await owner.ingest({...claudeHook('PermissionRequest','p1'),event:{kind,attention:{status:'unknown'}}});
  await owner.ingest(used('p1'));await owner.ingest(claudeHook('Stop','p1'));
  assert.deepEqual(markers(owner).map(([,kind])=>kind).sort(),['input','question']);
  await owner.shutdown();
});
