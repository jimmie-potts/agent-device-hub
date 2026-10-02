import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecord } from '@jimmie-potts/bunny-observability';
import { expectedLog, readLokiRecords, readTempoSpans, compareRecords } from '../query-records.mjs';
const trace = '1234567890abcdef1234567890abcdef', span = '1234567890abcdef';
const record = createRecord({ timestamp: '2026-10-02T00:00:00.123Z', event_name: 'command.completed', severity_text: 'INFO',
  resource: { 'service.namespace': 'bunny', 'service.name': 'nanoleaf-worker', 'service.version': '1.0.0',
    'service.instance.id': '00000000-0000-4000-8000-000000000001', 'deployment.environment.name': 'test' },
  scope: { name: 'bunny.controller', version: '1.0.0' }, trace_id: trace, span_id: span, trace_flags: '01',
  attributes: { 'bunny.operation': 'brightness', 'bunny.outcome': 'succeeded', 'bunny.provenance': 'source',
    'bunny.ticket.epoch': 'synthetic-epoch', 'bunny.ticket.sequence': 7 } }).value;
function response() {
  const expected = expectedLog(record), fields = { ...expected.fields }, stream = {};
  for (const key of ['service_namespace', 'service_name', 'deployment_environment_name']) { stream[key] = fields[key]; delete fields[key]; }
  return { status: 'success', data: { resultType: 'streams', encodingFlags: ['categorize-labels'], result: [
    { stream, values: [[expected.timestamp, expected.body, { structuredMetadata: fields }]] }] } };
}

test('Loki field projection preserves canonical identity, typed ticket values and static body without parsing it', () => {
  const found = readLokiRecords(response());
  assert.deepEqual(found, [expectedLog(record)]);
  assert.deepEqual(compareRecords([expectedLog(record)], found), { equal: true, expected: 1, actual: 1, missing: [], unexpected: [] });
});

test('equal counts with wrong identities, loss and duplicates remain failures', () => {
  const expected = expectedLog(record), other = structuredClone(expected); other.fields.bunny_ticket_sequence = '8';
  assert.equal(compareRecords([expected], [other]).equal, false);
  const duplicate = compareRecords([expected], [expected, expected]);
  assert.equal(duplicate.unexpected[0].count, 1);
  assert.equal(compareRecords([expected], []).missing[0].count, 1);
});

test('missing event mapping, query warnings, truncated result limits and parsed message fields cannot qualify', () => {
  for (const change of [x => { delete x.data.result[0].values[0][2].structuredMetadata.event_name; },
    x => { x.warnings = ['SYNTHETIC_SECRET']; }, x => { x.data.encodingFlags = []; },
    x => { x.data.result[0].values[0][2].parsed = { event_name: 'command.completed' }; }]) {
    const value = response(); change(value); assert.throws(() => readLokiRecords(value), /query/);
  }
  assert.throws(() => readLokiRecords(response(), { limit: 1 }), /limit/);
});

test('Tempo v2 base64 and OTLP hexadecimal IDs normalize to the same identity without accepting partial traces', () => {
  const attributes = [{ key: 'bunny.operation', value: { stringValue: 'brightness' } }];
  const make = encoded => ({ trace: { resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'hub' } }] },
    scopeSpans: [{ scope: { name: 'bunny.controller', version: '1.0.0' }, spans: [{ traceId: encoded ? Buffer.from(trace, 'hex').toString('base64') : trace,
      spanId: encoded ? Buffer.from(span, 'hex').toString('base64') : span, name: 'bunny.command.execute', kind: 'SPAN_KIND_INTERNAL',
      startTimeUnixNano: '1000', endTimeUnixNano: '2000', attributes, status: { code: 'STATUS_CODE_OK' } }] }] }] } });
  assert.deepEqual(readTempoSpans(make(true), trace), readTempoSpans(make(false), trace));
  const broken = make(true); broken.status = 'PARTIAL'; assert.throws(() => readTempoSpans(broken, trace), /query/);
  const foreign = make(true); foreign.trace.resourceSpans[0].scopeSpans[0].spans[0].traceId = 'a'.repeat(32);
  assert.throws(() => readTempoSpans(foreign, trace), /query/);
});
