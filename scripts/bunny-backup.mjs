// Private directory archives for the manual container profile. No activation or migration.
import {constants} from 'node:fs';
import {lstat, realpath, open, readdir, mkdir, unlink, mkdtemp, rm} from 'node:fs/promises';
import {join, dirname, resolve, isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';

export const STATE = '/var/lib/bunny';
export const CONFIG = '/etc/bunny/runtime.json';
export const SECRETS = '/run/secrets/bunny';
export const PENDING = '.restore-pending';
const OWNER = 'modules/core.sqlite-owner';
const SCHEMA = 'bunny-container-backup/1';
const fail = () => {throw new Error('backup-or-restore-refused');};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const absent = async path => {try {await lstat(path); return false;} catch (e) {if (e.code === 'ENOENT') return true; throw e;}};
const safeRelative = path => typeof path === 'string' && path.length < 4096 && !path.includes('\\') && !path.includes('\0') && path.split('/').every(x => x !== '' && x !== '.' && x !== '..');

export async function privatePath(path, directory = false) {
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) fail();
  const info = await lstat(path);
  if (info.uid !== process.getuid?.() || (info.mode & 0o7777) !== (directory ? 0o700 : 0o600)
    || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) fail();
  return info;
}
async function syncDir(path) {const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY); try {await fd.sync();} finally {await fd.close();}}
async function writeNew(path, bytes) {
  const fd = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {await fd.writeFile(bytes); await fd.sync();} finally {await fd.close();}
}
async function bytes(path, limit = 8 * 1024 * 1024) {
  const info = await privatePath(path);
  if (info.size > limit) fail();
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {if (!same(info, await fd.stat())) fail(); const data = await fd.readFile(); if (!same(info, await fd.stat())) fail(); return data;}
  finally {await fd.close();}
}
// Stream assets rather than buffering an entire media library. Never call this on the held lease inode.
async function copyOrHash(source, destination) {
  const before = await privatePath(source);
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output;
  try {
    if (!same(before, await input.stat())) fail();
    if (destination !== undefined) output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const digest = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let total = 0;
    for (;;) {
      const {bytesRead} = await input.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead); digest.update(chunk); total += bytesRead;
      if (output !== undefined) {
        let offset = 0;
        while (offset < chunk.length) offset += (await output.write(chunk, offset, chunk.length - offset, null)).bytesWritten;
      }
    }
    if (total !== before.size || !same(before, await input.stat()) || !same(before, await lstat(source))) fail();
    await output?.sync();
    return {bytes: total, sha256: digest.digest('hex')};
  } finally {await input.close(); await output?.close();}
}
async function tree(root, excludeLive = false) {
  const directories = [], files = [], excluded = [];
  let count = 0;
  async function walk(path, relative = '') {
    await privatePath(path, true);
    for (const name of (await readdir(path)).sort()) {
      const rel = relative === '' ? name : relative + '/' + name;
      if (++count > 100000 || !safeRelative(rel) || rel.split('/').length > 20) fail();
      const item = join(path, name), info = await lstat(item);
      if (excludeLive && rel === OWNER) {
        await privatePath(item); if (info.size !== 0) fail(); excluded.push(rel); continue;
      }
      if (excludeLive && rel === 'bunny-launch.sock') {
        if (!info.isSocket() || info.uid !== process.getuid?.() || (info.mode & 0o7777) !== 0o600) fail();
        excluded.push(rel); continue;
      }
      if (rel === PENDING) fail();
      if (info.isDirectory()) {directories.push(rel); await walk(item, rel);}
      else {await privatePath(item); files.push(rel);}
    }
  }
  await walk(root);
  return {directories, files, excluded};
}
async function refuseOwnerAlias(path, heldOwner) {
  if (heldOwner === undefined) return;
  // Metadata inspection never opens/closes the POSIX coordination inode.
  const info = await lstat(path);
  if (info.dev === heldOwner.dev && info.ino === heldOwner.ino) fail();
}
async function configuration(config, secrets, heldOwner) {
  await refuseOwnerAlias(config, heldOwner);
  const {readRuntimeConfig} = await import('../apps/runtime/dist/src/state.js');
  await readRuntimeConfig(config);
  const data = await bytes(config, 1024 * 1024), parsed = JSON.parse(data);
  const paths = new Set();
  function walk(value) {
    if (typeof value === 'string' && value.startsWith('/')) {
      // No implicit source-folder export or host path translation in this profile.
      if (!value.startsWith(secrets + '/')) fail(); paths.add(value);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
  }
  walk(parsed);
  const references = [];
  for (const path of [...paths].sort()) {
    await refuseOwnerAlias(path, heldOwner);
    references.push({path, ...await copyOrHash(path)});
  }
  return {data, sha256: hash(data), references};
}
async function makeDirectories(root, directories) {
  for (const relative of directories) await mkdir(join(root, relative), {mode: 0o700});
}
async function syncTree(root, directories) {
  for (const path of [...directories].reverse()) await syncDir(join(root, path));
  await syncDir(root);
}
async function validateDatabases(state, files) {
  // Validate disposable copies: SQLite may recover WAL/journal or create sidecars even on inspection.
  const scratch = await mkdtemp(join(await realpath(tmpdir()), 'bunny-db-check-'));
  try {
    for (const path of files.filter(p => /^modules\/[a-z][a-z0-9-]*\.sqlite$/.test(p))) {
      const target = join(scratch, 'database.sqlite');
      await copyOrHash(join(state, path), target);
      for (const suffix of ['-wal', '-shm', '-journal']) if (files.includes(path + suffix)) await copyOrHash(join(state, path + suffix), target + suffix);
      const database = new DatabaseSync(target);
      try {
        database.exec('PRAGMA locking_mode = EXCLUSIVE');
        const checks = database.prepare('PRAGMA quick_check').all();
        if (checks.length !== 1 || Object.values(checks[0])[0] !== 'ok') fail();
        const owner = path.slice('modules/'.length, -'.sqlite'.length);
        if (owner === 'core' || owner === 'onn') {
          const keyPath = `modules/${owner}/request-digest.key`;
          const table = database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'bunny_private_request_key'").get();
          const pins = table === undefined ? [] : database.prepare('SELECT id, digest FROM bunny_private_request_key').all();
          if (pins.length === 0) {if (files.includes(keyPath)) fail();}
          else {
            if (pins.length !== 1 || pins[0].id !== 1 || !files.includes(keyPath)) fail();
            const {PrivateRequestDigest} = await import('@jimmie-potts/sdk');
            // Existing SDK verifier checks key format and its DB pin, with no key initialization.
            new PrivateRequestDigest(database, () => join(state, 'modules', owner)).assertAvailable();
          }
        }
      } finally {database.close();}
      for (const name of await readdir(scratch)) await unlink(join(scratch, name));
    }
  } finally {await rm(scratch, {recursive: true, force: true});}
}
const validRevision = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
function disjoint(a, b) {if (a === b || a.startsWith(b + '/') || b.startsWith(a + '/')) fail();}

export async function backup({state = STATE, config = CONFIG, secrets = SECRETS, destination, revision}) {
  if (!validRevision(revision) || !isAbsolute(destination) || resolve(destination) !== destination) fail();
  disjoint(state, destination); disjoint(secrets, destination);
  const {checkStateDirectory} = await import('../apps/runtime/dist/src/state.js');
  await checkStateDirectory(dirname(destination));
  await privatePath(dirname(destination), true);
  if (!await absent(destination)) fail();
  const {acquireRuntimeOwnership, assertUnboundRuntimeOwnership} = await import('../apps/runtime/dist/src/runtime-ownership.js');
  const lease = await acquireRuntimeOwnership(state);
  try {
    const heldOwner = await lstat(join(state, OWNER));
    const selected = await configuration(config, secrets, heldOwner), before = await tree(state, true);
    if (!before.files.includes('modules/core.sqlite')) fail();
    await mkdir(destination, {mode: 0o700});
    const payload = join(destination, 'state'); await mkdir(payload, {mode: 0o700});
    await makeDirectories(payload, before.directories);
    const files = [];
    for (const path of before.files) files.push({path, ...await copyOrHash(join(state, path), join(payload, path))});
    await writeNew(join(destination, 'runtime.json'), selected.data);
    await validateDatabases(payload, before.files);
    if (!isDeepStrictEqual(before, await tree(state, true))) fail();
    for (const row of files) if (!isDeepStrictEqual({bytes: row.bytes, sha256: row.sha256}, await copyOrHash(join(state, row.path)))) fail();
    const again = await configuration(config, secrets, heldOwner);
    if (selected.sha256 !== again.sha256 || !isDeepStrictEqual(selected.references, again.references)) fail();
    await assertUnboundRuntimeOwnership(lease, state);
    await syncTree(payload, before.directories);
    const manifest = {schema: SCHEMA, revision, architecture: process.arch, createdAt: new Date().toISOString(),
      configSha256: selected.sha256, references: selected.references, directories: before.directories, files, excluded: before.excluded};
    await writeNew(join(destination, 'manifest.json'), JSON.stringify(manifest) + '\n');
    await syncDir(destination); await syncDir(dirname(destination));
    await verify({archive: destination, revision, config, secrets, heldOwner});
    return {operation: 'backup', status: 'complete', files: files.length};
  } finally {lease.releaseBeforeStartup();}
}
export async function verify({archive, revision, config = CONFIG, secrets = SECRETS, heldOwner}) {
  await privatePath(archive, true);
  if (!isDeepStrictEqual((await readdir(archive)).sort(), ['manifest.json', 'runtime.json', 'state'])) fail();
  const manifest = JSON.parse(await bytes(join(archive, 'manifest.json')));
  if (manifest.schema !== SCHEMA || !validRevision(revision) || manifest.revision !== revision
    || !Array.isArray(manifest.files) || !Array.isArray(manifest.directories) || !Array.isArray(manifest.excluded)
    || manifest.files.length > 100000 || manifest.directories.length > 100000
    || manifest.directories.some(p => !safeRelative(p)) || manifest.files.some(row => !safeRelative(row.path) || row.path === OWNER)
    || !manifest.files.some(row => row.path === 'modules/core.sqlite')) fail();
  const inventory = await tree(join(archive, 'state'));
  if (!isDeepStrictEqual(inventory.directories, manifest.directories) || !isDeepStrictEqual(inventory.files, manifest.files.map(row => row.path))) fail();
  const selected = await configuration(config, secrets, heldOwner);
  if (hash(await bytes(join(archive, 'runtime.json'))) !== manifest.configSha256 || selected.sha256 !== manifest.configSha256
    || !isDeepStrictEqual(selected.references, manifest.references)) fail();
  for (const row of manifest.files) if (!isDeepStrictEqual({bytes: row.bytes, sha256: row.sha256}, await copyOrHash(join(archive, 'state', row.path)))) fail();
  await validateDatabases(join(archive, 'state'), inventory.files);
  return manifest;
}
export async function restore({state = STATE, config = CONFIG, secrets = SECRETS, archive, revision}) {
  disjoint(state, archive); disjoint(secrets, state);
  const manifest = await verify({archive, revision, config, secrets});
  const {checkStateDirectory} = await import('../apps/runtime/dist/src/state.js');
  await checkStateDirectory(state);
  await privatePath(state, true);
  // Empty means empty: do not adopt an interrupted restore, existing lease, or failed latest state.
  if ((await readdir(state)).length !== 0) fail();
  const {holdRuntimeLease} = await import('../apps/runtime/dist/src/lease.js');
  const lease = await holdRuntimeLease(state);
  try {
    if (!isDeepStrictEqual(await tree(state, true), {directories: ['modules'], files: [], excluded: [OWNER]})) fail();
    await writeNew(join(state, PENDING), 'Restore incomplete. Preserve this state and inspect before any startup.\n'); await syncDir(state);
    for (const dir of manifest.directories) if (dir !== 'modules') await mkdir(join(state, dir), {mode: 0o700});
    for (const row of manifest.files) {
      const copied = await copyOrHash(join(archive, 'state', row.path), join(state, row.path));
      if (copied.bytes !== row.bytes || copied.sha256 !== row.sha256) fail();
    }
    await validateDatabases(state, manifest.files.map(row => row.path));
    await syncTree(state, manifest.directories);
    await unlink(join(state, PENDING)); await syncDir(state);
    return {operation: 'restore', status: 'complete', files: manifest.files.length, startup: 'stopped'};
  } finally {lease.release();}
}
