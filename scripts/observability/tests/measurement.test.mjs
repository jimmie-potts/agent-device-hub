import assert from 'node:assert/strict';
import { test } from 'node:test';
import { latencySummary, evaluatePair } from '../measurement.mjs';

const MiB = 1024 ** 2;
const baseline = () => ({ p50Ms: 1, p95Ms: 2, throughput: 20, cpuCores: 0.1, peakRssBytes: 100 * MiB });
const enabled = () => ({ p50Ms: 3, p95Ms: 7, throughput: 19, cpuCores: 0.35, peakRssBytes: 164 * MiB });
const pair = () => ({
  condition: 'healthy', baseline: baseline(), enabled: enabled(),
  stack: { peakRssBytes: 3 * 1024 ** 3, meanCpuCores: 1 },
  shutdown: { applicationSeconds: 2, flushSeconds: 1, containerSeconds: 30 },
  evidence: { healthyRecordsLost: 0, privacyFailures: 0, contextIsolationFailures: 0,
    duplicateSideEffects: 0, identicalCommandOutcomes: true, boundedQueues: true, accountedFaultLoss: true,
    measurementCoverage: true, workloadEvidence: true },
});

test('nearest-rank latency retains precision and does not mutate raw samples', () => {
  const samples = [10, 1, 3, 2, 5, 4, 6, 9, 8, 7];
  const copy = [...samples];
  assert.deepEqual(latencySummary(samples), { count: 10, p50Ms: 5, p95Ms: 10 });
  assert.deepEqual(samples, copy);
  assert.equal(latencySummary([1.00001]).p95Ms, 1.00001);
  for (const invalid of [[], [NaN], [Infinity], [-1], ['2']]) {
    assert.throws(() => latencySummary(invalid), /latency/);
  }
});

test('absolute allowances and inclusive limits apply to a tiny baseline', () => {
  const result = evaluatePair(pair());
  assert.equal(result.disposition, 'supported');
  assert.equal(result.checks.p50.limit, 2);
  assert.equal(result.checks.p95.limit, 5);
});

test('an unrounded individual failure refutes a pair', () => {
  const input = pair();
  input.enabled.p50Ms += 0.000001;
  const result = evaluatePair(input);
  assert.equal(result.disposition, 'refuted');
  assert.equal(result.checks.p50.status, 'fail');
  assert.equal(result.checks.p95.status, 'pass');
});

test('percentage allowances apply to larger baselines', () => {
  const input = pair();
  Object.assign(input.baseline, { p50Ms: 100, p95Ms: 200 });
  Object.assign(input.enabled, { p50Ms: 110, p95Ms: 230 });
  const result = evaluatePair(input);
  assert.equal(result.disposition, 'supported');
  assert.equal(result.checks.p50.limit, 10);
  assert.equal(result.checks.p95.limit, 30);
});

test('missing, nonnumeric and invalid measurements never produce a pass', () => {
  for (const invalid of [undefined, null, NaN, Infinity, '0', -1]) {
    const input = pair();
    input.enabled.cpuCores = invalid;
    assert.equal(evaluatePair(input).disposition, 'inconclusive');
  }
  const input = pair();
  input.baseline.throughput = 0;
  assert.equal(evaluatePair(input).disposition, 'inconclusive');
});

test('known failures remain refuted alongside missing measurements', () => {
  const input = pair();
  delete input.stack;
  input.evidence.privacyFailures = 1;
  const result = evaluatePair(input);
  assert.equal(result.disposition, 'refuted');
  assert.equal(result.checks.stackRss.status, 'missing');
  assert.equal(result.checks.privacy.status, 'fail');
});

test('fault condition requires accounting and bounds without claiming healthy ingestion', () => {
  const input = pair();
  input.condition = 'unavailable';
  delete input.evidence.healthyRecordsLost;
  assert.equal(evaluatePair(input).disposition, 'supported');
  input.evidence.accountedFaultLoss = false;
  assert.equal(evaluatePair(input).disposition, 'refuted');
  delete input.evidence.accountedFaultLoss;
  assert.equal(evaluatePair(input).disposition, 'inconclusive');
});

test('each mandatory protection independently prevents support', () => {
  for (const key of ['privacyFailures', 'contextIsolationFailures', 'duplicateSideEffects', 'healthyRecordsLost']) {
    const input = pair(); input.evidence[key] = 1;
    assert.equal(evaluatePair(input).disposition, 'refuted', key);
  }
  for (const key of ['identicalCommandOutcomes', 'boundedQueues']) {
    const input = pair(); input.evidence[key] = false;
    assert.equal(evaluatePair(input).disposition, 'refuted', key);
  }
  const input = pair(); input.condition = 'unknown';
  assert.throws(() => evaluatePair(input), /condition/);
});

test('incomplete workload or sampling evidence remains inconclusive even with passing numbers', () => {
  for (const name of ['measurementCoverage', 'workloadEvidence']) {
    const input=pair();input.evidence[name]=false;
    assert.equal(evaluatePair(input).disposition,'inconclusive');
    input.enabled.p50Ms=100;
    assert.equal(evaluatePair(input).disposition,'refuted');
  }
});

test('every numerical bound fails independently and missing evidence stays inconclusive', () => {
  const cases = [
    ['enabled', 'p95Ms', 7.0001], ['enabled', 'throughput', 18.9999],
    ['enabled', 'cpuCores', 0.3501], ['enabled', 'peakRssBytes', 164 * MiB + 1],
    ['stack', 'peakRssBytes', 3 * 1024 ** 3 + 1], ['stack', 'meanCpuCores', 1.0001],
    ['shutdown', 'applicationSeconds', 2.0001], ['shutdown', 'flushSeconds', 1.0001],
    ['shutdown', 'containerSeconds', 30.0001],
  ];
  for (const [section, key, value] of cases) {
    const input = pair(); input[section][key] = value;
    assert.equal(evaluatePair(input).disposition, 'refuted', `${section}.${key}`);
    delete input[section][key];
    assert.equal(evaluatePair(input).disposition, 'inconclusive', `${section}.${key} missing`);
  }
  for (const key of Object.keys(pair().evidence).filter(key => key !== 'accountedFaultLoss')) {
    const input = pair(); delete input.evidence[key];
    assert.equal(evaluatePair(input).disposition, 'inconclusive', key);
  }
});
