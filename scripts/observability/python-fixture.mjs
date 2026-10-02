import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createRecord, toOtlp, validateRecord } from '@jimmie-potts/bunny-observability';
import { verifyInstalledContract } from './released-contract.mjs';

/** Synthetic Python producer plus a named synthetic span for cross-language query qualification. */
export async function makePythonFixture(installed, { instanceId, traceId, spanId, timestamp }) {
  await verifyInstalledContract(installed);
  const input = { timestamp, event_name: 'command.completed', severity_text: 'WARN',
    resource: { 'service.namespace': 'bunny', 'service.name': 'nanoleaf-worker', 'service.version': '1.0.0',
      'service.instance.id': instanceId, 'deployment.environment.name': 'test' },
    scope: { name: 'bunny.controller', version: '1.0.0' }, trace_id: traceId, span_id: spanId, trace_flags: '01',
    attributes: { 'bunny.operation': 'brightness', 'bunny.outcome': 'uncertain', 'bunny.reason': 'timeout',
      'bunny.provenance': 'source', 'bunny.ticket.epoch': 'synthetic-python', 'bunny.ticket.sequence': 7,
      'bunny.write.possible': true, 'bunny.queue.wait_ms': 12.5 } };
  const expected = createRecord(input);
  if (!expected.ok) throw new Error('Python fixture identity invalid');
  const script = `import json,sys
if sys.version_info[:2] not in ((3,12),(3,14)): raise SystemExit(2)
sys.path.insert(0,sys.argv[1])
from bunny_observability import create_record,to_otlp
result=create_record(json.load(sys.stdin))
if not result['ok']: raise SystemExit(2)
print(json.dumps({'record':result['value'],'log':to_otlp(result['value'])}))
`;
  const child = spawnSync(process.env.PYTHON ?? 'python3', ['-I', '-B', '-c', script, join(installed, 'python')],
    { input: JSON.stringify(input), encoding: 'utf8', timeout: 5000, maxBuffer: 16384 });
  if (child.error || child.status !== 0) throw new Error('Python fixture generation failed');
  let output;
  try { output = JSON.parse(child.stdout); } catch { throw new Error('Python fixture output invalid'); }
  // Python's sorted attribute order differs from TypeScript; compare semantic objects by key.
  if (!validateRecord(output.record).ok || !isDeepStrictEqual(output.record, expected.value)) throw new Error('Python fixture parity failed');
  const normalized = envelope => {
    const value = structuredClone(envelope);
    value.resourceLogs[0].resource.attributes.sort((a, b) => a.key.localeCompare(b.key));
    value.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.sort((a, b) => a.key.localeCompare(b.key));
    return value;
  };
  if (!isDeepStrictEqual(normalized(output.log), normalized(toOtlp(expected.value)))) throw new Error('Python fixture mapping failed');
  const group = output.log.resourceLogs[0], scope = group.scopeLogs[0], log = scope.logRecords[0];
  const span = { resourceSpans: [{ resource: group.resource, scopeSpans: [{ scope: scope.scope, schemaUrl: scope.schemaUrl,
    spans: [{ traceId, spanId, flags: 1, name: 'bunny.command.execute', kind: 1, startTimeUnixNano: log.timeUnixNano,
      endTimeUnixNano: String(BigInt(log.timeUnixNano) + 1000000n), attributes: log.attributes, status: { code: 2 } }] }] }] };
  return { ...output, span, spanOrigin: 'synthetic-query-fixture' };
}
