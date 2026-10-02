import { createPinoEmitter } from '@jimmie-potts/bunny-observability/node';
import { validateRecord, parseRecord, toOtlp, MAX_QUEUE_RECORDS, MAX_QUEUE_BYTES, MAX_FLUSH_MS } from '@jimmie-potts/bunny-observability';
const add = (value, amount = 1) => Math.min(Number.MAX_SAFE_INTEGER, value + amount);

/** One bounded Pino queue and one OTLP path; no SDK log bridge or second transport queue. */
export function createLogPipeline({ sink, localSink, options = {} }) {
  if (typeof sink !== 'function' || (localSink !== undefined && typeof localSink !== 'function')) throw new TypeError('Invalid log sink');
  for (const [name, maximum] of [['maxRecords', MAX_QUEUE_RECORDS], ['maxBytes', MAX_QUEUE_BYTES], ['flushMs', MAX_FLUSH_MS]]) {
    if (options[name] !== undefined && (!Number.isSafeInteger(options[name]) || options[name] < 1 || options[name] > maximum)) {
      throw new TypeError('Invalid log queue limit');
    }
  }
  const minimum = options.minimumSeverity ?? 9;
  if (![1, 5, 9, 13, 17, 21].includes(minimum)) throw new TypeError('Invalid log severity');
  let attempted = 0, invalid = 0, filtered = 0, exported = 0, localFailed = 0, mappingFailed = 0, outputBytes = 0;
  let closed = false, closing, active;
  const emitter = createPinoEmitter(async line => {
    if (closed) return;
    const controller = new AbortController(); active = controller;
    try {
      const parsed = parseRecord(line);
      const mapped = parsed.ok ? toOtlp(parsed.value) : undefined;
      if (!mapped) { mappingFailed = add(mappingFailed); throw new Error('Invalid canonical log mapping'); }
      if (localSink) {
        try { await localSink(line, controller.signal); }
        catch { if (!closed) localFailed = add(localFailed); }
      }
      if (closed) return;
      const serialized = JSON.stringify(mapped);
      outputBytes = add(outputBytes, Buffer.byteLength(serialized));
      await sink(serialized, controller.signal);
      if (!closed) exported = add(exported);
    } finally { if (active === controller) active = undefined; }
  }, options);
  return {
    emit(input) {
      attempted = add(attempted);
      const canonical = validateRecord(input);
      if (!canonical.ok) { invalid = add(invalid); return false; }
      if (canonical.value.severity_number < minimum) { filtered = add(filtered); return false; }
      return emitter.emit(canonical.value);
    },
    counts: () => ({ ...emitter.counts(), attempted, invalid, filtered, exported, localFailed, mappingFailed, outputBytes }),
    close() {
      if (closing) return closing;
      closing = emitter.close().finally(() => {
        closed = true; active?.abort(); active = undefined;
      });
      return closing;
    },
  };
}
