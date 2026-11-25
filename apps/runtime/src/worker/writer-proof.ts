import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, mkdir, open, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import type {ChildProcess} from 'node:child_process';

export function signalWriter(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try {process.kill(-child.pid, signal); return;} catch { /* The process group may already have exited. */ }
  }
  child.kill(signal);
}

export function writerGone(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {process.kill(-pid, 0); return false;}
  catch (error) {return (error as NodeJS.ErrnoException).code === 'ESRCH';}
}

const MAX_ENTRIES = 20_000;
const MAX_BYTES = 96 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/u;
type Git = (cwd: string, args: string[]) => Promise<string>;
export type ProtectedCheckout = {path: string; identity: string};
export type CheckoutIdentity = {root: string; gitDir: string; common: string; key: string};
export type WorktreeProof = {head: string; digest: string; identity: CheckoutIdentity};
type FileCopy = {name: string; mode: number; content: Buffer};
type Snapshot = WorktreeProof & {files: FileCopy[]};
const list = (text: string) => text.split('\0').filter(Boolean);
export const within = (root: string, file: string) => {
  const path = relative(root, file);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('../'));
};
const safeName = (name: string) => !isAbsolute(name) && !name.includes('\\') &&
  name.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..' && segment.toLowerCase() !== '.git');

export async function protectedCheckout(path: string): Promise<ProtectedCheckout> {
  const canonical = await realpath(path);
  const record = await lstat(path, {bigint: true});
  if (canonical !== path || !record.isDirectory()) throw new Error('protected-checkout');
  return {path, identity: `${String(record.dev)}:${String(record.ino)}`};
}

export async function checkoutIdentity(worktree: string, git: Git): Promise<CheckoutIdentity> {
  const root = await realpath(worktree);
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).trim();
  const common = (await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  const marker = join(root, '.git');
  const markerStat = await lstat(marker, {bigint: true});
  if (await realpath(gitDir) !== gitDir || await realpath(common) !== common ||
    await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim()) !== root) throw new Error('checkout-identity');
  if (markerStat.isFile()) {
    const markerText = await readFile(marker, 'utf8');
    if (markerStat.size > 8192n || !markerText.startsWith('gitdir: ') || dirname(gitDir) !== join(common, 'worktrees') ||
      resolve(root, markerText.slice('gitdir: '.length).trim()) !== gitDir ||
      resolve(gitDir, (await readFile(join(gitDir, 'gitdir'), 'utf8')).trim()) !== marker) throw new Error('checkout-gitdir');
  } else if (!markerStat.isDirectory() || gitDir !== marker || common !== marker) throw new Error('checkout-gitdir');
  const points = await Promise.all([root, gitDir, common].map(path => lstat(path, {bigint: true})));
  if (points.some(point => !point.isDirectory())) throw new Error('checkout-identity');
  const key = [markerStat, ...points].map(point => `${String(point.dev)}:${String(point.ino)}`).join('/');
  return {root, gitDir, common, key};
}

async function snapshot(worktree: string, git: Git, capture: boolean): Promise<Snapshot> {
  const bound = await checkoutIdentity(worktree, git);
  const head = (await git(bound.root, ['rev-parse', 'HEAD'])).trim();
  const index = list(await git(bound.root, ['ls-files', '--stage', '-z']));
  const tracked = list(await git(bound.root, ['ls-tree', '-r', '--name-only', '-z', head]));
  const expected = new Set(tracked);
  if (!SHA.test(head) || expected.size > MAX_ENTRIES || tracked.some(name => !safeName(name)) ||
    list(await git(bound.root, ['ls-files', '--others', '--exclude-standard', '-z'])).length !== 0) throw new Error('checkout-files');
  for (const entry of index) {
    const parsed = /^100(?:644|755) [a-f0-9]{40} 0\t([\s\S]+)$/u.exec(entry);
    const name = parsed?.[1];
    if (name === undefined || !safeName(name)) throw new Error('checkout-index');
    if (!expected.has(name) && /(?:^|\/)(?:\.env(?:\.|$)|credentials(?:\.|$)|secrets(?:\.|$)|[^/]+\.(?:key|pem|p12|pfx)$)/iu.test(name)) {
      throw new Error('checkout-sensitive-file');
    }
    expected.add(name);
  }

  const fingerprint = createHash('sha256').update(JSON.stringify([head, index]));
  const files: FileCopy[] = [];
  let bytes = 0;
  if (expected.size > MAX_ENTRIES) throw new Error('checkout-files');
  for (const name of [...expected].sort()) {
    const path = join(bound.root, name);
    try {
      if (await realpath(dirname(path)) !== dirname(path)) throw new Error('checkout-parent');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      fingerprint.update(JSON.stringify([name, 'deleted'])); continue;
    }
    const given = await lstat(path, {bigint: true}).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (given === undefined) {fingerprint.update(JSON.stringify([name, 'deleted'])); continue;}
    if (!given.isFile() || given.nlink !== 1n || Number(given.size) + bytes > MAX_BYTES) throw new Error('checkout-file');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat({bigint: true});
      if (!before.isFile() || before.nlink !== 1n || given.dev !== before.dev || given.ino !== before.ino || given.size !== before.size) throw new Error('checkout-file-replaced');
      const content = Buffer.alloc(Number(before.size));
      const read = await handle.read(content, 0, content.length, 0);
      const after = await handle.stat({bigint: true});
      if (read.bytesRead !== content.length || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
        throw new Error('checkout-file-changed');
      }
      bytes += content.length;
      const mode = Number(before.mode & 0o777n);
      fingerprint.update(JSON.stringify([name, mode, content.length])).update(content);
      if (capture) files.push({name, mode, content});
    } finally {await handle.close();}
  }
  if ((await checkoutIdentity(worktree, git)).key !== bound.key) throw new Error('checkout-replaced');
  return {head, digest: fingerprint.digest('hex'), identity: bound, files};
}

