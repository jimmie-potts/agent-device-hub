import { createServer, request } from 'node:http';
import { once } from 'node:events';
import * as api from '../dist/index.js';
import { fixture, principal } from './helpers.mjs';

export async function httpFixture(t, config = {}) {
  const f = fixture(config.service);
  let handler;
  const server = createServer((req, res) => { void handler.handle(req, res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const host = `127.0.0.1:${server.address().port}`, url = `http://${host}/mcp`;
  handler = api.createMcpHandler({ enabled: true, registry: f.registry, tools: f.tools,
    allowedHosts: [host], allowedOrigins: [`http://${host}`], authenticate: async token => token === 'synthetic' ? principal() : null, ...config.options });
  t.after(async () => { await handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = { Authorization: 'Bearer synthetic', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
  let session, version = '2025-11-25', nextId = 1;
  async function rpc(method, params, extra = {}) {
    const headers = { ...base, ...(session ? { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': version } : {}), ...extra.headers };
    Object.keys(headers).filter(k => headers[k] === undefined).forEach(k => delete headers[k]);
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0',
      ...(method.startsWith('notifications/') ? {} : { id: extra.id ?? nextId++ }), method, ...(params === undefined ? {} : { params }) }), signal: extra.signal });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }
  async function initialize(profile = { name: 'raw-client', clientVersion: 'synthetic' }, requestedVersion = '2025-11-25') {
    version = requestedVersion;
    const response = await rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: profile.name, version: profile.clientVersion } });
    if (response.status === 200) { session = response.headers.get('mcp-session-id'); await rpc('notifications/initialized'); }
    return response;
  }
  return { ...f, handler, server, host, url, base, rpc, initialize, get session() { return session; }, get version() { return version; },
    async removeSession() { return fetch(url, { method: 'DELETE', headers: { ...base, 'Mcp-Session-Id': session, 'MCP-Protocol-Version': version } }); } };
}
export function rawRequest(url, headers, chunks = ['{}'], leaveOpen = false) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers }, response => {
      response.resume(); response.once('end', () => { resolve(response.statusCode); req.destroy(); });
    });
    req.on('error', reject);
    chunks.forEach(chunk => req.write(chunk));
    if (!leaveOpen) req.end();
  });
}
