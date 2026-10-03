import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readPreparedBackend } from './backend-files.mjs';

const maxBytes = 32768, maxEvents = 16;
const keys = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.keys(value).sort().join(',') : '';
function identity(plan, receipt) {
  if (![receipt?.containerId, receipt?.network?.networkId].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) {
    throw new Error('Cleanup journal receipt invalid');
  }
  return { container: receipt.containerId, network: receipt.network.networkId, volume: plan.volumeName };
}
function advance(state, event, ids) {
  if (state.complete || state.count >= maxEvents) throw new Error('Cleanup journal is terminal or full');
  if (event?.phase === 'complete') {
    if (keys(event) !== 'complete,elapsedMs,phase' || event.complete !== true ||
      !Number.isFinite(event.elapsedMs) || event.elapsedMs < 0 || event.elapsedMs > 30000 || state.pending) {
      throw new Error('Cleanup journal completion invalid');
    }
    return { count: state.count + 1, pending: null, complete: true };
  }
  if (keys(event) !== 'action,id,kind,phase' || !['intent', 'returned'].includes(event.phase) ||
    !['container', 'network', 'volume'].includes(event.kind) || event.id !== ids[event.kind] ||
    !['stop', 'remove'].includes(event.action) || (event.action === 'stop' && event.kind !== 'container')) {
    throw new Error('Cleanup journal event invalid');
  }
  if (event.phase === 'intent') {
    if (state.pending) throw new Error('Cleanup journal effect already pending');
    return { count: state.count + 1, pending: { ...event }, complete: false };
  }
  if (!state.pending || !isDeepStrictEqual({ ...event, phase: 'intent' }, state.pending)) {
    throw new Error('Cleanup journal effect return mismatch');
  }
  return { count: state.count + 1, pending: null, complete: false };
}
const initial = () => ({ count: 0, pending: null, complete: false });
const header = (plan, ids) => ({ version: '1.0', runId: plan.runId, ownerToken: plan.ownerToken, resources: ids });

/** One new file per attempt. A failed or interrupted journal is never reopened for writing. */
export async function createCleanupJournal(directory, receipt, attemptId) {
  if (typeof attemptId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(attemptId)) throw new Error('Cleanup attempt invalid');
  const { plan } = await readPreparedBackend(directory), ids = identity(plan, receipt);
  const path = join(directory, `cleanup-${attemptId}.jsonl`);
  const file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let state = initial(), size = 0, failed = false, closed = false, pending = null;
  try {
    const first = JSON.stringify(header(plan, ids)) + '\n';
    await file.writeFile(first); await file.sync(); size = Buffer.byteLength(first);
    const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await parent.sync(); } finally { await parent.close(); }
  } catch (error) { await file.close(); throw error; }
  async function record(event) {
    if (closed || failed) throw new Error('Cleanup journal closed or failed');
    if (pending) throw new Error('Cleanup journal concurrent write refused');
    const next = advance(state, event, ids);
    const line = JSON.stringify({ sequence: next.count, event }) + '\n';
    if (size + Buffer.byteLength(line) > maxBytes) throw new Error('Cleanup journal size exceeded');
    pending = (async () => {
      try {
        await file.writeFile(line); await file.sync();
        state = next; size += Buffer.byteLength(line);
      } catch (error) { failed = true; throw error; }
    })();
    try { await pending; } finally { pending = null; }
  }
  return { path, record, async close() {
    if (closed) return;
    closed = true;
    try { await pending; } finally { await file.close(); }
  } };
}

/** Read-only evidence check. A valid intent is not proof its effect ran or succeeded. */
export async function readCleanupJournal(path, plan, receipt) {
  const ids = identity(plan, receipt);
  if (typeof path !== 'string' || resolve(path) !== path || await realpath(dirname(path)) !== dirname(path)) {
    throw new Error('Cleanup journal path invalid');
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let raw;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error('Cleanup journal file invalid');
    const buffer = Buffer.alloc(maxBytes + 1); let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > maxBytes) throw new Error('Cleanup journal size exceeded');
    raw = buffer.subarray(0, used).toString('utf8');
  } finally { await file.close(); }
  if (!raw.endsWith('\n')) throw new Error('Cleanup journal incomplete line');
  const rows = raw.slice(0, -1).split('\n').map(line => JSON.parse(line));
  if (!isDeepStrictEqual(rows.shift(), header(plan, ids))) throw new Error('Cleanup journal identity mismatch');
  let state = initial(); const events = [];
  for (const row of rows) {
    if (keys(row) !== 'event,sequence' || row.sequence !== state.count + 1) throw new Error('Cleanup journal sequence invalid');
    state = advance(state, row.event, ids); events.push(row.event);
  }
  return { events, pending: state.pending, complete: state.complete };
}
