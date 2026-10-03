import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { createOwnedOrigins, traceparentOnly } from '../propagation.mjs';

test('only exact configured numeric loopback origins qualify for outgoing tracing', () => {
  const owned = createOwnedOrigins(['http://127.0.0.1:43100', 'http://[::1]:43101']);
  assert.equal(owned.has('http://127.0.0.1:43100'), true);
  assert.equal(owned.has('http://[::1]:43101'), true);
  for (const value of ['http://127.0.0.1:43102', 'http://localhost:43100', 'https://127.0.0.1:43100',
    'http://127.0.0.1:43100/private', 'http://user@127.0.0.1:43100', undefined]) assert.equal(owned.has(value), false);
  for (const value of ['https://example.invalid', 'http://localhost:80', 'http://127.0.0.1:43100/',
    'http://127.1:43100', 'http://2130706433:43100', 'http://0.0.0.0:43100']) {
    assert.throws(() => createOwnedOrigins([value]), /numeric loopback origin/);
  }
});

test('propagation preserves sampling flags and emits neither baggage nor tracestate', () => {
  for (const traceFlags of [0, 1]) {
    const active = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: '12345678901234567890123456789012', spanId: '1234567890123456', traceFlags,
      traceState: { serialize: () => 'private=SYNTHETIC_SECRET' },
    });
    const headers = {};
    traceparentOnly.inject(active, headers, { set: (carrier, name, value) => { carrier[name] = value; } });
    assert.deepEqual(headers, { traceparent: `00-12345678901234567890123456789012-1234567890123456-0${traceFlags}` });
  }
  assert.deepEqual(traceparentOnly.fields(), ['traceparent']);
});

test('automatic extraction cannot adopt unauthenticated headers and invalid spans cannot propagate', () => {
  assert.equal(traceparentOnly.extract(ROOT_CONTEXT, { traceparent: 'untrusted' }, {
    get() { throw Error('automatic extraction must not read headers'); },
  }), ROOT_CONTEXT);
  for (const active of [ROOT_CONTEXT, trace.setSpanContext(ROOT_CONTEXT, {
    traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 1,
  })]) {
    traceparentOnly.inject(active, {}, { set() { assert.fail('invalid span propagated'); } });
  }
});
