// Disposable consumer pause controls. The consumer owns acknowledgment and
// stopped-process release; compose owns requests and never deletes a pause.
import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {link, lstat, open, realpath, rm} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {currentLease} from './safety-thaw.mjs';

const exec = promisify(execFile);
/** @param {string[]} args */
const systemctl = async args => (await exec('systemctl', ['--user', ...args], {timeout: 10000})).stdout;
const pause = (/** @type {number} */ ms) => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const RUN_ID = /^[a-z][a-z0-9-]{0,15}-\d{8}T\d{6}Z-[0-9a-f]{6}$/;
/** @typedef {{id: string, runId: string | null, proofDir: string | null}} PausedService */
/** @typedef {{version: number, runId: string, nonce: string}} Request */
/** @typedef {{service: PausedService, request: Request, runtime: string, pid: number, started: number}} PauseTicket */
/** @typedef {{runtimeRoot: string, control?: (args: string[]) => Promise<string>, timeoutMs?: number}} PauseOptions */

export class FeedPauseError extends Error {
  /** @param {string} message @param {string} service */
  constructor(message, service) { super(message); this.service = service; }
}
/** @param {string} reason @param {PausedService} service */
const fail = (reason, service) => new FeedPauseError(reason, service.id);

/** @param {string} path */
async function privateDirectory(path) {
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) throw new Error('unsafe directory');
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new Error('unsafe directory');
}
/** @param {string} path @param {number} limit @returns {Promise<any>} */
async function privateJson(path, limit) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid?.() || info.nlink !== 1 || (info.mode & 0o077) || info.size > limit) throw new Error('unsafe file');
    const bytes = Buffer.alloc(limit + 1);
    const {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > limit) throw new Error('oversized file');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally { await handle.close(); }
}
/** Publish a complete file without replacing a public control. @param {string} path @param {Request} value */
async function publish(path, value) {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); } finally { await handle.close(); }
  try { await link(temporary, path); } finally { await rm(temporary, {force: true}); }
}
/** @param {any} value @param {Request} request @param {boolean} ack */
function matches(value, request, ack) {
  const keys = ack ? ['nonce', 'pid', 'runId', 'version'] : ['nonce', 'runId', 'version'];
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.join(',')
    && value.version === 1 && value.runId === request.runId && value.nonce === request.nonce
    && (!ack || Number.isSafeInteger(value.pid) && value.pid > 0);
}
/** @param {string} text */
const properties = text => Object.fromEntries(text.trim().split('\n').filter(Boolean).map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
}));

/** Receipt, runtime, current lease and the same live process. @param {PausedService} service @param {PauseOptions} options */
export async function liveFeedIdentity(service, {runtimeRoot, control = systemctl}) {
  try {
    if (!RUN_ID.test(service.runId ?? '') || !service.proofDir) throw new Error('invalid run');
    const runId = /** @type {string} */ (service.runId), runtime = join(runtimeRoot, runId);
    await privateDirectory(runtimeRoot); await privateDirectory(runtime); await privateDirectory(service.proofDir);
    const receiptPath = join(service.proofDir, 'receipt.json');
    const receipt = await privateJson(receiptPath, 4 * 1024 * 1024);
    const unit = `app-verify-${runId}.service`;
    if (receipt.runId !== runId || receipt.state !== 'running' || receipt.roots?.runtime !== runtimeRoot
      || receipt.owned?.runtimeDir !== runId || receipt.owned.unit !== unit
      || !Number.isSafeInteger(receipt.owned.mainPid) || receipt.owned.mainPid <= 0
      || !Number.isSafeInteger(receipt.owned.mainStartMonotonic) || receipt.owned.mainStartMonotonic <= 0) throw new Error('invalid receipt');
    if (!(await currentLease(runId, receiptPath, control)).valid) throw new Error('lease unavailable');
    const state = properties(await control(['show', unit, '-p', 'LoadState', '-p', 'ActiveState', '-p', 'FreezerState', '-p', 'MainPID', '-p', 'ExecMainStartTimestampMonotonic']));
    if (state.LoadState !== 'loaded' || state.ActiveState !== 'active' || state.FreezerState !== 'running'
      || Number(state.MainPID) !== receipt.owned.mainPid || Number(state.ExecMainStartTimestampMonotonic) !== receipt.owned.mainStartMonotonic) throw new Error('process changed');
    return {runtime, pid: receipt.owned.mainPid, started: receipt.owned.mainStartMonotonic};
  } catch { throw fail('current run identity or lease could not be verified', service); }
}

