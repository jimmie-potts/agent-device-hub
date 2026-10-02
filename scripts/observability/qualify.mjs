import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { inspectHost, inspectDocker } from './preflight.mjs';
import { smokeBackend } from './backend-smoke.mjs';

const args = process.argv.slice(2);
if (args[0] === 'backend-smoke' && args.length === 9 && args[1] === '--evidence-dir' &&
  args[3] === '--state-parent' && args[5] === '--endpoint' && args[7] === '--ports') {
  const control = new AbortController();
  const abort = () => control.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const values = args[8].split(',').map(Number);
    if (values.length !== 5 || values.some(value => !Number.isInteger(value) || value < 1024 || value > 65535) || new Set(values).size !== 5) {
      throw new Error('Ports invalid');
    }
    const ports = Object.fromEntries(['grafana', 'otlp', 'loki', 'tempo', 'health'].map((name, index) => [name, values[index]]));
    const result = await smokeBackend({ directory: resolve(args[2]), stateParent: resolve(args[4]),
      endpoint: args[6], ports, signal: control.signal });
    console.log(JSON.stringify(result));
    process.exitCode = result.failure === null && result.stopConfirmed ? 0 : 2;
  } catch {
    console.error('Backend smoke incomplete; retain evidence and read back owned resources before any retry.');
    process.exitCode = 2;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
} else if (args.length !== 3 || args[0] !== 'preflight' || args[1] !== '--evidence-dir' || !args[2]) {
  console.error('Usage: npm run qualify:observability -- preflight --evidence-dir <new-run-directory>\n  or backend-smoke --evidence-dir <new-run-directory> --state-parent <existing-local-directory-outside-git> --endpoint <unix-socket-url> --ports <grafana,otlp,loki,tempo,health>');
  process.exitCode = 2;
} else {
  try {
    const directory = resolve(args[2]);
    await mkdir(directory, { recursive: true });
    const host = await inspectHost(directory);
    const docker = await inspectDocker();
    const report = { schemaVersion: '1.0', stage: 'preflight', createdAt: new Date().toISOString(),
      ready: host.ready && docker.ready, qualification: 'unexecuted', host, docker,
      remainingRuntimeChecks: ['pinned-image-size', 'container-limits', 'loopback-bindings',
        'continuous-resource-caps', 'ingestion', 'viewer', 'faults', 'paired-benchmarks', 'cleanup'] };
    await writeFile(join(directory, 'preflight.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(report));
    process.exitCode = report.ready ? 0 : 2;
  } catch {
    console.error('Preflight evidence could not be created; existing evidence is preserved.');
    process.exitCode = 2;
  }
}
