import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { backendPlan } from '../backend-plan.mjs';
import { createBackendQueries } from '../backend-queries.mjs';
const traceId = '1234567890abcdef1234567890abcdef', instanceId = '00000000-0000-4000-8000-000000000001';
async function fixture(t, handler) {
  const server = createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const port = server.address().port, others = [43000, 43001, 43002, 43003, 43004].filter(n => n !== port);
  const plan = backendPlan({ runId: 'queries', ownerToken: '12345678-1234-4123-8123-123456789012',
    configDirectory: '/workspace/.local/query/config', ports: { loki: port, tempo: others[0], grafana: others[1], otlp: others[2], health: others[3] } });
  return { plan, port };
}

test('query transport uses categorized metadata and fixed instance/time scope without authentication or redirects', async t => {
  let calls = 0;
  const f = await fixture(t, (req, res) => {
    calls++; const url = new URL(req.url, 'http://127.0.0.1');
    assert.equal(url.pathname, '/loki/api/v1/query_range');
    assert.equal(req.headers['x-loki-response-encoding-flags'], 'categorize-labels');
    assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.traceparent, undefined);
    assert.equal(url.searchParams.get('limit'), '5000');
    assert.ok(url.searchParams.get('query').includes('service_instance_id="' + instanceId + '"'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', data: { resultType: 'streams', encodingFlags: ['categorize-labels'], result: [] } }));
  });
  const queries = createBackendQueries(f.plan);
  const result = await queries.logs({ instanceId, startNs: '1000000000', endNs: '2000000000', filters: { severity_text: 'INFO' } });
  assert.deepEqual(result.records, []); assert.equal(result.found, true); assert.equal(calls, 1);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test('privacy sentinels are detected after JSON escape decoding; errors never retain raw responses', async t => {
  const f = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"private":"\\u0053YNTHETIC_SECRET"}');
  });
  const queries = createBackendQueries(f.plan, { forbidden: ['SYNTHETIC_SECRET'] });
  await assert.rejects(queries.logs({ instanceId, startNs: '1', endNs: '2' }), error => error.code === 'privacy' && !error.message.includes('SYNTHETIC_SECRET'));
});

test('redirects, oversized responses and deadline failures are not retried', async t => {
  for (const mode of ['redirect', 'size', 'timeout']) {
    let calls = 0;
    const f = await fixture(t, (_req, res) => {
      calls++; if (mode === 'timeout') return;
      res.writeHead(mode === 'redirect' ? 302 : 200, { 'content-type': 'application/json', location: 'http://example.invalid' });
      res.end(mode === 'size' ? 'x'.repeat(4 * 1024 ** 2 + 1) : '{}');
    });
    await assert.rejects(createBackendQueries(f.plan).logs({ instanceId, startNs: '1', endNs: '2' }, { timeoutMs: mode === 'timeout' ? 25 : 2000 }));
    assert.equal(calls, 1);
  }
});

test('Tempo 404 is missing evidence; invalid trace IDs and log selectors are refused before requests', async t => {
  let calls = 0;
  const f = await fixture(t, (_req, res) => { calls++; res.writeHead(404); res.end(); });
  const input = { ...f.plan, ports: { ...f.plan.ports, tempo: f.port, loki: f.plan.ports.tempo } };
  const plan = backendPlan({ runId: input.runId, ownerToken: input.ownerToken, configDirectory: input.configDirectory, ports: input.ports });
  const queries = createBackendQueries(plan);
  const result = await queries.trace(traceId); assert.equal(result.found, false); assert.deepEqual(result.records, []);
  await assert.rejects(queries.trace('../private'));
  await assert.rejects(queries.logs({ instanceId: 'arbitrary', startNs: '1', endNs: '2' }));
  await assert.rejects(queries.logs({ instanceId, startNs: '1', endNs: '2', filters: { raw_url: 'secret' } }));
  assert.equal(calls, 1);
});
