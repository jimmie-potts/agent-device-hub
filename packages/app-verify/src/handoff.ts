// handoff: freeze the verified set, optionally reseed, print the preview card.
import {existsSync} from 'node:fs';
import {chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {card} from './card.js';
import {EXIT, Failure, has, load, reseed, reseedInputs, sums, type Io} from './lifecycle.js';
import {validateReceipt} from './receipt.js';
import * as systemd from './systemd.js';
import type {AppPlugin, Receipt} from './types.js';
import {hex256, holder, holderAlive, iso} from './util.js';

export const IN_PROGRESS = '.in-progress';

/** The marker a running capture writes: its PID and start time, so a reused PID never looks live. */
export const marker = holder;

/** Captures whose process still runs. Markers of dead processes are removed; their receipts already say `failed`. */
export async function capturesInProgress(proofDir: string): Promise<string[]> {
  const running: string[] = [];
  for (const parent of [proofDir, join(proofDir, 'after-handoff')]) {
    if (!existsSync(parent)) continue;
    for (const entry of await readdir(parent)) {
      const path = join(parent, entry, IN_PROGRESS);
      if (!/^capture-\d+$/.test(entry) || !existsSync(path)) continue;
      if (await holderAlive(await readFile(path, 'utf8'))) running.push(entry);
      else await rm(path, {force: true});
    }
  }
  return running;
}

/** The frozen set is built here and renamed to `verified/` only once `SHA256SUMS` is written. */
export const PARTIAL = 'verified.partial';

async function writableTree(path: string): Promise<void> {
  const info = await stat(path);
  if (info.isDirectory()) {
    await chmod(path, 0o755);
    for (const entry of await readdir(path)) await writableTree(join(path, entry));
  } else await chmod(path, 0o644);
}

/** The latest `frozen` event of a run: the manifest digest and time recorded just before its set was renamed. */
export async function latestFrozen(proofDir: string): Promise<{manifest: string; frozenAt: string} | undefined> {
  const text = await readFile(join(proofDir, 'events.jsonl'), 'utf8').catch(() => '');
  let found: {manifest: string; frozenAt: string} | undefined;
  for (const line of text.split('\n')) {
    try {
      const event = JSON.parse(line) as {event?: string; manifest?: unknown; frozenAt?: unknown};
      if (event.event === 'frozen' && typeof event.manifest === 'string' && typeof event.frozenAt === 'string') found = {manifest: event.manifest, frozenAt: event.frozenAt};
    } catch {
      // A torn line is not evidence either way.
    }
  }
  return found;
}

const unprefixed = (path: string | null) => (path === null ? null : path.replace(/^verified\//, ''));

/**
 * Judge a `verified/` that no receipt has committed. `commit`: it is exactly
 * the set this run froze (its manifest digest and time match the `frozen`
 * event written before the rename, its files match the manifest, and its
 * receipt copy is this run's with records equal to the live ones) and nothing
 * was captured since. `rebuild`: the same, but a later capture of this run
 * exists outside it. `conflict`: anything else.
 */
export async function uncommitted(proofDir: string, live: Receipt): Promise<{kind: 'commit'; copy: Receipt; manifest: string; digest: string} | {kind: 'rebuild'} | {kind: 'conflict'; reason: string}> {
  const verified = join(proofDir, 'verified');
  const conflict = (reason: string) => ({kind: 'conflict' as const, reason});
  if (!existsSync(join(verified, 'SHA256SUMS'))) return conflict('verified/ exists without SHA256SUMS');
  const manifest = await readFile(join(verified, 'SHA256SUMS'), 'utf8');
  const digest = 'sha256:' + hex256(manifest);
  const event = await latestFrozen(proofDir);
  if (!event || event.manifest !== digest) return conflict('verified/ does not match the manifest digest this run recorded before its rename');
  let found: Map<string, string>;
  try {
    found = await sums(verified);
  } catch {
    return conflict('verified/ holds a non-regular entry');
  }
  if ([...found].map(([path, sum]) => `${sum}  ${path}\n`).join('') !== manifest) return conflict('verified/ no longer matches its SHA256SUMS');
  let copy: Receipt;
  try {
    copy = JSON.parse(await readFile(join(verified, 'receipt.json'), 'utf8')) as Receipt;
  } catch {
    return conflict('verified/receipt.json is unreadable');
  }
  if (!validateReceipt(copy).ok || copy.runId !== live.runId || copy.startedAt !== live.startedAt || copy.proof.frozenAt !== event.frozenAt) return conflict('verified/receipt.json is not this run\'s freeze');
  const frozen = copy.captures.filter(c => c.set === 'verified');
  for (const record of frozen) {
    const current = live.captures.find(c => c.n === record.n);
    const expected = {...record, screenshot: unprefixed(record.screenshot), video: unprefixed(record.video), log: unprefixed(record.log)!, ...(record.attachments ? {attachments: record.attachments.map(a => unprefixed(a)!)} : {})};
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) return conflict(`capture ${record.n} differs from the live receipt`);
  }
  const covered = new Set(frozen.map(c => c.n));
  const later = live.captures.some(c => c.set === 'verified' && !covered.has(c.n)) || (await readdir(proofDir)).some(e => /^capture-\d+$/.test(e));
  return later ? {kind: 'rebuild'} : {kind: 'commit', copy, manifest, digest};
}

/**
 * Proof recovery when a never-frozen run stops, after its units are gone:
 * commit a set that `uncommitted` says is this run's own and complete, return
 * any other captures to the proof directory, or report a conflict and leave
 * the files for inspection. It changes only `current` and those files.
 */
export async function recoverOnStop(proofDir: string, current: Receipt): Promise<{proof: 'none' | 'committed' | 'unwound' | 'conflict'; reason?: string; digest?: string}> {
  if (current.proof.frozenAt) return {proof: 'none'};
  let proof: 'none' | 'committed' | 'unwound' = 'none', digest: string | undefined;
  try {
    if (existsSync(join(proofDir, 'verified'))) {
      const verdict = await uncommitted(proofDir, current);
      if (verdict.kind === 'conflict') return {proof: 'conflict', reason: verdict.reason};
      if (verdict.kind === 'commit') {
        const frozen = new Map(verdict.copy.captures.filter(c => c.set === 'verified').map(c => [c.n, c]));
        current.captures = current.captures.map(c => frozen.get(c.n) ?? c);
        current.proof.frozenAt = verdict.copy.proof.frozenAt;
        proof = 'committed';
        digest = verdict.digest;
      } else {
        await unwind(proofDir, 'verified');
        proof = 'unwound';
      }
    }
    if (existsSync(join(proofDir, PARTIAL))) {
      await unwind(proofDir, PARTIAL);
      if (proof === 'none') proof = 'unwound';
    }
  } catch (error) {
    if (error instanceof Failure && error.code === 'proof-conflict') return {proof: 'conflict', reason: error.detail};
    throw error;
  }
  return {proof, ...(digest ? {digest} : {})};
}

/**
 * Put back a freeze that was interrupted before its set was complete: its
 * captures return to the proof directory and the partial set is removed.
 */
async function unwind(proofDir: string, name: string): Promise<void> {
  const partial = join(proofDir, name);
  if (!existsSync(partial)) return;
  await writableTree(partial);
  for (const entry of (await readdir(partial)).filter(e => /^capture-\d+$/.test(e))) {
    if (existsSync(join(proofDir, entry))) throw new Failure('proof-conflict', `${entry} exists both in ${name}/ and the proof directory; move one aside`);
    await rename(join(partial, entry), join(proofDir, entry));
  }
  await rm(partial, {recursive: true, force: true});
}

async function readOnly(path: string): Promise<void> {
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const entry of await readdir(path)) await readOnly(join(path, entry));
    await chmod(path, 0o555);
  } else await chmod(path, 0o444);
}

