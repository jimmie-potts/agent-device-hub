// handoff: freeze the verified set, optionally reseed, print the preview card.
import {existsSync} from 'node:fs';
import {chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {card} from './card.js';
import {EXIT, Failure, load, reseed, sums, type Io} from './lifecycle.js';
import * as systemd from './systemd.js';
import type {AppPlugin, Receipt} from './types.js';
import {hex256, iso} from './util.js';

export const IN_PROGRESS = '.in-progress';

/** Captures whose process still runs. Markers of dead processes are removed; their receipts already say `failed`. */
export async function capturesInProgress(proofDir: string): Promise<string[]> {
  const running: string[] = [];
  for (const parent of [proofDir, join(proofDir, 'after-handoff')]) {
    if (!existsSync(parent)) continue;
    for (const entry of await readdir(parent)) {
      const marker = join(parent, entry, IN_PROGRESS);
      if (!/^capture-\d+$/.test(entry) || !existsSync(marker)) continue;
      const pid = Number((await readFile(marker, 'utf8')).trim());
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = pid > 0;
      } catch {
        alive = false;
      }
      if (alive) running.push(entry);
      else await rm(marker, {force: true});
    }
  }
  return running;
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
  if (reset !== undefined && !plugin.scenarios[reset]) throw new Failure('unknown-scenario', `the fixtures define no scenario ${reset}`);
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
  const busy = await capturesInProgress(run.store.dir);
  if (busy.length) throw new Failure('capture-in-progress', `wait for ${busy.join(', ')} to finish before handoff`);
  const verified = join(run.store.dir, 'verified');
  let manifest = '';
  receipt = await run.store.update(async current => {
    await mkdir(verified);
    for (const entry of (await readdir(run.store.dir)).filter(e => /^capture-\d+$/.test(e))) await rename(join(run.store.dir, entry), join(verified, entry));
    const moved = (path: string | null) => (path === null ? null : `verified/${path}`);
    current.captures = current.captures.map(c => (c.set === 'verified' && !c.log.startsWith('verified/') ? {...c, screenshot: moved(c.screenshot), video: moved(c.video), log: moved(c.log)!} : c));
    const frozenAt = iso();
    current.proof.frozenAt = frozenAt;
    // The copy of this moment's receipt already names the captures' verified/ locations.
    await writeFile(join(verified, 'receipt.json'), JSON.stringify(current satisfies Receipt, null, 2) + '\n');
    const found = await sums(verified);
    manifest = [...found].map(([path, sum]) => `${sum}  ${path}\n`).join('');
    await writeFile(join(verified, 'SHA256SUMS'), manifest);
    await readOnly(verified);
  });
  await run.store.event('frozen', {frozenAt: receipt.proof.frozenAt, files: manifest.split('\n').filter(Boolean).length, manifest: 'sha256:' + hex256(manifest)});
  io.progress(`${run.runId}: verified set frozen in ${verified}`);
  if (reset !== undefined) {
    const reseeded = await reseed(run, io, receipt, reset);
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
