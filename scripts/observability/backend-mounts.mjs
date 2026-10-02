import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { assertBackendIsolation } from './backend-plan.mjs';

async function fileIdentity(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) throw new Error('Backend bind source must be a regular file');
    return { dev: stat.dev, ino: stat.ino, size: stat.size };
  } finally { await handle.close(); }
}

/** Desktop can translate a WSL bind source. Accept only the same local file,
 * never a path-prefix match alone, and preserve the original inspection. */
export async function normalizeVerifiedMounts(inspect, plan, inspectFile = fileIdentity) {
  const normalized = structuredClone(inspect);
  if (!Array.isArray(normalized?.Mounts)) return normalized;
  for (const name of ['otelcol-config.yaml', 'loki-config.yaml']) {
    const mount = normalized.Mounts.find(value => value.Destination === `/otel-lgtm/${name}`);
    const expected = `${plan.configDirectory}/${name}`;
    if (!mount || mount.Source === expected) continue;
    if (mount.Type !== 'bind' || mount.RW !== false || typeof mount.Source !== 'string' ||
      !/^\/run\/desktop\/mnt\/host\/wsl\/docker-desktop-bind-mounts\/[A-Za-z0-9._-]+\/[a-f0-9]{64}$/.test(mount.Source)) {
      throw new Error('Backend bind source translation refused');
    }
    const original = await inspectFile(expected);
    const translated = await inspectFile(mount.Source.replace('/run/desktop/mnt/host/wsl/', '/mnt/wsl/'));
    if (original.dev !== translated.dev || original.ino !== translated.ino || original.size !== translated.size) {
      throw new Error('Backend bind source identity mismatch');
    }
    mount.Source = expected;
  }
  return normalized;
}

export async function verifyBackendIsolation(inspect, plan) {
  return assertBackendIsolation(await normalizeVerifiedMounts(inspect, plan), plan);
}
