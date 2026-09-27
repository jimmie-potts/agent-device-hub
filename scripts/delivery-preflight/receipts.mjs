// Local proof readers. Both only read files and report identities: run ids,
// revisions and digests, never the local path, receipt roots or file contents.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { LocalReadFailure, redactPaths, short } from './context.mjs';

export const RECEIPT_VERSION = 'app-verification/1';
export const GUIDE_HTML_PATH = 'docs/work-guide/outputs/agent-device-work-guides.html';

const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Run file reads so that any filesystem error becomes a LocalReadFailure with only its code. */
function guarded(label, fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof LocalReadFailure) throw error;
    if (error && typeof error.code === 'string') throw new LocalReadFailure(label, error.code === 'ENOENT' ? 'not found' : error.code);
    throw error;
  }
}

/** A receipt-supplied reason, shortened and without absolute paths. */
function tidy(reason) {
  return redactPaths(reason).slice(0, 80);
}

/** Name a local file without disclosing where it lives. */
export function describeLocal(file) {
  const parts = path.resolve(file).split(path.sep).filter(Boolean);
  return parts.slice(-2).join('/');
}

function readJson(file, label) {
  const text = guarded(label, () => fs.readFileSync(file, 'utf8'));
  try {
    return JSON.parse(text);
  } catch {
    throw new LocalReadFailure(label, 'not valid JSON');
  }
}

function listFiles(directory, prefix = '') {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listFiles(path.join(directory, entry.name), relative);
    return [relative];
  });
}

/**
 * Read one app-verification/1 proof directory (or its receipt.json) as proof
 * for a candidate head. Returns {evidence, reasons}; throws LocalReadFailure
 * when the receipt cannot be read at all.
 */
export function readAppReceipt(location, { repository, head }) {
  const proofDir = path.basename(location) === 'receipt.json' ? path.dirname(location) : location;
  const label = `receipt ${describeLocal(path.join(proofDir, 'receipt.json'))}`;
  return guarded(label, () => checkAppReceipt(proofDir, label, { repository, head }));
}

