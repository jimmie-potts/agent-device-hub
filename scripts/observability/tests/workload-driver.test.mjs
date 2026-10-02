import test from 'node:test';
import assert from 'node:assert/strict';
import { runScheduledWorkload } from '../workload-driver.mjs';

test('fixed schedule runs all 1800 slots once and measures only the 1200 measurement operations', async () => {
  let time=0,calls=0;const events=[];
  const result=await runScheduledWorkload({clock:{now:()=>time,wait:async ms=>{const deadline=time+ms;await new Promise(resolve=>setImmediate(resolve));time=Math.max(time,deadline);}},
    operation:async({ordinal})=>{assert.equal(ordinal,calls++);return {status:202,outcome:'queued'};},record:event=>events.push(event)});
  assert.equal(result.complete,true);assert.equal(calls,1800);assert.equal(result.measurement.count,1200);
  assert.equal(result.measurement.throughput,20);assert.equal(result.omitted,0);assert.equal(result.lateCompletions,0);
  assert.equal(events.filter(e=>e.kind==='dispatch').length,1800);assert.equal(events.filter(e=>e.kind==='completion').length,1800);
});

test('driver stalls retain expired slots without catch-up calls or reused command ordinals', async () => {
  let time=0;const slots=[],events=[];
  const result=await runScheduledWorkload({clock:{now:()=>time,wait:async ms=>{const deadline=time+ms;await new Promise(resolve=>setImmediate(resolve));time=Math.max(time,deadline);}},
    operation:async({ordinal,slot})=>{slots.push(slot);if(ordinal===0)time=210;return {status:202,outcome:'queued'};},record:e=>events.push(e)});
  assert.equal(result.complete,true);assert.equal(result.omitted,3);assert.deepEqual(slots.slice(0,3),[0,4,5]);
  assert.deepEqual(events.filter(e=>e.kind==='omitted').map(e=>e.slot),[1,2,3]);
  assert.equal(events.find(e=>e.kind==='completion').scheduledToCompletionMs,210);
});

test('operation failure is retained once without retry; failed evidence halts future commands', async () => {
  let time=0,calls=0;const events=[];
  const result=await runScheduledWorkload({clock:{now:()=>time,wait:async ms=>{const deadline=time+ms;await new Promise(resolve=>setImmediate(resolve));time=Math.max(time,deadline);}},
    operation:async()=>{calls++;throw new Error('SYNTHETIC_PRIVATE_CANARY');},record:e=>events.push(e)});
  assert.equal(calls,1800);assert.equal(result.operationFailures,1800);
  assert.equal(JSON.stringify(events).includes('SYNTHETIC_PRIVATE_CANARY'),false);
  time=0;calls=0;
  const failed=await runScheduledWorkload({clock:{now:()=>time,wait:async ms=>{const deadline=time+ms;await new Promise(resolve=>setImmediate(resolve));time=Math.max(time,deadline);}},
    operation:async()=>{calls++;return {};},record:()=>{throw new Error('full');}});
  assert.equal(failed.complete,false);assert.equal(calls,0);
});

test('a shared future start preserves the fixed warmup and measurement boundaries', async () => {
  let time=0; const events=[];
  const result=await runScheduledWorkload({startMs:1000,
    clock:{now:()=>time,wait:async ms=>{const deadline=time+ms;await new Promise(resolve=>setImmediate(resolve));time=Math.max(time,deadline);}},
    operation:async()=>({}),record:e=>events.push(e)});
  assert.equal(result.complete,true);assert.equal(events[0].dispatchMs,1000);
  assert.equal(result.measurementStartMs,31000);assert.equal(result.measurementEndMs,91000);
});
