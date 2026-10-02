import thresholds from './thresholds.json' with { type: 'json' };

/** Fixed owner-approved slots. Advancing the driver never dispatches expired
 * slots or retries omitted work. The driver retains every returned event. */
export function createWorkloadSchedule({ startMs }) {
  if (typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0) throw new TypeError('Invalid start time');
  const { operations_per_second: rate, maximum_concurrency: maximum,
    warmup_seconds: warmup, measurement_seconds: measurement } = thresholds.workload;
  const interval = 1000 / rate, warmupSlots = warmup * rate, total = (warmup + measurement) * rate;
  let cursor = 0, previous = startMs;
  return {
    get complete() { return cursor === total; },
    get nextMs() { return startMs + cursor * interval; },
    advance(nowMs, inFlight) {
      if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || nowMs < previous) throw new TypeError('Clock must be monotonic');
      if (!Number.isInteger(inFlight) || inFlight < 0 || inFlight > maximum) throw new TypeError('Invalid in-flight count');
      previous = nowMs;
      const events = [];
      while (cursor < total && startMs + cursor * interval <= nowMs) {
        const slot = cursor++, scheduledMs = startMs + slot * interval;
        const common = { slot, phase: slot < warmupSlots ? 'warmup' : 'measurement', scheduledMs };
        if (nowMs >= scheduledMs + interval) {
          events.push({ kind: 'omitted', ...common, observedMs: nowMs, reason: 'driver-lag' });
        } else if (inFlight >= maximum) {
          events.push({ kind: 'omitted', ...common, observedMs: nowMs, reason: 'concurrency' });
        } else {
          events.push({ kind: 'dispatch', ...common, dispatchMs: nowMs, lagMs: nowMs - scheduledMs });
          // At most one nonexpired slot exists at a given observation.
          break;
        }
      }
      return events;
    },
  };
}
