// Read-only actual-byte closure. The production bin supplies verified source and admission.
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {lstat, open, opendir, readlink, realpath} from 'node:fs/promises';
import {dirname, isAbsolute, join, posix, resolve} from 'node:path';
import {canonical, digest, hashRegular, readRegular, safeRelative, sha256} from '../../hub/dist/install/files.js';
import {readPrivateFile} from '../dist/src/state.js';
const refuse = () => {throw new Error('runtime-upgrade-baseline-refused');};
const closed = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && canonical(Object.keys(value).sort()) === canonical([...keys].sort());
const absolute = value => typeof value === 'string' && value.length <= 4096 && isAbsolute(value) && resolve(value) === value
  && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const inside = (root, name) => name === root || name.startsWith(root + '/');
const dependencies = name => name.split('/').includes('node_modules');
const built = name => /^apps\/runtime\/dist(?:\/|$)/.test(name) || /^(packages|modules|controllers)\/[^/]+\/dist(?:\/|$)/.test(name);
const same = (a, b) => canonical(a) === canonical(b);
const fingerprint = info => ({device: info.dev, inode: info.ino, uid: info.uid, links: info.nlink,
  mode: info.mode, size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs});
async function executionHash(name, observed) {
  const file = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 256 * 1024 * 1024
      || !same(fingerprint(before), fingerprint(observed))) refuse();
    const hash = createHash('sha256'); const buffer = Buffer.alloc(64 * 1024); let total = 0;
    for (;;) {
      const {bytesRead} = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead; if (total > before.size) refuse(); hash.update(buffer.subarray(0, bytesRead));
    }
    if (total !== before.size || !same(fingerprint(before), fingerprint(await file.stat()))) refuse();
    return hash.digest('hex');
  } finally {await file.close();}
}
async function membership(name, wanted) {
  const remaining = new Set(wanted);
  const directory = await opendir(name, {bufferSize: 32});
  for await (const entry of directory) {if (!remaining.delete(entry.name)) refuse();}
  if (remaining.size !== 0) refuse();
}
async function absent(name) {
  try {await lstat(name);} catch (error) {if (error?.code === 'ENOENT') return; throw error;}
  refuse();
}

// Resolve logical payload names through declared links without walking the filesystem.
function manifestDestination(name, entries) {
  const seen = new Set();
  for (let hop = 0; hop < 32; hop++) {
    if (!safeRelative(name) || seen.has(name)) refuse(); seen.add(name);
    const parts = name.split('/'); let changed = false;
    for (let end = 1; end <= parts.length; end++) {
      const prefix = parts.slice(0, end).join('/'); const entry = entries.get(prefix);
      if (entry?.kind !== 'link') continue;
      if (typeof entry.target !== 'string' || isAbsolute(entry.target)) refuse();
      name = posix.normalize(posix.join(posix.dirname(prefix), entry.target, ...parts.slice(end)));
      changed = true; break;
    }
    if (!changed) {if (!entries.has(name)) refuse(); return name;}
  }
  return refuse();
}

export async function runtimeWorkspaceMap(release) {
  const byPath = new Map(release.entries.map(entry => [entry.path, entry]));
  const read = async name => {
    const entry = byPath.get(name); if (entry?.kind !== 'file' || !digest(entry.sha256)) refuse();
    const bytes = await readRegular(join(release.root, name), 256 * 1024);
    if (sha256(bytes) !== entry.sha256) refuse();
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  };
  const document = await read('package.json');
  if (!Array.isArray(document.workspaces) || document.workspaces.length > 128) refuse();
  const result = [];
  for (const path of document.workspaces) {
    if (typeof path !== 'string' || !/^(apps|packages|modules|controllers)\/[^/]+$/.test(path) || !safeRelative(path)) refuse();
    const manifest = await read(path + '/package.json');
    if (typeof manifest.name !== 'string' || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(manifest.name)) refuse();
    result.push({path, name: manifest.name});
  }
  if (new Set(result.map(item => item.path)).size !== result.length || new Set(result.map(item => item.name)).size !== result.length) refuse();
  return result;
}

