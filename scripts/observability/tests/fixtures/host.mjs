import assert from 'node:assert/strict';
import { register } from 'node:module';
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
const { startPilotTelemetry } = await import('../../host.mjs');
const resource = { 'service.namespace': 'bunny', 'service.name': 'hub', 'service.version': '0.4.2',
  'service.instance.id': '00000000-0000-4000-8000-000000000001', 'deployment.environment.name': 'test' };
if (process.argv[2] === 'environment') {
  await assert.rejects(startPilotTelemetry({ resource, logSink() {}, traceSink() {} }), /Ambient OpenTelemetry settings/);
  process.stdout.write('environment refused\n');
} else {
  const local = [], logs = [], traces = [], signals = [];
  const unavailable = process.argv[2] === 'unavailable';
  const stall = signal => {
    signals.push(signal);
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Synthetic transport aborted')), { once: true }));
  };
  let origins = [];
  const host = await startPilotTelemetry({ resource, readOrigins: () => origins,
    localSink: line => local.push(JSON.parse(line)),
    logSink: (line, signal) => { logs.push(JSON.parse(line)); if (unavailable) return stall(signal); },
    traceSink: (line, signal) => { traces.push(JSON.parse(line)); if (unavailable) return stall(signal); },
    ...(unavailable ? { logOptions: { flushMs: 20 }, traceOptions: { flushMs: 20 } } : {}) });
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { startHub } = await import('../../../../apps/hub/dist/server.js');
  const { createCommandDiagnostics } = await import('../../../../apps/hub/dist/diagnostics.js');
  const { startFakeController } = await import('../../../../apps/hub/tests/fake-controller.mjs');
  const { createWorkerDiagnostics } = await import('../../worker-diagnostics.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'hub-host-'));
  let hub, fake;
  try {
    const controllerResource = { ...resource, 'service.name': 'nanoleaf-controller' };
    const workerResource = { ...resource, 'service.name': 'nanoleaf-worker' };
    const worker = createWorkerDiagnostics({ resource: controllerResource, workerResource, emit: host.emit,
      tracer: host.tracerFor({ resource: name => name === 'bunny.command.execute' ? workerResource : controllerResource,
        scope: name => name === 'bunny.command.queue' ? 'bunny.queue' : 'bunny.controller' }) });
    fake = await startFakeController({ execution: {}, diagnostics: worker });
    origins = [new URL(fake.endpoint).origin];
    const token = 'h'.repeat(43);
    const diagnostics = createCommandDiagnostics({ resource, emit: host.emit,
      tracer: host.tracerFor({ resource, scope: (_name, options) => options.kind === 1 ? 'bunny.http' : 'bunny.controller' }) });
    hub = await startHub({ directory, ownerId: 'owner', consumers: [], diagnostics,
      credentials: [{ id: 'pilot', digest: createHash('sha256').update(token).digest('hex'), scopes: ['read', 'control'], devices: ['wall'] }],
      controllers: [fake.config()] });
    const snapshot = fake.snapshot10();
    const body = { apiVersion: '1.0', controllerId: snapshot.identity.controllerId, deviceId: snapshot.identity.deviceId,
      requestId: snapshot.nextRequestId, expectedConfigurationRevision: snapshot.configurationRevision,
      expectedGeneration: snapshot.generation, command: { kind: 'brightness.set', percent: 42 } };
    const response = await fetch(`${hub.url}/api/controllers/v1/wall/commands`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-pixoo-request': '1',
        traceparent: '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01', baggage: 'private=SYNTHETIC_SECRET' }, body: JSON.stringify(body) });
    assert.equal(response.status, 202); assert.equal((await response.json()).outcome, 'queued');
    assert.equal(fake.executionState().effects, 0); fake.executeQueued(); assert.equal(fake.executionState().effects, 1);
    await hub.close(); hub = undefined; await fake.close(); fake = undefined;
    const closing = host.shutdown(); assert.equal(host.shutdown(), closing); await closing;
    if (unavailable) {
      const counts = host.counts();
      assert.equal(counts.logs.accepted, 7); assert.equal(counts.logs.dropped, 7);
      assert.equal(counts.traces.output.accepted, 6); assert.equal(counts.traces.output.dropped, 6);
      assert.equal(counts.logs.queued, 0); assert.equal(counts.traces.output.queued, 0);
      assert.equal(signals.length, 2); assert.ok(signals.every(signal => signal.aborted));
      assert.equal(counts.logs.exported, 0); assert.equal(counts.traces.output.exported, 0);
      process.stdout.write('unavailable host preserved command\n');
    } else {
    assert.equal(local.length, 7); assert.equal(logs.length, 7); assert.equal(traces.length, 6);
    const spans = traces.map(value => value.resourceSpans[0].scopeSpans[0].spans[0]);
    const ids = new Set(spans.map(span => span.spanId));
    assert.equal(ids.size, 6);
    for (const log of logs.map(value => value.resourceLogs[0].scopeLogs[0].logRecords[0])) {
      assert.equal(log.traceId, '1'.repeat(32)); assert.ok(ids.has(log.spanId));
    }
    assert.ok(spans.every(span => span.traceId === '1'.repeat(32)));
    assert.ok(spans.find(span => span.name === 'bunny.command.execute').links.length === 1);
    assert.equal(JSON.stringify({ local, logs, traces }).includes('SYNTHETIC_SECRET'), false);
    const counts = host.counts();
    for (const field of ['failed', 'dropped', 'invalid', 'localFailed', 'mappingFailed', 'queued']) assert.equal(counts.logs[field], 0, field);
    for (const field of ['invalid', 'unassociated', 'associationDropped', 'failures', 'unfinished', 'active']) assert.equal(counts.traces[field], 0, field);
    assert.equal(counts.logs.exported, 7); assert.equal(counts.traces.output.exported, 6);
    process.stdout.write('combined host verified\n');
    }
  } finally {
    await hub?.close(); await fake?.close(); await host.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
}
