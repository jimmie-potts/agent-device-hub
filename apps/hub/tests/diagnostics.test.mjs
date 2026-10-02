import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trace } from '@opentelemetry/api';
import { validateRecord } from '@jimmie-potts/bunny-observability';
import { createCommandDiagnostics } from '../dist/diagnostics.js';
import { HttpError } from '../dist/common.js';

const resource = { 'service.namespace': 'bunny', 'service.name': 'hub', 'service.version': '0.4.2',
  'service.instance.id': '00000000-0000-4000-8000-000000000001', 'deployment.environment.name': 'test' };
const metadata = { 'bunny.operation': 'brightness', 'bunny.controller.id': 'controller',
  'bunny.device.id': 'device', 'bunny.ticket.epoch': 'ticket', 'bunny.ticket.sequence': 1 };
const result = { status: 202, body: { outcome: 'queued' } };
const spanContext = { traceId: '1'.repeat(32), spanId: '2'.repeat(16), traceFlags: 1 };
const tracer = () => ({ startSpan() { return trace.wrapSpanContext(spanContext); } });

test('command diagnostics emit the shared form with correlation and truthful queued outcome', async () => {
  const records = [];
  const diagnostics = createCommandDiagnostics({ resource, emit: value => records.push(value), tracer: tracer() });
  let calls = 0;
  assert.equal(await diagnostics.run('bunny.http', metadata, async () => { calls++; return result; }), result);
  assert.equal(calls, 1);
  assert.equal(records.length, 1);
  assert.equal(validateRecord(records[0]).ok, true);
  assert.equal(records[0].attributes['bunny.outcome'], 'queued');
  assert.equal(records[0].event_name, 'operation.completed');
  assert.equal(records[0].trace_id, spanContext.traceId);
  assert.equal(records[0].attributes['bunny.provenance'], 'source');
});

test('start, end and sink errors never repeat or replace a domain result', async () => {
  for (const broken of ['start', 'end', 'emit']) {
    let calls = 0;
    const diagnostics = createCommandDiagnostics({ resource,
      emit() { if (broken === 'emit') throw Error('SYNTHETIC_SECRET'); },
      tracer: { startSpan() {
        if (broken === 'start') throw Error('SYNTHETIC_SECRET');
        return { ...trace.wrapSpanContext(spanContext), spanContext: () => spanContext,
          setAttributes() {}, setStatus() {}, end() { if (broken === 'end') throw Error('SYNTHETIC_SECRET'); } };
      } },
    });
    assert.equal(await diagnostics.run('bunny.http', metadata, async () => { calls++; return result; }), result);
    assert.equal(calls, 1, broken);
  }
});

test('uncertain domain errors survive by identity and never expose error text or stacks', async () => {
  const records = [];
  const diagnostics = createCommandDiagnostics({ resource, emit: value => records.push(value), tracer: tracer() });
  const error = new HttpError('uncertain-result', 503);
  error.message = 'SYNTHETIC_SECRET';
  await assert.rejects(diagnostics.run('bunny.controller', { ...metadata, 'bunny.observed.service': 'local-controllers' }, async () => { throw error; }), value => value === error);
  assert.equal(records.length, 1);
  assert.equal(validateRecord(records[0]).ok, true);
  assert.equal(records[0].attributes['bunny.outcome'], 'uncertain');
  assert.equal(records[0].attributes['bunny.write.possible'], true);
  assert.equal(records[0].attributes['bunny.provenance'], 'observation');
  assert.equal(JSON.stringify(records).includes('SYNTHETIC_SECRET'), false);
});