/** Missing acknowledgment may be retried; other mismatches fail closed. @param {PauseTicket} ticket @param {PauseOptions} options */
async function acknowledged(ticket, options) {
  const {service, request, runtime} = ticket;
  try {
    if (!matches(await privateJson(join(runtime, 'feed-pause.request'), 4096), request, false)) throw new Error('request changed');
    let ack;
    try { ack = await privateJson(join(runtime, 'feed-pause.ack'), 4096); }
    catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false; throw error; }
    if (!matches(ack, request, true) || ack.pid !== ticket.pid) throw new Error('ack mismatch');
    const live = await liveFeedIdentity(service, options);
    if (live.pid !== ticket.pid || live.started !== ticket.started || live.runtime !== runtime) throw new Error('process replaced');
    return true;
  } catch { throw fail('pause acknowledgment or current process did not match', service); }
}

/**
 * Leave every request in place, including on failure. Only the consumer's
 * successful authorized seed consumes it after stopping the old process.
 * @template T @param {PausedService[]} services @param {PauseOptions} options
 * @param {(tickets: PauseTicket[]) => Promise<T>} ownerCall @returns {Promise<T>}
 */
export async function withPausedFeeds(services, options, ownerCall) {
  /** @type {PauseTicket[]} */
  const tickets = [];
  for (const service of services) {
    const identity = await liveFeedIdentity(service, options);
    for (const name of ['request', 'ack', 'release']) {
      try {
        await lstat(join(identity.runtime, `feed-pause.${name}`));
        throw fail('an existing feed pause must be cleaned before reset', service);
      } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error; }
    }
    tickets.push({service, ...identity, request: {version: 1, runId: /** @type {string} */ (service.runId), nonce: randomBytes(16).toString('hex')}});
  }
  for (const ticket of tickets) {
    try { await publish(join(ticket.runtime, 'feed-pause.request'), ticket.request); }
    catch { throw fail('could not publish the private feed pause', ticket.service); }
  }
  const deadline = Date.now() + (options.timeoutMs ?? 15000);
  for (;;) {
    /** @type {PauseTicket | undefined} */
    let waiting;
    for (const ticket of tickets) if (!await acknowledged(ticket, options)) waiting ??= ticket;
    if (!waiting) break;
    if (Date.now() >= deadline) throw fail('consumer did not acknowledge a drained feed before timeout', waiting.service);
    await pause(10);
  }
  // Validate all consumers again: the first could have changed while the last drained.
  await verifyPausedFeeds(tickets, options);
  return ownerCall(tickets);
}

/** Authorize only this still-paused process's subsequent stopped seed. @param {PauseTicket} ticket @param {PauseOptions} options */
export async function releaseFeed(ticket, options) {
  if (!await acknowledged(ticket, options)) throw fail('pause acknowledgment disappeared before release', ticket.service);
  try { await publish(join(ticket.runtime, 'feed-pause.release'), ticket.request); }
  catch { throw fail('could not publish the matching feed release', ticket.service); }
}

/** Recheck the batch directly before mutating the owner. @param {PauseTicket[]} tickets @param {PauseOptions} options */
export async function verifyPausedFeeds(tickets, options) {
  for (const ticket of tickets) if (!await acknowledged(ticket, options)) throw fail('pause acknowledgment disappeared before owner reset', ticket.service);
}