export function runtimeExecutionEntries(entries, sourceInputs, workspaces) {
  const all = new Map(entries.map(entry => [entry.path, entry]));
  if (all.size !== entries.length || entries.length > 100000) refuse();
  const selected = new Map();
  const workspaceByPath = new Map(workspaces.map(item => [item.path, item]));
  if (workspaceByPath.size !== workspaces.length) refuse();
  const sources = new Set(sourceInputs.map(item => item.path));
  for (const entry of entries) if (sources.has(entry.path) || dependencies(entry.path) || built(entry.path)) selected.set(entry.path, entry);
  const ancestors = name => {
    for (let parent = posix.dirname(name); parent !== '.'; parent = posix.dirname(parent)) {
      const entry = all.get(parent); if (entry?.kind !== 'directory') refuse(); selected.set(parent, entry);
    }
  };
  for (const entry of [...selected.values()]) ancestors(entry.path);
  const queue = [...selected.values()].filter(entry => entry.kind === 'link');
  const seen = new Set();
  for (let at = 0; at < queue.length; at++) {
    const entry = queue[at]; if (seen.has(entry.path)) continue; seen.add(entry.path);
    if (typeof entry.target !== 'string' || isAbsolute(entry.target)) refuse();
    const name = manifestDestination(posix.normalize(posix.join(posix.dirname(entry.path), entry.target)), all);
    const target = all.get(name); if (target === undefined) refuse();
    if (target.kind === 'directory' && !dependencies(name)) {
      const workspace = workspaceByPath.get(name);
      if (workspace === undefined || !entry.path.endsWith('node_modules/' + workspace.name)) refuse();
      // The exact verified workspace payload covers inactive application links too.
      for (const child of entries) if (child.path === name || child.path.startsWith(name + '/')) {
        selected.set(child.path, child); ancestors(child.path);
        if (child.kind === 'link') queue.push(child);
      }
      const rootManifest = all.get('package.json'); if (rootManifest?.kind !== 'file') refuse();
      selected.set('package.json', rootManifest);
    }
    selected.set(name, target); ancestors(name);
    if (target.kind === 'link') queue.push(target);
  }
  for (const required of ['apps/runtime/dist/src/main.js', 'apps/runtime/dist/src/build-identity.js', 'node_modules/.package-lock.json']) {
    if (selected.get(required)?.kind !== 'file') refuse();
  }
  return [...selected.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

async function regularPin(pin, maximum) {
  if (!closed(pin, ['path', 'sha256']) || !absolute(pin.path) || !digest(pin.sha256)
    || await realpath(dirname(pin.path)) !== dirname(pin.path)) refuse();
  const before = await lstat(pin.path);
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.getuid() || before.nlink !== 1
    || (before.mode & 0o7022) !== 0 || await hashRegular(pin.path, maximum) !== pin.sha256) refuse();
  const after = await lstat(pin.path);
  if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode
    || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
    || await realpath(dirname(pin.path)) !== dirname(pin.path)) refuse();
  return {path: pin.path, fingerprint: fingerprint(after)};
}

