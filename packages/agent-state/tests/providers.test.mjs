import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeHook,createEmitter} from '../dist/providers.js';
import {validateEvent} from '@jimmie-potts/agent-lifecycle-contracts';

const source=(hook='SessionStart',provider='codex')=>({provider,client:provider==='codex'?'cli':'code',hostId:'host',sourceId:'source',hook});
const raw={session_id:'session',turn_id:'turn',prompt_id:'prompt',agent_id:'child'};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

for(const provider of ['codex','claude'])for(const [hook,kind] of Object.entries({SessionStart:'session.started',UserPromptSubmit:'turn.started',PermissionRequest:'attention.approval',Stop:'turn.ended',SessionEnd:'runtime.ended',SubagentStart:'session.started',SubagentStop:'turn.ended',...(provider==='codex'?{Interrupt:'turn.interrupted'}:{})})){
  test(`${provider} ${hook} maps only qualified lifecycle metadata`,()=>{
    const value=normalizeHook(raw,source(hook,provider),1000);
    assert.equal(value.event.kind,kind);assert.equal(validateEvent(value).ok,true);
    assert.deepEqual(value.ordering,{status:'unknown'});
    assert.equal(value.identity.sourceId,'source');assert.equal(value.observedAtMs,1000);
    const child=hook.startsWith('Subagent');
    assert.equal(value.identity.sessionId,child?'child':'session');
    assert.deepEqual(value.turn,child?{status:'unknown'}:{status:'known',id:provider==='codex'?'turn':'prompt'});
    if(child){assert.equal(value.parent.identity.sessionId,'session');assert.equal(value.parent.status,'known');}
    else assert.deepEqual(value.parent,{status:'unknown'});
    if(kind==='attention.approval')assert.deepEqual(value.event.attention,{status:'unknown'});
    assert.ok(Object.isFrozen(value));assert.ok(Object.isFrozen(value.identity));
  });
}

test('private fields and getters never enter normalized transport metadata',()=>{
  let reads=0;const input={...raw,prompt:'PRIVATE_CANARY',title:'PRIVATE_CANARY',cwd:'/PRIVATE_CANARY',tool_input:{secret:'PRIVATE_CANARY'},event_id:'invented'};
  Object.defineProperty(input,'transcript',{enumerable:true,get(){reads++;throw new Error('PRIVATE_CANARY');}});
  const value=normalizeHook(input,source('PermissionRequest'),1000);
  assert.equal(reads,0);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_CANARY|invented/);
  assert.equal('eventId' in value,false);assert.equal('occurredAtMs' in value,false);
  const getter={};Object.defineProperty(getter,'session_id',{enumerable:true,get(){reads++;throw new Error('PRIVATE_CANARY');}});
  assert.equal(normalizeHook(getter,source(),1000),null);assert.equal(reads,0);
});

test('missing identity, malformed fields and unsupported coverage stay unavailable',()=>{
  for(const session_id of [null,'','has spaces','x'.repeat(129),'session\n'])assert.equal(normalizeHook({session_id},source(),1000),null);
  assert.equal(normalizeHook({session_id:'session'},source('SubagentStart'),1000),null);
  assert.equal(normalizeHook({...raw,agent_id:'session'},source('SubagentStart'),1000),null);
  assert.equal(normalizeHook(raw,source('Interrupt','claude'),1000),null);
  assert.equal(normalizeHook(raw,source('ReadObserved'),1000),null);
  assert.equal(normalizeHook(raw,source('request_user_input_async'),1000),null);
  assert.deepEqual(normalizeHook({session_id:'session'},source('Stop'),1000).turn,{status:'unknown'});
  assert.equal(normalizeHook({...raw,turn_id:'bad turn'},source('Stop'),1000),null);
  assert.equal(normalizeHook(raw,source(),NaN),null);
  assert.doesNotMatch(readFileSync(new URL('../dist/providers.js',import.meta.url),'utf8'),/agent-lifecycle-contracts|ajv|reducer/);
});

