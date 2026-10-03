import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyIngestion, queryWindows } from '../ingestion-check.mjs';
const instance = '00000000-0000-4000-8000-000000000001', traceId = '1'.repeat(32), spanId = '2'.repeat(16);
const log = { timestamp: '1000000000', body: 'Command completed', fields: { service_instance_id: instance,
  service_name: 'hub', trace_id: traceId, span_id: spanId } };
const span = { traceId, spanId, resource: { 'service.name': { stringValue: 'hub' }, 'service.instance.id': { stringValue: instance } } };
const receipt = records => ({ found: true, records, bytes: 100, sha256: 'a'.repeat(64) });

test('ten-second half-open windows cover every boundary once', () => {
  assert.deepEqual(queryWindows('1', '20000000002'), [
    { startNs: '1', endNs: '10000000001' }, { startNs: '10000000001', endNs: '20000000001' },
    { startNs: '20000000001', endNs: '20000000002' }]);
});

test('saved exact identity and log/span correlation establish ingestion-only satisfaction', async () => {
  const events = [], calls = [];
  const result = await verifyIngestion({ expectedLogs: [log], expectedSpans: [span], startNs: '1', endNs: '2000000000',
    queries: { async logs(input) { calls.push(input); return receipt([log]); }, async trace(id) { assert.equal(id, traceId); return receipt([span]); } },
    record: async event => events.push(event) });
  assert.equal(result.disposition, 'supported'); assert.equal(result.scope, 'ingestion-only');
  assert.equal(result.correlationFailures, 0); assert.equal(events.filter(e => e.kind === 'query').length, 2);
  assert.equal(calls[0].instanceId, instance);
});

test('unexpected duplicates fail immediately and missing identities reach the fixed deadline without a favorable rerun', async () => {
  for (const duplicate of [true, false]) {
    const events = [];
    const result = await verifyIngestion({ expectedLogs: [log], expectedSpans: [span], startNs: '1', endNs: '2000000000', deadlineMs: 30,
      queries: { async logs() { return receipt(duplicate ? [log, log] : []); }, async trace() { return receipt([span]); } },
      record: async event => events.push(event) });
    assert.equal(result.disposition, 'refuted'); assert.equal(result.reason, duplicate ? 'unexpected-records' : 'visibility-deadline');
    assert.equal(events.filter(e => e.kind === 'round').length, 1);
  }
});

test('query or evidence failure is inconclusive and cannot be relabeled as missing records or a pass', async () => {
  for (const failEvidence of [true, false]) {
    const result = await verifyIngestion({ expectedLogs: [log], expectedSpans: [span], startNs: '1', endNs: '2000000000',
      queries: { async logs() { if (!failEvidence) throw new Error('private'); return receipt([log]); }, async trace() { return receipt([span]); } },
      record: async () => { if (failEvidence) throw new Error('disk'); } });
    assert.equal(result.disposition, 'inconclusive'); assert.equal(result.reason, 'query-or-evidence-failed');
  }
});

test('stalled evidence cannot outlive the visibility deadline or claim a saved query', async () => {
  const result = await verifyIngestion({ expectedLogs: [log], expectedSpans: [span], startNs: '1', endNs: '2000000000', deadlineMs: 30,
    queries: { async logs() { return receipt([log]); }, async trace() { return receipt([span]); } },
    record: async (_event, { signal }) => { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); } });
  assert.equal(result.disposition, 'inconclusive'); assert.equal(result.evidenceSaved, false);
});

test('failed query retains only an allowlisted failure code and HTTP status, never exception text', async () => {
  const events = [];
  const result = await verifyIngestion({ expectedLogs: [log], expectedSpans: [span], startNs: '1', endNs: '2000000000',
    queries: { async logs() { return receipt([]); }, async trace() { throw Object.assign(new Error('SYNTHETIC_PRIVATE_CANARY'), { code: 'http-status', status: 400 }); } },
    record: async event => events.push(event) });
  assert.equal(result.disposition, 'inconclusive');
  const failure = events.find(event => event.kind === 'query-failure');
  assert.equal(failure.code, 'http-status'); assert.equal(failure.status, 400);
  assert.equal(JSON.stringify({ events, result }).includes('SYNTHETIC_PRIVATE_CANARY'), false);
});
