// Read-only protection of the coordinator-qualified client hook paths.
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {lstat, open, readlink, realpath} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {checkStateDirectory, readPrivateFile} from './state.js';

type Pin = {path: string; sha256: string};
type Script = Pin & {resolvedPath: string};
type Hook = {path: string; kind: 'directory-link' | 'file-link'; target: string; scripts: Script[]};
type Input = {installationRoot: string; installationId: string; pin: Pin};
const refused = (): never => {throw new Error('runtime-upgrade-hooks-refused');};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const absolute = (value: unknown): value is string => text(value) && isAbsolute(value) && resolve(value) === value;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const closed = (value: unknown, keys: string[]): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const inside = (root: string, name: string) => {const path = relative(root, name); return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('../'));};
const overlap = (a: string, b: string) => inside(a, b) || inside(b, a);
const sortedUnique = (paths: string[]) => paths.every((path, index) => index === 0 || (paths[index - 1] ?? '') < path);
const fingerprint = (info: Awaited<ReturnType<typeof lstat>>) => ({device: info.dev, inode: info.ino,
  uid: info.uid, mode: info.mode, links: info.nlink, size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs});

function hooks(value: unknown): Hook[] {
  if (!Array.isArray(value) || value.length > 32) return refused();
  let count = 0;
  for (const row of value) {
    if (!closed(row, ['path', 'kind', 'target', 'scripts']) || !absolute(row.path) || !text(row.target)
      || !['directory-link', 'file-link'].includes(String(row.kind)) || !Array.isArray(row.scripts)
      || row.scripts.length === 0 || row.scripts.length > 32) return refused();
    count += row.scripts.length; if (count > 128) return refused();
    for (const script of row.scripts) {
      if (!closed(script, ['path', 'resolvedPath', 'sha256']) || !absolute(script.path)
        || !absolute(script.resolvedPath) || !digest(script.sha256)
        || (row.kind === 'file-link' ? script.path !== row.path : script.path === row.path || !inside(row.path, script.path))) return refused();
    }
    if ((row.kind === 'file-link' && row.scripts.length !== 1)
      || !sortedUnique((row.scripts as Script[]).map(script => script.path))) return refused();
  }
  if (!sortedUnique((value as Hook[]).map(row => row.path))) return refused();
  return value as Hook[];
}

async function scriptHash(name: string, expected: ReturnType<typeof fingerprint>) {
  const file = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 1024 * 1024 || !isDeepStrictEqual(fingerprint(before), expected)) return refused();
    const digest = createHash('sha256'); const buffer = Buffer.alloc(64 * 1024); let total = 0;
    for (;;) {const {bytesRead} = await file.read(buffer, 0, buffer.length, null); if (bytesRead === 0) break;
      total += bytesRead; if (total > before.size) return refused(); digest.update(buffer.subarray(0, bytesRead));}
    if (total !== before.size || !isDeepStrictEqual(fingerprint(await file.stat()), expected)) return refused();
    return digest.digest('hex');
  } finally {await file.close();}
}

/** Test hooks are internal; no request or environment value selects a reader. */
export function createUpgradeHookInspector(testHooks: {beforeFinalCheck?: () => Promise<void>; afterScriptRead?: () => Promise<void>} = {}) {
  return async (input: Input) => {
    try {
      if (!absolute(input.installationRoot) || !absolute(input.pin.path) || !digest(input.pin.sha256)) return refused();
      const root = await checkStateDirectory(input.installationRoot);
      const rootInfo = fingerprint(await lstat(root));
      const bytes = await readPrivateFile(input.pin.path, 256 * 1024);
      if (hash(bytes) !== input.pin.sha256) return refused();
      const document = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)) as Record<string, unknown>;
      if (document.schema !== 'runtime-installed-closure/2.0' || document.installationId !== input.installationId) return refused();
      // Baseline/source admission validates the other closure fields. This reader
      // validates only the qualified hook list and actual protected bytes.
      const qualified = hooks(document.protectedHooks);
      const observe = async () => {
        let total = 0; const result = [];
        for (const row of qualified) {
          if (overlap(root, row.path) || await realpath(dirname(row.path)) !== dirname(row.path)) return refused();
          const link = await lstat(row.path);
          if (!link.isSymbolicLink() || link.uid !== process.getuid?.() || link.nlink !== 1 || (link.mode & 0o7000) !== 0
            || await readlink(row.path) !== row.target) return refused();
          const target = await realpath(row.path);
          if (overlap(root, target)) return refused();
          const info = await lstat(target);
          if (info.uid !== process.getuid?.() || (info.mode & 0o7022) !== 0
            || (row.kind === 'directory-link' ? !info.isDirectory() : !info.isFile())) return refused();
          const scripts = [];
          for (const script of row.scripts) {
            if (overlap(root, script.path) || overlap(root, script.resolvedPath)
              || await realpath(script.path) !== script.resolvedPath
              || await realpath(dirname(script.resolvedPath)) !== dirname(script.resolvedPath)) return refused();
            const file = await lstat(script.resolvedPath);
            if (!file.isFile() || file.isSymbolicLink() || file.uid !== process.getuid?.() || file.nlink !== 1
              || (file.mode & 0o7022) !== 0 || file.size > 1024 * 1024) return refused();
            total += file.size; if (total > 32 * 1024 * 1024) return refused();
            if (await scriptHash(script.resolvedPath, fingerprint(file)) !== script.sha256) return refused();
            await testHooks.afterScriptRead?.();
            scripts.push({...script, identity: fingerprint(file)});
          }
          result.push({...row, resolvedTarget: target, linkIdentity: fingerprint(link), targetIdentity: fingerprint(info), scripts});
        }
        return result;
      };
      const original = await observe(); await testHooks.beforeFinalCheck?.();
      if (!isDeepStrictEqual(original, await observe())) return refused();
      for (const row of original) {
        if (!isDeepStrictEqual(row.linkIdentity, fingerprint(await lstat(row.path)))
          || await realpath(dirname(row.path)) !== dirname(row.path)
          || await readlink(row.path) !== row.target || await realpath(row.path) !== row.resolvedTarget
          || !isDeepStrictEqual(row.targetIdentity, fingerprint(await lstat(row.resolvedTarget)))) return refused();
        for (const script of row.scripts) {
          if (!isDeepStrictEqual(script.identity, fingerprint(await lstat(script.resolvedPath)))
            || await realpath(script.path) !== script.resolvedPath
            || await realpath(dirname(script.resolvedPath)) !== dirname(script.resolvedPath)) return refused();
        }
      }
      if (!bytes.equals(await readPrivateFile(input.pin.path, 256 * 1024))
        || !isDeepStrictEqual(rootInfo, fingerprint(await lstat(root))) || await checkStateDirectory(root) !== root) return refused();
      return {closureSha256: input.pin.sha256, hooks: original};
    } catch {return refused();}
  };
}
export const inspectUpgradeProtectedHooks = createUpgradeHookInspector();
