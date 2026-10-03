import { open, readdir, realpath, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readPreparedBackend } from './backend-files.mjs';
import { networkReceipt, volumeReceipt } from './backend-resources.mjs';

const kinds = ['network', 'volume', 'container'];
const order = ['preflight', ...kinds.flatMap(kind => ['intent', 'returned', 'verified'].map(phase => `${kind}-${phase}`)), 'receipt'];
const keys = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort().join(',') : '';
const id = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const bytes = value => value === null || (Number.isSafeInteger(value) && value >= 0);
async function read(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16384) throw new Error('Allocation file invalid');
    const buffer = Buffer.alloc(16385); let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > 16384) throw new Error('Allocation file exceeds bound');
    const text = buffer.subarray(0, used).toString('utf8');
    if (!text.endsWith('\n')) throw new Error('Allocation file incomplete');
    return JSON.parse(text);
  } finally { await file.close(); }
}

/** Read only. Recorded stopped state is historical; callers must inspect live resources again. */
export async function readAllocation(directory) {
  const { plan } = await readPreparedBackend(directory), path = join(directory, 'allocation');
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if (error.code === 'ENOENT') return { status: 'not-attempted', resources: {}, receipt: null };
    throw error;
  }
  if (!info.isDirectory() || await realpath(path) !== path) throw new Error('Allocation directory is not canonical');
  const names = await readdir(path);
  if (names.some(name => !order.some(key => name === key + '.json'))) throw new Error('Allocation directory contains unknown records');
  const records = {}; let missing = false;
  for (const key of order) {
    if (!names.includes(key + '.json')) { missing = true; continue; }
    if (missing) throw new Error('Allocation record sequence incomplete');
    records[key] = await read(join(path, key + '.json'));
  }
  const resources = {}, preflight = records.preflight;
  if (!preflight) return { status: 'interrupted', resources, receipt: null };
  if (keys(preflight) !== 'availableDiskBytes,availableMemoryBytes,hostReady,imageBytes,imageId,ownerToken,runId,version' ||
    preflight.version !== '1.0' || preflight.runId !== plan.runId || preflight.ownerToken !== plan.ownerToken ||
    preflight.hostReady !== true || !bytes(preflight.availableMemoryBytes) || !bytes(preflight.availableDiskBytes) ||
    !/^sha256:[a-f0-9]{64}$/.test(preflight.imageId ?? '') || !Number.isSafeInteger(preflight.imageBytes) ||
    preflight.imageBytes < 0 || preflight.imageBytes > plan.limits.imageBytes) throw new Error('Allocation preflight invalid');
  const receipt = { version: '1.0', runId: plan.runId, ownerToken: plan.ownerToken,
    stage: 'allocated-stopped', qualification: 'unexecuted', imageId: preflight.imageId, imageBytes: preflight.imageBytes };
  for (const kind of kinds) {
    const intent = records[kind + '-intent'], returned = records[kind + '-returned'], verified = records[kind + '-verified'];
    if (!intent) break;
    if (!isDeepStrictEqual(intent, { action: 'create', kind, name: plan[kind + 'Name'], runId: plan.runId, ownerToken: plan.ownerToken })) {
      throw new Error('Allocation intent invalid');
    }
    resources[kind] = { phase: 'intent', id: null };
    if (!returned) break;
    if (keys(returned) !== 'id,warningCount' || !(kind === 'volume' ? returned.id === plan.volumeName : id(returned.id)) ||
      !Number.isSafeInteger(returned.warningCount) || returned.warningCount < 0) throw new Error('Allocation returned identity invalid');
    resources[kind] = { phase: 'returned', id: returned.id, warningCount: returned.warningCount };
    if (!verified) break;
    if (returned.warningCount !== 0) throw new Error('Allocation verified despite warnings');
    let expected;
    if (kind === 'network') {
      expected = networkReceipt({ Id: returned.id, Name: plan.networkName, Created: verified.createdAt,
        Labels: plan.labels, Driver: 'bridge', Scope: 'local', Internal: false, Attachable: false, Ingress: false, Containers: {} }, plan);
      receipt.network = expected;
    } else if (kind === 'volume') {
      expected = volumeReceipt({ Name: plan.volumeName, CreatedAt: verified.createdAt, Mountpoint: verified.mountpoint,
        Driver: 'local', Scope: 'local', Labels: plan.labels, Options: null }, plan);
      receipt.volume = expected;
    } else {
      expected = { containerId: returned.id, imageId: preflight.imageId, running: false };
      receipt.containerId = returned.id;
    }
    if (!isDeepStrictEqual(expected, verified)) throw new Error('Allocation verified receipt invalid');
    resources[kind] = { phase: 'verified', id: returned.id, warningCount: 0 };
  }
  if (!records.receipt) return { status: 'interrupted', resources, receipt: null };
  if (!isDeepStrictEqual(records.receipt, receipt)) throw new Error('Allocation final receipt mismatch');
  return { status: 'allocated-stopped', resources, receipt };
}
