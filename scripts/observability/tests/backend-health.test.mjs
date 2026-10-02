import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { backendPlan } from '../backend-plan.mjs';
import { probeBackendHealth } from '../backend-health.mjs';

async function fixture(t, override = {}) {
  const servers = [], ports = {}, calls = [];
  for (const name of ['grafana', 'loki', 'tempo', 'health']) {
    const server = createServer((req, res) => {
      calls.push([name, req.url]);
      if (override[name]) return override[name](req, res);
      res.end(name === 'grafana' ? '{"database":"ok"}' : 'ready');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server); ports[name] = server.address().port;
  }
  ports.otlp = [43001, 43002, 43003, 43004, 43005].find(port => !Object.values(ports).includes(port));
  t.after(async () => { for (const s of servers) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); } });
  return { calls, plan: backendPlan({ runId: 'health', ownerToken: '12345678-1234-4123-8123-123456789012',
    configDirectory: '/workspace/.local/health/config', ports }) };
}

test('readiness contacts all four required loopback services without ingesting records', async t => {
  const f = await fixture(t), result = await probeBackendHealth(f.plan);
  assert.equal(result.ready, true);
  assert.deepEqual(f.calls, [['grafana', '/api/health'], ['loki', '/ready'], ['tempo', '/ready'], ['health', '/ready']]);
  assert.deepEqual(result.services.map(s => s.ready), [true, true, true, true]);
});

test('redirects, failing Grafana database and oversized responses cannot qualify startup or leak response text', async t => {
  const f = await fixture(t, {
    grafana: (_q, s) => s.end('{"database":"failed","secret":"SYNTHETIC_SECRET"}'),
    loki: (_q, s) => { s.writeHead(302, { location: 'http://example.invalid/SYNTHETIC_SECRET' }); s.end(); },
    tempo: (_q, s) => s.end('SYNTHETIC_SECRET'.repeat(1000)),
  });
  const result = await probeBackendHealth(f.plan);
  assert.equal(result.ready, false); assert.equal(result.services.filter(s => s.ready).length, 1);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET'), false); assert.equal(f.calls.length, 4);
});

test('stalled readiness request has a bounded deadline and cancellation makes no request', async t => {
  const f = await fixture(t, { grafana: () => {} });
  const result = await probeBackendHealth(f.plan, { timeoutMs: 30 });
  assert.equal(result.ready, false); assert.equal(result.services[0].code, 'timeout');
  const before = f.calls.length;
  await assert.rejects(probeBackendHealth(f.plan, { signal: AbortSignal.abort() }), /aborted/);
  assert.equal(f.calls.length, before);
});
