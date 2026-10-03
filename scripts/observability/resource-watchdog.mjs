import thresholds from './thresholds.json' with { type: 'json' };
import { setTimeout as delay } from 'node:timers/promises';
const limits = thresholds.hard_limits;
const fields = ['runDataBytes', 'cgroupMemoryBytes', 'hostAvailableMemoryBytes', 'minimumAvailableBytes'];

export function assessResources(sample) {
  const values = Object.fromEntries(fields.map(key => [key, Number.isSafeInteger(sample?.[key]) && sample[key] >= 0 ? sample[key] : null]));
  values.oomKilled = typeof sample?.oomKilled === 'boolean' ? sample.oomKilled : null;
  const reason = values.runDataBytes > limits.run_data_bytes ? 'run-data-cap'
    : values.cgroupMemoryBytes > limits.stack_memory_bytes ? 'stack-memory-cap'
    : values.oomKilled === true ? 'oom'
    : Object.values(values).includes(null) ? 'measurement-invalid'
    : values.hostAvailableMemoryBytes < limits.host_available_reserve_bytes ? 'host-reserve'
    : values.minimumAvailableBytes < Math.max(0, limits.run_data_bytes - values.runDataBytes) ? 'storage-headroom' : null;
  return { ok: reason === null, reason, values };
}

async function bounded(action, timeoutMs, parent) {
  const control = new AbortController(); let timer;
  const signal = parent ? AbortSignal.any([parent, control.signal]) : control.signal;
  if (signal.aborted) throw new Error('Watchdog operation aborted');
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(new Error('Watchdog operation aborted')); });
  signal.addEventListener('abort', rejectAbort, { once: true });
  timer = setTimeout(() => control.abort(), timeoutMs);
  try { return await Promise.race([Promise.resolve().then(() => action({ signal, timeoutMs })), aborted]); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', rejectAbort); control.abort(); }
}

/** Callbacks must honor cancellation. stopOwned must verify current ownership and absence/running state. */
export function startResourceWatchdog({ sample, record, stopOwned, intervalMs = 1000, sampleTimeoutMs = 5000, maximumSamples = 3600 }) {
  if ([sample, record, stopOwned].some(value => typeof value !== 'function') ||
    !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 1000 ||
    !Number.isInteger(sampleTimeoutMs) || sampleTimeoutMs < 1 || sampleTimeoutMs > 5000 ||
    !Number.isInteger(maximumSamples) || maximumSamples < 1 || maximumSamples > 3600) throw new Error('Watchdog configuration invalid');
  const control = new AbortController(); let finishing = false, sampleCount = 0, settleReady;
  const ready = new Promise(resolve => { settleReady = resolve; });
  const done = (async () => {
    let reason = null, evidenceSaved = true;
    while (!finishing && !reason) {
      if (sampleCount >= maximumSamples) { reason = 'sample-limit'; break; }
      const startedNs = String(process.hrtime.bigint());
      let observation;
      try { observation = await bounded(sample, sampleTimeoutMs, control.signal); }
      catch { if (!finishing) reason = 'sample-failed'; break; }
      if (finishing) break;
      const assessment = assessResources(observation);
      sampleCount++;
      const finishedNs = String(process.hrtime.bigint());
      try { await bounded(options => record({ phase: 'sample', sequence: sampleCount, startedNs, finishedNs, ...assessment }, options), 1000, control.signal); }
      catch { evidenceSaved = false; if (!finishing) reason = assessment.reason ?? 'evidence-failed'; break; }
      if (!assessment.ok) { reason = assessment.reason; break; }
      if (finishing) break;
      settleReady(true);
      try { await delay(intervalMs, undefined, { signal: control.signal }); }
      catch { if (!finishing) reason = 'monitor-aborted'; }
    }
    settleReady(false);
    if (!reason) return { status: 'finished', sampleCount, evidenceSaved, reason: null, stopConfirmed: false };
    if (evidenceSaved) {
      try { await bounded(options => record({ phase: 'stop-intent', reason, sampleCount }, options), 1000); }
      catch { evidenceSaved = false; }
    }
    let stopConfirmed = false;
    try { stopConfirmed = (await bounded(options => stopOwned({ ...options, reason }), 29000))?.confirmed === true; }
    catch { /* Preserve failure; no automatic retry or force. */ }
    return { status: 'failed', reason, sampleCount, evidenceSaved, stopConfirmed };
  })();
  return { ready, done, finish() { finishing = true; control.abort(); return done; } };
}
