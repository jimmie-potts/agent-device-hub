import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { inspectHost, inspectDocker } from './preflight.mjs';

const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== 'preflight' || args[1] !== '--evidence-dir' || !args[2]) {
  console.error('Usage: npm run qualify:observability -- preflight --evidence-dir <new-run-directory>');
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
