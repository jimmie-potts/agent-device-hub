import { spawnSync } from 'node:child_process';
import { readFile, statfs } from 'node:fs/promises';
import thresholds from './thresholds.json' with { type: 'json' };

const limits = thresholds.hard_limits;
const validBytes = value => Number.isSafeInteger(value) && value >= 0;

export function assessHost(input) {
  const checks = {
    linux: input.platform === 'linux',
    architecture: input.arch === 'x64',
    node24: /^24\.\d+\.\d+$/.test(input.nodeVersion),
    memoryReserve: validBytes(input.availableMemoryBytes)
      && input.availableMemoryBytes >= limits.host_available_reserve_bytes + limits.stack_memory_bytes,
    runDataSpace: validBytes(input.availableDiskBytes) && input.availableDiskBytes >= limits.run_data_bytes,
  };
  return { ready: Object.values(checks).every(Boolean), checks,
    availableMemoryBytes: input.availableMemoryBytes ?? null,
    availableDiskBytes: input.availableDiskBytes ?? null };
}

export async function inspectHost(directory) {
  let availableMemoryBytes = null, availableDiskBytes = null;
  try {
    const match = /^MemAvailable:\s+(\d+) kB$/m.exec(await readFile('/proc/meminfo', 'utf8'));
    if (match) availableMemoryBytes = Number(match[1]) * 1024;
  } catch { /* Missing metrics remain unqualified. */ }
  try {
    const disk = await statfs(directory);
    availableDiskBytes = disk.bavail * disk.bsize;
  } catch { /* Missing metrics remain unqualified. */ }
  return assessHost({ platform: process.platform, arch: process.arch,
    nodeVersion: process.versions.node, availableMemoryBytes, availableDiskBytes });
}

const localSocket = value => typeof value === 'string' && /^unix:\/\/\/[\w./-]+$/.test(value);
const infoFields = ['OSType', 'Architecture', 'CgroupVersion', 'NCPU', 'MemTotal', 'MemoryLimit', 'CpuCfsQuota'];
const infoFormat = `{${infoFields.map(key => `"${key}":{{json .${key}}}`).join(',')}}`;

/** Read-only commands only; raw Docker output and local context names never enter receipts. */
export async function inspectDocker(env = process.env, run = args => spawnSync('docker', args,
  { env, encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024 })) {
  if (env.DOCKER_HOST && !localSocket(env.DOCKER_HOST)) return { ready: false, code: 'nonlocal-docker-endpoint' };
  try {
    if (!env.DOCKER_HOST || env.DOCKER_CONTEXT) {
      const context = run(['context', 'inspect', ...(env.DOCKER_CONTEXT ? [env.DOCKER_CONTEXT] : []),
        '--format', '{{json .Endpoints.docker.Host}}']);
      if (context.error || context.status !== 0) return { ready: false, code: 'docker-context-unavailable' };
      let endpoint;
      try { endpoint = JSON.parse(context.stdout); } catch { return { ready: false, code: 'docker-context-invalid' }; }
      if (!localSocket(endpoint)) return { ready: false, code: 'nonlocal-docker-endpoint' };
    }
    const result = run(['info', '--format', infoFormat]);
    if (result.error || result.status !== 0) return { ready: false, code: 'docker-engine-unavailable' };
    let info;
    try { info = JSON.parse(result.stdout); } catch { return { ready: false, code: 'docker-info-invalid' }; }
    const checks = {
      linux: info?.OSType === 'linux',
      architecture: ['x86_64', 'amd64'].includes(info?.Architecture),
      cgroupV2: info?.CgroupVersion === '2',
      cpuCapacity: Number.isSafeInteger(info?.NCPU) && info.NCPU >= limits.stack_cpu_cores,
      memoryCapacity: validBytes(info?.MemTotal) && info.MemTotal >= limits.stack_memory_bytes,
      memoryLimit: info?.MemoryLimit === true,
      cpuLimit: info?.CpuCfsQuota === true,
    };
    const ready = Object.values(checks).every(Boolean);
    return { ready, code: ready ? 'local-engine-ready' : 'docker-capability-unavailable', checks };
  } catch { return { ready: false, code: 'docker-probe-failed' }; }
}