export async function worktreeFingerprint(worktree: string, git: Git): Promise<WorktreeProof | undefined> {
  try {
    const {head, digest, identity: bound} = await snapshot(worktree, git, false);
    return {head, digest, identity: bound};
  } catch {return undefined;}
}

export function sameCheckout(source: CheckoutIdentity, proof: CheckoutIdentity): boolean {
  return source.key === proof.key && source.root === proof.root && source.gitDir === proof.gitDir && source.common === proof.common;
}
function matches(source: WorktreeProof, proof: WorktreeProof): boolean {
  return source.head === proof.head && source.digest === proof.digest && sameCheckout(source.identity, proof.identity);
}

/** Copy only verified, tracked checkout files into a new, independent Git checkout. */
export async function copyWorktree(proof: WorktreeProof, successor: string, protectedRoot: ProtectedCheckout, writerHome: string, base: string, git: Git): Promise<WorktreeProof | undefined> {
  let created = false, copied = false;
  try {
    const source = await snapshot(proof.identity.root, git, true);
    const targetParent = await realpath(dirname(successor));
    const targetPath = join(targetParent, successor.split('/').at(-1) ?? '');
    if ((await protectedCheckout(protectedRoot.path)).identity !== protectedRoot.identity || targetParent !== protectedRoot.path ||
      !SHA.test(base) || !matches(source, proof) || within(proof.identity.root, targetPath) || within(proof.identity.common, targetPath) || within(writerHome, targetPath)) return;
    const patch = await git(source.identity.root, ['diff', '--cached', '--binary', '--no-renames', '--no-ext-diff', '--no-textconv', source.head, '--']);
    await mkdir(successor, {mode: 0o700}); created = true;
    await git(successor, ['-c', 'init.templateDir=', 'init', '--quiet']);
    await git(successor, ['-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', 'fetch', '--quiet', '--no-tags', '--no-recurse-submodules',
      '--depth=1', source.identity.common, ...new Set([source.head, base])]);
    await git(successor, ['update-ref', '--no-deref', 'HEAD', source.head]);
    await git(successor, ['read-tree', 'HEAD']);
    if (patch !== '') {
      const patchPath = join(targetPath, '.git', 'bunny-handoff-index.patch');
      await writeFile(patchPath, patch, {flag: 'wx', mode: 0o600});
      try {await git(successor, ['apply', '--cached', '--binary', '--', patchPath]);}
      finally {await rm(patchPath, {force: true});}
    }
    for (const file of source.files) {
      const path = join(targetPath, file.name);
      await mkdir(dirname(path), {recursive: true, mode: 0o700});
      await writeFile(path, file.content, {flag: 'wx', mode: file.mode});
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {await handle.chmod(file.mode);} finally {await handle.close();}
    }
    const alternates = await lstat(join(targetPath, '.git', 'objects', 'info', 'alternates')).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (alternates !== undefined) return;
    const target = await snapshot(successor, git, false);
    const finalSource = await snapshot(proof.identity.root, git, false);
    if (target.head !== proof.head || target.digest !== proof.digest || !matches(finalSource, proof) ||
      target.identity.root !== targetPath || target.identity.gitDir !== join(targetPath, '.git') ||
      target.identity.common !== target.identity.gitDir || target.identity.key === proof.identity.key ||
      (await protectedCheckout(protectedRoot.path)).identity !== protectedRoot.identity) return;
    copied = true;
    return {head: target.head, digest: target.digest, identity: target.identity};
  } catch {return undefined;}
  finally {if (created && !copied) await rm(successor, {recursive: true, force: true}).catch(() => {});}
}
