// Storage roots and candidate identity.
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import type {AppPlugin} from './types.js';
import {exec, hex256, sha256} from './util.js';

export const DEFAULT_PROOF_LABEL = '<canonical checkout>/.local/evidence/verify';
export const DEFAULT_RUNTIME_LABEL = '~/.local/state/app-verify';

export interface Roots {
  proof: string;
  runtime: string;
  /** How the receipt names them. */
  labels: {proof: string; runtime: string};
}

type Env = Readonly<Record<string, string | undefined>>;

/** The repository's main worktree: `git worktree list` names it first. */
export async function canonicalCheckout(root: string): Promise<string | undefined> {
  const result = await exec('git', ['-C', root, 'worktree', 'list', '--porcelain']);
  if (result.code !== 0) return undefined;
  const first = /^worktree (.+)$/m.exec(result.stdout);
  return first ? first[1] : undefined;
}

/** The Git checkout containing `path` (or its nearest existing ancestor), if any. */
async function checkoutOf(path: string): Promise<string | undefined> {
  let probe = resolve(path);
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const result = await exec('git', ['-C', probe, 'rev-parse', '--show-toplevel']);
  return result.code === 0 ? result.stdout.trim() : undefined;
}

export class RootError extends Error {
  constructor(readonly code: 'proof-root-unusable' | 'runtime-root-unusable', message: string) {
    super(message);
  }
}

export async function resolveRoots(plugin: AppPlugin, env: Env): Promise<Roots> {
  const runtimeOverride = env.APP_VERIFY_STATE_ROOT, proofOverride = env.APP_VERIFY_PROOF_ROOT;
  const runtime = runtimeOverride ? resolve(runtimeOverride) : join(env.HOME || homedir(), '.local/state/app-verify');
  const runtimeCheckout = await checkoutOf(runtime);
  if (runtimeCheckout) throw new RootError('runtime-root-unusable', 'the runtime root is inside a Git checkout; runtime state must stay outside every checkout');
  let proof: string;
  if (proofOverride) proof = resolve(proofOverride);
  else {
    const canonical = await canonicalCheckout(plugin.root);
    if (!canonical) throw new RootError('proof-root-unusable', 'the plug-in root is not inside a Git checkout, so there is no canonical checkout for proof');
    proof = join(canonical, '.local/evidence/verify');
  }
  const proofCheckout = await checkoutOf(proof);
  if (proofCheckout) {
    const ignored = await exec('git', ['-C', proofCheckout, 'check-ignore', '-q', join(relative(proofCheckout, proof), 'probe')]);
    if (ignored.code !== 0) throw new RootError('proof-root-unusable', 'the proof root is inside a Git checkout but not ignored; proof must never be committed');
  }
  return {proof, runtime, labels: {proof: proofOverride ? proof : DEFAULT_PROOF_LABEL, runtime: runtimeOverride ? runtime : DEFAULT_RUNTIME_LABEL}};
}

export interface Candidate {
  sourceRevision: string;
  dirty: boolean;
  version: string;
}

/** Source revision and dirty flag at this moment. Unknown or unreadable checkouts are never called clean. */
export async function candidate(plugin: AppPlugin): Promise<Candidate> {
  const head = await exec('git', ['-C', plugin.root, 'rev-parse', 'HEAD']);
  const sourceRevision = head.code === 0 && /^[0-9a-f]{40,64}$/.test(head.stdout.trim()) ? head.stdout.trim() : 'unknown';
  const status = await exec('git', ['-C', plugin.root, 'status', '--porcelain', '--untracked-files=no']);
  const dirty = sourceRevision === 'unknown' || status.code !== 0 || status.stdout.trim().length > 0;
  return {sourceRevision, dirty, version: plugin.build.version};
}

/** SHA-256 of the served artifact, read from the running app or from a file under root. */
export async function artifactDigest(plugin: AppPlugin, url: string, signal: AbortSignal): Promise<string> {
  const artifact = plugin.build.artifact;
  if ('route' in artifact) {
    const response = await fetch(new URL(artifact.route, url), {signal, redirect: 'error'});
    // The full URL, which a redacted detail keeps; a bare route would read as a path.
    if (!response.ok) throw new Error(`artifact route ${new URL(artifact.route, url).href} answered ${response.status}`);
    return sha256(new Uint8Array(await response.arrayBuffer()));
  }
  const under = (path: string) => (isAbsolute(path) ? path : join(plugin.root, path));
  if ('files' in artifact) {
    if (artifact.files.length === 0) throw new Error('artifact files list is empty');
    let lines = '';
    for (const path of artifact.files) lines += `${hex256(await readFile(under(path)))}  ${path}\n`;
    return sha256(lines);
  }
  return sha256(await readFile(under(artifact.file)));
}