function checkAppReceipt(proofDir, label, { repository, head }) {
  const receipt = readJson(path.join(proofDir, 'receipt.json'), label);
  const reasons = [];
  const runId = typeof receipt.runId === 'string' ? receipt.runId : null;
  const name = runId || describeLocal(proofDir);
  if (receipt.receiptVersion !== RECEIPT_VERSION) reasons.push(`${name}: receiptVersion ${receipt.receiptVersion} is not ${RECEIPT_VERSION}`);
  if (receipt.repository !== repository) reasons.push(`${name}: repository ${receipt.repository} is not ${repository}`);
  const build = receipt.build || {};
  if (build.sourceRevision !== head) {
    const built = /^[0-9a-f]{40}$/.test(String(build.sourceRevision)) ? short(build.sourceRevision) : tidy(String(build.sourceRevision));
    reasons.push(`${name}: built from ${built}, not the candidate ${short(head)}`);
  }
  if (build.dirty !== false) reasons.push(`${name}: the build was dirty or its state is unknown; proof must come from a clean run`);
  if (receipt.state === 'failed') {
    const cause = receipt.failure && receipt.failure.cause ? tidy(receipt.failure.cause) : 'no cause recorded';
    reasons.push(`${name}: the run failed: ${cause}`);
  }
  for (const check of Array.isArray(receipt.checks) ? receipt.checks : []) {
    if (check.outcome === 'failed') reasons.push(`${name}: check ${tidy(check.id)} failed${check.reason ? ` (${tidy(check.reason)})` : ''}`);
  }
  const captures = Array.isArray(receipt.captures) ? receipt.captures : [];
  const verified = captures.filter(capture => capture.set === 'verified');
  if (!verified.length) reasons.push(`${name}: no verified capture`);
  for (const capture of verified) {
    if (capture.outcome !== 'passed') {
      reasons.push(`${name}: capture ${capture.n} ${tidy(capture.step)}: ${capture.outcome}${capture.reason ? ` (${tidy(capture.reason)})` : ''}`);
    }
  }

  let sums = null;
  let verifiedFiles = 0;
  if (!receipt.proof || !receipt.proof.frozenAt) {
    reasons.push(`${name}: the verified set is not frozen (no handoff)`);
  } else {
    const verifiedDir = path.join(proofDir, 'verified');
    let manifest;
    try {
      manifest = fs.readFileSync(path.join(verifiedDir, 'SHA256SUMS'));
    } catch {
      manifest = null;
      reasons.push(`${name}: verified/SHA256SUMS is missing`);
    }
    if (manifest) {
      sums = `sha256:${sha256(manifest)}`;
      const listed = new Map();
      for (const line of manifest.toString('utf8').split('\n').filter(Boolean)) {
        const match = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
        if (!match || match[2].startsWith('/') || match[2].split('/').includes('..')) {
          reasons.push(`${name}: unreadable SHA256SUMS line`);
          continue;
        }
        listed.set(match[2], match[1]);
      }
      const present = listFiles(verifiedDir).filter(file => file !== 'SHA256SUMS');
      verifiedFiles = present.length;
      for (const file of present) {
        if (!listed.has(file)) reasons.push(`${name}: verified/${file} is not in SHA256SUMS`);
        else if (listed.get(file) !== sha256(fs.readFileSync(path.join(verifiedDir, file)))) reasons.push(`${name}: SHA256SUMS mismatch: ${file}`);
      }
      for (const file of listed.keys()) {
        if (!present.includes(file)) reasons.push(`${name}: SHA256SUMS lists missing verified/${file}`);
      }
      if (listed.has('receipt.json')) {
        const frozen = readJson(path.join(verifiedDir, 'receipt.json'), `${label} (verified copy)`);
        if (frozen.runId !== runId || (frozen.build || {}).sourceRevision !== build.sourceRevision) {
          reasons.push(`${name}: the verified receipt names another run or revision`);
        }
      } else {
        reasons.push(`${name}: the verified set has no receipt copy`);
      }
    }
  }
  const components = Array.isArray(receipt.components) ? receipt.components : [];
  return {
    reasons,
    evidence: {
      runId,
      app: receipt.app ?? null,
      state: receipt.state ?? null,
      sourceRevision: build.sourceRevision ?? null,
      dirty: build.dirty ?? null,
      artifactDigest: build.artifactDigest ?? null,
      frozenAt: receipt.proof ? receipt.proof.frozenAt ?? null : null,
      sha256sums: sums,
      verifiedFiles,
      captures: verified.map(capture => ({ n: capture.n, step: capture.step, outcome: capture.outcome })),
      simulated: components.filter(component => component.kind === 'simulated').map(component => component.id),
      failure: receipt.failure && receipt.failure.cause ? { cause: receipt.failure.cause, at: receipt.failure.at ?? null } : null,
    },
  };
}

/**
 * Read the guide browser check's receipt (docs/work-guide/work/check_guide.cjs)
 * and confirm its retained screenshots and print check sit beside it.
 */
export function readGuideReceipt(file) {
  const label = `guide receipt ${describeLocal(file)}`;
  return guarded(label, () => checkGuideReceipt(file, label));
}

function checkGuideReceipt(file, label) {
  const receipt = readJson(file, label);
  const reasons = [];
  if (!/^[0-9a-f]{64}$/.test(String(receipt.htmlSha256))) reasons.push('the guide receipt has no HTML hash');
  for (const [key, value] of Object.entries(receipt)) {
    if (typeof value === 'string' && ['failed', 'skipped', 'unavailable', 'pending'].includes(value)) reasons.push(`guide check ${key}: ${value}`);
  }
  for (const key of ['errors', 'consoleErrors']) {
    if (!Array.isArray(receipt[key])) reasons.push(`the guide receipt has no ${key} list`);
    else if (receipt[key].length) reasons.push(`the guide receipt records ${receipt[key].length} ${key}`);
  }
  const passed = Object.values(receipt).filter(value => value === 'passed').length;
  if (!passed) reasons.push('the guide receipt records no passed check');
  const siblings = fs.readdirSync(path.dirname(file));
  const screenshots = siblings.filter(name => /^guide-.*\.png$/.test(name)).length;
  const printCheck = siblings.includes('guide-print-check.pdf');
  if (!screenshots || !printCheck) {
    const missing = [!screenshots && 'screenshots', !printCheck && 'print check'].filter(Boolean).join(' and ');
    reasons.push(`the retained guide ${missing} are missing beside the receipt (screenshots and print check)`);
  }
  return {
    reasons,
    evidence: { htmlSha256: receipt.htmlSha256 ?? null, checkedAt: receipt.checkedAt ?? null, passedChecks: passed, screenshots, printCheck },
  };
}