test('disabled and unqualified sources send nothing; qualified sends receive detached immutable values',async()=>{
  let calls=0;const send=async event=>{calls++;assert.ok(Object.isFrozen(event));assert.ok(Object.isFrozen(event.identity));assert.doesNotMatch(JSON.stringify(event),/PRIVATE_CANARY/);};
  for(const flags of [{},{enabled:true},{qualified:true}]){const emitter=createEmitter({source:source(),send,...flags});await emitter.emit(raw);assert.equal(emitter.stats().pending,0);await emitter.close();}
  assert.equal(calls,0);
  const emitter=createEmitter({source:source(),send,enabled:true,qualified:true,clock:()=>1000});
  await emitter.emit({...raw,prompt:'PRIVATE_CANARY'});assert.equal(calls,1);assert.equal(emitter.stats().delivered,1);await emitter.close();
});

test('queue saturation drops new work by both count and bytes',async()=>{
  for(const cap of [{maxPending:1},{maxPendingBytes:Buffer.byteLength(JSON.stringify(normalizeHook(raw,source(),1000)))}]){
    const gate=deferred();let calls=0;
    const emitter=createEmitter({source:source(),send:()=>{calls++;return gate.promise;},enabled:true,qualified:true,clock:()=>1000,...cap});
    const first=emitter.emit(raw);await emitter.emit({...raw,session_id:'otherxx'});
    assert.equal(calls,1);assert.equal(emitter.stats().droppedSaturated,1);assert.equal(emitter.stats().resyncNeeded,true);
    gate.resolve();await first;assert.equal(emitter.stats().pending,0);await emitter.close();
  }
});

test('timeout aborts and retains one underlying send until an ignored abort settles',async()=>{
  const gate=deferred();let calls=0,signal;
  const emitter=createEmitter({source:source(),send:(_event,abort)=>{calls++;signal=abort;return gate.promise;},enabled:true,qualified:true,timeoutMs:15});
  await Promise.all([emitter.emit(raw),emitter.emit({...raw,session_id:'second'})]);
  assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(emitter.stats().timedOut,1);assert.equal(emitter.stats().pending,1);
  await emitter.emit(raw);assert.equal(calls,1);
  gate.resolve();await settle();assert.equal(emitter.stats().pending,0);assert.equal(emitter.stats().delivered,0);await emitter.close();
});

test('throws, rejected sends, clocks and close never expose private exception data',async()=>{
  for(const send of [()=>{throw new Error('PRIVATE_CANARY');},()=>Promise.reject(new Error('PRIVATE_CANARY'))]){
    const emitter=createEmitter({source:source(),send,enabled:true,qualified:true});await assert.doesNotReject(emitter.emit(raw));
    assert.equal(emitter.stats().failed,1);assert.doesNotMatch(JSON.stringify(emitter.stats()),/PRIVATE_CANARY/);await emitter.close();
  }
  const gate=deferred();let signal;
  const emitter=createEmitter({source:source(),send:(_e,s)=>{signal=s;return gate.promise;},enabled:true,qualified:true});
  const first=emitter.emit(raw),second=emitter.emit(raw);await emitter.close();await Promise.all([first,second]);
  assert.equal(signal.aborted,true);assert.equal(emitter.stats().cancelled,2);gate.reject(new Error('PRIVATE_CANARY'));await settle();
  assert.equal(emitter.stats().pending,0);assert.doesNotMatch(JSON.stringify(emitter.stats()),/PRIVATE_CANARY/);
  const invalidClock=createEmitter({source:source(),send:async()=>assert.fail(),enabled:true,qualified:true,clock:()=>{throw new Error('PRIVATE_CANARY');}});
  await assert.doesNotReject(invalidClock.emit(raw));await invalidClock.close();
});

test('configuration uses fixed error codes and never invokes option accessors',()=>{
  for(const extra of [{timeoutMs:3001},{maxPending:129},{maxPendingBytes:262145},{enabled:'yes'},{qualified:'yes'},{clock:1}])assert.throws(()=>createEmitter({source:source(),send:async()=>{},...extra}),/invalid-/);
  let reads=0;const config={source:source(),send:async()=>{}};Object.defineProperty(config,'timeoutMs',{enumerable:true,get(){reads++;throw new Error('PRIVATE_CANARY');}});
  assert.throws(()=>createEmitter(config),/invalid-timeout/);assert.equal(reads,0);
});
