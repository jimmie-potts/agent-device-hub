// Read-only installation layout and protected-path binding. No links are created.
import type {Stats} from 'node:fs';
import {lstat, readdir, readlink, realpath} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {checkStateDirectory, readPrivateFile} from './state.js';
import type {UpgradeOwner} from './upgrade-owner.js';

type ArtifactPaths = {identity: string; directory: string; archive: string};
type EvidencePin = {path: string; sha256: string};
type ExecutionFrame = {
  operationId: string; backupDirectory: string; stopTimeoutMs: number;
  postStart: {attempts: number; timeoutMs: number; intervalMs: number};
  startupEffects: {assessment: EvidencePin; authority: EvidencePin};
  adoption: null | {draftFile: string; overrideFile: string; originals: EvidencePin[]; restoration: EvidencePin};
};
export type UpgradePreflightRequest = {
  schema: 'runtime-upgrade-request/1.0'; operation: 'adoption' | 'upgrade'; installationId: string;
  installationRoot: string; tokenFile: string; admissionFile: string; installedBaselineClosureFile: string;
  qualificationRevision: string; releases: {previous: ArtifactPaths; target: ArtifactPaths; recovery: ArtifactPaths};
  formatInventoryFiles: {previous: string; target: string; recovery: string; qualification: string};
  execution: ExecutionFrame;
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
const bounded = (value: unknown, minimum: number, maximum: number): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
const evidencePin = (value: unknown): value is EvidencePin => closed(value, ['path', 'sha256'])
  && path(value.path) && typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256);

function executionFrame(value: unknown, root: string, operation: string): value is ExecutionFrame {
  if (!closed(value, ['operationId', 'backupDirectory', 'stopTimeoutMs', 'postStart', 'startupEffects', 'adoption'])
    || typeof value.operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value.operationId)
    || value.backupDirectory !== join(root, 'backups', value.operationId)
    || !bounded(value.stopTimeoutMs, 1000, 60000)
    || !closed(value.postStart, ['attempts', 'timeoutMs', 'intervalMs'])
    || !bounded(value.postStart.attempts, 1, 30) || !bounded(value.postStart.timeoutMs, 1000, 180000)
    || !bounded(value.postStart.intervalMs, 100, 10000) || value.postStart.intervalMs >= value.postStart.timeoutMs
    || !closed(value.startupEffects, ['assessment', 'authority']) || !Object.values(value.startupEffects).every(evidencePin)) return false;
  if (operation === 'upgrade') return value.adoption === null;
  if (!closed(value.adoption, ['draftFile', 'overrideFile', 'originals', 'restoration'])
    || !path(value.adoption.draftFile) || !path(value.adoption.overrideFile)
    || !inside(join(root, 'provenance'), value.adoption.draftFile)
    || value.adoption.draftFile === join(root, 'provenance')
    || !Array.isArray(value.adoption.originals) || value.adoption.originals.length < 1 || value.adoption.originals.length > 16
    || !value.adoption.originals.every(evidencePin) || !evidencePin(value.adoption.restoration)) return false;
  return new Set(value.adoption.originals.map(pin => pin.path)).size === value.adoption.originals.length;
}

export function parseUpgradeRequest(value: unknown): UpgradePreflightRequest {
  if (!closed(value, ['schema', 'operation', 'installationId', 'installationRoot', 'tokenFile', 'admissionFile',
    'installedBaselineClosureFile', 'qualificationRevision', 'releases', 'formatInventoryFiles', 'execution'])
    || value.schema !== 'runtime-upgrade-request/1.0' || !['adoption', 'upgrade'].includes(String(value.operation))
    || typeof value.installationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value.installationId)
    || ![value.installationRoot, value.tokenFile, value.admissionFile, value.installedBaselineClosureFile].every(path)
    || typeof value.qualificationRevision !== 'string' || !/^[0-9a-f]{40}$/.test(value.qualificationRevision)
    || !closed(value.releases, ['previous', 'target', 'recovery'])
    || !Object.values(value.releases).every(row => closed(row, ['identity', 'directory', 'archive']) && Object.values(row).every(path))
    || !closed(value.formatInventoryFiles, ['previous', 'target', 'recovery', 'qualification'])
    || !Object.values(value.formatInventoryFiles).every(path)
    || !executionFrame(value.execution, String(value.installationRoot), String(value.operation))) return refused();
  return value as UpgradePreflightRequest;
}

/** Bind private operational evidence; this is not an approval interpreter or a service action. */
export async function inspectUpgradeExecution(request: UpgradePreflightRequest): Promise<ExecutionFrame> {
  try {
    const frame = request.execution;
    const provenance = join(request.installationRoot, 'provenance');
    await checkStateDirectory(provenance);
    const pins = [...Object.values(frame.startupEffects), ...(frame.adoption === null ? [] :
      [...frame.adoption.originals, frame.adoption.restoration])];
    for (const pin of pins) {
      // Retained original-fragment copies and authored evidence are private.
      // Live unit fragments remain bound by the owner and baseline observers.
      if (!inside(provenance, pin.path) || pin.path === provenance) return refused();
      const bytes = await readPrivateFile(pin.path, 1024 * 1024);
      if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) return refused();
    }
    return structuredClone(frame);
  } catch { return refused(); }
}

