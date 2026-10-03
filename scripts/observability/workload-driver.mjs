import { waitUntil } from './wait-until.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorkloadSchedule } from './workload-schedule.mjs';
import { latencySummary } from './measurement.mjs';
import thresholds from './thresholds.json' with { type: 'json' };

/** The operation performs one command with no retry. record is a synchronous,
 * bounded evidence collector owned by the driver, outside application metrics.
 * Injected clocks are source-test seams, never benchmark duration overrides. */
export async function runScheduledWorkload({ operation, record, signal, startMs: selectedStart,
  clock = { now: () => performance.now(), wait: (ms, active) => delay(ms, undefined, { signal: active }) } }) {
  if (typeof operation !== 'function' || typeof record !== 'function' ||
    typeof clock?.now !== 'function' || typeof clock?.wait !== 'function' || signal?.aborted) throw new Error('Workload inputs invalid');
  const startMs = selectedStart ?? clock.now(), schedule = createWorkloadSchedule({ startMs });
  const measurementStartMs = startMs + thresholds.workload.warmup_seconds * 1000;
  const measurementEndMs = measurementStartMs + thresholds.workload.measurement_seconds * 1000;
  const control = new AbortController(), active = signal ? AbortSignal.any([signal,control.signal]) : control.signal;
  const pending = new Set(), latencies = [], scheduledLatencies = [], lags = [];
  let dispatched = 0, omitted = 0, completions = 0, operationFailures = 0, measuredCompletions = 0, lateCompletions = 0, reason = null;
  function save(event) {
    try {
      const returned = record(event);
      if (returned && typeof returned.then === 'function') {
        Promise.resolve(returned).catch(() => {}); throw new Error('Synchronous recorder required');
      }
    } catch {
      reason = 'evidence-failed'; control.abort(); throw new Error('Evidence incomplete');
    }
  }
  async function perform(event, ordinal) {
    const timeout = new AbortController(), operationSignal = AbortSignal.any([active,timeout.signal]);
    let onAbort, outcome = null, failed = false;
    const aborted = new Promise((_,reject) => { onAbort = () => reject(new Error('Operation aborted')); });
    operationSignal.addEventListener('abort',onAbort,{once:true});
    const timer = setTimeout(() => timeout.abort(),2000);
    try {
      if (operationSignal.aborted) throw new Error('Operation aborted');
      outcome = await Promise.race([Promise.resolve().then(() => operation({ ...event, ordinal, signal: operationSignal })),aborted]);
    } catch { failed = true;operationFailures++; }
    finally { clearTimeout(timer);operationSignal.removeEventListener('abort',onAbort);timeout.abort(); }
    const completedMs = clock.now(), latencyMs = completedMs-event.dispatchMs, scheduledToCompletionMs = completedMs-event.scheduledMs;
    if (![latencyMs,scheduledToCompletionMs].every(n => Number.isFinite(n) && n>=0)) throw new Error('Workload clock invalid');
    completions++;
    if(event.phase==='measurement') {
      latencies.push(latencyMs);scheduledLatencies.push(scheduledToCompletionMs);lags.push(event.lagMs);
      if(completedMs>=measurementStartMs && completedMs<measurementEndMs)measuredCompletions++;else lateCompletions++;
    }
    save({kind:'completion',slot:event.slot,ordinal,phase:event.phase,scheduledMs:event.scheduledMs,dispatchMs:event.dispatchMs,
      completedMs,latencyMs,scheduledToCompletionMs,failed,outcome});
  }
  try {
    await waitUntil(clock,startMs,active);
    while (!schedule.complete && !active.aborted) {
      const events = schedule.advance(clock.now(),pending.size);
      for (const event of events) {
        if (active.aborted) break;
        if(event.kind==='omitted') { omitted++;save(event);continue; }
        const ordinal = dispatched;save({...event,ordinal});dispatched++;
        const task = perform(event,ordinal).catch(() => { reason ??= 'operation-evidence-failed';control.abort(); }).finally(() => pending.delete(task));
        pending.add(task);
      }
      if (!schedule.complete && !active.aborted) await waitUntil(clock,schedule.nextMs,active);
    }
    if (!active.aborted) await waitUntil(clock,measurementEndMs,active);
  } catch { reason ??= active.aborted ? 'aborted' : 'driver-failed';control.abort(); }
  await Promise.all(pending);
  if (active.aborted) reason ??= signal?.aborted ? 'aborted' : 'driver-failed';
  return {scope:'workload-only',complete:!reason && schedule.complete,reason,startMs,measurementStartMs,measurementEndMs,
    finishedMs:clock.now(),dispatched,omitted,completions,operationFailures,lateCompletions,
    measurement:latencies.length ? {...latencySummary(latencies),throughput:measuredCompletions/thresholds.workload.measurement_seconds,
      withinWindowCompletions:measuredCompletions,scheduledLatency:latencySummary(scheduledLatencies),dispatchLag:latencySummary(lags)} : null};
}
