import { request } from 'node:http';
import { performance } from 'node:perf_hooks';
import { backendCreateRequests } from './backend-create.mjs';
const routes = { grafana: '/api/health', loki: '/ready', tempo: '/ready', health: '/ready' };

function probe(port, path, timeoutMs, signal, grafana) {
  return new Promise(resolve => {
    let req, timer, ended = false;
    const finish = code => {
      if (ended) return; ended = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort); req?.destroy();
      resolve({ ready: code === 'ready', code });
    };
    const abort = () => finish('aborted');
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish('timeout'), timeoutMs);
    req = request({ hostname: '127.0.0.1', port, path, method: 'GET', agent: false, maxHeaderSize: 8192,
      headers: { accept: 'application/json, text/plain', 'accept-encoding': 'identity' } }, res => {
      if (res.statusCode !== 200) { res.resume(); finish('http-status'); return; }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
        res.resume(); finish('encoding'); return;
      }
      let bytes = 0; const chunks = [];
      res.on('data', chunk => { bytes += chunk.length;
        if (bytes > 8192) finish('response-limit'); else chunks.push(chunk); });
      res.on('aborted', () => finish('response-failed'));
      res.on('error', () => finish('response-failed'));
      res.on('end', () => {
        if (grafana) {
          try { if (JSON.parse(Buffer.concat(chunks).toString('utf8')).database !== 'ok') return finish('database'); }
          catch { return finish('response-invalid'); }
        }
        finish('ready');
      });
    });
    req.on('upgrade', (_res, socket) => { socket.destroy(); finish('upgrade'); });
    req.on('error', () => finish('unavailable'));
    if (signal?.aborted) abort(); else req.end();
  });
}

/** Required published services only. HTTP health is neither ingestion nor identity proof. */
export async function probeBackendHealth(plan, { timeoutMs = 2000, signal } = {}) {
  backendCreateRequests(plan);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Health deadline invalid');
  if (signal?.aborted) throw new Error('Health probe aborted');
  const started = performance.now(), services = [];
  for (const [name, path] of Object.entries(routes)) {
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    const result = signal?.aborted ? { ready: false, code: 'aborted' }
      : remaining < 1 ? { ready: false, code: 'timeout' }
      : await probe(plan.ports[name], path, remaining, signal, name === 'grafana');
    services.push({ name, ...result });
  }
  return { ready: services.every(service => service.ready), services };
}
