import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecord } from '@jimmie-potts/bunny-observability';
import { projectSpan } from '../span-projection.mjs';
const metadata = () => createRecord({ timestamp: '2026-10-02T00:00:00.000Z', event_name: 'operation.completed', severity_text: 'INFO',
  resource: { 'service.namespace': 'bunny', 'service.name': 'hub', 'service.version': '0.4.2',
    'service.instance.id': '00000000-0000-4000-8000-000000000001', 'deployment.environment.name': 'test' },
  scope: { name: 'bunny.http', version: '1.0.0' },
  attributes: { 'bunny.operation': 'brightness', 'bunny.ticket.epoch': 'ticket', 'bunny.ticket.sequence': 42, 'bunny.provenance': 'source' },
}).value;
const span = () => ({ spanContext: () => ({ traceId: '1'.repeat(32), spanId: '2'.repeat(16), traceFlags: 1 }),
  parentSpanContext: { traceId: '1'.repeat(32), spanId: '3'.repeat(16) }, kind: 2,
  startTime: [1790899200, 123456789], endTime: [1790899200, 223456790], status: { code: 2, message: 'SYNTHETIC_SECRET' },
  name: 'GET /SYNTHETIC_SECRET', attributes: { 'url.full': 'http://SYNTHETIC_SECRET', 'bunny.ticket.sequence': 999 },
  events: [{ name: 'exception', attributes: { 'exception.message': 'SYNTHETIC_SECRET' } }],
  resource: { attributes: { 'host.name': 'SYNTHETIC_SECRET' } }, links: [{ attributes: { private: 'SYNTHETIC_SECRET' } }],
});

test('span export uses canonical typed metadata, exact nanosecond times and registered names', () => {
  const output = projectSpan(span(), metadata(), 'bunny.command.request');
  const group = output.resourceSpans[0];
  const scope = group.scopeSpans[0];
  const value = scope.spans[0];
  assert.equal(value.name, 'bunny.command.request');
  assert.equal(value.startTimeUnixNano, '1790899200123456789');
  assert.equal(value.endTimeUnixNano, '1790899200223456790');
  assert.equal(value.parentSpanId, '3'.repeat(16));
  assert.equal(value.kind, 3);
  assert.deepEqual(value.status, { code: 2 });
  assert.deepEqual(value.attributes.find(item => item.key === 'bunny.ticket.sequence').value, { intValue: '42' });
  assert.deepEqual(scope.scope, { name: 'bunny.http', version: '1.0.0' });
  assert.equal(JSON.stringify(output).includes('SYNTHETIC_SECRET'), false);
});

test('projection never reads SDK content, resource attributes, events, links or status messages', () => {
  const value = span();
  for (const key of ['name', 'attributes', 'events', 'resource', 'links', 'instrumentationScope']) {
    Object.defineProperty(value, key, { get() { assert.fail(`read unapproved SDK field: ${key}`); } });
  }
  Object.defineProperty(value.status, 'message', { get() { assert.fail('read exception text'); } });
  assert.ok(projectSpan(value, metadata(), 'bunny.command.request'));
});

test('invalid canonical metadata, IDs, time ranges and names cannot be exported', () => {
  const badMetadata = metadata(); badMetadata.attributes.secret = 'SYNTHETIC_SECRET';
  assert.equal(projectSpan(span(), badMetadata, 'bunny.command.request'), undefined);
  assert.equal(projectSpan(span(), metadata(), 'GET /private'), undefined);
  for (const changes of [
    { startTime: [-1, 0] }, { startTime: [1, 1e9] }, { endTime: [1, 0] }, { kind: 99 },
    { spanContext: () => ({ traceId: '0'.repeat(32), spanId: '2'.repeat(16), traceFlags: 1 }) },
    { parentSpanContext: { traceId: '9'.repeat(32), spanId: '3'.repeat(16) } },
    { parentSpanContext: { traceId: '1'.repeat(32), spanId: '0'.repeat(16) } },
  ]) assert.equal(projectSpan({ ...span(), ...changes }, metadata(), 'bunny.command.request'), undefined);
});

test('only separately approved causal link identities reach export, never SDK link attributes', () => {
  const source = span();
  Object.defineProperty(source, 'links', { get() { assert.fail('raw SDK links must not be read'); } });
  const approved = [{ traceId: '4'.repeat(32), spanId: '5'.repeat(16), traceFlags: 1 }];
  const output = projectSpan(source, metadata(), 'bunny.command.execute', approved);
  assert.deepEqual(output.resourceSpans[0].scopeSpans[0].spans[0].links,
    [{ traceId: '4'.repeat(32), spanId: '5'.repeat(16), flags: 1 }]);
  for (const links of [[{ ...approved[0], attributes: { secret: 'SYNTHETIC_SECRET' } }],
    [{ ...approved[0], traceId: '0'.repeat(32) }], [{ ...approved[0], traceFlags: -1 }],
    Array(9).fill(approved[0]), 'SYNTHETIC_SECRET']) {
    assert.equal(projectSpan(source, metadata(), 'bunny.command.execute', links), undefined);
  }
});
