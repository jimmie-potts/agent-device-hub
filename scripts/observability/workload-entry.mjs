import hubPackage from '../../apps/hub/package.json' with {type:'json'};
import { register, registerHooks } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { readPreparedBackend } from './backend-files.mjs';
import { readHostRoots } from './host-roots.mjs';
import { verifyInstalledContract } from './released-contract.mjs';

let hub, fake, host, logTransport, traceTransport, drainTimer, closing, pending = 0, evidenceFailed = false;
let stage = 'input';
let evidenceBatch=[],evidenceBytes=0;
function send(value) {
  if (!process.connected || pending >= 128 || Buffer.byteLength(JSON.stringify(value)) > 65536) { evidenceFailed = true; return; }
  pending++;
  process.send(value, error => { pending--; if (error) evidenceFailed = true; });
}
function drain() {
  const executions = fake?.takeExecutions();
  if (executions?.length) send({ kind: 'executions', executions });
  if(evidenceBatch.length){send({kind:'telemetry',events:evidenceBatch});evidenceBatch=[];evidenceBytes=0;}
}
function observe(event) {
  const bytes=Buffer.byteLength(JSON.stringify(event));
  if(bytes>16384){evidenceFailed=true;return;}
  if(evidenceBytes+bytes>49152 || evidenceBatch.length>=128)drain();
  evidenceBatch.push(event);evidenceBytes+=bytes;
}
async function stop() {
  if (closing) return closing;
  closing = (async () => {
    clearInterval(drainTimer);
    // Let the fake's already scheduled immediate run; never enqueue or replay a command.
    await new Promise(resolve => setImmediate(resolve)); drain();
    const quiescent = !fake || fake.executionState().queued === 0;
    const started = performance.now();
    await hub?.close(); await fake?.close(); drain();
    const flushStarted = performance.now(); await host?.shutdown();
    const flushMs = performance.now() - flushStarted, applicationMs = performance.now() - started;
    logTransport?.close(); traceTransport?.close();
    drain();
    send({ kind: 'closed', complete: stage === 'running' && quiescent && !evidenceFailed,
      stage, evidenceFailed, quiescent, counts: host?.counts() ?? null,
      oracle: fake?.executionState() ?? null, shutdown: { applicationMs, flushMs } });
    process.disconnect();
  })();
  return closing;
}
process.on('disconnect', () => { void stop().catch(() => { process.exitCode = 2; }); });
process.once('message', async input => {
  try {
    if (!input || Object.keys(input).sort().join(',') !== 'directory,enabled,purpose' ||
      typeof input.directory !== 'string' || typeof input.enabled !== 'boolean' || !['workload','command-faults','collection-faults'].includes(input.purpose) || !process.send) throw new Error('Input invalid');
    const { plan } = await readPreparedBackend(input.directory), roots = await readHostRoots(input.directory);
    stage = 'contract';
    const installed = join(roots.roots.state.path, 'contract/node_modules/@jimmie-potts/bunny-observability');
    await verifyInstalledContract(installed);
    if (input.enabled) register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === '@jimmie-potts/bunny-observability' || specifier === '@jimmie-potts/bunny-observability/node') {
        return next(pathToFileURL(join(installed, 'dist', specifier.endsWith('/node') ? 'node.js' : 'index.js')).href, context);
      }
      return next(specifier, context);
    } });
    const resolved = new URL(import.meta.resolve('@jimmie-potts/bunny-observability'));
    if (resolved.pathname !== pathToFileURL(join(installed, 'dist/index.js')).pathname ||
      !['', '?iitm=true'].includes(resolved.search) || resolved.hash) throw new Error('Contract resolution invalid');
    const resource = { 'service.namespace': 'bunny', 'service.name': 'hub', 'service.version': hubPackage.version,
      'service.instance.id': randomUUID(), 'deployment.environment.name': 'test' };
    let origins = [], diagnostics, worker;
    if (input.enabled) {
      stage = 'telemetry';
      const { startPilotTelemetry } = await import('./host.mjs');
      const { createOtlpTransport } = await import('./otlp-http.mjs');
      logTransport = createOtlpTransport({ origin: `http://127.0.0.1:${plan.ports.otlp}`, signal: 'logs' });
      traceTransport = createOtlpTransport({ origin: `http://127.0.0.1:${plan.ports.otlp}`, signal: 'traces' });
      host = await startPilotTelemetry({ resource, readOrigins: () => origins,
        logSink: (line, signal) => logTransport.send(line, signal), traceSink: (line, signal) => traceTransport.send(line, signal),observe,
        // Leave time to account for drops and finish SDK cleanup inside the
        // accepted 1,000 ms end-to-end flush bound.
        logOptions:{flushMs:950},traceOptions:{flushMs:950} });
      const { createCommandDiagnostics } = await import('../../apps/hub/dist/diagnostics.js');
      const { createWorkerDiagnostics } = await import('./worker-diagnostics.mjs');
      const controllerResource = { ...resource, 'service.name': 'nanoleaf-controller' }, workerResource = { ...resource, 'service.name': 'nanoleaf-worker' };
      diagnostics = createCommandDiagnostics({ resource, emit: host.emit,
        tracer: host.tracerFor({ resource, scope: (_name, options) => options.kind === 1 ? 'bunny.http' : 'bunny.controller' }) });
      worker = createWorkerDiagnostics({ resource: controllerResource, workerResource, emit: host.emit,
        tracer: host.tracerFor({ resource: name => name === 'bunny.command.execute' ? workerResource : controllerResource,
          scope: name => name === 'bunny.command.queue' ? 'bunny.queue' : 'bunny.controller' }) });
    }
    stage = 'application';
    const { startHub } = await import('../../apps/hub/dist/server.js');
    const { startFakeController } = await import('../../apps/hub/tests/fake-controller.mjs');
    const fakeOptions={ execution: { autoDrain: input.purpose!=='command-faults' }, diagnostics: worker };
    fake = await startFakeController(fakeOptions);
    origins = [new URL(fake.endpoint).origin];
    const token = 's'.repeat(43), directory = join(roots.roots.state.path,
      input.purpose==='workload'?'hub':input.purpose==='collection-faults'?`hub-cf-${input.enabled?'e':'d'}`:`hub-faults-${input.enabled?'enabled':'disabled'}`);
    await mkdir(directory, { mode: 0o700 });
    hub = await startHub({ directory, ownerId: 'synthetic-pilot', consumers: [], diagnostics,
      credentials: [{ id: 'pilot', digest: createHash('sha256').update(token).digest('hex'), scopes: ['read','control'], devices: ['wall'] }],
      controllers: [fake.config()] });
    const snapshot = fake.snapshot10(); stage = 'running';
    drainTimer = setInterval(drain, 25);
    let qualifying=false;
    process.on('message', message => {
      if (message?.kind === 'stop' && Object.keys(message).length === 1) void stop().catch(() => { process.exitCode = 2; process.disconnect(); });
      else if(message?.kind==='qualify-commands' && Object.keys(message).length===1 && input.purpose==='command-faults' && !qualifying) {
        qualifying=true;
        void import('./command-faults.mjs').then(({runCommandFaults})=>runCommandFaults({hub,fake,fakeOptions,token}))
          .then(result=>{drain();send({kind:'command-qualification',result});})
          .catch(()=>{evidenceFailed=true;send({kind:'command-qualification',result:{complete:false,stage:'qualification-error'}});});
      }
      else { evidenceFailed = true; void stop(); }
    });
    send({ kind: 'ready', pid: process.pid, url: hub.url, token, resource, contractSource: 'verified-released-archive',
      request: { apiVersion: '1.0', controllerId: snapshot.identity.controllerId, deviceId: snapshot.identity.deviceId,
        requestId: snapshot.nextRequestId, expectedConfigurationRevision: snapshot.configurationRevision,
        expectedGeneration: snapshot.generation, command: { kind: 'brightness.set', percent: 42 } } });
  } catch { evidenceFailed = true; process.exitCode = 2; await stop().catch(() => { if (process.connected) process.disconnect(); }); }
});