test('context setup failures before and after invocation preserve exactly one domain call', async t => {
  const { context, ROOT_CONTEXT } = await import('@opentelemetry/api');
  t.after(() => context.disable());
  for (const phase of ['before', 'after', 'active']) {
    context.disable();
    context.setGlobalContextManager({
      active() { if (phase === 'active') throw Error('SYNTHETIC_SECRET'); return ROOT_CONTEXT; },
      with(_context, callback, thisArg, ...args) {
        if (phase === 'before') throw Error('SYNTHETIC_SECRET');
        callback.apply(thisArg, args);
        throw Error('SYNTHETIC_SECRET');
      },
      bind(_context, target) { return target; }, enable() { return this; }, disable() { return this; },
    });
    let calls = 0;
    const diagnostics = createCommandDiagnostics({ resource, emit() {}, tracer: tracer() });
    assert.equal(await diagnostics.run('bunny.controller', { ...metadata, 'bunny.observed.service': 'local-controllers' },
      async () => { calls++; return result; }), result);
    assert.equal(calls, 1, phase);
    assert.ok(diagnostics.counts().failures > 0);
  }
});

test('authenticated Hub brightness route emits diagnostics without changing native admission', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { startHub } = await import('../dist/server.js');
  const { startFakeController } = await import('./fake-controller.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'hub-diagnostics-'));
  const fake = await startFakeController();
  const records = [], token = 'h'.repeat(43);
  const diagnostics = createCommandDiagnostics({ resource, emit: record => records.push(record), tracer: tracer() });
  let hub;
  t.after(async () => { await hub?.close(); await fake.close(); await rm(directory, { recursive: true, force: true }); });
  hub = await startHub({ directory, ownerId: 'owner', consumers: [], diagnostics,
    credentials: [{ id: 'pilot', digest: createHash('sha256').update(token).digest('hex'), scopes: ['read', 'control'], devices: ['wall'] }],
    controllers: [fake.config()] });
  const snapshot = fake.snapshot10();
  const request = { apiVersion: '1.0', controllerId: snapshot.identity.controllerId, deviceId: snapshot.identity.deviceId,
    requestId: snapshot.nextRequestId, expectedConfigurationRevision: snapshot.configurationRevision,
    expectedGeneration: snapshot.generation, command: { kind: 'brightness.set', percent: 42 } };
  const post = credential => fetch(`${hub.url}/api/controllers/v1/wall/commands`, { method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json', 'x-pixoo-request': '1',
      traceparent: '00-' + '3'.repeat(32) + '-' + '4'.repeat(16) + '-01', baggage: 'SYNTHETIC_SECRET' },
    body: JSON.stringify(request) });
  assert.equal((await post('invalid')).status, 401);
  assert.equal(records.length, 0, 'authentication precedes diagnostic context');
  const response = await post(token);
  assert.equal(response.status, 202);
  assert.equal((await response.json()).outcome, 'queued');
  assert.equal(fake.commands.length, 1);
  assert.equal(records.length, 2, 'Hub request plus controller-client observation');
  assert.ok(records.every(record => validateRecord(record).ok));
  assert.deepEqual(records.map(record => record.scope.name).sort(), ['bunny.controller', 'bunny.http']);
  assert.ok(records.every(record => record.attributes['bunny.ticket.sequence'] === request.requestId.sequence));
  assert.equal(JSON.stringify(records).includes('SYNTHETIC_SECRET'), false);
});

test('telemetry does not let a later snapshot overtake command slot admission', async t => {
  const { ControllerClient } = await import('../dist/controllers.js');
  const { startFakeController } = await import('./fake-controller.mjs');
  const fake = await startFakeController();
  const diagnostics = createCommandDiagnostics({ resource, emit() {}, tracer: tracer() });
  const client = new ControllerClient(fake.config(), 2000, diagnostics);
  t.after(async () => { client.close(); await fake.close(); });
  const snapshot = fake.snapshot10();
  const request = { apiVersion: '1.0', controllerId: snapshot.identity.controllerId, deviceId: snapshot.identity.deviceId,
    requestId: snapshot.nextRequestId, expectedConfigurationRevision: snapshot.configurationRevision,
    expectedGeneration: snapshot.generation, command: { kind: 'brightness.set', percent: 42 } };
  const command = client.command(request).then(value => ({ value }), error => ({ error }));
  const read = await client.snapshot().then(value => ({ value }), error => ({ error }));
  assert.equal(read.error?.code, 'capacity', 'the first command owns the slot before yielding');
  const settled = await command;
  assert.equal(settled.value?.body.outcome, 'queued');
  assert.equal(fake.commands.length, 1);
});
