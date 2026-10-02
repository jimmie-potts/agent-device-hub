import { register, registerHooks } from 'node:module';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readPreparedBackend } from './backend-files.mjs';
import { readHostRoots } from './host-roots.mjs';
import { verifyInstalledContract } from './released-contract.mjs';

// Fresh process only. Resolve both contract entry points to the verified release,
// before any producer or Pino adapter can load the workspace package.
const output = { version: '1.0', complete: false, stage: 'input', contractSource: null,
  node: { logs: [], spans: [], effects: null, outcome: null }, python: null };
let hub, fake, host, logTransport, traceTransport;
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk; if (Buffer.byteLength(input) > 8192) throw new Error('Input limit');
  }
  const config = JSON.parse(input);
  if (Object.keys(config).join(',') !== 'directory' || typeof config.directory !== 'string') throw new Error('Input invalid');
  const { plan } = await readPreparedBackend(config.directory), roots = await readHostRoots(config.directory);
  const installed = join(roots.roots.state.path, 'contract/node_modules/@jimmie-potts/bunny-observability');
  output.stage = 'contract'; await verifyInstalledContract(installed);
  output.stage = 'module-hooks';
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@jimmie-potts/bunny-observability' || specifier === '@jimmie-potts/bunny-observability/node') {
      const entry = specifier.endsWith('/node') ? 'node.js' : 'index.js';
      return next(pathToFileURL(join(installed, 'dist', entry)).href, context);
    }
    return next(specifier, context);
  } });
  output.stage = 'module-resolution';
  const resolved = new URL(import.meta.resolve('@jimmie-potts/bunny-observability'));
  if (resolved.protocol !== 'file:' || resolved.pathname !== pathToFileURL(join(installed, 'dist/index.js')).pathname ||
    !['', '?iitm=true'].includes(resolved.search) || resolved.hash) {
    throw new Error('Contract resolution mismatch');
  }
  output.contractSource = 'verified-released-archive';
  const { startPilotTelemetry } = await import('./host.mjs');
  const { createOtlpTransport } = await import('./otlp-http.mjs');
  const origin = `http://127.0.0.1:${plan.ports.otlp}`;
  logTransport = createOtlpTransport({ origin, signal: 'logs' });
  traceTransport = createOtlpTransport({ origin, signal: 'traces' });
  const resource = { 'service.namespace': 'bunny', 'service.name': 'hub', 'service.version': '0.4.2',
    'service.instance.id': randomUUID(), 'deployment.environment.name': 'test' };
  let origins = [];
  const append = (rows, value, maximum) => { if (rows.length >= maximum) throw new Error('Fixture output limit'); rows.push(value); };
  output.stage = 'telemetry';
  host = await startPilotTelemetry({ resource, readOrigins: () => origins,
    localSink: line => append(output.node.logs, JSON.parse(line), 7),
    logSink: (line, signal) => logTransport.send(line, signal),
    traceSink: (line, signal) => { append(output.node.spans, JSON.parse(line), 6); return traceTransport.send(line, signal); } });
  const { startHub } = await import('../../apps/hub/dist/server.js');
  const { createCommandDiagnostics } = await import('../../apps/hub/dist/diagnostics.js');
  const { startFakeController } = await import('../../apps/hub/tests/fake-controller.mjs');
  const { createWorkerDiagnostics } = await import('./worker-diagnostics.mjs');
  const controllerResource = { ...resource, 'service.name': 'nanoleaf-controller' };
  const workerResource = { ...resource, 'service.name': 'nanoleaf-worker' };
  const worker = createWorkerDiagnostics({ resource: controllerResource, workerResource, emit: host.emit,
    tracer: host.tracerFor({ resource: name => name === 'bunny.command.execute' ? workerResource : controllerResource,
      scope: name => name === 'bunny.command.queue' ? 'bunny.queue' : 'bunny.controller' }) });
  output.stage = 'application';
  output.stage = 'fake-controller';
  fake = await startFakeController({ execution: {}, diagnostics: worker });
  origins = [new URL(fake.endpoint).origin];
  const token = 's'.repeat(43), diagnostics = createCommandDiagnostics({ resource, emit: host.emit,
    tracer: host.tracerFor({ resource, scope: (_name, options) => options.kind === 1 ? 'bunny.http' : 'bunny.controller' }) });
  output.stage = 'hub';
  await mkdir(join(roots.roots.state.path, 'hub'), { mode: 0o700 });
  hub = await startHub({ directory: join(roots.roots.state.path, 'hub'), ownerId: 'synthetic-pilot', consumers: [], diagnostics,
    credentials: [{ id: 'pilot', digest: createHash('sha256').update(token).digest('hex'), scopes: ['read','control'], devices: ['wall'] }],
    controllers: [fake.config()] });
  const snapshot = fake.snapshot10(), traceId = randomBytes(16).toString('hex');
  const body = { apiVersion: '1.0', controllerId: snapshot.identity.controllerId, deviceId: snapshot.identity.deviceId,
    requestId: snapshot.nextRequestId, expectedConfigurationRevision: snapshot.configurationRevision,
    expectedGeneration: snapshot.generation, command: { kind: 'brightness.set', percent: 42 } };
  output.startNs = String(BigInt(Date.now()) * 1000000n); output.stage = 'command';
  const response = await fetch(`${hub.url}/api/controllers/v1/wall/commands`, { method: 'POST', signal: AbortSignal.timeout(2000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-pixoo-request': '1',
      traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01`, baggage: 'private=SYNTHETIC_PRIVATE_CANARY' }, body: JSON.stringify(body) });
  output.node.outcome = (await response.json()).outcome;
  if (response.status !== 202 || output.node.outcome !== 'queued' || fake.executionState().effects !== 0) throw new Error('Command outcome mismatch');
  fake.executeQueued(); output.node.effects = fake.executionState().effects;
  if (output.node.effects !== 1) throw new Error('Execution mismatch');
  await hub.close(); hub = undefined; await fake.close(); fake = undefined;
  output.stage = 'flush'; await host.shutdown(); output.node.counts = host.counts();
  if (output.node.logs.length !== 7 || output.node.spans.length !== 6 || output.node.counts.logs.exported !== 7 ||
    output.node.counts.traces.output.exported !== 6) throw new Error('Export incomplete');
  output.stage = 'python';
  const { makePythonFixture } = await import('./python-fixture.mjs');
  output.python = await makePythonFixture(installed, { instanceId: randomUUID(), traceId: randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'), timestamp: new Date().toISOString() });
  await logTransport.send(JSON.stringify(output.python.log)); await traceTransport.send(JSON.stringify(output.python.span));
  output.endNs = String(BigInt(Date.now() + 1) * 1000000n);
  output.transport = { logs: logTransport.counts(), traces: traceTransport.counts() };
  if (JSON.stringify(output).includes('SYNTHETIC_PRIVATE_CANARY')) throw new Error('Privacy failure');
  output.complete = true; output.stage = 'complete';
} catch { /* Stage and canonical partial evidence survive; arbitrary exception text does not. */ }
finally {
  try { await hub?.close(); await fake?.close(); await host?.shutdown(); }
  catch { output.complete = false; output.stage = 'cleanup'; }
  logTransport?.close(); traceTransport?.close();
}
const serialized = JSON.stringify(output);
if (Buffer.byteLength(serialized) > 256 * 1024) { process.stdout.write('{"complete":false,"stage":"output-limit"}\n'); process.exitCode = 2; }
else { process.stdout.write(serialized + '\n'); process.exitCode = output.complete ? 0 : 2; }
