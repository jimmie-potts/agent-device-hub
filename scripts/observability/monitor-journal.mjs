import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readPreparedBackend } from './backend-files.mjs';
import { assessResources } from './resource-watchdog.mjs';
const maxBytes = 2 * 1024 ** 2;
const reasons = ['run-data-cap', 'stack-memory-cap', 'oom', 'measurement-invalid', 'host-reserve', 'storage-headroom',
  'sample-limit', 'sample-failed', 'evidence-failed', 'monitor-aborted'];
const keys = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort().join(',') : '';
const timestamp = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value);
const initial = () => ({ sampleCount: 0, lastEnd: '0', lastFailure: null, stopReason: null, result: null });
function advance(state, event) {
  const invalid = () => { throw new Error('Monitor journal event invalid'); };
  if (state.result) invalid();
  if (event?.phase === 'sample') {
    const expected = { phase: 'sample', sequence: state.sampleCount + 1, startedNs: event.startedNs,
      finishedNs: event.finishedNs, ...assessResources(event.values) };
    if (state.stopReason || state.lastFailure || state.sampleCount >= 3600 || !isDeepStrictEqual(event, expected) ||
      !timestamp(event.startedNs) || !timestamp(event.finishedNs) || BigInt(event.startedNs) < BigInt(state.lastEnd) ||
      BigInt(event.finishedNs) < BigInt(event.startedNs)) invalid();
    return { ...state, sampleCount: event.sequence, lastEnd: event.finishedNs, lastFailure: event.reason };
  }
  if (event?.phase === 'stop-intent') {
    if (state.stopReason || keys(event) !== 'phase,reason,sampleCount' || !reasons.includes(event.reason) ||
      event.sampleCount !== state.sampleCount || (state.lastFailure && event.reason !== state.lastFailure)) invalid();
    return { ...state, stopReason: event.reason };
  }
  if (event?.phase !== 'result' || keys(event) !== 'phase,result') invalid();
  const result = event.result;
  if (keys(result) !== 'evidenceSaved,reason,sampleCount,status,stopConfirmed' ||
    !['finished', 'failed'].includes(result.status) || typeof result.evidenceSaved !== 'boolean' ||
    typeof result.stopConfirmed !== 'boolean' || !Number.isSafeInteger(result.sampleCount) ||
    result.sampleCount < state.sampleCount || result.sampleCount > state.sampleCount + (result.evidenceSaved ? 0 : 1)) invalid();
  if (result.status === 'finished') {
    if (result.reason !== null || result.stopConfirmed || state.stopReason || state.lastFailure) invalid();
  } else if (!reasons.includes(result.reason) || (state.stopReason && state.stopReason !== result.reason) ||
    (state.lastFailure && state.lastFailure !== result.reason) || (result.evidenceSaved && !state.stopReason)) invalid();
  return { ...state, result: { ...result } };
}
function header(plan, receipt) {
  if (!/^[a-f0-9]{64}$/.test(receipt?.containerId ?? '') || !/^sha256:[a-f0-9]{64}$/.test(receipt?.imageId ?? '')) {
    throw new Error('Monitor journal identity invalid');
  }
  return { version: '1.0', runId: plan.runId, ownerToken: plan.ownerToken, containerId: receipt.containerId, imageId: receipt.imageId };
}

/** One exclusive file per monitoring attempt; write failures poison further appends. */
export async function createMonitorJournal(directory, receipt, attemptId) {
  if (typeof attemptId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(attemptId)) throw new Error('Monitor attempt invalid');
  const { plan } = await readPreparedBackend(directory), first = JSON.stringify(header(plan, receipt)) + '\n';
  const path = join(directory, `monitor-${attemptId}.jsonl`);
  const file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let state = initial(), bytes = Buffer.byteLength(first), failed = false, closed = false, pending = null;
  try {
    await file.writeFile(first); await file.sync();
    const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await parent.sync(); } finally { await parent.close(); }
  } catch (error) { await file.close(); throw error; }
  async function record(event, { signal } = {}) {
    if (closed || failed || pending || signal?.aborted) throw new Error('Monitor journal unavailable');
    const next = advance(state, event), line = JSON.stringify(event) + '\n', length = Buffer.byteLength(line);
    if (length > 1024 || bytes + length > maxBytes) throw new Error('Monitor journal limit exceeded');
    pending = (async () => {
      try {
        await file.writeFile(line); await file.sync();
        if (signal?.aborted) throw new Error('Monitor write completion unconfirmed');
        state = next; bytes += length;
      } catch (error) { failed = true; throw error; }
    })();
    try { await pending; } finally { pending = null; }
  }
  return { path, record, finish: result => record({ phase: 'result', result }), async close() {
    if (closed) return; closed = true;
    try { await pending; } finally { await file.close(); }
  } };
}

export async function readMonitorJournal(path, plan, receipt) {
  if (typeof path !== 'string' || resolve(path) !== path || await realpath(dirname(path)) !== dirname(path)) {
    throw new Error('Monitor journal path invalid');
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); let text;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error('Monitor journal file invalid');
    const buffer = Buffer.alloc(maxBytes + 1); let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, used);
      if (!bytesRead) break; used += bytesRead;
    }
    if (used > maxBytes) throw new Error('Monitor journal limit exceeded');
    text = buffer.subarray(0, used).toString('utf8');
  } finally { await file.close(); }
  if (!text.endsWith('\n')) throw new Error('Monitor journal truncated');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length > 3603 || lines.some(line => Buffer.byteLength(line) > 1024)) throw new Error('Monitor journal limit exceeded');
  if (!isDeepStrictEqual(JSON.parse(lines.shift()), header(plan, receipt))) throw new Error('Monitor journal identity mismatch');
  let state = initial();
  for (const line of lines) state = advance(state, JSON.parse(line));
  return { sampleCount: state.sampleCount, stopReason: state.stopReason, result: state.result };
}
