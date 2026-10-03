import { mkdir, open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readPreparedBackend } from './backend-files.mjs';
import { hostTreeIdentity } from './host-storage.mjs';

async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await file.sync(); } finally { await file.close(); }
}
async function save(path, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(text) > 8192) throw new Error('Host root record limit exceeded');
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  await syncDirectory(dirname(path));
}
async function read(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 8192) throw new Error('Host root record invalid');
    const buffer = Buffer.alloc(8193); let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > 8192) throw new Error('Host root record limit exceeded');
    const text = buffer.subarray(0, used).toString('utf8');
    if (!text.endsWith('\n')) throw new Error('Host root record incomplete');
    return JSON.parse(text);
  } finally { await file.close(); }
}
async function outsideGit(path) {
  for (let cursor = path;; cursor = dirname(cursor)) {
    let present = false;
    try { await lstat(join(cursor, '.git')); present = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (present) throw new Error('Synthetic state must be outside every Git checkout');
    if (dirname(cursor) === cursor) return;
  }
}
const marker = plan => ({ version: '1.0', runId: plan.runId, ownerToken: plan.ownerToken, role: 'synthetic-state' });
function intent(plan, directory, stateParent) {
  // Keep state paths short enough for the Hub's Unix sockets; uniqueness is still checked by mkdir.
  return { version: '1.0', runId: plan.runId, ownerToken: plan.ownerToken, backendDirectory: directory,
    stateDirectory: join(stateParent, 's-' + plan.ownerToken.replaceAll('-', '').slice(0, 16)) };
}

/** Create a fresh state root only. An interrupted registration remains immutable and requires readback. */
export async function registerHostRoots(directory, stateParent) {
  const { plan } = await readPreparedBackend(directory);
  await hostTreeIdentity(stateParent); await outsideGit(stateParent);
  const request = intent(plan, directory, stateParent);
  if (request.stateDirectory.startsWith(directory + '/') || directory.startsWith(request.stateDirectory + '/')) {
    throw new Error('Host run roots overlap');
  }
  await save(join(directory, 'host-roots-intent.json'), request);
  await mkdir(request.stateDirectory, { mode: 0o700 });
  await syncDirectory(stateParent);
  await save(join(request.stateDirectory, 'observability-owner.json'), marker(plan));
  const record = { version: '1.0', runId: plan.runId, ownerToken: plan.ownerToken,
    roots: { backend: await hostTreeIdentity(directory), state: await hostTreeIdentity(request.stateDirectory) } };
  await save(join(directory, 'host-roots.json'), record);
  return readHostRoots(directory);
}

/** Read recorded roots and compare current filesystem identities before handing them to the sampler. */
export async function readHostRoots(directory) {
  const { plan } = await readPreparedBackend(directory);
  const request = await read(join(directory, 'host-roots-intent.json'));
  if (typeof request?.stateDirectory !== 'string') throw new Error('Host root intent invalid');
  const parent = dirname(request.stateDirectory);
  await hostTreeIdentity(parent); await outsideGit(parent);
  if (!isDeepStrictEqual(request, intent(plan, directory, parent))) throw new Error('Host root intent invalid');
  const record = await read(join(directory, 'host-roots.json'));
  const current = { version: '1.0', runId: plan.runId, ownerToken: plan.ownerToken,
    roots: { backend: await hostTreeIdentity(directory), state: await hostTreeIdentity(request.stateDirectory) } };
  if (!isDeepStrictEqual(record, current)) throw new Error('Host root identity changed');
  if (!isDeepStrictEqual(await read(join(request.stateDirectory, 'observability-owner.json')), marker(plan))) {
    throw new Error('Synthetic state owner changed');
  }
  return record;
}
