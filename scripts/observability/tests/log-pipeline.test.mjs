import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecord, parseRecord } from '@jimmie-potts/bunny-observability';
import { createLogPipeline } from '../log-pipeline.mjs';
const record = () => createRecord({ timestamp: '2026-10-02T00:00:00.000Z', event_name: 'operation.completed', severity_text: 'INFO',
  resource: { 'service.namespace': 'bunny', 'service.name': 'hub', 'service.version': '0.4.2',
    'service.instance.id': '00000000-0000-4000-8000-000000000001', 'deployment.environment.name': 'test' },
  scope: { name: 'bunny.http', version: '1.0.0' }, trace_id: '1'.repeat(32), span_id: '2'.repeat(16), trace_flags: '01',
  attributes: { 'bunny.operation': 'brightness', 'bunny.outcome': 'queued', 'bunny.provenance': 'source' },
}).value;
const tick = () => new Promise(resolve => setImmediate(resolve));

test('one Pino JSON record maps to exactly one OTLP log preserving correlation', async () => {
  const local = [], exported = [];
  const pipeline = createLogPipeline({ localSink: line => local.push(line), sink: line => exported.push(JSON.parse(line)) });
  assert.equal(pipeline.emit(record()), true);
  assert.equal(local.length, 0, 'Pino sink is not called synchronously in the producer');
  await pipeline.close();
  assert.equal(local.length, 1); assert.equal(exported.length, 1);
  assert.equal(parseRecord(local[0]).ok, true);
  const log = exported[0].resourceLogs[0].scopeLogs[0].logRecords[0];
  assert.equal(log.traceId, '1'.repeat(32)); assert.equal(log.spanId, '2'.repeat(16));
  assert.equal(pipeline.counts().exported, 1); assert.equal(pipeline.counts().queued, 0);
});

test('unknown/private content is rejected before either sink, and local failures do not duplicate export', async () => {
  let calls = 0;
  const pipeline = createLogPipeline({ localSink() { throw Error('SYNTHETIC_SECRET'); }, sink() { calls++; } });
  assert.equal(pipeline.emit({ ...record(), attributes: { secret: 'SYNTHETIC_SECRET' } }), false);
  assert.equal(pipeline.emit(record()), true);
  await pipeline.close();
  assert.equal(calls, 1); assert.equal(pipeline.counts().invalid, 1); assert.equal(pipeline.counts().localFailed, 1);
  assert.equal(JSON.stringify(pipeline.counts()).includes('SYNTHETIC_SECRET'), false);
});

test('transport rejection is counted without retry, and subsequent records drain', async () => {
  let calls = 0;
  const pipeline = createLogPipeline({ sink() { if (++calls === 1) return Promise.reject(Error('SYNTHETIC_SECRET')); } });
  pipeline.emit(record()); pipeline.emit(record());
  await pipeline.close();
  assert.equal(calls, 2); assert.equal(pipeline.counts().failed, 1); assert.equal(pipeline.counts().exported, 1);
});

test('shutdown aborts stalled transport within the flush budget and accounts queue loss', async () => {
  let signal, reject;
  const pipeline = createLogPipeline({ sink(_line, value) { signal = value; return new Promise((_resolve, no) => { reject = no; }); },
    options: { maxRecords: 2, flushMs: 10 } });
  pipeline.emit(record()); pipeline.emit(record()); assert.equal(pipeline.emit(record()), false);
  await tick();
  const closing = pipeline.close(); assert.equal(pipeline.close(), closing);
  await closing;
  assert.equal(signal.aborted, true); assert.equal(pipeline.counts().dropped, 3);
  assert.equal(pipeline.counts().queued, 0); assert.equal(pipeline.counts().bytes, 0);
  const counts = pipeline.counts(); reject(Error('SYNTHETIC_SECRET')); await tick();
  assert.deepEqual(pipeline.counts(), counts);
});
