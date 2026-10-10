// Repository-operated evidence helper. It never controls a service or a device.
import {randomUUID} from 'node:crypto';
import {lstat, open, rename, rm} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {validateInstallReceipt} from '@jimmie-potts/device-contracts';
import {canonical, sha256} from '../../hub/dist/install/files.js';
import {createUpgradeSourceAdapter, verifyRuntimeUpgradeRelease} from './runtime-upgrade-source.mjs';
import {checkStateDirectory, readPrivateFile} from '../dist/src/state.js';
import {requireUpgradeLock} from '../dist/src/upgrade-lock.js';
import {runtimeUpgradePreflight, runtimeUpgradeRunningCheck} from './runtime-upgrade-preflight.mjs';

const maximum = 256 * 1024;
const missing = error => error instanceof Error && error.code === 'ENOENT';
// Only a validated, consistency-checked receipt can become a private failure
// diagnostic. Never include unvalidated documents or filesystem error text.
let receiptAttempt;

const closed = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && canonical(Object.keys(value).sort()) === canonical([...keys].sort());
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const controls = value => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const inside = (root, path) => {
  if (typeof path !== 'string' || path.length > 4096 || !isAbsolute(path) || resolve(path) !== path || controls(path)) return false;
  const name = relative(root, path);
  return name !== '' && !isAbsolute(name) && name !== '..' && !name.startsWith('../');
};

/** The coordinator inspects evidence and accepts its meaning. This only binds
 * that explicit private decision, retains prior bytes and checks persistence. */
async function inspectedResolution(file, directory, previousBytes, previous, finalBytes, receipt) {
  const refuse = () => { throw new Error('runtime-receipt-resolution-refused'); };
  const installationRoot = dirname(directory);
  if (directory !== join(installationRoot, 'receipts')) refuse();
  await requireUpgradeLock(installationRoot);
  const provenance = await checkStateDirectory(join(installationRoot, 'provenance'));
  if (!inside(provenance, file) || !['in-progress', 'interrupted', 'rollback-failed', 'receipt-finalization-failed'].includes(previous.outcome)
    || !['succeeded', 'refused', 'failed-before-switch', 'failed-rolled-back'].includes(receipt.outcome)) refuse();
  const resolutionBytes = await readPrivateFile(file, maximum);
  const resolution = JSON.parse(resolutionBytes.toString('utf8'));
  if (!closed(resolution, ['schema','installationId','operationId','receiptSha256','finalReceiptSha256','plan','running','latestState','coordinator'])
    || resolution.schema !== 'runtime-receipt-resolution/1.0' || resolution.installationId !== receipt.installationId
    || resolution.operationId !== receipt.operationId || resolution.receiptSha256 !== sha256(previousBytes)
    || resolution.finalReceiptSha256 !== sha256(finalBytes)
    || !closed(resolution.coordinator, ['name', 'authority']) || typeof resolution.coordinator.name !== 'string'
    || resolution.coordinator.name.length < 1 || resolution.coordinator.name.length > 128
    || controls(resolution.coordinator.name)) refuse();
  const pins = [resolution.plan, resolution.running, resolution.latestState, resolution.coordinator.authority];
  const retainedPins = [];
  for (const pin of pins) {
    if (!closed(pin, ['path','sha256']) || !inside(provenance, pin.path) || !hash(pin.sha256)) refuse();
    await checkStateDirectory(dirname(pin.path));
    const bytes = await readPrivateFile(pin.path, 8 * 1024 * 1024);
    if (sha256(bytes) !== pin.sha256) refuse();
    retainedPins.push({pin, bytes});
  }
  const plan = JSON.parse(retainedPins[0].bytes.toString('utf8'));
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) refuse();
  const {planSha256, ...body} = plan;
  if (!hash(planSha256) || sha256(canonical(body)) !== planSha256 || previous.approval === null
    || previous.approval.planSha256 !== planSha256 || plan.schema !== 'runtime-upgrade-plan/1.0'
    || plan.eligibility !== 'eligible-under-coordinator-admission' || plan.installationId !== receipt.installationId
    || plan.execution?.operationId !== receipt.operationId) refuse();
  const retained = join(provenance, 'unresolved-' + receipt.operationId + '-' + resolution.receiptSha256 + '.json');
  let saved;
  let retainedInfo;
  try { retainedInfo = await lstat(retained); } catch (error) { if (!missing(error)) throw error; }
  if (retainedInfo !== undefined) saved = await readPrivateFile(retained, maximum);
  if (saved !== undefined && !saved.equals(previousBytes)) refuse();
  const handle = await open(retained, saved === undefined ? 'wx' : 'r', 0o600);
  try { if (saved === undefined) await handle.writeFile(previousBytes); await handle.sync(); }
  finally { await handle.close(); }
  const parent = await open(provenance, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
  const recheck = async () => {
    if (!(await readPrivateFile(retained, maximum)).equals(previousBytes)
      || !(await readPrivateFile(file, maximum)).equals(resolutionBytes)) refuse();
    for (const {pin, bytes} of retainedPins) {
      if (!(await readPrivateFile(pin.path, 8 * 1024 * 1024)).equals(bytes)) refuse();
    }
    await requireUpgradeLock(installationRoot);
  };
  await recheck();
  return {previousBytes, recheck};
}

