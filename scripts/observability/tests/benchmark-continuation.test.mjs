import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkMayContinue } from '../benchmark-suite.mjs';

const measured = () => ({ backendComplete: true, cleanupComplete: true, preparationFailure: null,
  window: { failure: null, workload: { complete: true, reason: null, omitted: 0 },
    sampling: { complete: true, reason: null, coverageComplete: true }, metrics: { application: {}, stack: {} } } });

test('driver or sampler failures prevent another allocation after cleanup', () => {
  for (const part of ['workload', 'sampling']) {
    const run = measured(); run.window[part] = { complete: false, reason: part + '-failed' };
    assert.equal(benchmarkMayContinue(run), false);
  }
  assert.equal(benchmarkMayContinue({ backendComplete: true, cleanupComplete: true }), false);
});

test('measured threshold misses remain evidence and do not skip prescribed pairs', () => {
  const run = measured(); run.complete = false; run.failure = 'benchmark-evidence-incomplete';
  run.window.workload.omitted = 2;
  run.window.metrics.application = { cpuCores: 3, peakRssBytes: 500000000 };
  assert.equal(benchmarkMayContinue(run), true);
  for (const field of ['backendComplete', 'cleanupComplete']) {
    assert.equal(benchmarkMayContinue({ ...run, [field]: false }), false);
  }
});
