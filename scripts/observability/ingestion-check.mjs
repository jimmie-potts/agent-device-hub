import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { compareRecords } from './query-records.mjs';
const ns = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n;
export function queryWindows(startNs, endNs) {
  if (!ns(startNs) || !ns(endNs) || BigInt(startNs) >= BigInt(endNs) || BigInt(endNs) - BigInt(startNs) > 120000000000n) {
    throw new Error('Query window invalid');
  }
  const windows = [];
  for (let start = BigInt(startNs); start < BigInt(endNs); start += 10000000000n) {
    windows.push({ startNs: String(start), endNs: String(start + 10000000000n < BigInt(endNs) ? start + 10000000000n : BigInt(endNs)) });
  }
  return windows;
}
function correlation(logs, spans) {
  const counts = new Map();
  const key = (traceId, spanId, service, instance) => JSON.stringify([traceId, spanId, service, instance]);
  for (const span of spans) {
    const id = key(span.traceId, span.spanId, span.resource['service.name']?.stringValue,
      span.resource['service.instance.id']?.stringValue);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return logs.filter(log => !log.fields.trace_id || !log.fields.span_id || counts.get(key(log.fields.trace_id,
    log.fields.span_id, log.fields.service_name, log.fields.service_instance_id)) !== 1).length;
}

/** Fixed post-flush visibility window; polling never resends telemetry or domain commands. */
export async function verifyIngestion({ expectedLogs: inputLogs, expectedSpans: inputSpans, startNs, endNs,
  queries, record, deadlineMs = 30000, signal }) {
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30000 || typeof record !== 'function' ||
    ![inputLogs, inputSpans].every(value => Array.isArray(value) && value.length > 0 && value.length <= 20000)) throw new Error('Ingestion check inputs invalid');
  const expectedLogs = structuredClone(inputLogs), expectedSpans = structuredClone(inputSpans);
  const instances = [...new Set(expectedLogs.map(log => log.fields.service_instance_id))], traces = [...new Set(expectedSpans.map(span => span.traceId))];
  if (instances.length > 8 || traces.length > 2000 || instances.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) ||
    traces.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))) throw new Error('Ingestion identities invalid');
  const windows = queryWindows(startNs, endNs), control = new AbortController();
  const activeSignal = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  const started = performance.now(), timer = setTimeout(() => control.abort(), deadlineMs);
  let round = 0, logComparison = null, spanComparison = null, correlationFailures = null, evidenceSaved = true, waitingForVisibility = false;
  const result = (disposition, reason) => ({ scope: 'ingestion-only', disposition, reason, rounds: round,
    elapsedMs: performance.now() - started, logs: logComparison, spans: spanComparison, correlationFailures, evidenceSaved });
  const remaining = () => {
    const timeoutMs = Math.floor(deadlineMs - (performance.now() - started));
    if (activeSignal.aborted || timeoutMs < 1) throw new Error('Query visibility deadline');
    return { signal: activeSignal, timeoutMs: Math.min(2000, timeoutMs) };
  };
  async function within(action) {
    if (activeSignal.aborted) throw new Error('Query deadline');
    let onAbort;
    const aborted = new Promise((_, reject) => { onAbort = () => reject(new Error('Query deadline')); });
    activeSignal.addEventListener('abort', onAbort, { once: true });
    try {
      const value = await Promise.race([Promise.resolve().then(action), aborted]);
      if (activeSignal.aborted) throw new Error('Query completion unconfirmed');
      return value;
    } finally { activeSignal.removeEventListener('abort', onAbort); }
  }
  // Serialize durable observations while permitting up to eight independent HTTP reads.
  let writing = Promise.resolve();
  async function save(event) {
    const pending = writing.then(() => within(() => record(event, { signal: activeSignal }))); writing = pending.catch(() => {});
    try { await pending; } catch (error) { evidenceSaved = false; throw error; }
  }
  async function collect(jobs, type) {
    const rows = [], failures = []; let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, async () => {
      while (next < jobs.length && !failures.length && !activeSignal.aborted) {
        const index = next++, selector = jobs[index];
        try {
          const receipt = await within(() => type === 'logs' ? queries.logs(selector, remaining()) : queries.trace(selector, remaining()));
          await save({ kind: 'query', round, type, index, selector, receipt });
          remaining(); rows.push(...receipt.records);
          if (rows.length > 20000) throw new Error('Query result count exceeded');
        } catch (error) { failures.push(error); }
      }
    }));
    if (failures.length) throw failures[0];
    remaining(); return rows;
  }
  try {
    while (performance.now() - started < deadlineMs && !activeSignal.aborted) {
      round++; waitingForVisibility = false;
      const logs = await collect(instances.flatMap(instanceId => windows.map(window => ({ instanceId, ...window }))), 'logs');
      const spans = await collect(traces, 'traces');
      logComparison = compareRecords(expectedLogs, logs); spanComparison = compareRecords(expectedSpans, spans);
      correlationFailures = correlation(logs, spans); remaining();
      await save({ kind: 'round', round, logs: logComparison, spans: spanComparison, correlationFailures });
      if (logComparison.unexpected.length || spanComparison.unexpected.length) return result('refuted', 'unexpected-records');
      if (logComparison.equal && spanComparison.equal) return result(correlationFailures ? 'refuted' : 'supported', correlationFailures ? 'correlation' : null);
      waitingForVisibility = true;
      const left = deadlineMs - (performance.now() - started);
      await delay(Math.max(1, Math.ceil(Math.min(1000, left))), undefined, { signal: activeSignal });
      if (left <= 1000) return result('refuted', 'visibility-deadline');
    }
    return result('refuted', 'visibility-deadline');
  } catch {
    if (!signal?.aborted && evidenceSaved && waitingForVisibility && logComparison && spanComparison && (control.signal.aborted || performance.now() - started >= deadlineMs)) {
      return result('refuted', 'visibility-deadline');
    }
    return result('inconclusive', signal?.aborted ? 'aborted' : 'query-or-evidence-failed');
  } finally { clearTimeout(timer); control.abort(); }
}