export async function handoff(plugin: AppPlugin, io: Io, runId: string | undefined, reset: string | undefined) {
  const run = await load(plugin, io, runId);
  if (reset !== undefined && !has(plugin.scenarios, reset)) throw new Failure('unknown-scenario', `the fixtures define no scenario ${reset}`);
  if (!run.store.exists()) throw new Failure('unknown-run', `no receipt for ${run.runId}`);
  let receipt = await run.store.read();
  const unit = await systemd.unitState(run.unit);
  if (receipt.state !== 'running' || !unit?.loaded || unit.active !== 'active') throw new Failure('run-not-running', `${run.runId} is not serving a preview`);
  if (receipt.proof.frozenAt) {
    // A second handoff only prints the card again; it never rewrites the frozen set.
    if (reset !== undefined) throw new Failure('already-frozen', `the verified set was frozen at ${receipt.proof.frozenAt}; use the scenario operation to reseed`);
    const lines = card(receipt, plugin.command);
    for (const line of lines) io.progress(line);
    return {code: EXIT.ok, value: {operation: 'handoff', runId: run.runId, frozenAt: receipt.proof.frozenAt, verified: join(run.store.dir, 'verified'), url: receipt.preview?.url, expiresAt: receipt.preview?.expiresAt, card: lines}};
  }
  // Checked before the freeze: a plug-in that no longer accepts a recorded input is a usage error that changes nothing.
  const inputs = reset !== undefined ? reseedInputs(plugin, receipt, reset) : undefined;
  const verified = join(run.store.dir, 'verified'), partial = join(run.store.dir, PARTIAL);
  let manifest = '', committed: string | undefined;
  receipt = await run.store.update(async current => {
    // Checked under the receipt lock that a capture's write-ahead also takes, so no capture starts in between.
    const busy = await capturesInProgress(run.store.dir);
    if (busy.length) throw new Failure('capture-in-progress', `wait for ${busy.join(', ')} to finish before handoff`);
    if (existsSync(verified)) {
      // A handoff killed after its rename but before this receipt was written. Commit that set only if it is
      // provably this run's own, unchanged freeze; otherwise refuse and leave every file for inspection.
      const verdict = await uncommitted(run.store.dir, current);
      if (verdict.kind === 'conflict') throw new Failure('proof-conflict', verdict.reason);
      if (verdict.kind === 'commit') {
        const frozen = new Map(verdict.copy.captures.filter(c => c.set === 'verified').map(c => [c.n, c]));
        current.captures = current.captures.map(c => frozen.get(c.n) ?? c);
        current.proof.frozenAt = verdict.copy.proof.frozenAt;
        manifest = verdict.manifest;
        committed = verdict.digest;
        return;
      }
      // This run's own set, but a capture was taken after it: put it back and rebuild so the capture is included.
      await unwind(run.store.dir, 'verified');
    }
    // A freeze interrupted before its set was complete starts over.
    await unwind(run.store.dir, PARTIAL);
    const captures = (await readdir(run.store.dir)).filter(e => /^capture-\d+$/.test(e));
    // Refuse before moving anything if a capture holds a link or other non-regular entry.
    for (const entry of captures) await sums(join(run.store.dir, entry));
    await mkdir(partial);
    for (const entry of captures) await rename(join(run.store.dir, entry), join(partial, entry));
    const moved = (path: string | null) => (path === null ? null : `verified/${path}`);
    current.captures = current.captures.map(c => (c.set === 'verified' && !c.log.startsWith('verified/')
      ? {...c, screenshot: moved(c.screenshot), video: moved(c.video), log: moved(c.log)!, ...(c.attachments ? {attachments: c.attachments.map(a => moved(a)!)} : {})}
      : c));
    current.proof.frozenAt = iso();
    // The copy of this moment's receipt already names the captures' verified/ locations.
    await writeFile(join(partial, 'receipt.json'), JSON.stringify(current satisfies Receipt, null, 2) + '\n');
    const found = await sums(partial);
    manifest = [...found].map(([path, sum]) => `${sum}  ${path}\n`).join('');
    await writeFile(join(partial, 'SHA256SUMS'), manifest);
    await readOnly(partial);
    await run.store.event('frozen', {frozenAt: current.proof.frozenAt, files: manifest.split('\n').filter(Boolean).length, manifest: 'sha256:' + hex256(manifest)});
    // Only a complete, summed set ever becomes verified/.
    await rename(partial, verified);
  });
  // Not a second authoritative freeze: doctor keeps checking against the digest recorded before the rename.
  if (committed) await run.store.event('frozen-committed', {frozenAt: receipt.proof.frozenAt, manifest: committed});
  io.progress(`${run.runId}: verified set frozen in ${verified}`);
  if (reset !== undefined) {
    const reseeded = await reseed(run, io, receipt, reset, inputs!);
    if (reseeded.code !== EXIT.ok) {
      const {receipt: _unused, ...value} = reseeded.value;
      return {code: reseeded.code, value: {operation: 'handoff', ...value, frozenAt: receipt.proof.frozenAt, verified}};
    }
    receipt = reseeded.value.receipt as Receipt;
  }
  const lines = card(receipt, plugin.command);
  for (const line of lines) io.progress(line);
  return {code: EXIT.ok, value: {operation: 'handoff', runId: run.runId, frozenAt: receipt.proof.frozenAt, verified, scenario: receipt.scenario.name, url: receipt.preview?.url, expiresAt: receipt.preview?.expiresAt, card: lines}};
}
