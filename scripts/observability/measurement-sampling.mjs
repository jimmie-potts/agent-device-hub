import { waitUntil } from './wait-until.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import thresholds from './thresholds.json' with { type: 'json' };

const intervalMs = 100;
const durationMs = thresholds.workload.measurement_seconds * 1000;

/** Fixed measurement cadence. sample must honor cancellation; record must be a
 * synchronous bounded collector. Missing slots are evidence, never catch-up work. */
export async function runMeasurementSampling({ startMs, sample, record, signal,
  clock = { now: () => performance.now(), wait: (ms, active) => delay(ms, undefined, { signal: active }) } }) {
  if (!Number.isFinite(startMs) || typeof sample !== 'function' || typeof record !== 'function' ||
    typeof clock?.now !== 'function' || typeof clock?.wait !== 'function') throw new Error('Sampling inputs invalid');
  let samples = 0, omitted = 0, maximumDurationMs = 0, reason = null;
  const control = new AbortController();
  const active = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  function save(event) {
    try {
      const result = record(event);
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw new Error('Synchronous recorder required');
      }
    } catch { reason = 'evidence-failed'; throw new Error('Evidence incomplete'); }
  }
  try {
    for (let slot = 0; slot <= durationMs / intervalMs; slot++) {
      if (active.aborted) { reason = 'aborted'; break; }
      const scheduledMs = startMs + slot * intervalMs;
      await waitUntil(clock, scheduledMs, active);
      const startedMs = clock.now();
      if (!Number.isFinite(startedMs) || startedMs < scheduledMs) throw new Error('Sampling clock invalid');
      if (startedMs >= scheduledMs + intervalMs) {
        omitted++;
        save({ kind: 'sample-omitted', slot, scheduledMs, observedMs: startedMs });
        continue;
      }
      const timeout = new AbortController();
      const sampleSignal = AbortSignal.any([active, timeout.signal]);
      let onAbort;
      const aborted = new Promise((_, reject) => { onAbort = () => reject(new Error('Sample aborted')); });
      sampleSignal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => timeout.abort(), 1000);
      let value;
      try {
        if (sampleSignal.aborted) throw new Error('Sample aborted');
        value = await Promise.race([Promise.resolve().then(() => sample({ signal: sampleSignal })), aborted]);
      } catch {
        reason = active.aborted ? 'aborted' : 'sample-failed';
        save({ kind: 'sample-failed', slot, scheduledMs, startedMs, reason });
        break;
      } finally {
        clearTimeout(timer);
        sampleSignal.removeEventListener('abort', onAbort);
        timeout.abort();
      }
      const finishedMs = clock.now(), duration = finishedMs - startedMs;
      if (!Number.isFinite(duration) || duration < 0) throw new Error('Sampling clock invalid');
      maximumDurationMs = Math.max(maximumDurationMs, duration);
      save({ kind: 'sample', slot, scheduledMs, startedMs, finishedMs, lagMs: startedMs - scheduledMs, durationMs: duration, value });
      samples++;
    }
  } catch { reason ??= active.aborted ? 'aborted' : 'sampling-failed'; }
  finally { control.abort(); }
  const complete = reason === null;
  return { complete, coverageComplete: complete && omitted === 0 && samples === durationMs / intervalMs + 1,
    reason, samples, omitted, maximumDurationMs, startMs, endMs: startMs + durationMs };
}
