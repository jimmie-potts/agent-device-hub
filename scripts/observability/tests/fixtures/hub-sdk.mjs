import assert from 'node:assert/strict';
import { register } from 'node:module';
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
const { NodeSDK } = await import('@opentelemetry/sdk-node');
const { resourceFromAttributes } = await import('@opentelemetry/resources');
const { AlwaysOnSampler, ParentBasedSampler } = await import('@opentelemetry/sdk-trace-base');
const { createOutgoingInstrumentation } = await import('../../instrumentation.mjs');
const { traceparentOnly } = await import('../../propagation.mjs');
const resource = { 'service.namespace': 'bunny', 'service.name': 'hub', 'service.version': '0.4.2',
  'service.instance.id': '00000000-0000-4000-8000-000000000001', 'deployment.environment.name': 'test' };
let origins = [];
const spans = [], records = [];
const sdk = new NodeSDK({ autoDetectResources: false, resource: resourceFromAttributes(resource),
  sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
  spanProcessors: [{ onStart() {}, onEnd(span) { spans.push(span); }, async forceFlush() {}, async shutdown() {} }],
  logRecordProcessors: [], textMapPropagator: traceparentOnly,
  instrumentations: createOutgoingInstrumentation(() => origins),
});
sdk.start();
const { mkdtemp, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { createHash } = await import('node:crypto');
const { startHub } = await import('../../../../apps/hub/dist/server.js');
const { createCommandDiagnostics } = await import('../../../../apps/hub/dist/diagnostics.js');
const { startFakeController } = await import('../../../../apps/hub/tests/fake-controller.mjs');
const { validateRecord, parseRecord, toOtlp } = await import('@jimmie-potts/bunny-observability');
const { createPinoEmitter } = await import('@jimmie-potts/bunny-observability/node');
const { projectSpan } = await import('../../span-projection.mjs');
const directory = await mkdtemp(join(tmpdir(), 'hub-otel-'));
const fakes = [];
let hub;
try {
  for (let index = 0; index < 2; index++) fakes.push(await startFakeController({
    controllerId: `controller-${index}`, deviceId: `device-${index}`, execution: { autoDrain: false },
  }));
  origins = fakes.map(fake => new URL(fake.endpoint).origin);
  const diagnostics = createCommandDiagnostics({ resource, emit: record => records.push(record) });
  const token = 'h'.repeat(43);
  hub = await startHub({ directory, ownerId: 'owner', consumers: [], diagnostics,
    credentials: [{ id: 'pilot', digest: createHash('sha256').update(token).digest('hex'),
      scopes: ['read', 'control'], devices: ['wall-0', 'wall-1'] }],
    controllers: fakes.map((fake, index) => fake.config({ id: `wall-${index}` })),
  });
  const request = index => {
    const snapshot = fakes[index].snapshot10();
    return { apiVersion: '1.0', controllerId: snapshot.identity.controllerId, deviceId: snapshot.identity.deviceId,
      requestId: snapshot.nextRequestId, expectedConfigurationRevision: snapshot.configurationRevision,
      expectedGeneration: snapshot.generation, command: { kind: 'brightness.set', percent: 42 } };
  };
  const post = async (index, traceparent, credential = token) => {
    const response = await fetch(`${hub.url}/api/controllers/v1/wall-${index}/commands`, {
      method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json',
        'x-pixoo-request': '1', traceparent, baggage: 'private=SYNTHETIC_SECRET', tracestate: 'private=SYNTHETIC_SECRET' },
      body: JSON.stringify(request(index)),
    });
    return { status: response.status, body: await response.json() };
  };
  const incoming = index => `00-${String(index + 1).repeat(32)}-${String(index + 3).repeat(16)}-01`;
  assert.equal((await post(0, incoming(0), 'invalid')).status, 401);
  assert.equal(records.length, 0);
  assert.equal(spans.length, 0, 'pre-authentication HTTP creates no automatic span');
  const results = await Promise.all([post(0, incoming(0)), post(1, incoming(1))]);
  assert.ok(results.every(value => value.status === 202 && value.body.outcome === 'queued'));
  assert.equal(records.length, 4);
  assert.equal(spans.length, 6, 'each command has Hub, controller observation and automatic client spans');
  for (let index = 0; index < 2; index++) {
    const traceId = String(index + 1).repeat(32);
    const scoped = spans.filter(span => span.spanContext().traceId === traceId);
    assert.equal(scoped.length, 3);
    const root = scoped.find(span => span.parentSpanContext?.spanId === String(index + 3).repeat(16));
    assert.ok(root, 'authenticated parent is adopted');
    const controller = scoped.find(span => span.parentSpanContext?.spanId === root.spanContext().spanId);
    assert.ok(controller);
    assert.ok(scoped.some(span => span.parentSpanContext?.spanId === controller.spanContext().spanId));
    assert.equal(records.filter(record => record.trace_id === traceId).length, 2);
    assert.ok(records.filter(record => record.trace_id === traceId)
      .every(record => record.attributes['bunny.controller.id'] === `controller-${index}`));
    assert.equal(fakes[index].executionState().effects, 0, 'queued logs cannot claim execution');
    fakes[index].executeQueued();
    assert.equal(fakes[index].executionState().effects, 1);
  }
  const beforeMalformed = spans.length;
  assert.equal((await post(0, '00-' + '0'.repeat(32) + '-' + '0'.repeat(16) + '-01')).status, 202);
  const fresh = spans.slice(beforeMalformed);
  assert.equal(fresh.length, 3);
  assert.equal(new Set(fresh.map(span => span.spanContext().traceId)).size, 1);
  assert.ok(fresh.some(span => span.parentSpanContext === undefined));
  assert.ok(fresh.every(span => !['0'.repeat(32), '1'.repeat(32), '2'.repeat(32)].includes(span.spanContext().traceId)));
  // Honor authenticated unsampled parents without pretending a sampled trace exists.
  const beforeUnsampled = spans.length;
  assert.equal((await post(1, '00-' + '7'.repeat(32) + '-' + '8'.repeat(16) + '-00')).status, 202);
  assert.equal(spans.length, beforeUnsampled);
  const unsampled = records.filter(record => record.trace_id === '7'.repeat(32));
  assert.equal(unsampled.length, 2);
  assert.ok(unsampled.every(record => record.trace_flags === '00'));
  assert.ok(records.every(record => validateRecord(record).ok));
  assert.equal(JSON.stringify(records).includes('SYNTHETIC_SECRET'), false);
  assert.deepEqual(diagnostics.counts(), { failures: 0, invalidRecords: 0 });
  // Exercise real SDK spans and the released Pino-to-OTLP mapping with synthetic sinks.
  // The runtime host still needs bounded streaming association and transport queues.
  const lines = [];
  const emitter = createPinoEmitter(line => { lines.push(line); });
  for (const record of records) assert.equal(emitter.emit(record), true);
  await emitter.close();
  assert.deepEqual(emitter.counts(), { accepted: records.length, dropped: 0, failed: 0, queued: 0, bytes: 0 });
  const logs = lines.map(line => {
    const parsed = parseRecord(line); assert.equal(parsed.ok, true);
    return toOtlp(parsed.value);
  });
  const exported = spans.map(span => {
    const id = span.spanContext().spanId;
    // Automatic client spans inherit their canonical controller observation.
    const metadata = records.find(record => record.span_id === id) ??
      records.find(record => record.span_id === span.parentSpanContext?.spanId);
    assert.ok(metadata, 'every exported span has an authenticated canonical association');
    const projected = projectSpan(span, metadata, 'bunny.command.request');
    assert.ok(projected);
    return projected;
  });
  assert.equal(logs.length, records.length);
  assert.equal(exported.length, spans.length);
  assert.equal(JSON.stringify({ lines, logs, exported }).includes('SYNTHETIC_SECRET'), false);
  const logIds = new Set(logs.map(log => log.resourceLogs[0].scopeLogs[0].logRecords[0].spanId));
  for (const span of exported.map(value => value.resourceSpans[0].scopeSpans[0].spans[0])) {
    assert.ok(logIds.has(span.spanId) || logIds.has(span.parentSpanId));
  }
  process.stdout.write('Hub SDK context verified\n');
} finally {
  await hub?.close();
  await Promise.all(fakes.map(fake => fake.close()));
  await rm(directory, { recursive: true, force: true });
  await sdk.shutdown();
}
