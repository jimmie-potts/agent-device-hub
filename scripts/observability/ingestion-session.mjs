import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { runIngestionProducer } from './ingestion-process.mjs';
import { expectedLog, readTempoSpans, compareRecords } from './query-records.mjs';
import { createBackendQueries } from './backend-queries.mjs';
import { verifyIngestion, queryWindows } from './ingestion-check.mjs';

async function save(directory, name, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(text) > 512 * 1024) throw new Error('Ingestion evidence limit');
  const file = await open(join(directory, name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await parent.sync(); } finally { await parent.close(); }
}

/** Called only inside a ready, continuously monitored backend session. The
 * installed contract must already be prepared in the registered state root. */
export async function performIngestion({ directory, plan, signal }) {
  await save(directory, 'ingestion-intent.json', { version: '1.0', runId: plan.runId, scope: 'ingestion-only' });
  const producer = await runIngestionProducer(directory, { signal });
  await save(directory, 'ingestion-producer.json', producer);
  if (producer.code !== 0 || producer.reason || producer.output?.complete !== true ||
    producer.output.contractSource !== 'verified-released-archive') throw new Error('Ingestion producer incomplete');
  const fixture = producer.output;
  const expectedLogs = [...fixture.node.logs, fixture.python.record].map(expectedLog);
  const expectedSpans = [...fixture.node.spans, fixture.python.span].flatMap(envelope =>
    readTempoSpans({ trace: envelope }, envelope.resourceSpans[0].scopeSpans[0].spans[0].traceId));
  await save(directory, 'ingestion-expected.json', { expectedLogs, expectedSpans, startNs: fixture.startNs, endNs: fixture.endNs });
  const journal = await open(join(directory, 'ingestion-queries.jsonl'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  let bytes = 0, count = 0, failed = false;
  const queries = createBackendQueries(plan, { forbidden: ['SYNTHETIC_PRIVATE_CANARY'] });
  try {
    const result = await verifyIngestion({ expectedLogs, expectedSpans, startNs: fixture.startNs, endNs: fixture.endNs, signal,
      queries,
      record: async event => {
        const text = JSON.stringify(event) + '\n'; bytes += Buffer.byteLength(text); count++;
        if (failed || count > 512 || bytes > 8 * 1024 ** 2) throw new Error('Ingestion query evidence limit');
        try { await journal.writeFile(text); await journal.sync(); } catch (error) { failed = true; throw error; }
      } });
    await save(directory, 'ingestion-result.json', result);
    if (result.disposition !== 'supported' || !result.evidenceSaved) throw new Error('Ingestion not supported');
    const checks = [];
    for (const [name, reference, fields] of [
      ['node', expectedLogs[0], ['service_name', 'trace_id', 'bunny_ticket_epoch', 'bunny_ticket_sequence']],
      ['python', expectedLogs.at(-1), ['event_name', 'severity_text', 'bunny_outcome', 'bunny_ticket_sequence']],
    ]) {
      const filters = Object.fromEntries(fields.map(key => [key, reference.fields[key]]));
      const expected = expectedLogs.filter(log => log.fields.service_instance_id === reference.fields.service_instance_id &&
        fields.every(key => log.fields[key] === filters[key]));
      if (!expected.length) throw new Error('Field query has no expected evidence');
      const receipts = [];
      for (const window of queryWindows(fixture.startNs, fixture.endNs)) {
        receipts.push(await queries.logs({ instanceId: reference.fields.service_instance_id, ...window, filters }, { signal, timeoutMs: 2000 }));
      }
      const comparison = compareRecords(expected, receipts.flatMap(receipt => receipt.records));
      checks.push({ name, filters, receipts, comparison });
    }
    await save(directory, 'ingestion-field-queries.json', checks);
    if (checks.some(check => !check.comparison.equal)) throw new Error('Field query identity mismatch');
    return result;
  } finally { await journal.close(); }
}
