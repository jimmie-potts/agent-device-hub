import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trace, ROOT_CONTEXT } from '@opentelemetry/api';
import { createRecord } from '@jimmie-potts/bunny-observability';
import { createSpanPipeline } from '../span-pipeline.mjs';
const resource = { 'service.namespace': 'bunny', 'service.name': 'hub', 'service.version': '0.4.2',
  'service.instance.id': '00000000-0000-4000-8000-000000000001', 'deployment.environment.name': 'test' };
const attributes = { 'bunny.operation': 'brightness', 'bunny.ticket.epoch': 'ticket', 'bunny.ticket.sequence': 1,
  'bunny.provenance': 'source', 'bunny.schema.version': '1.1' };
function fixture(options = {}) {
  const output = []; let sequence = 0;
  const pipeline = createSpanPipeline({ sink: line => { output.push(JSON.parse(line)); }, ...options });
  const raw = { startSpan(name, settings, active) {
    const parentSpanContext = trace.getSpanContext(active);
    const identity = { traceId: parentSpanContext?.traceId ?? '1'.repeat(32), spanId: String(++sequence).padStart(16, '0'), traceFlags: 1 };
    const span = { name, parentSpanContext, kind: settings.kind ?? 0, startTime: [1790899200, 0], endTime: [1790899200, 1000],
      status: { code: 0 }, spanContext: () => identity, isRecording: () => true,
      instrumentationScope: { name: 'pilot-manual' }, end() { pipeline.processor.onEnd(span); } };
    pipeline.processor.onStart(span, active); return span;
  } };
  const tracer = pipeline.wrapTracer(raw, { resource, scope: 'bunny.http' });
  return { pipeline, tracer, raw, output };
}

test('manual span metadata and canonical terminal updates survive a streaming export', async () => {
  const { pipeline, tracer, output } = fixture();
  const span = tracer.startSpan('bunny.command.request', { attributes }, ROOT_CONTEXT);
  const id = span.spanContext();
  const record = createRecord({ timestamp: '2026-10-02T00:00:00.000Z', event_name: 'operation.completed', severity_text: 'INFO',
    resource, scope: { name: 'bunny.http', version: '1.0.0' }, trace_id: id.traceId, span_id: id.spanId, trace_flags: '01',
    attributes: { ...attributes, 'bunny.outcome': 'queued' } }).value;
  assert.equal(pipeline.observe(record), true);
  Object.defineProperty(span, 'attributes', { get() { assert.fail('raw SDK attributes read'); } });
  span.end(); await pipeline.processor.forceFlush();
  assert.equal(output.length, 1);
  assert.deepEqual(output[0].resourceSpans[0].scopeSpans[0].spans[0].attributes.find(value => value.key === 'bunny.outcome').value, { stringValue: 'queued' });
  assert.equal(pipeline.counts().active, 0); assert.equal(pipeline.counts().activeBytes, 0);
  await pipeline.processor.shutdown();
});

test('automatic spans inherit only an owned parent association and never raw HTTP content', async () => {
  const { pipeline, tracer, raw, output } = fixture();
  const parent = tracer.startSpan('bunny.command.request', { attributes }, ROOT_CONTEXT);
  const active = trace.setSpanContext(ROOT_CONTEXT, parent.spanContext());
  const automatic = raw.startSpan('GET /SYNTHETIC_SECRET', { kind: 2 }, active);
  automatic.instrumentationScope = { name: '@opentelemetry/instrumentation-http' };
  automatic.attributes = { 'url.full': 'SYNTHETIC_SECRET', 'bunny.ticket.sequence': 999 };
  pipeline.processor.onStart(automatic, active);
  parent.end(); automatic.end(); await pipeline.processor.shutdown();
  assert.equal(output.length, 2);
  const child = output[1].resourceSpans[0].scopeSpans[0].spans[0];
  assert.equal(child.parentSpanId, parent.spanContext().spanId);
  assert.equal(child.name, 'bunny.command.request');
  assert.deepEqual(child.attributes.find(value => value.key === 'bunny.ticket.sequence').value, { intValue: '1' });
  assert.equal(JSON.stringify(output).includes('SYNTHETIC_SECRET'), false);
});

