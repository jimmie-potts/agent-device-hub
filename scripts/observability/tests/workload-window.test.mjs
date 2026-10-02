import test from 'node:test';
import assert from 'node:assert/strict';
import { collectWorkloadWindow } from '../workload-window.mjs';

// All waiters share one virtual monotonic clock; advancing the earliest timer
// lets each async continuation run before selecting the next deadline.
function virtualClock() {
  let now=0,queued=false;const waits=[];
  const tick=()=>{queued=false;if(!waits.length)return;waits.sort((a,b)=>a.deadline-b.deadline);
    const next=waits.shift();now=Math.max(now,next.deadline);next.resolve();setImmediate(tick);queued=true;};
  return {now:()=>now,wait:ms=>new Promise(resolve=>{waits.push({deadline:now+ms,resolve});if(!queued){queued=true;setImmediate(tick);}})};
}
function fixture() {
  const clock=virtualClock(),events=[],executions=[];let resolveClosed,stops=0;
  const closed=new Promise(resolve=>{resolveClosed=resolve;});
  const application={identity:{pid:123,parentPid:1,startTicks:'1'},ready:{resource:{'service.instance.id':'synthetic'}},closed,
    stop:async()=>{stops++;const value={code:0,reason:null,executions,result:{complete:true,quiescent:true,
      oracle:{effects:executions.length,executed:executions.length,cancelled:0,queued:0,historyDropped:0,diagnosticFailures:0},
      shutdown:{applicationMs:1,flushMs:1}}};resolveClosed(value);return value;}};
  const stamp=()=>String(Math.round(clock.now()*1e6));
  return {clock,events,application,stops:()=>stops,record:e=>events.push(e),
    operation:async({ordinal})=>{const requestId={epoch:'requests-1',sequence:ordinal+1};
      executions.push({requestId,receipt:{requestId,outcome:'sent',priorEffects:'confirmed-transmission',
        completedOperations:['brightness'],uncertainOperations:[]},effects:ordinal+1});
      return {requestId,status:202,validReceipt:true,receipt:{requestId,outcome:'queued'}};},
    sampleApplication:async()=>({source:'linux-proc-stat-smaps-rollup',processCount:1,pid:123,parentPid:1,startTicks:'1',
      ticksPerSecond:100,userTicks:Math.floor(clock.now()/1000),systemTicks:0,rssBytes:1024,
      startedNs:stamp(),finishedNs:stamp(),cpuObservedNs:stamp()}),
    sampleStack:async()=>({source:'docker-engine-v1.47-process-rss',containerId:'a'.repeat(64),
      startedNs:stamp(),cpuObservedNs:stamp(),finishedNs:String(BigInt(stamp())+1n),
      cpuTotalNs:Math.floor(clock.now()*1000),rssBytes:2048,cgroupMemoryBytes:4096})};
}
test('one window shares workload and sample boundaries and stops after retaining complete synthetic evidence',async()=>{
  const f=fixture(),result=await collectWorkloadWindow(f);
  assert.equal(result.scope,'single-workload-only');assert.equal(result.complete,true);
  assert.equal(result.workload.dispatched,1800);assert.equal(result.sampling.samples,601);
  assert.equal(result.workload.measurementStartMs,result.sampling.startMs);
  assert.equal(result.workload.measurementEndMs,result.sampling.endMs);
  assert.equal(result.oracle.executed,1800);assert.equal(f.stops(),1);
  assert.equal(f.events.filter(e=>e.kind==='sample').length,601);
});
test('sampling failure aborts remaining commands but still closes the owned application',async()=>{
  const f=fixture();f.sampleStack=async()=>{throw new Error('SYNTHETIC_PRIVATE_CANARY');};
  const result=await collectWorkloadWindow(f);
  assert.equal(result.complete,false);assert.equal(result.sampling.reason,'sample-failed');
  assert.ok(result.workload.dispatched<1800);assert.equal(f.stops(),1);
  assert.equal(JSON.stringify(f.events).includes('SYNTHETIC_PRIVATE_CANARY'),false);
});
