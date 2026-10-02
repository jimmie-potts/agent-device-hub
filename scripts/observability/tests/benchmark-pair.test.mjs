import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeBenchmarkPair,commandOutcomesDigest} from '../benchmark-pair.mjs';
const run=enabled=>({enabled,condition:'healthy',complete:true,window:{complete:true,workload:{measurement:{p50Ms:enabled?2:1,p95Ms:enabled?4:2,throughput:20}},
  sampling:{coverageComplete:true},oracle:{complete:true,duplicateExecutions:0},metrics:{application:{meanCpuCores:0.1,peakRssBytes:100000000},stack:{meanCpuCores:0.2,peakRssBytes:300000000}},
  shutdown:{applicationMs:10,flushMs:5}},outcomesDigest:'a'.repeat(64),privacyFailures:0,diagnostics:enabled?{complete:true,correlationFailures:0,shapeFailures:0}:null,
  accounting:enabled?{complete:true,counts:{logs:{expected:12600,exported:12600,failed:0,dropped:0,pending:0,inFlight:0},traces:{expected:10800,exported:10800,failed:0,dropped:0,pending:0,inFlight:0}}}:null,
  ingestion:enabled?{disposition:'supported',evidenceSaved:true,logs:{equal:true,expected:12600,observed:12600,missing:[],unexpected:[]},spans:{equal:true,expected:10800,observed:10800,missing:[],unexpected:[]},correlationFailures:0}:null,
  boundedQueues:true,backendComplete:true,cleanupComplete:true,teardownMs:500});
test('pair evidence requires both modes and full ingestion; preserves individual threshold failure',()=>{
  const runs=[run(false),run(true)];
  assert.equal(summarizeBenchmarkPair({condition:'healthy',number:1,runs}).evaluation.disposition,'supported');
  runs[1].window.workload.measurement.p95Ms=7.000001;
  assert.equal(summarizeBenchmarkPair({condition:'healthy',number:1,runs}).evaluation.disposition,'refuted');
});
test('missing cleanup, identity proof or samples cannot be promoted by passing numerical summaries',()=>{
  for(const mutate of [r=>r.pop(),r=>{r[1].cleanupComplete=false;},r=>{r[1].teardownMs=null;},r=>{r[1].window.sampling.coverageComplete=false;},
    r=>{r[1].ingestion=null;},r=>{r[1].accounting.complete=false;}]) {
    const runs=[run(false),run(true)];mutate(runs);
    assert.notEqual(summarizeBenchmarkPair({condition:'healthy',number:1,runs}).evaluation.disposition,'supported');
  }
});
test('fault loss requires complete accounting and identical domain results; missing one mode is inconclusive',()=>{
  const runs=[run(false),run(true)].map(r=>({...r,condition:'unavailable',ingestion:null}));
  for(const c of Object.values(runs[1].accounting.counts)){c.failed=c.expected;c.exported=0;}
  assert.equal(summarizeBenchmarkPair({condition:'unavailable',number:1,runs}).evaluation.disposition,'supported');
  runs[1].outcomesDigest='b'.repeat(64);
  assert.equal(summarizeBenchmarkPair({condition:'unavailable',number:1,runs}).evaluation.disposition,'refuted');
  assert.notEqual(summarizeBenchmarkPair({condition:'healthy',number:1,runs:[]}).evaluation.disposition,'supported');
});

test('healthy loss counts multiplicities, not only distinct missing hashes',()=>{
  const runs=[run(false),run(true)];runs[1].ingestion.logs.missing=[{sha256:'a'.repeat(64),count:3}];
  runs[1].ingestion.disposition='refuted';
  const result=summarizeBenchmarkPair({condition:'healthy',number:1,runs});
  assert.equal(result.pair.evidence.healthyRecordsLost,3);assert.equal(result.evaluation.disposition,'refuted');
});

test('concurrent completion order does not change comparison but altered domain outcomes do',()=>{
  const first={ordinal:0,slot:0,failed:false,outcome:{status:202,validReceipt:true,receipt:{requestId:{epoch:'first',sequence:1},outcome:'queued'}}};
  const second={...first,ordinal:1,slot:1};
  const digest=commandOutcomesDigest([first,second]);
  assert.equal(commandOutcomesDigest([second,first]),digest);
  const changed=structuredClone(first);changed.outcome.receipt.outcome='failed';
  assert.notEqual(commandOutcomesDigest([changed,second]),digest);
  assert.throws(()=>commandOutcomesDigest([first,first]));
});
