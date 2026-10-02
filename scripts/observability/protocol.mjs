import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const inputPatterns = {
  sourceRevision: /^[0-9a-f]{40}$/,
  sourceTree: /^[0-9a-f]{40}$/,
  packageLockSha256: /^[0-9a-f]{64}$/,
  harnessSha256: /^[0-9a-f]{64}$/,
  nodeVersion: /^24\.\d+\.\d+$/,
  pythonVersion: /^3\.(?:12|14)\.\d+$/,
  runId: /^[a-z0-9][a-z0-9-]{0,63}$/,
  createdAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Caller supplies an isolated run directory. Existing evidence is never replaced. */
export async function freezeProtocol(directory, inputs) {
  if (inputs === null || typeof inputs !== 'object'
    || Object.keys(inputs).length !== Object.keys(inputPatterns).length
    || Object.keys(inputs).some(key => !Object.hasOwn(inputPatterns, key))
    || Object.entries(inputPatterns).some(([key, pattern]) => typeof inputs[key] !== 'string' || !pattern.test(inputs[key]))
    || !Number.isFinite(Date.parse(inputs.createdAt))
    || new Date(inputs.createdAt).toISOString() !== inputs.createdAt) {
    throw new TypeError('invalid protocol input');
  }
  const thresholdBytes = await readFile(new URL('./thresholds.json', import.meta.url));
  const thresholdHash = sha256(thresholdBytes);
  // This digest is the owner-approved pre-measurement record, not a runtime override.
  if (thresholdHash !== 'd495d0ccdc47297d10f0b57d564ec66d25290f152dac45ffb8fb8bd61868da3b') {
    throw new Error('threshold record changed: record a reviewed revision before measurement');
  }
  const protocol = {
    version: '1.0',
    inputs: Object.fromEntries(Object.keys(inputPatterns).map(key => [key, inputs[key]])),
    thresholdsSha256: thresholdHash,
    thresholds: JSON.parse(thresholdBytes),
    queryVisibilityDeadlineMs: 30_000,
    resourceSampleIntervalMs: 100,
    pairs: ['healthy', 'unavailable'].flatMap(condition => [1, 2, 3].map(number => ({
      condition, number, order: number === 2 ? ['enabled', 'disabled'] : ['disabled', 'enabled'],
    }))),
    metricDefinitions: {
      latencyPercentile: 'nearest-rank-unrounded',
      requestLatency: 'actual-dispatch-to-response-milliseconds',
      scheduling: 'monotonic-slots-no-catch-up-no-retry',
      schedulingEvidence: 'retain-dispatch-lag-omitted-slots-and-scheduled-to-completion-latency',
      measurementCoverage: '601-fixed-100ms-sample-slots-including-both-boundaries-no-omitted-or-failed-slots',
      workloadEvidence: 'all-1800-slots-dispatched-once-with-valid-responses-and-exact-independent-execution-reconciliation',
      throughput: 'completions-within-measurement-window-per-second-late-completions-separate',
      applicationCpu: 'sum-process-user-and-system-cpu-delta-divided-by-wall-time',
      applicationRss: 'peak-summed-process-rss-sampled-every-100ms',
      applicationProcesses: ['hub', 'fake-controller', 'telemetry-workers'],
      excludedProcesses: ['driver', 'query-sampler'],
      stackCpu: 'whole-container-cgroup-usage-delta-divided-by-wall-time',
      stackRss: 'peak-summed-container-process-rss-with-source-recorded',
      shutdownStart: 'after-workload-quiescence',
      healthyLoss: 'expected-versus-queried-canonical-identity-multisets-after-flush-deadline',
      faultAccounting: 'exported-dropped-failed-pending-identities-preserved',
    },
    backend: {
      image: 'grafana/otel-lgtm:0.34.0@sha256:c6a56be719990e78b1d32e879988a219904300ecde1b9bfeec472831a56a922b',
      indexDigest: 'sha256:b966ea107831d526d9eb8fe4d2d86c9e5731392fad9dce8296bcf2072031f07c',
      platform: 'linux/amd64',
      publishedAddress: '127.0.0.1',
    },
    contract: {
      version: '1.0.0',
      release: 'https://github.com/jimmie-potts/agent-device-hub/releases/tag/bunny-observability-v1.0.0',
      archiveSha256: '7c48025059a92677790182c84c5b5d3b830f69470a9adc791386ad89c2185894',
      sourceRevision: '673a297ad1225cd18b611de8969dea10b28d33f2',
    },
  };
  const bytes = `${JSON.stringify(protocol, null, 2)}\n`;
  const path = join(directory, 'protocol.json');
  const digest = sha256(bytes);
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  // A failed sidecar write leaves the original evidence intact and aborts the run.
  await writeFile(`${path}.sha256`, `${digest}  protocol.json\n`, { flag: 'wx', mode: 0o600 });
  return { path, sha256: digest };
}