async function writeReceipt(input, directory, resolutionFile) {
  // Validation precedes every write. Host acceptance is established by the
  // owning procedure; this helper verifies document consistency and persistence.
  const inputBytes = await readPrivateFile(input, maximum);
  const receipt = JSON.parse(inputBytes.toString('utf8'));
  if (!validateInstallReceipt(receipt)) throw new Error('invalid-install-receipt');
  const root = await checkStateDirectory(directory);
  const rootInfo = await lstat(root);
  const destination = join(root, receipt.operationId + '.json');
  const bytes = canonical(receipt) + '\n';
  if (Buffer.byteLength(bytes) > maximum) throw new Error('invalid-install-receipt');
  let resolution;
  try {
    const info = await lstat(destination);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
      throw new Error('unsafe-install-file');
    }
    const previousBytes = await readPrivateFile(destination, maximum);
    const previous = JSON.parse(previousBytes.toString('utf8'));
    if (!validateInstallReceipt(previous)) throw new Error('invalid-install-receipt');
    if (previous.outcome !== 'in-progress' && resolutionFile === undefined) {
      if (canonical(previous) !== canonical(receipt)) throw new Error('install-receipt-conflict');
      // Re-publish and synchronize even identical terminal bytes. A prior
      // rename may be visible while its directory synchronization failed.
    }
    const immutable = ['schemaVersion','operationId','operation','runtime','installationId','startedAt','requestedTarget','previous','target','approval','compatibility'];
    if (immutable.some(key => canonical(previous[key]) !== canonical(receipt[key])) || receipt.updatedAt < previous.updatedAt) {
      throw new Error('install-receipt-conflict');
    }
    if (resolutionFile !== undefined) resolution = await inspectedResolution(resolutionFile, root, previousBytes, previous, inputBytes, receipt);
  } catch (error) {
    if (!missing(error)) throw error;
  }
  if (resolutionFile !== undefined && resolution === undefined) throw new Error('runtime-receipt-resolution-refused');
  receiptAttempt = receipt;
  const temporary = join(root, '.receipt-next-' + randomUUID());
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(bytes);
    await file.sync();
    await file.close();
    file = undefined;
    // Recheck the same private directory before the atomic publication.
    await checkStateDirectory(root);
    const current = await lstat(root);
    if (current.dev !== rootInfo.dev || current.ino !== rootInfo.ino) throw new Error('unsafe-install-file');
    if (resolution !== undefined) {
      await resolution.recheck();
      if (!(await readPrivateFile(destination, maximum)).equals(resolution.previousBytes)
        || !(await readPrivateFile(input, maximum)).equals(inputBytes)) throw new Error('runtime-receipt-resolution-refused');
    }
    await rename(temporary, destination);
    const parent = await open(root, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
    const saved = JSON.parse((await readPrivateFile(destination, maximum)).toString('utf8'));
    if (!validateInstallReceipt(saved) || canonical(saved) !== canonical(receipt)) throw new Error('install-receipt-readback');
    return receipt;
  } finally {
    await file?.close();
    await rm(temporary, {force: true});
  }
}

