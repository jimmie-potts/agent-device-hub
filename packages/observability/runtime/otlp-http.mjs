import { Agent, request } from 'node:http';
import { createOwnedOrigins } from './propagation.mjs';
const error = code => Object.assign(new Error(`OTLP transport: ${code}`), { code });
const add = (value, amount = 1) => Math.min(Number.MAX_SAFE_INTEGER, value + amount);

/** Single-record JSON transport to the owned loopback Collector; no retries or redirects. */
export function createOtlpTransport({ origin, signal, timeoutMs = 1000, maxResponseBytes = 8192 }) {
  createOwnedOrigins([origin]);
  if (!['logs', 'traces'].includes(signal) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1000 ||
    !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 2 || maxResponseBytes > 8192) throw new TypeError('Invalid OTLP transport configuration');
  const endpoint = new URL(`/v1/${signal}`, origin);
  const agent = new Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });
  const counts = { attempted: 0, acknowledged: 0, rejectedRecords: 0, warnings: 0, failed: 0, submittedBodyBytes: 0, acknowledgedBodyBytes: 0 };
  let closed = false, busy = false, cancel;
  const refuse = code => { counts.failed = add(counts.failed); throw error(code); };
  function singleRecord(line) {
    if (typeof line !== 'string' || Buffer.byteLength(line) > 65536) return false;
    try {
      const value = JSON.parse(line);
      const resourceKey = signal === 'logs' ? 'resourceLogs' : 'resourceSpans';
      const scopeKey = signal === 'logs' ? 'scopeLogs' : 'scopeSpans';
      const itemKey = signal === 'logs' ? 'logRecords' : 'spans';
      const resources = value[resourceKey], scopes = resources?.[0]?.[scopeKey], items = scopes?.[0]?.[itemKey];
      return Object.keys(value).length === 1 && Array.isArray(resources) && resources.length === 1 &&
        Array.isArray(scopes) && scopes.length === 1 && Array.isArray(items) && items.length === 1;
    } catch { return false; }
  }
  return {
    async send(line, abortSignal) {
      counts.attempted = add(counts.attempted);
      if (closed) return refuse('closed');
      if (busy) return refuse('capacity');
      if (abortSignal?.aborted) return refuse('aborted');
      if (!singleRecord(line)) return refuse('invalid-payload');
      busy = true;
      return new Promise((resolve, reject) => {
        let done = false, outgoing, incoming;
        const timer = setTimeout(() => finish('timeout'), timeoutMs);
        const abort = () => finish('aborted');
        cancel = () => finish('closed');
        function finish(code) {
          if (done) return;
          done = true; busy = false; cancel = undefined; clearTimeout(timer);
          abortSignal?.removeEventListener('abort', abort);
          if (code) {
            counts.failed = add(counts.failed); incoming?.destroy(); outgoing?.destroy(); reject(error(code));
          } else { counts.acknowledged = add(counts.acknowledged); counts.acknowledgedBodyBytes = add(counts.acknowledgedBodyBytes,Buffer.byteLength(line)); resolve(); }
        }
        abortSignal?.addEventListener('abort', abort, { once: true });
        try {
          outgoing = request(endpoint, { agent, method: 'POST', maxHeaderSize: 8192,
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(line), 'accept-encoding': 'identity' } }, response => {
            incoming = response;
            response.on('error', () => finish('network'));
            response.on('aborted', () => finish('network'));
            if (response.statusCode !== 200) { finish('http-status'); return; }
            if (response.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
              ![undefined, 'identity'].includes(response.headers['content-encoding'])) { finish('invalid-response'); return; }
            const chunks = []; let size = 0;
            response.on('data', chunk => {
              size += chunk.length;
              if (size > maxResponseBytes) finish('response-limit'); else chunks.push(chunk);
            });
            response.on('end', () => {
              if (done) return;
              try {
                const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (!value || Array.isArray(value) || typeof value !== 'object') throw error('invalid-response');
                const partial = value.partialSuccess;
                if (partial != null) {
                  const field = signal === 'logs' ? 'rejectedLogRecords' : 'rejectedSpans';
                  if (typeof partial !== 'object' || Array.isArray(partial)) throw error('invalid-response');
                  const rejected = partial[field] ?? 0;
                  if (![0, 1, '0', '1'].includes(rejected) || (partial.errorMessage != null && typeof partial.errorMessage !== 'string')) throw error('invalid-response');
                  if (Number(rejected) === 1) { counts.rejectedRecords = add(counts.rejectedRecords); finish('partial-rejection'); return; }
                  if (partial.errorMessage) counts.warnings = add(counts.warnings);
                }
                finish();
              } catch { finish('invalid-response'); }
            });
          });
          outgoing.on('error', () => finish('network'));
          counts.submittedBodyBytes=add(counts.submittedBodyBytes,Buffer.byteLength(line));
          outgoing.end(line);
        } catch { finish('network'); }
      });
    },
    counts: () => ({ ...counts, inFlight: busy ? 1 : 0 }),
    close() { closed = true; cancel?.(); agent.destroy(); },
  };
}
