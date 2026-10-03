import test from 'node:test';
import assert from 'node:assert/strict';
import { runMeasurementSampling } from '../measurement-sampling.mjs';

test('100ms sampling includes both measurement boundaries without adding collection time to the cadence', async () => {
  let now=0;const events=[];
  const result=await runMeasurementSampling({startMs:0,clock:{now:()=>now,wait:async ms=>{now+=ms;}},
    sample:async()=>{now+=25;return {value:1};},record:e=>events.push(e)});
  assert.equal(result.complete,true);assert.equal(result.coverageComplete,true);assert.equal(result.samples,601);assert.equal(result.omitted,0);
  assert.equal(events[0].scheduledMs,0);assert.equal(events.at(-1).scheduledMs,60000);
  assert.equal(events.at(-1).startedMs,60000);assert.equal(result.maximumDurationMs,25);
});

test('a stalled sampler retains missed slots and cannot claim complete coverage', async () => {
  let now=0,count=0;const events=[];
  const result=await runMeasurementSampling({startMs:0,clock:{now:()=>now,wait:async ms=>{now+=ms;}},
    sample:async()=>{if(count++===0)now=350;return {};},record:e=>events.push(e)});
  assert.equal(result.complete,true);assert.equal(result.coverageComplete,false);assert.equal(result.omitted,2);
  assert.deepEqual(events.filter(e=>e.kind==='sample-omitted').map(e=>e.slot),[1,2]);
  assert.equal(events[3].slot,3);assert.equal(events[3].startedMs,350);
});

test('failed samples retain a static failure and stop; source exceptions never enter evidence', async () => {
  const events=[];const result=await runMeasurementSampling({startMs:0,clock:{now:()=>0,wait:async()=>{}},
    sample:async()=>{throw new Error('SYNTHETIC_PRIVATE_CANARY');},record:e=>events.push(e)});
  assert.equal(result.complete,false);assert.equal(result.reason,'sample-failed');assert.equal(result.coverageComplete,false);
  assert.equal(JSON.stringify(events).includes('SYNTHETIC_PRIVATE_CANARY'),false);
});

test('cancellation and failed evidence stop sampling without reusing a slot',async()=>{
  let calls=0;const control=new AbortController();
  const aborted=await runMeasurementSampling({startMs:0,signal:control.signal,
    clock:{now:()=>0,wait:async()=>{}},sample:async({signal})=>{
      calls++;control.abort();assert.equal(signal.aborted,true);return {};
    },record:()=>{}});
  assert.equal(aborted.complete,false);assert.equal(aborted.reason,'aborted');assert.equal(calls,1);
  calls=0;
  const failed=await runMeasurementSampling({startMs:0,clock:{now:()=>0,wait:async()=>{}},
    sample:async()=>{calls++;return {};},record:()=>{throw new Error('full');}});
  assert.equal(failed.reason,'evidence-failed');assert.equal(calls,1);
});

test('early timer wakeups preserve all absolute sampling boundaries', async () => {
  let now = 0; const events = [];
  const result = await runMeasurementSampling({ startMs: 100.75,
    clock: { now: () => now, wait: async ms => { now += Math.max(1, Math.floor(ms)); } },
    sample: async () => ({}), record: event => events.push(event) });
  assert.equal(result.coverageComplete, true);
  assert.equal(result.samples, 601);
  assert.ok(events.every(event => event.startedMs >= event.scheduledMs));
  assert.equal(result.omitted, 0);
});
