// Read-only installation layout and protected-path binding. No links are created.
import type {Stats} from 'node:fs';
import {lstat, readdir, readlink, realpath} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {checkStateDirectory} from './state.js';
import type {UpgradeOwner} from './upgrade-owner.js';

type ArtifactPaths = {identity: string; directory: string; archive: string};
export type UpgradePreflightRequest = {
  schema: 'runtime-upgrade-request/1.0'; operation: 'adoption' | 'upgrade'; installationId: string;
  installationRoot: string; tokenFile: string; admissionFile: string; installedBaselineClosureFile: string;
  qualificationRevision: string; releases: {previous: ArtifactPaths; target: ArtifactPaths; recovery: ArtifactPaths};
  formatInventoryFiles: {previous: string; target: string; recovery: string; qualification: string};
};
const refused = (): never => {throw new Error('runtime-upgrade-paths-refused');};
const path = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && isAbsolute(value) && resolve(value) === value
  && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const closed = (value: unknown, keys: string[]): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const inside = (root: string, value: string): boolean => {
  const name = relative(root, value);
  return name === '' || (!isAbsolute(name) && name !== '..' && !name.startsWith('../'));
};
const overlaps = (a: string, b: string): boolean => inside(a, b) || inside(b, a);
const binding = (name: string, info: Stats) => ({path: name, device: info.dev, inode: info.ino, uid: info.uid, mode: info.mode});

export function parseUpgradeRequest(value: unknown): UpgradePreflightRequest {
  if (!closed(value, ['schema', 'operation', 'installationId', 'installationRoot', 'tokenFile', 'admissionFile',
    'installedBaselineClosureFile', 'qualificationRevision', 'releases', 'formatInventoryFiles'])
    || value.schema !== 'runtime-upgrade-request/1.0' || !['adoption', 'upgrade'].includes(String(value.operation))
    || typeof value.installationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value.installationId)
    || ![value.installationRoot, value.tokenFile, value.admissionFile, value.installedBaselineClosureFile].every(path)
    || typeof value.qualificationRevision !== 'string' || !/^[0-9a-f]{40}$/.test(value.qualificationRevision)
    || !closed(value.releases, ['previous', 'target', 'recovery'])
    || !Object.values(value.releases).every(row => closed(row, ['identity', 'directory', 'archive']) && Object.values(row).every(path))
    || !closed(value.formatInventoryFiles, ['previous', 'target', 'recovery', 'qualification'])
    || !Object.values(value.formatInventoryFiles).every(path)) return refused();
  return value as UpgradePreflightRequest;
}

async function directory(name: string) {
  if (!path(name) || await checkStateDirectory(name) !== name) return refused();
  const info = await lstat(name);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) return refused();
  return binding(name, info);
}

/** Verified roots and baselineRoot come from the source/closure adapters, never observation flags. */
export async function inspectUpgradePaths(request: UpgradePreflightRequest, owner: UpgradeOwner,
  verified: {previous: string; target: string; recovery: string; baselineRoot: string;
    revisions: {previous: string; target: string; recovery: string}}, credentialsFile: string) {
  try {
    const root = request.installationRoot;
    const directories = [];
    for (const name of ['', 'releases', 'provenance', 'receipts', 'backups']) directories.push(await directory(join(root, name)));
    const allowed = ['', 'releases', 'provenance', 'receipts', 'backups', 'install.lock', 'current'].filter(Boolean);
    const names = await readdir(root);
    if (names.some(name => !allowed.includes(name)) || names.length > allowed.length) return refused();
    const releases = join(root, 'releases');
    for (const key of ['previous', 'target', 'recovery'] as const) {
      const declared = request.releases[key].directory;
      if (declared !== verified[key] || !/^[0-9a-f]{40}$/.test(verified.revisions[key])
        || declared !== join(releases, verified.revisions[key])) return refused();
    }
    for (const name of [...new Set([verified.previous, verified.target, verified.recovery])].sort()) directories.push(await directory(name));
    const provenance = join(root, 'provenance');
    if (![request.admissionFile, request.installedBaselineClosureFile].every(name => inside(provenance, name) && name !== provenance)) return refused();
    const lockPath = join(root, 'install.lock');
    const lock = await lstat(lockPath);
    if (!lock.isFile() || lock.isSymbolicLink() || lock.uid !== process.getuid?.() || lock.nlink !== 1
      || (lock.mode & 0o7777) !== 0o600) return refused();
    const protectedNames = [owner.options.stateDir, owner.options.config, credentialsFile, request.tokenFile, owner.executable, ...owner.units];
    if (!path(verified.baselineRoot)) return refused();
    const executionEntry = join(verified.baselineRoot, 'apps/runtime/dist/src/main.js');
    if (owner.entry !== executionEntry && !(request.operation === 'upgrade'
      && owner.entry === join(root, 'current/apps/runtime/dist/src/main.js')
      && await realpath(owner.entry) === executionEntry)) return refused();
    if (request.operation === 'adoption') protectedNames.push(verified.baselineRoot);
    else if (verified.baselineRoot !== verified.previous) return refused();
    const protectedPaths = [];
    const privateFiles = new Set([owner.options.config, credentialsFile, request.tokenFile]);
    const executionFiles = new Set([owner.executable, ...owner.units]);
    for (const name of [...new Set(protectedNames)].sort()) {
      if (!path(name) || overlaps(root, name) || await realpath(name) !== name) return refused();
      const info = await lstat(name);
      if (info.uid !== process.getuid?.() || (info.mode & 0o022) !== 0 || info.isSymbolicLink()
        || (info.mode & 0o7000) !== 0 || (!info.isFile() && !info.isDirectory())) return refused();
      if (privateFiles.has(name) && (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0)) return refused();
      if (executionFiles.has(name) && (!info.isFile() || info.nlink !== 1)) return refused();
      if (name === owner.options.stateDir && (!info.isDirectory() || (info.mode & 0o077) !== 0)) return refused();
      if (request.operation === 'adoption' && name === verified.baselineRoot && !info.isDirectory()) return refused();
      protectedPaths.push(binding(name, info));
    }
    const current = join(root, 'current');
    let selection: {kind: 'absent'} | {kind: 'previous'; target: string; device: number; inode: number};
    let currentInfo: Stats | undefined;
    try { currentInfo = await lstat(current); } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT') || request.operation !== 'adoption') return refused();
    }
    if (currentInfo !== undefined) {
      const info = currentInfo;
      if (!info.isSymbolicLink() || info.uid !== process.getuid?.()) return refused();
      const target = resolve(root, await readlink(current));
      if (target !== verified.previous || await realpath(current) !== verified.previous) return refused();
      selection = {kind: 'previous', target, device: info.dev, inode: info.ino};
    } else {
      selection = {kind: 'absent'};
    }
    return {directories, lock: binding(lockPath, lock), protectedPaths, selection, executionEntry};
  } catch { return refused(); }
}
