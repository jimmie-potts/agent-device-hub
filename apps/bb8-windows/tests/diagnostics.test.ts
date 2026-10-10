import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceFields, SdkError} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {startHelperDiagnostics} from '../src/diagnostics.js';
void test('approved helper diagnostics record parented spans and static traced errors without raw payloads', async () => {
  const records: string[] = [], spans: string[] = [];
  const diagnostics = await startHelperDiagnostics({sink: line => {records.push(line);}, spanSink: line => {spans.push(line);}});
  const parent = {traceparent: '00-11111111111111111111111111111111-2222222222222222-01'};
  const span = diagnostics.trace.start('bunny.device.call', {parent, kind: 'client', attributes: {'bunny.operation': 'setup', 'bunny.device.id': 'bb8'}});
  diagnostics.log.info('command.admitted', {'bunny.request.id': 'request-1', 'bunny.outcome': 'accepted'}, span.context);
  diagnostics.failed(new SdkError(errorBody('internal'), {cause: new Error('tok_SYNTHETIC_private_address')}), span.context);
  diagnostics.diagnostic({event: 'remote.command.uncertain', level: 'warn', code: 'uncertain-result', requestId: 'request-1', outcome: 'uncertain', trace: parent});
  span.end(); await diagnostics.shutdown();
  assert.equal(records.length, 3); assert.equal(spans.length, 1);
  const logs = records.map(line => JSON.parse(line) as {trace_id: string; span_id: string; body: string});
  assert.ok(logs.every(log => log.trace_id === '11111111111111111111111111111111'));
  assert.equal(logs[0]?.span_id, traceFields(span.context)?.spanId);
  assert.equal(JSON.stringify({records, spans}).includes('tok_SYNTHETIC_private_address'), false);
  assert.equal(spans[0]?.includes('2222222222222222'), true, 'device span continues the incoming parent');
});
void test('diagnostic sink failure loses bounded telemetry without throwing into accepted work', async () => {
  const diagnostics = await startHelperDiagnostics({sink: () => {throw new Error('synthetic sink failure');}});
  const span = diagnostics.trace.start('bunny.device.call');
  diagnostics.log.info('command.admitted', {'bunny.outcome': 'accepted'}); span.end();
  await diagnostics.shutdown(); const counts = diagnostics.counts() as {logs?: {localFailed?: number}}; assert.ok((counts.logs?.localFailed ?? 0) > 0, 'sink loss is counted');
});
