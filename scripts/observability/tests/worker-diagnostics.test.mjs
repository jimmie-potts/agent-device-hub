import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRecord } from '@jimmie-potts/bunny-observability';
import { trace } from '@opentelemetry/api';
import { createWorkerDiagnostics } from '../worker-diagnostics.mjs';
const resource = { 'service.namespace': 'bunny', 'service.name': 'nanoleaf-controller', 'service.version': '1.0.0',
  'service.instance.id': '00000000-0000-4000-8000-000000000002', 'deployment.environment.name': 'test' };
const attributes = { 'bunny.operation': 'brightness', 'bunny.controller.id': 'controller', 'bunny.device.id': 'device',
  'bunny.ticket.epoch': 'ticket', 'bunny.ticket.sequence': 1 };
const parent = '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01';
function fixture() {
  const records = [], spans = [];
  const tracer = { startSpan(name, options, active) {
    const upstream = trace.getSpanContext(active);
    const identity = { traceId: upstream?.traceId ?? '9'.repeat(32), spanId: String(spans.length + 3).padStart(16, '0'), traceFlags: 1 };
    const value = { name, options, upstream, identity, ended: false,
      spanContext: () => identity, setAttributes() {}, setStatus() {}, end() { value.ended = true; } };
    spans.push(value); return value;
  } };
  const adapter = createWorkerDiagnostics({ resource, workerResource: { ...resource, 'service.name': 'nanoleaf-worker' },
    tracer, emit: record => records.push(record) });
  return { adapter, records, spans };
}

test('explicit queue handoff retains parentage, links deferred execution and emits truthful stages', () => {
  const { adapter, records, spans } = fixture();
  const request = adapter.request(attributes, parent);
  const queue = request.queued();
  request.finish({ outcome: 'queued' });
  assert.equal(spans[0].ended, true);
  assert.equal(spans[1].ended, false);
  const execution = queue.execute();
  execution.finish({ outcome: 'transport-acknowledged' });
  execution.finish({ outcome: 'transport-acknowledged' });
  assert.deepEqual(spans.map(span => span.name), ['bunny.command.request', 'bunny.command.queue', 'bunny.command.execute']);
  assert.ok(spans.every(span => span.ended));
  assert.equal(spans[0].upstream.spanId, '2'.repeat(16));
  assert.equal(spans[1].upstream.spanId, spans[0].identity.spanId);
  assert.equal(spans[2].upstream.spanId, spans[1].identity.spanId);
  assert.equal(spans[2].options.links[0].context.spanId, spans[0].identity.spanId);
  assert.deepEqual(records.map(record => record.event_name), ['command.queued', 'command.admitted', 'operation.completed', 'command.executing', 'command.completed']);
  assert.ok(records.every(record => validateRecord(record).ok && record.trace_id === '1'.repeat(32)));
  assert.equal(records.at(-1).attributes['bunny.outcome'], 'transport-acknowledged');
  assert.equal(records.at(-1).resource['service.name'], 'nanoleaf-worker');
});

test('cancelled queue ends without an execution span or a success claim', () => {
  const { adapter, records, spans } = fixture();
  const request = adapter.request(attributes, parent), queue = request.queued();
  request.finish({ outcome: 'queued' }); queue.cancel(); queue.cancel();
  assert.equal(spans.length, 2);
  assert.ok(spans.every(span => span.ended));
  assert.equal(records.at(-1).event_name, 'command.cancelled');
  assert.equal(records.at(-1).attributes['bunny.outcome'], 'cancelled');
  assert.equal(records.filter(record => record.event_name === 'command.cancelled').length, 1);
});

test('unknown content is rejected and malformed context never becomes a parent', () => {
  const { adapter, records, spans } = fixture();
  adapter.request({ ...attributes, secret: 'SYNTHETIC_SECRET' }, parent).finish({ outcome: 'rejected' });
  assert.equal(records.length, 0);
  assert.equal(spans.length, 0);
  adapter.request(attributes, 'SYNTHETIC_SECRET').finish({ outcome: 'rejected' });
  assert.equal(spans[0].upstream, undefined);
  assert.equal(records[0].event_name, 'command.rejected');
  assert.equal(JSON.stringify(records).includes('SYNTHETIC_SECRET'), false);
});
