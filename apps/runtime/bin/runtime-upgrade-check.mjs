// Repository-operated evidence helper. It never controls a service or a device.
import {randomUUID} from 'node:crypto';
import {lstat, open, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {validateInstallReceipt} from '@jimmie-potts/device-contracts';
import {canonical} from '../../hub/dist/install/files.js';
import {createUpgradeSourceAdapter, verifyRuntimeUpgradeRelease} from './runtime-upgrade-source.mjs';
import {checkStateDirectory, readPrivateFile} from '../dist/src/state.js';
import {requireUpgradeLock} from '../dist/src/upgrade-lock.js';
import {runtimeUpgradePreflight} from './runtime-upgrade-preflight.mjs';

const maximum = 256 * 1024;
const missing = error => error instanceof Error && error.code === 'ENOENT';


async function writeReceipt(input, directory) {
  // Validation precedes every write. Host acceptance is established by the
  // owning procedure; this helper verifies document consistency and persistence.
  const receipt = JSON.parse((await readPrivateFile(input, maximum)).toString('utf8'));
  if (!validateInstallReceipt(receipt)) throw new Error('invalid-install-receipt');
  const root = await checkStateDirectory(directory);
  const rootInfo = await lstat(root);
  const destination = join(root, receipt.operationId + '.json');
  const bytes = canonical(receipt) + '\n';
  if (Buffer.byteLength(bytes) > maximum) throw new Error('invalid-install-receipt');
  try {
    const info = await lstat(destination);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
      throw new Error('unsafe-install-file');
    }
    const previous = JSON.parse((await readPrivateFile(destination, maximum)).toString('utf8'));
    if (!validateInstallReceipt(previous)) throw new Error('invalid-install-receipt');
    if (previous.outcome !== 'in-progress') {
      if (canonical(previous) !== canonical(receipt)) throw new Error('install-receipt-conflict');
      return receipt;
    }
    const immutable = ['schemaVersion','operationId','operation','runtime','installationId','startedAt','requestedTarget','previous','target','approval','compatibility'];
    if (immutable.some(key => canonical(previous[key]) !== canonical(receipt[key])) || receipt.updatedAt < previous.updatedAt) {
      throw new Error('install-receipt-conflict');
    }
  } catch (error) {
    if (!missing(error)) throw error;
  }
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
    process.stdout.write(JSON.stringify({verified: true, scope: source.expected.formats.scope, inputs: source.inputs.length}) + '\n');
  } else if (command === 'receipt' && directory && rest.length === 0) {
    const receipt = await writeReceipt(input, directory);
    process.stdout.write(JSON.stringify({schemaVersion: receipt.schemaVersion, operationId: receipt.operationId, outcome: receipt.outcome, persisted: true}) + '\n');
  } else throw new Error('invalid-install-request');
} catch (error) {
  // Never print paths, input documents, exception messages or stack traces.
  const codes = new Set(['invalid-install-request','invalid-install-receipt','unsafe-install-file','install-receipt-conflict','install-receipt-readback',
    'install-source-identity','install-manifest-hash','install-file-inventory','install-archive-hash','unsafe-install-root','unsafe-install-link','unsafe-install-entry','install-inventory-capacity','install-file-changed']);
  const code = error instanceof Error && codes.has(error.message) ? error.message : failureCode;
  process.stderr.write(JSON.stringify({code, verified: false}) + '\n');
  process.exitCode = 1;
}
