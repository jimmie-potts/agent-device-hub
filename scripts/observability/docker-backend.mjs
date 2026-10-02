import { request, Agent } from 'node:http';
import { resolve } from 'node:path';

const API = '/v1.47';
const maximum = 1024 * 1024;
const error = code => new Error(code);
function resourcePath(kind, id) {
  if (kind === 'volume' && typeof id === 'string' && /^bunny-o704-[a-z0-9][a-z0-9-]{0,63}-data$/.test(id)) {
    return '/volumes/' + id;
  }
  if (['container', 'network'].includes(kind) && typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) {
    return `/${kind}s/${id}`;
  }
  throw error('docker-resource-invalid');
}
const version = value => typeof value === 'string' && /^1\.\d+$/.test(value) ? Number(value.slice(2)) : NaN;

/** Local Engine API transport only. Ownership and saved-evidence checks belong to the coordinator. */
export async function createDockerBackend({ endpoint, signal, timeoutMs = 5000 }) {
  if (typeof endpoint !== 'string' || !/^unix:\/\/\/[\w./-]+$/.test(endpoint)) throw error('docker-endpoint-invalid');
  const socketPath = endpoint.slice(7);
  if (resolve(socketPath) !== socketPath || Buffer.byteLength(socketPath) > 103) throw error('docker-endpoint-invalid');
  const agent = new Agent({ keepAlive: false, maxSockets: 1 });
  let active = null, closed = false;
  function send(method, path, { signal, timeoutMs = 5000 } = {}) {
    if (closed) return Promise.reject(error('docker-closed'));
    if (active) return Promise.reject(error('docker-concurrent-request'));
    if (signal?.aborted) return Promise.reject(error('docker-aborted'));
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return Promise.reject(error('docker-timeout-invalid'));
    return new Promise((resolve, reject) => {
      let req, timer, settled = false;
      const finish = (failure, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        active = null;
        if (failure) { req?.destroy(); reject(error(failure)); } else resolve(result);
      };
      const abort = () => finish('docker-aborted');
      active = abort;
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish('docker-timeout'), timeoutMs);
      try {
        req = request({ socketPath, path, method, agent, maxHeaderSize: 8192,
          headers: { accept: 'application/json', host: 'localhost' } }, res => {
          let bytes = 0; const chunks = [];
          res.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > maximum) { finish('docker-response-limit'); res.destroy(); }
            else if (!settled) chunks.push(chunk);
          });
          res.on('error', () => finish('docker-response-failed'));
          res.on('aborted', () => finish('docker-response-failed'));
          res.on('end', () => finish(null, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'),
            contentType: res.headers['content-type'], encoding: res.headers['content-encoding'] }));
        });
        req.on('error', () => finish('docker-transport-failed'));
        req.end();
      } catch { finish('docker-transport-failed'); }
    });
  }
  function json(result) {
    if (!/^application\/json(?:;|$)/i.test(result.contentType ?? '') ||
      (result.encoding && result.encoding !== 'identity')) throw error('docker-response-invalid');
    let value;
    try { value = JSON.parse(result.body); } catch { throw error('docker-response-invalid'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('docker-response-invalid');
    return value;
  }
  function close() { closed = true; active?.(); agent.destroy(); }
  try {
    const response = await send('GET', '/version', { signal, timeoutMs });
    if (response.status !== 200) throw error('docker-version-unavailable');
    const value = json(response);
    if (!(version(value.ApiVersion) >= 47 && version(value.MinAPIVersion) <= 47) ||
      value.Os !== 'linux' || value.Arch !== 'amd64') throw error('docker-api-incompatible');
  } catch (failure) { close(); throw failure; }
  return {
    async inspect(kind, id, options) {
      const path = resourcePath(kind, id) + (kind === 'container' ? '/json' : '');
      const result = await send('GET', API + path, options);
      if (result.status === 404) { json(result); return null; }
      if (result.status !== 200) throw error('docker-http-status');
      return json(result);
    },
    async stop(id, options) {
      const result = await send('POST', API + resourcePath('container', id) + '/stop?t=20', options);
      if (![204, 304].includes(result.status)) throw error('docker-http-status');
    },
    async remove(kind, id, options) {
      const query = kind === 'container' ? '?force=false&v=false&link=false' : kind === 'volume' ? '?force=false' : '';
      const result = await send('DELETE', API + resourcePath(kind, id) + query, options);
      if (result.status !== 204) throw error('docker-http-status');
    },
    close,
  };
}
