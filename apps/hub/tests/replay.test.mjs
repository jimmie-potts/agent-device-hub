import test from 'node:test';
import assert from 'node:assert/strict';
import {createReplayLedgers} from '../dist/replay.js';

/** A fake operation the test settles explicitly, counting how often it runs. */
function deferred(){
 const operation={runs:0};
 operation.run=()=>{operation.runs++;return new Promise((resolve,reject)=>{operation.resolve=resolve;operation.reject=reject;});};
 return operation;
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));

for(const [name,settle,check] of [
 ['resolves',operation=>operation.resolve({ok:true}),async result=>assert.deepEqual(await result,{ok:true})],
 ['rejects',operation=>operation.reject(new Error('owner-failed')),async result=>assert.rejects(result,/owner-failed/)],
]){
 test(`a pending command survives retirement and is released once when it ${name}`,async()=>{
  const ledgers=createReplayLedgers({entries:1,bytes:1024}),operation=deferred();
  const body='{"operation":"label"}',result=ledgers.submit('browser-a',ledgers.ticket('browser-a'),body,operation.run);
  result.catch(()=>{});await turn();
  assert.equal(operation.runs,1);
  ledgers.retire('browser-a');ledgers.retire('browser-a');
  assert.deepEqual(ledgers.counts(),{ledgers:0,replayEntries:1,replayBytes:Buffer.byteLength(body),pendingReplays:1},'retirement leaves admitted work charged');
  assert.throws(()=>ledgers.submit('reader',ledgers.ticket('reader'),'{}',()=>'next'),{code:'capacity'},'pending work is never evicted to admit more work');
  settle(operation);await check(result);await turn();
  assert.equal(operation.runs,1,'retirement neither cancels nor repeats the operation');
  assert.deepEqual(ledgers.counts(),{ledgers:1,replayEntries:0,replayBytes:0,pendingReplays:0},'settlement releases the entry');
  ledgers.retire('browser-a');ledgers.retire('reader');
  assert.deepEqual(ledgers.counts(),{ledgers:0,replayEntries:0,replayBytes:0,pendingReplays:0},'repeated retirement cannot double-release');
  assert.equal(await ledgers.submit('other',ledgers.ticket('other'),'{}',()=>'admitted'),'admitted','released capacity admits new work');
 });
}

test('a pending command stays charged after its caller stops waiting, until it settles',async()=>{
 const ledgers=createReplayLedgers(),operation=deferred();
 const ticket=ledgers.ticket('browser-a'),body='{"operation":"acknowledge"}';
 const result=ledgers.submit('browser-a',ticket,body,operation.run);
 // Models the HTTP handler's three-second response timeout, which abandons only the response: the operation keeps running.
 const abandoned=await Promise.race([result.then(()=>'settled'),new Promise(resolve=>setTimeout(()=>resolve('timed-out'),20))]);
 assert.equal(abandoned,'timed-out');
 assert.equal(ledgers.submit('browser-a',ticket,body,operation.run),result,'a repeat before retirement reuses the running operation');
 ledgers.retire('browser-a');
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.deepEqual(ledgers.counts(),{ledgers:0,replayEntries:1,replayBytes:Buffer.byteLength(body),pendingReplays:1});
 operation.resolve('late');assert.equal(await result,'late');await turn();
 assert.equal(operation.runs,1);
 assert.deepEqual(ledgers.counts(),{ledgers:0,replayEntries:0,replayBytes:0,pendingReplays:0});
});

test('retiring a principal drops its settled entries and ledger without touching others',async()=>{
 const ledgers=createReplayLedgers();
 await ledgers.submit('browser-a',ledgers.ticket('browser-a'),'{"a":1}',()=>'a');
 await ledgers.submit('reader',ledgers.ticket('reader'),'{"r":1}',()=>'r');
 const readerNext=ledgers.ticket('reader');
 ledgers.retire('browser-a');
 assert.deepEqual(ledgers.principals(),['reader']);
 assert.deepEqual(ledgers.counts(),{ledgers:1,replayEntries:1,replayBytes:7,pendingReplays:0});
 assert.equal(ledgers.ticket('reader'),readerNext,'another principal keeps its ticket');
});
