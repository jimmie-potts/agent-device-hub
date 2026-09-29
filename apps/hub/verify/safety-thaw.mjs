// A frozen unit cannot be stopped by its one-shot lease. Every thaw therefore
// checks the run's current lease, including a lease changed outside compose.
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const SYSTEMCTL = existsSync('/usr/bin/systemctl') ? '/usr/bin/systemctl' : '/bin/systemctl';
/** @param {string[]} args */
const control = async args => (await exec(SYSTEMCTL, ['--user', ...args], {timeout: 10000})).stdout;
/** @typedef {(args: string[]) => Promise<string>} Control */
/** @param {string} runId */
function names(runId) {
  if (!/^[a-z][a-z0-9-]{0,15}-\d{8}T\d{6}Z-[0-9a-f]{6}$/.test(runId)) throw new Error('invalid owned run id');
  return {unit: `app-verify-${runId}.service`, lease: `app-verify-${runId}-lease`};
}
/** @param {string} text */
const properties = text => Object.fromEntries(text.trim().split('\n').filter(Boolean).map(line => {
  const at = line.indexOf('=');
  return [line.slice(0, at), line.slice(at + 1)];
}));

/**
 * Read the live receipt and its exact timer. Missing or conflicting evidence
 * never counts as a future lease. The composition's cached expiry is not used.
 * @param {string} runId @param {string} receiptPath @param {Control} [ctl]
 */
export async function currentLease(runId, receiptPath, ctl = control) {
  const {unit, lease} = names(runId);
  try {
    if (!isAbsolute(receiptPath)) throw new Error('receipt path must be absolute');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const timer = receipt.owned?.leaseTimer;
    const suffix = typeof timer === 'string' && timer.startsWith(lease) ? timer.slice(lease.length) : '';
    if (receipt.runId !== runId || receipt.owned?.unit !== unit || !/^(?:-[2-9]\d*|-1\d+)?\.timer$/.test(suffix)) throw new Error('receipt ownership mismatch');
    const expiresAt = receipt.preview?.expiresAt;
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry)) throw new Error('receipt expiry missing');
    const state = properties(await ctl(['show', timer, '--timestamp=unix', '-p', 'LoadState', '-p', 'ActiveState', '-p', 'NextElapseUSecRealtime']));
    const valid = state.LoadState === 'loaded' && state.ActiveState === 'active'
      && state.NextElapseUSecRealtime === `@${expiry / 1000}` && expiry > Date.now();
    return {valid, expiresAt, expiry};
  } catch {
    return {valid: false, expiresAt: null, expiry: NaN};
  }
}

/**
 * Thaw before checking: a lease firing after this point can stop the unit.
 * If it already fired while frozen, stop the exact owned unit ourselves.
 * @param {string} runId @param {string} receiptPath @param {Control} [ctl]
 */
export async function thawWithLease(runId, receiptPath, ctl = control) {
  const {unit} = names(runId);
  await ctl(['thaw', unit]).catch(() => undefined);
  const lease = await currentLease(runId, receiptPath, ctl);
  if (!lease.valid) await ctl(['stop', unit]).catch(() => undefined);
  const state = properties(await ctl(['show', unit, '-p', 'LoadState', '-p', 'ActiveState', '-p', 'FreezerState']));
  const stopped = state.LoadState === 'not-found' || ['inactive', 'failed'].includes(state.ActiveState ?? '');
  const running = state.ActiveState === 'active' && state.FreezerState === 'running';
  if (lease.valid ? !running && !stopped : !stopped) throw new Error('owned unit did not reach a safe state after thaw');
  return {leaseValid: lease.valid && running, stopped, freezerState: state.FreezerState};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await thawWithLease(process.argv[2] ?? '', process.argv[3] ?? '');
  } catch (error) {
    const known = ['invalid owned run id', 'owned unit did not reach a safe state after thaw'];
    const detail = error instanceof Error && known.includes(error.message) ? error.message : 'systemd query failed';
    process.stderr.write(`app-verify safety thaw failed: ${detail}\n`);
    process.exitCode = 1;
  }
}
