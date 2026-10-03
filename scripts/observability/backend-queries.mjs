import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { backendCreateRequests } from './backend-create.mjs';
import { readLokiRecords, readTempoSpans } from './query-records.mjs';
const failure = code => Object.assign(new Error('Backend query: ' + code), { code });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const trace = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) && !/^0+$/.test(value);
const ns = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n;
const filterNames = ['service_name', 'event_name', 'severity_text', 'bunny_operation', 'bunny_outcome',
  'bunny_ticket_epoch', 'bunny_ticket_sequence', 'trace_id', 'span_id'];

/** Read-only loopback API, bounded requests, no redirects or automatic retries. Caller controls visibility polling. */
export function createBackendQueries(inputPlan, { forbidden = [] } = {}) {
  const plan = structuredClone(inputPlan); backendCreateRequests(plan);
  if (!Array.isArray(forbidden) || forbidden.length > 32 || forbidden.some(s => typeof s !== 'string' || s.length < 1 || s.length > 512)) {
    throw failure('sentinel-configuration');
  }
  const sentinels = [...forbidden];
  function get(port, path, options = {}, isTrace = false) {
    const { timeoutMs = 2000, signal } = options;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) return Promise.reject(failure('deadline'));
    if (signal?.aborted) return Promise.reject(failure('aborted'));
    return new Promise((resolve, reject) => {
      let req, timer, ended = false, status = null;
      const finish = (code, value) => {
        if (ended) return; ended = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); req?.destroy();
        if (code) reject(Object.assign(failure(code), { status })); else resolve(value);
      };
      const abort = () => finish('aborted');
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish('timeout'), timeoutMs);
      req = request({ hostname: '127.0.0.1', port, path, method: 'GET', agent: false, maxHeaderSize: 8192,
        headers: { accept: 'application/json', 'accept-encoding': 'identity',
          ...(!isTrace ? { 'x-loki-response-encoding-flags': 'categorize-labels' } : {}) } }, res => {
        status = res.statusCode;
        const missing = isTrace && res.statusCode === 404;
        if (res.statusCode !== 200 && !missing) { res.resume(); return finish('http-status'); }
        if ((!missing && !/^application\/json(?:;|$)/i.test(res.headers['content-type'] ?? '')) ||
          ![undefined, 'identity'].includes(res.headers['content-encoding'])) { res.resume(); return finish('format'); }
        const chunks = []; let bytes = 0;
        res.on('data', chunk => { bytes += chunk.length; if (bytes > 4 * 1024 ** 2) finish('response-limit'); else chunks.push(chunk); });
        res.on('error', () => finish('network')); res.on('aborted', () => finish('network'));
        res.on('end', () => {
          if (ended) return;
          const buffer = Buffer.concat(chunks), text = buffer.toString('utf8');
          if (sentinels.some(s => text.includes(s))) return finish('privacy');
          let value;
          if (!missing) {
            try { value = JSON.parse(text); } catch { return finish('json'); }
            if (sentinels.some(s => JSON.stringify(value).includes(s))) return finish('privacy');
          }
          finish(null, { found: !missing, value, bytes, sha256: createHash('sha256').update(buffer).digest('hex') });
        });
      });
      req.on('upgrade', (_res, socket) => { socket.destroy(); finish('upgrade'); });
      req.on('error', () => finish('network')); req.end();
    });
  }
  return {
    async logs({ instanceId, startNs, endNs, filters = {} }, options) {
      if (!uuid(instanceId) || !ns(startNs) || !ns(endNs) || BigInt(endNs) <= BigInt(startNs) ||
        BigInt(endNs) - BigInt(startNs) > 10000000000n || !filters || typeof filters !== 'object' || Array.isArray(filters)) throw failure('selector');
      let query = '{service_namespace="bunny",deployment_environment_name="test"} | service_instance_id=' + JSON.stringify(instanceId);
      for (const [name, value] of Object.entries(filters)) {
        if (!filterNames.includes(name) || !(typeof value === 'string' || Number.isSafeInteger(value)) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(value))) throw failure('selector');
        query += ' | ' + name + '=' + JSON.stringify(String(value));
      }
      const params = new URLSearchParams({ query, start: startNs, end: endNs, direction: 'forward', limit: '5000' });
      const { value, ...receipt } = await get(plan.ports.loki, '/loki/api/v1/query_range?' + params, options);
      try { return { ...receipt, records: readLokiRecords(value) }; }
      catch { throw Object.assign(failure('record-invalid'), { status: 200 }); }
    },
    async trace(traceId, options) {
      if (!trace(traceId)) throw failure('trace-id');
      const { value, ...receipt } = await get(plan.ports.tempo, '/api/v2/traces/' + traceId + '?span_pruning=false', options, true);
      try { const records = receipt.found ? readTempoSpans(value, traceId) : [];
        return { ...receipt, found: records.length > 0, records }; }
      catch { throw Object.assign(failure('record-invalid'), { status: 200 }); }
    },
  };
}