/** Inputs are bound by the production source/admission adapters, not CLI observation flags. */
export function createRuntimeBaselineInspector(hooks = {}) {
 return async function inspect(input) {
  try {
    const {path, pin, installationId, owner, previous} = input;
    if (!absolute(path) || pin.path !== path || !digest(pin.sha256)) refuse();
    const bytes = await readPrivateFile(path, 256 * 1024);
    if (sha256(bytes) !== pin.sha256) refuse();
    const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!closed(value, ['schema', 'scope', 'installationId', 'previous', 'runningRoot', 'entry', 'inventorySha256', 'node', 'units', 'protectedHooks'])
      || value.schema !== 'runtime-installed-closure/2.0' || value.scope !== 'runtime-execution-closure/1.0'
      || !Array.isArray(value.protectedHooks) || value.protectedHooks.length > 32
      || value.installationId !== installationId || !same(value.previous, previous.identity)
      || !absolute(value.runningRoot) || !absolute(value.entry) || !digest(value.inventorySha256)
      || value.entry !== join(value.runningRoot, 'apps/runtime/dist/src/main.js')
      || await realpath(owner.entry) !== value.entry || value.node?.path !== owner.executable
      || !Array.isArray(value.units) || value.units.length > 17
      || !same(value.units.map(unit => unit.path), owner.units)) refuse();
    const root = value.runningRoot;
    const beforeRoot = await lstat(root);
    if (!beforeRoot.isDirectory() || beforeRoot.isSymbolicLink() || beforeRoot.uid !== process.getuid()
      || (beforeRoot.mode & 0o7022) !== 0 || await realpath(root) !== root) refuse();
    const workspaces = await runtimeWorkspaceMap(previous);
    const expected = runtimeExecutionEntries(previous.entries, previous.inputs, workspaces);
    if (sha256(canonical(expected)) !== value.inventorySha256) refuse();
    const names = new Map(expected.map(entry => [entry.path, entry]));
    const allEntries = new Map(previous.entries.map(entry => [entry.path, entry]));
    const children = new Map();
    for (const entry of expected) {
      const parent = posix.dirname(entry.path);
      const list = children.get(parent) ?? []; list.push(posix.basename(entry.path)); children.set(parent, list);
    }
    for (const list of children.values()) list.sort();
    const snapshots = [];
    const absencePaths = [];
    const resolutionDirectories = [root, ...expected.filter(entry => entry.kind === 'directory').map(entry => join(root, entry.path))];
    for (const directory of resolutionDirectories) {
      const child = join(directory, 'node_modules');
      const relative = posix.relative(root, child);
      if (!names.has(relative)) {await absent(child); absencePaths.push(child);}
    }
    for (const workspace of workspaces) {
      if (names.has(workspace.path) && !names.has(workspace.path + '/dist')) {
        const child = join(root, workspace.path, 'dist'); await absent(child); absencePaths.push(child);
      }
    }
    let total = 0;
    for (const entry of expected) {
      if (!safeRelative(entry.path) || entry.path.length > 4096) refuse();
      const name = join(root, entry.path);
      if (await realpath(dirname(name)) !== dirname(name)) refuse();
      const before = await lstat(name);
      if (before.uid !== process.getuid() || (before.mode & 0o777) !== entry.mode || (before.mode & 0o7000) !== 0) refuse();
      if (entry.kind === 'link') {
        if (!before.isSymbolicLink() || await readlink(name) !== entry.target || isAbsolute(entry.target)
          || !inside(root, resolve(dirname(name), entry.target)) || await realpath(name) !== join(root, manifestDestination(posix.normalize(posix.join(posix.dirname(entry.path), entry.target)), allEntries))) refuse();
      } else {
        if ((before.mode & 0o022) !== 0 || before.isSymbolicLink()) refuse();
        if (entry.kind === 'directory') {
          if (!before.isDirectory()) refuse();
          if (dependencies(entry.path) || built(entry.path)) {
            await membership(name, children.get(entry.path) ?? []);
          }
        } else if (entry.kind === 'file') {
          await hooks.beforeFileOpen?.(name);
          total += before.size; if (total > 512 * 1024 * 1024 || !before.isFile() || before.nlink < 1
            || !digest(entry.sha256) || await executionHash(name, before) !== entry.sha256) refuse();
        } else refuse();
      }
      const after = await lstat(name);
      if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode
        || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
        || await realpath(dirname(name)) !== dirname(name)) refuse();
      snapshots.push({path: name, fingerprint: fingerprint(after), entry});
    }
    // npm can hard-link executables. Every inode alias must be accounted for by
    // a separately verified manifest file; aliases outside this scope refuse.
    const fileGroups = new Map();
    for (const observed of snapshots.filter(item => item.entry.kind === 'file')) {
      const key = observed.fingerprint.device + ':' + observed.fingerprint.inode;
      const group = fileGroups.get(key) ?? []; group.push(observed); fileGroups.set(key, group);
    }
    for (const group of fileGroups.values()) {
      if (group.some(item => item.fingerprint.links !== group.length
        || !same(item.fingerprint, group[0].fingerprint)
        || item.entry.sha256 !== group[0].entry.sha256)) refuse();
    }
    // Keep destinations part of the independently derived manifest scope.
    for (const entry of expected.filter(item => item.kind === 'link')) {
      const target = manifestDestination(posix.normalize(posix.join(posix.dirname(entry.path), entry.target)), allEntries);
      if (!names.has(target)) refuse();
    }
    const external = [await regularPin(value.node, 256 * 1024 * 1024)];
    for (const unit of value.units) external.push(await regularPin(unit, 1024 * 1024));
    await hooks.beforeFinalCheck?.();
    for (const observed of [...snapshots, ...external]) {
      if (!same(fingerprint(await lstat(observed.path)), observed.fingerprint)
        || await realpath(dirname(observed.path)) !== dirname(observed.path)) refuse();
    }
    for (const observed of snapshots) {
      const entry = observed.entry;
      if (entry.kind === 'directory' && (dependencies(entry.path) || built(entry.path))) {
        await membership(observed.path, children.get(entry.path) ?? []);
      }
      if (entry.kind === 'link' && (await readlink(observed.path) !== entry.target || await realpath(observed.path) !== join(root, manifestDestination(posix.normalize(posix.join(posix.dirname(entry.path), entry.target)), allEntries)))) refuse();
    }
    for (const path of absencePaths) await absent(path);
    const afterRoot = await lstat(root);
    if (beforeRoot.dev !== afterRoot.dev || beforeRoot.ino !== afterRoot.ino || beforeRoot.mode !== afterRoot.mode
      || await realpath(root) !== root || !bytes.equals(await readPrivateFile(path, 256 * 1024))) refuse();
    return {baselineRoot: root, closureSha256: pin.sha256, inventorySha256: value.inventorySha256,
      previous: value.previous, node: value.node, units: value.units, protectedHooks: value.protectedHooks};
  } catch { return refuse(); }
}

}

export const inspectRuntimeBaselineClosure = createRuntimeBaselineInspector();