let failureCode = 'receipt-finalization-failed';
try {
  const [command, input, directory, ...rest] = process.argv.slice(2);
  if (!input) throw new Error('invalid-install-request');
  if (command === 'plan' && directory === undefined && rest.length === 0) {
    failureCode = 'runtime-upgrade-preflight-refused';
    const plan = await runtimeUpgradePreflight(input);
    // Private procedure output, redirected by the operator under umask 077.
    process.stdout.write(canonical(plan) + '\n');
  } else if (command === 'recheck' && directory && rest.length === 0) {
    failureCode = 'runtime-upgrade-preflight-refused';
    const plan = await runtimeUpgradePreflight(input, directory);
    process.stdout.write(JSON.stringify({verified: true, planSha256: plan.planSha256, operation: plan.operation}) + '\n');
  } else if (command === 'verify-running' && directory && rest.length === 1) {
    failureCode = 'runtime-upgrade-running-refused';
    const observation = await runtimeUpgradeRunningCheck(input, directory, rest[0]);
    process.stdout.write(canonical(observation) + '\n');
  } else if (command === 'check-lock' && directory === undefined && rest.length === 0) {
    failureCode = 'runtime-upgrade-lock-refused';
    await requireUpgradeLock(input);
    process.stdout.write(JSON.stringify({lockIdentityVerified: true}) + '\n');
  } else if (command === 'verify-release' && directory && rest.length === 1) {
    failureCode = 'release-verification-failed';
    const release = await verifyRuntimeUpgradeRelease(input, directory, rest[0]);
    process.stdout.write(JSON.stringify({sourceRevision: release.identity.sourceRevision, verified: true, entries: release.entries.length}) + '\n');
  } else if (command === 'verify-formats' && directory === undefined && rest.length === 0) {
    failureCode = 'runtime-upgrade-source-refused';
    const request = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await readPrivateFile(input, maximum)));
    const source = await createUpgradeSourceAdapter(verifyRuntimeUpgradeRelease)(request);
    process.stdout.write(JSON.stringify({verified: true, scope: source.expected.formats.scope, inputs: source.inputs.length,
      ...(source.classification === 'changed-requires-admission' ? {classification: source.classification, compatibility: 'not-established'} : {})}) + '\n');
  } else if (command === 'receipt' && directory && rest.length === 0) {
    const receipt = await writeReceipt(input, directory);
    process.stdout.write(JSON.stringify({schemaVersion: receipt.schemaVersion, operationId: receipt.operationId, outcome: receipt.outcome, persisted: true}) + '\n');
  } else if (command === 'resolve-receipt' && directory && rest.length === 1) {
    failureCode = 'runtime-receipt-resolution-refused';
    const receipt = await writeReceipt(input, join(directory, 'receipts'), rest[0]);
    process.stdout.write(JSON.stringify({schemaVersion: receipt.schemaVersion, operationId: receipt.operationId, outcome: receipt.outcome, persisted: true}) + '\n');
  } else throw new Error('invalid-install-request');
} catch (error) {
  // Private receipt diagnostics are explicitly redirected by the procedure.
  // Other failures expose only fixed codes, never raw documents or errors.
  const codes = new Set(['invalid-install-request','invalid-install-receipt','unsafe-install-file','install-receipt-conflict','install-receipt-readback',
    'install-source-identity','install-manifest-hash','install-file-inventory','install-archive-hash','unsafe-install-root','unsafe-install-link','unsafe-install-entry','install-inventory-capacity','install-file-changed']);
  const code = error instanceof Error && codes.has(error.message) ? error.message : failureCode;
  const diagnostic = receiptAttempt === undefined ? undefined : {...receiptAttempt, completedAt: null,
    outcome: 'receipt-finalization-failed',
    failure: {phase: 'receipt-finalization', code: 'write-failed', evidence: 'stderr-receipt'}};
  if (diagnostic !== undefined && validateInstallReceipt(diagnostic)) {
    process.stderr.write(canonical(diagnostic) + '\n');
  } else process.stderr.write(JSON.stringify({code, verified: false}) + '\n');
  process.exitCode = 1;
}
