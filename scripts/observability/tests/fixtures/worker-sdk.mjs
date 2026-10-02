import assert from 'node:assert/strict';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AlwaysOnSampler, ParentBasedSampler } from '@opentelemetry/sdk-trace-base';
import { createWorkerDiagnostics } from '../../worker-diagnostics.mjs';
import { traceparentOnly } from '../../propagation.mjs';
import { validateRecord } from '@jimmie-potts/bunny-observability';
const resource = { 'service.namespace': 'bunny', 'service.name': 'nanoleaf-controller', 'service.version': '1.0.0',
  'service.instance.id': '00000000-0000-4000-8000-000000000002', 'deployment.environment.name': 'test' };
const records = [], spans = [];
const sdk = new NodeSDK({ autoDetectResources: false, resource: resourceFromAttributes(resource),
  sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
  spanProcessors: [{ onStart() {}, onEnd(span) { spans.push(span); }, async forceFlush() {}, async shutdown() {} }],
  logRecordProcessors: [], textMapPropagator: traceparentOnly, instrumentations: [],
});
sdk.start();
const { startFakeController } = await import('../../../../apps/hub/tests/fake-controller.mjs');
const fakes = [];
try {
  for (let index = 0; index < 2; index++) {
    const diagnostics = createWorkerDiagnostics({ resource,
      workerResource: { ...resource, 'service.name': 'nanoleaf-worker' }, emit: record => records.push(record) });
    fakes.push(await startFakeController({ controllerId: `controller-${index}`, deviceId: `device-${index}`,
      execution: {}, diagnostics }));
  }
  const submit = async index => {
    const fake = fakes[index], snapshot = fake.snapshot10();
    const body = { apiVersion: '1.0', controllerId: snapshot.identity.controllerId, deviceId: snapshot.identity.deviceId,
      requestId: snapshot.nextRequestId, expectedConfigurationRevision: snapshot.configurationRevision,
      expectedGeneration: snapshot.generation, command: { kind: 'brightness.set', percent: 42 } };
    const response = await fetch(fake.endpoint + '/commands', { method: 'POST',
      headers: { authorization: `Bearer ${fake.config().token}`, 'content-type': 'application/json',
        traceparent: `00-${String(index + 1).repeat(32)}-${String(index + 3).repeat(16)}-01`,
        baggage: 'private=SYNTHETIC_SECRET', tracestate: 'private=SYNTHETIC_SECRET' }, body: JSON.stringify(body) });
    assert.equal(response.status, 202); assert.equal((await response.json()).outcome, 'queued');
  };
  await Promise.all([submit(0), submit(1)]);
  assert.equal(spans.length, 2, 'only the request spans have ended before execution');
  assert.ok(fakes.every(fake => fake.executionState().effects === 0));
  // Drain in reverse order outside every request context, exercising explicit captured handoffs.
  fakes[1].executeQueued(); fakes[0].executeQueued();
  assert.equal(spans.length, 6);
  for (let index = 0; index < 2; index++) {
    const traceId = String(index + 1).repeat(32);
    const scoped = spans.filter(span => span.spanContext().traceId === traceId);
    const request = scoped.find(span => span.name === 'bunny.command.request');
    const queue = scoped.find(span => span.name === 'bunny.command.queue');
    const execution = scoped.find(span => span.name === 'bunny.command.execute');
    assert.equal(request.parentSpanContext.spanId, String(index + 3).repeat(16));
    assert.equal(queue.parentSpanContext.spanId, request.spanContext().spanId);
    assert.equal(execution.parentSpanContext.spanId, queue.spanContext().spanId);
    assert.equal(execution.links[0].context.spanId, request.spanContext().spanId);
    const scopedRecords = records.filter(record => record.trace_id === traceId);
    assert.equal(scopedRecords.length, 5);
    assert.ok(scopedRecords.every(record => record.attributes['bunny.controller.id'] === `controller-${index}`));
    assert.equal(scopedRecords.at(-1).resource['service.name'], 'nanoleaf-worker');
    assert.equal(scopedRecords.at(-1).attributes['bunny.outcome'], 'transport-acknowledged');
    assert.equal(fakes[index].executionState().effects, 1);
    assert.equal(fakes[index].executionState().diagnosticFailures, 0);
  }
  assert.ok(records.every(record => validateRecord(record).ok));
  assert.equal(JSON.stringify(records).includes('SYNTHETIC_SECRET'), false);
  process.stdout.write('worker SDK handoff verified\n');
} finally {
  await Promise.all(fakes.map(fake => fake.close()));
  await sdk.shutdown();
}
