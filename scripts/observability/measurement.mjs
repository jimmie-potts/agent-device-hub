import thresholds from './thresholds.json' with { type: 'json' };

const limits = thresholds.each_pair;
const finiteNonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Nearest rank, with no display rounding and no mutation of retained samples. */
export function latencySummary(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || !samples.every(finiteNonnegative)) {
    throw new TypeError('latency samples must be a nonempty array of finite nonnegative milliseconds');
  }
  const ordered = [...samples].sort((left, right) => left - right);
  return {
    count: ordered.length,
    p50Ms: ordered[Math.ceil(ordered.length * 0.5) - 1],
    p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
  };
}

/** Evaluates one measured pair only. This does not establish the pilot adoption gate. */
export function evaluatePair(pair) {
  if (!['healthy', 'unavailable'].includes(pair?.condition)) throw new TypeError('unknown collection condition');
  const checks = {};
  const missing = (name, limit) => { checks[name] = { status: 'missing', limit }; };
  function upper(name, value, limit, valid = finiteNonnegative(value)) {
    if (!valid) return missing(name, limit);
    checks[name] = { status: value <= limit ? 'pass' : 'fail', value, limit };
  }
  function delta(name, key, limit) {
    const before = pair.baseline?.[key], after = pair.enabled?.[key];
    upper(name, after - before, limit, finiteNonnegative(before) && finiteNonnegative(after));
  }
  function flag(name, value) {
    checks[name] = typeof value !== 'boolean' ? { status: 'missing', expected: true }
      : { status: value ? 'pass' : 'fail', value, expected: true };
  }
  for (const percentile of ['p50', 'p95']) {
    const before = pair.baseline?.[`${percentile}Ms`];
    const limit = finiteNonnegative(before)
      ? Math.max(limits[`${percentile}_added_ms_absolute`], before * limits[`${percentile}_added_baseline_fraction`])
      : null;
    delta(percentile, `${percentile}Ms`, limit);
  }
  const before = pair.baseline?.throughput, after = pair.enabled?.throughput;
  if (!finiteNonnegative(before) || before === 0 || !finiteNonnegative(after)) {
    missing('throughput', null);
  } else {
    const limit = before * limits.enabled_throughput_minimum_baseline_fraction;
    checks.throughput = { status: after >= limit ? 'pass' : 'fail', value: after, limit, comparison: '>=' };
  }
  delta('applicationCpu', 'cpuCores', limits.application_added_cpu_cores);
  delta('applicationRss', 'peakRssBytes', limits.application_added_peak_rss_bytes);
  upper('stackRss', pair.stack?.peakRssBytes, limits.stack_peak_rss_bytes);
  upper('stackCpu', pair.stack?.meanCpuCores, limits.stack_mean_cpu_cores);
  upper('applicationShutdown', pair.shutdown?.applicationSeconds, limits.application_shutdown_seconds);
  upper('flush', pair.shutdown?.flushSeconds, limits.telemetry_flush_seconds);
  upper('containerTeardown', pair.shutdown?.containerSeconds, limits.container_teardown_seconds);
  for (const [name, key, threshold] of [
    ['privacy', 'privacyFailures', limits.privacy_failures],
    ['contextIsolation', 'contextIsolationFailures', limits.context_isolation_failures],
    ['duplicateSideEffects', 'duplicateSideEffects', limits.duplicate_side_effects],
    ...(pair.condition === 'healthy' ? [['healthyLoss', 'healthyRecordsLost', limits.healthy_expected_records_lost]] : []),
  ]) {
    const value = pair.evidence?.[key];
    upper(name, value, threshold, Number.isSafeInteger(value) && value >= 0);
  }
  flag('commandOutcomes', pair.evidence?.identicalCommandOutcomes);
  flag('boundedQueues', pair.evidence?.boundedQueues);
  if (pair.condition === 'unavailable') flag('faultAccounting', pair.evidence?.accountedFaultLoss);
  const statuses = Object.values(checks).map(check => check.status);
  return {
    scope: 'measured-pair-only',
    condition: pair.condition,
    disposition: statuses.includes('fail') ? 'refuted' : statuses.includes('missing') ? 'inconclusive' : 'supported',
    checks,
  };
}
