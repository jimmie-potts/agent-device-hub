import { open, opendir, realpath, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const fail = message => { throw new Error(message); };
function validatePath(path) {
  if (process.platform !== 'linux' || typeof path !== 'string' || resolve(path) !== path ||
    !path.split('/').includes('.local') || /[\r\n\0]/.test(path)) fail('Host storage root invalid');
}

/** Capture only roots already created/authorized by the run owner; identity is not ownership authorization. */
export async function hostTreeIdentity(path) {
  validatePath(path);
  try {
    if (await realpath(path) !== path) fail('Host storage root not canonical');
    const handle = await open(path, flags | constants.O_DIRECTORY);
    try {
      const info = await handle.stat({ bigint: true });
      return { path, device: String(info.dev), inode: String(info.ino) };
    } finally { await handle.close(); }
  } catch (error) {
    if (error.code) fail('Host storage root inspection failed');
    throw error;
  }
}

/** Bounded Linux descriptor-relative metadata walk; never reads file contents or returns names. */
export async function measureHostRunFiles(roots, { signal, maximumEntries = 10000, timeoutMs = 1000 } = {}) {
  if (!Array.isArray(roots) || roots.length < 1 || roots.length > 8 ||
    !Number.isInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 10000 ||
    !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) fail('Host storage limits invalid');
  for (const root of roots) {
    validatePath(root?.path);
    if (!/^[0-9]+$/.test(root.device ?? '') || !/^[0-9]+$/.test(root.inode ?? '')) fail('Host storage identity invalid');
  }
  if (roots.some((root, i) => roots.some((other, j) => i !== j &&
    (root.path === other.path || root.path.startsWith(other.path + '/'))))) fail('Host storage roots overlap');
  const started = performance.now(), seen = new Set();
  let entries = 0, files = 0, directories = 0, sockets = 0, apparent = 0n, allocated = 0n;
  function check() {
    if (signal?.aborted) fail('Host storage measurement aborted');
    if (performance.now() - started >= timeoutMs) fail('Host storage measurement deadline exceeded');
  }
  async function walk(handle, depth, device, socketStat) {
    check();
    if (++entries > maximumEntries || depth > 64) fail('Host storage traversal limit exceeded');
    const stat = socketStat ?? await handle.stat({ bigint: true });
    if (String(stat.dev) !== device || stat.size < 0n || stat.blocks < 0n) fail('Host storage filesystem metadata invalid');
    if (!stat.isFile() && !stat.isDirectory() && !(stat.isSocket() && stat.uid === BigInt(process.getuid()))) fail('Host storage entry type refused');
    const identity = `${stat.dev}:${stat.ino}`;
    if (seen.has(identity)) return;
    seen.add(identity); apparent += stat.size; allocated += stat.blocks * 512n;
    if (apparent > BigInt(Number.MAX_SAFE_INTEGER) || allocated > BigInt(Number.MAX_SAFE_INTEGER)) fail('Host storage size unsafe');
    if (stat.isFile()) { files++; return; }
    if (stat.isSocket()) { sockets++; return; }
    directories++;
    // Each child is resolved against an already-open directory, not a mutable ancestor path.
    const base = `/proc/self/fd/${handle.fd}`;
    const directory = await opendir(base);
    for await (const entry of directory) {
      check();
      const metadata = await lstat(`${base}/${entry.name}`, { bigint: true });
      if (metadata.isSocket()) { await walk(null, depth + 1, device, metadata); continue; }
      const child = await open(`${base}/${entry.name}`, flags);
      try { await walk(child, depth + 1, device); } finally { await child.close(); }
    }
  }
  try {
    for (const root of roots) {
      check();
      const current = await hostTreeIdentity(root.path);
      if (current.device !== root.device || current.inode !== root.inode) fail('Host storage root identity changed');
      const handle = await open(root.path, flags | constants.O_DIRECTORY);
      try {
        const stat = await handle.stat({ bigint: true });
        if (String(stat.dev) !== root.device || String(stat.ino) !== root.inode) fail('Host storage root identity changed');
        await walk(handle, 0, root.device);
      } finally { await handle.close(); }
      const after = await hostTreeIdentity(root.path);
      if (after.device !== root.device || after.inode !== root.inode) fail('Host storage root identity changed');
    }
    check();
  } catch (error) {
    if (error.code) fail('Host storage inspection failed');
    throw error;
  }
  return { source: 'owned-host-tree-stat', fileCount: files, directoryCount: directories, socketCount: sockets, entriesVisited: entries,
    apparentBytes: Number(apparent), allocatedBytes: Number(allocated), hostRunBytes: Number(apparent > allocated ? apparent : allocated),
    elapsedMs: performance.now() - started };
}