test('association saturation leaves domain span creation intact and releases owned state', async () => {
  const { pipeline, tracer, output } = fixture({ maxActiveRecords: 1 });
  const first = tracer.startSpan('bunny.command.request', { attributes }, ROOT_CONTEXT);
  const second = tracer.startSpan('bunny.command.request', { attributes }, ROOT_CONTEXT);
  assert.ok(second); assert.equal(pipeline.counts().active, 1); assert.equal(pipeline.counts().associationDropped, 1);
  second.end(); first.end(); await pipeline.processor.shutdown();
  assert.equal(output.length, 1); assert.equal(pipeline.counts().unassociated, 1);
  assert.equal(pipeline.counts().active, 0);
});

test('unsampled spans retain no association and shutdown counts unfinished spans', async () => {
  const { pipeline, tracer } = fixture();
  const silent = pipeline.wrapTracer({ startSpan: () => ({ isRecording: () => false }) }, { resource, scope: 'bunny.http' });
  assert.ok(silent.startSpan('bunny.command.request', { attributes }, ROOT_CONTEXT));
  assert.equal(pipeline.counts().active, 0);
  tracer.startSpan('bunny.command.request', { attributes }, ROOT_CONTEXT);
  await pipeline.processor.shutdown();
  assert.equal(pipeline.counts().unfinished, 1); assert.equal(pipeline.counts().activeBytes, 0);
});

test('byte saturation and invalid metadata never replace the returned domain span', async () => {
  const { pipeline, tracer, output } = fixture({ maxActiveBytes: 1 });
  const span = tracer.startSpan('bunny.command.request', { attributes }, ROOT_CONTEXT);
  assert.ok(span); assert.equal(pipeline.counts().active, 0); assert.equal(pipeline.counts().associationDropped, 1);
  span.end(); await pipeline.processor.shutdown(); assert.equal(output.length, 0);
  const next = fixture();
  const invalid = next.tracer.startSpan('bunny.command.request', { attributes: { ...attributes, secret: 'SYNTHETIC_SECRET' } }, ROOT_CONTEXT);
  assert.ok(invalid); assert.equal(next.pipeline.counts().invalid, 1);
  invalid.end(); await next.pipeline.processor.shutdown(); assert.equal(next.output.length, 0);
});

test('canonical updates cannot change the registered resource identity', async () => {
  const { pipeline, tracer, output } = fixture();
  const span = tracer.startSpan('bunny.command.request', { attributes }, ROOT_CONTEXT);
  const id = span.spanContext();
  const forged = createRecord({ timestamp: '2026-10-02T00:00:00.000Z', event_name: 'operation.completed', severity_text: 'INFO',
    resource: { ...resource, 'service.name': 'bunny-tool' }, scope: { name: 'bunny.http', version: '1.0.0' },
    trace_id: id.traceId, span_id: id.spanId, trace_flags: '01', attributes }).value;
  assert.equal(pipeline.observe(forged), false);
  assert.equal(pipeline.counts().invalid, 1);
  span.end(); await pipeline.processor.shutdown();
  assert.deepEqual(output[0].resourceSpans[0].resource.attributes.find(item => item.key === 'service.name').value, { stringValue: 'hub' });
});

test('span identities account for association loss and unfinished spans before export',async()=>{
  const events=[];const {pipeline,tracer}=fixture({maxActiveRecords:1,observe:event=>events.push(event)});
  tracer.startSpan('bunny.command.request',{attributes},ROOT_CONTEXT);
  const dropped=tracer.startSpan('bunny.command.request',{attributes},ROOT_CONTEXT);dropped.end();
  await pipeline.processor.shutdown();
  assert.deepEqual(events.map(e=>[e.id,e.phase]),[[1,'expected'],[2,'expected'],[2,'dropped'],[1,'pending']]);
  assert.deepEqual(pipeline.counts().evidence,{expected:2,exported:0,failed:0,dropped:1,pending:1,inFlight:0,evidenceFailed:0});
});

test('span projection is retained before queue loss and successful transport settles exactly once',async()=>{
  const events=[];const {pipeline,tracer}=fixture({observe:event=>events.push(event)});
  const span=tracer.startSpan('bunny.command.request',{attributes},ROOT_CONTEXT);span.end();
  await pipeline.processor.shutdown();
  assert.deepEqual(events.map(e=>e.phase),['expected','projected','exported']);
  assert.equal(events[1].value.resourceSpans[0].scopeSpans[0].spans[0].spanId,span.spanContext().spanId);
  assert.equal(pipeline.counts().evidence.inFlight,0);
});
