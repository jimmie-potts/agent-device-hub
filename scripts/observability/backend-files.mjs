import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { backendPlan } from './backend-plan.mjs';
import { backendConfigs } from './backend-config.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
async function directoryPath(directory, existing) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory ||
    await realpath(existing ? directory : dirname(directory)) !== (existing ? directory : dirname(directory))) {
    throw new Error('Invalid backend directory');
  }
}
async function regularFile(path, maximum, description) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) throw new Error('invalid');
    const buffer = Buffer.alloc(maximum + 1); let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximum) throw new Error('invalid');
    return buffer.subarray(0, length);
  } catch { throw new Error(`Invalid backend ${description}`); }
  finally { await handle?.close(); }
}

/** Create a new private run directory; a partial failure is retained, never overwritten or auto-deleted. */
export async function prepareBackendDirectory(directory, { runId, ports }) {
  await directoryPath(directory, false);
  const plan = backendPlan({ runId, ports, ownerToken: randomUUID(), configDirectory: join(directory, 'config') });
  const files = backendConfigs();
  await mkdir(directory, { mode: 0o700 });
  await mkdir(plan.configDirectory, { mode: 0o700 });
  const configs = {};
  for (const [name, text] of Object.entries(files)) {
    // Contents are synthetic configuration, not credentials. World-readable file mode
    // permits the capability-dropped container to read the bind mount; parent stays private.
    await writeFile(join(plan.configDirectory, name), text, { flag: 'wx', mode: 0o444 });
    configs[name] = { sha256: digest(text), bytes: Buffer.byteLength(text) };
  }
  const manifest = { version: '1.0', createdAt: new Date().toISOString(), qualification: 'unexecuted', plan, configs };
  await writeFile(join(directory, 'backend.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return readPreparedBackend(directory);
}

/** Read-only verification; failed evidence stays available for diagnosis. */
export async function readPreparedBackend(directory) {
  await directoryPath(directory, true);
  const manifest = JSON.parse(await regularFile(join(directory, 'backend.json'), 65536, 'manifest'));
  if (!manifest || Object.keys(manifest).sort().join(',') !== 'configs,createdAt,plan,qualification,version' ||
    manifest.version !== '1.0' || manifest.qualification !== 'unexecuted' || !Number.isFinite(Date.parse(manifest.createdAt)) ||
    new Date(manifest.createdAt).toISOString() !== manifest.createdAt) throw new Error('Invalid backend manifest');
  const plan = backendPlan({ runId: manifest.plan?.runId, ownerToken: manifest.plan?.ownerToken,
    ports: manifest.plan?.ports, configDirectory: join(directory, 'config') });
  if (!isDeepStrictEqual(plan, manifest.plan)) throw new Error('Invalid backend manifest plan');
  await directoryPath(plan.configDirectory, true);
  const expected = backendConfigs(), receipts = {};
  for (const [name, text] of Object.entries(expected)) {
    const bytes = await regularFile(join(plan.configDirectory, name), 8192, 'configuration');
    if (!bytes.equals(Buffer.from(text))) throw new Error('Backend configuration differs from the pinned profile');
    receipts[name] = { sha256: digest(bytes), bytes: bytes.length };
  }
  if (!isDeepStrictEqual(receipts, manifest.configs)) throw new Error('Invalid backend configuration receipt');
  return manifest;
}