async function directory(name: string) {
  if (!path(name) || await checkStateDirectory(name) !== name) return refused();
  const info = await lstat(name);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) return refused();
  return binding(name, info);
}

async function absent(name: string): Promise<void> {
  try { await lstat(name); } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    return refused();
  }
  return refused();
}

/** Exact bytes for the one approved anchor override; never writes or invokes systemd. */
export function renderUpgradeAdoptionDraft(root: string, owner: UpgradeOwner): string {
  if (owner.argv[0] !== owner.executable || owner.argv[1] !== owner.entry) return refused();
  const cwd = join(root, 'current');
  const argv = [...owner.argv];
  argv[1] = join(cwd, 'apps/runtime/dist/src/main.js');
  if (![cwd, ...argv].every(value => /^[-A-Za-z0-9_/.:=]+$/.test(value))) return refused();
  return '[Service]\nWorkingDirectory=' + cwd + '\nExecStart=\nExecStart=' + argv.join(' ') + '\n';
}

/** Observe the selection after a manual start; never switch or start anything. */
export async function inspectUpgradeRunningPaths(request: UpgradePreflightRequest, owner: UpgradeOwner,
  approved: {owner: UpgradeOwner; paths: {protectedPaths: ReturnType<typeof binding>[]; adoptionDraftSha256: string | null}}, selected: string) {
  try {
    const current = join(request.installationRoot, 'current');
    await directory(request.installationRoot);
    const observe = async () => {
      const info = await lstat(current);
      if (!info.isSymbolicLink() || info.uid !== process.getuid?.() || info.nlink !== 1
        || await readlink(current) !== selected || await realpath(current) !== selected
        || owner.entry !== join(current, 'apps/runtime/dist/src/main.js') || owner.cwd !== selected
        || await realpath(owner.entry) !== join(selected, 'apps/runtime/dist/src/main.js')) return refused();
      for (const pin of approved.paths.protectedPaths) {
        if (!path(pin.path) || await realpath(pin.path) !== pin.path
          || !isDeepStrictEqual(binding(pin.path, await lstat(pin.path)), pin)) return refused();
      }
      const adoption = request.execution.adoption;
      const units = [...approved.owner.units, ...(adoption === null ? [] : [adoption.overrideFile])].sort();
      if (!isDeepStrictEqual(owner.units, units)) return refused();
      if (adoption !== null) {
        const bytes = Buffer.from(renderUpgradeAdoptionDraft(request.installationRoot, approved.owner));
        const actual = await lstat(adoption.overrideFile);
        if (!actual.isFile() || actual.isSymbolicLink() || actual.nlink !== 1 || actual.uid !== process.getuid?.()
          || (actual.mode & 0o7022) !== 0 || await realpath(adoption.overrideFile) !== adoption.overrideFile
          || !bytes.equals(await readPrivateFile(adoption.overrideFile, 65536))
          || createHash('sha256').update(bytes).digest('hex') !== approved.paths.adoptionDraftSha256) return refused();
      }
      return {selection: binding(current, info), target: selected, units};
    };
    const original = await observe();
    if (!isDeepStrictEqual(original, await observe())) return refused();
    return original;
  } catch {return refused();}
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
    await absent(request.execution.backupDirectory);
    let adoptionDraftSha256: string | null = null;
    if (request.execution.adoption !== null) {
      const adoption = request.execution.adoption;
      const unit = owner.units.filter(name => basename(name) === owner.service);
      const primary = unit[0];
      if (unit.length !== 1 || primary === undefined || dirname(adoption.overrideFile) !== join(dirname(primary), owner.service + '.d')
        || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.conf$/.test(basename(adoption.overrideFile))
        || dirname(adoption.draftFile) !== provenance) return refused();
      await absent(dirname(adoption.overrideFile));
      const bytes = Buffer.from(renderUpgradeAdoptionDraft(root, owner));
      adoptionDraftSha256 = createHash('sha256').update(bytes).digest('hex');
      // Preparing exactly the planned draft must not invalidate recheck. Any
      // different, linked or public file refuses; absence is allowed at plan time.
      let draft;
      try { draft = await lstat(adoption.draftFile); } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) return refused();
      }
      if (draft !== undefined && !bytes.equals(await readPrivateFile(adoption.draftFile, 65536))) return refused();
    }
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
    return {directories, lock: binding(lockPath, lock), protectedPaths, selection, executionEntry, adoptionDraftSha256};
  } catch { return refused(); }
}
