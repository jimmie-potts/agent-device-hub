import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createOtlpTransport } from '../otlp-http.mjs';
const payload = signal => JSON.stringify(signal === 'logs' ? { resourceLogs: [{ scopeLogs: [{ logRecords: [{}] }] }] }
  : { resourceSpans: [{ scopeSpans: [{ spans: [{}] }] }] });
async function fixture(t, handler, options = {}) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = createOtlpTransport({ origin: `http://127.0.0.1:${server.address().port}`, signal: 'logs', ...options });
  t.after(async () => { transport.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); });
  return transport;
}

test('one JSON request reaches the fixed signal endpoint without credentials or propagation headers', async t => {
  let calls = 0;
  const transport = await fixture(t, async (req, res) => {
    calls++; assert.equal(req.url, '/v1/logs'); assert.equal(req.method, 'POST');
    assert.equal(req.headers['content-type'], 'application/json');
    for (const name of ['authorization', 'traceparent', 'tracestate', 'baggage']) assert.equal(req.headers[name], undefined);
    let text = ''; for await (const part of req) text += part;
    assert.equal(text, payload('logs'));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
  await transport.send(payload('logs'));
  assert.equal(calls, 1); assert.equal(transport.counts().acknowledged, 1);
});

test('partial rejection is counted and never retried or exposed as a successful acknowledgment', async t => {
  let calls = 0;
  const transport = await fixture(t, (_req, res) => {
    calls++; res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ partialSuccess: { rejectedLogRecords: '1', errorMessage: 'SYNTHETIC_SECRET' } }));
  });
  await assert.rejects(transport.send(payload('logs')), error => error.code === 'partial-rejection' && !error.message.includes('SYNTHETIC_SECRET'));
  assert.equal(calls, 1); assert.equal(transport.counts().rejectedRecords, 1); assert.equal(transport.counts().acknowledged, 0);
});

test('zero-rejection warning is counted without retaining its text', async t => {
  const transport = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ partialSuccess: { rejectedLogRecords: '0', errorMessage: 'SYNTHETIC_SECRET' } }));
  });
  await transport.send(payload('logs'));
  assert.equal(transport.counts().warnings, 1); assert.equal(transport.counts().acknowledged, 1);
  assert.equal(JSON.stringify(transport.counts()).includes('SYNTHETIC_SECRET'), false);
});

test('redirects and retryable errors are refused without a second request', async t => {
  for (const status of [307, 429, 503]) {
    let calls = 0;
    const transport = await fixture(t, (_req, res) => { calls++; res.writeHead(status, { location: 'http://example.invalid/SYNTHETIC_SECRET', 'retry-after': '0' }); res.end(); });
    await assert.rejects(transport.send(payload('logs')), error => error.code === 'http-status');
    assert.equal(calls, 1);
  }
});

test('malformed, wrong-type, oversized and impossible partial responses cannot claim acknowledgment', async t => {
  for (const [body, type] of [['SYNTHETIC_SECRET', 'application/json'], ['{}', 'text/plain'],
    ['x'.repeat(8193), 'application/json'], ['{"partialSuccess":{"rejectedLogRecords":"2"}}', 'application/json']]) {
    const transport = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-type': type }); res.end(body); });
    await assert.rejects(transport.send(payload('logs')));
    assert.equal(transport.counts().acknowledged, 0);
  }
});

test('timeout, cancellation and unavailable collection settle without leaking transport errors', async t => {
  const transport = await fixture(t, () => {}, { timeoutMs: 20 });
  await assert.rejects(transport.send(payload('logs')), error => error.code === 'timeout');
  const controller = new AbortController();
  const sending = transport.send(payload('logs'), controller.signal); controller.abort();
  await assert.rejects(sending, error => error.code === 'aborted');
  transport.close();
  await assert.rejects(transport.send(payload('logs')), error => error.code === 'closed');
});

test('nonlocal origins, alternate paths and invalid limits are refused before networking', () => {
  for (const origin of ['http://example.invalid', 'http://localhost:4318', 'http://127.0.0.1:4318/private', 'http://127.1:4318']) {
    assert.throws(() => createOtlpTransport({ origin, signal: 'logs' }));
  }
  for (const options of [{ signal: 'metrics' }, { timeoutMs: 1001 }, { maxResponseBytes: 8193 }]) {
    assert.throws(() => createOtlpTransport({ origin: 'http://127.0.0.1:4318', signal: 'logs', ...options }));
  }
});

test('trace partial rejection uses its own count while unknown JSON fields are ignored', async t => {
  const rejected = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"partialSuccess":{"rejectedSpans":"1"}}');
  }, { signal: 'traces' });
  await assert.rejects(rejected.send(payload('traces')), error => error.code === 'partial-rejection');
  assert.equal(rejected.counts().rejectedRecords, 1);
  const future = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"futureMetadata":"SYNTHETIC_SECRET","partialSuccess":{"rejectedLogRecords":"1","errorMessage":null}}');
  }, { signal: 'traces' });
  await future.send(payload('traces'));
  assert.equal(future.counts().acknowledged, 1); assert.equal(future.counts().rejectedRecords, 0);
  assert.equal(JSON.stringify(future.counts()).includes('SYNTHETIC_SECRET'), false);
});

test('absent collector produces a sanitized network failure without retry', async t => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.close(resolve));
  const transport = createOtlpTransport({ origin, signal: 'logs' }); t.after(() => transport.close());
  await assert.rejects(transport.send(payload('logs')), error => error.code === 'network' && error.message === 'OTLP transport: network');
  assert.equal(transport.counts().attempted, 1); assert.equal(transport.counts().failed, 1);
});

test('concurrent callers cannot create a hidden agent queue and close cancels the active request', async t => {
  const transport = await fixture(t, () => {});
  const active = transport.send(payload('logs'));
  await assert.rejects(transport.send(payload('logs')), error => error.code === 'capacity');
  transport.close(); await assert.rejects(active, error => error.code === 'closed');
  assert.equal(transport.counts().inFlight, 0);
});

test('invalid or batched payloads are refused before any HTTP request', async t => {
  let calls = 0;
  const transport = await fixture(t, (_req, res) => { calls++; res.end('{}'); });
  for (const line of ['SYNTHETIC_SECRET', 'x'.repeat(65537), '{"resourceLogs":[]}', payload('traces')]) {
    await assert.rejects(transport.send(line), error => error.code === 'invalid-payload');
  }
  assert.equal(calls, 0);
});
