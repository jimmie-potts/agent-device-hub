// One SQLite lease domain for the core, offline tools and early runtime admission.
import {constants, type Stats} from 'node:fs';
import {lstat, open, realpath} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const SQLITE_BUSY = 5;
const LEASE_POLL_MS = 20;
const errcode = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode : undefined;

/** A held lease: the lock database's open exclusive transaction, released once. */
export type Lock = {release: () => void};
/** The lock files this process holds a lease on. */
const held = new Set<string>();
const heldFiles = new Set<string>();
const fileKey = (info: Stats): string => `${info.dev}:${info.ino}`;
const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

/**
 * Takes the store's lease, as the Hub's adapter does: an exclusive transaction held open on a lock database beside the
 * store, `<store>-owner`, private to its owner. Another holder, in another process or in this one, is waited for until
 * `signal` aborts at agent-state's deadline. The store's own file keeps the locking its opener gave it. An in-memory store,
 * which no other connection can open, has no lock file. Offline tools take it through `holdRuntimeLease` (Hub #931).
 */
export async function takeLock(location: string | null, signal: AbortSignal): Promise<Lock> {
  if (location === null || location === '') return {release: () => {}};
  return acquire(`${location}-owner`, signal, false);
}

/** Existing bootstrap only. Uses the same canonical filename registry and actual SQLite write lock. */
export function takeExistingLock(location: string): Promise<Lock> {
  return acquire(`${location}-owner`, AbortSignal.abort(), true);
}

/** No SQLite recovery or journaling is permitted on the empty coordination file. */
export async function checkLeaseSidecars(path: string): Promise<void> {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    const exists = await lstat(`${path}${suffix}`).then(() => true, (error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    });
    if (exists) throw new Error('invalid-store');
  }
}
function validFile(info: Stats, existingOnly: boolean): void {
  if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() ||
    (existingOnly ? (info.mode & 0o7777) !== 0o600 || info.size !== 0 : (info.mode & 0o077) !== 0)) throw new Error('invalid-store');
}
async function acquire(requested: string, signal: AbortSignal, existingOnly: boolean): Promise<Lock> {
  // Normalize before consulting the shared registry, including legacy relative/dot/directory-link spellings.
  // Keep the leaf unfollowed so the ordinary O_NOFOLLOW contract still rejects a symlink lease.
  const absolute = resolve(requested);
  const path = join(await realpath(dirname(absolute)), basename(absolute));
  for (;;) {
    const before = await lstat(path).catch((error: unknown) => {
      if (!existingOnly && typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (before !== undefined) validFile(before, existingOnly);
    // Metadata probes do not open/close the inode. Also guard a held inode renamed to a different pathname.
    if (held.has(path) || (before !== undefined && heldFiles.has(fileKey(before)))) {
      signal.throwIfAborted();
      await wait(LEASE_POLL_MS);
      continue;
    }
    held.add(path);
    let key: string | undefined;
    try {
      if (existingOnly) {
        if (before === undefined) throw new Error('invalid-store');
        await checkLeaseSidecars(path);
        key = fileKey(before);
      } else {
        const file = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        try {
          const info = await file.stat();
          validFile(info, false);
          key = fileKey(info);
        } finally {
          await file.close();
        }
      }
      heldFiles.add(key);
      // mode=rw refuses a vanished file. readOnly cannot provide exclusive writer exclusion.
      const uri = pathToFileURL(path); uri.searchParams.set('mode', 'rw');
      const lock = new DatabaseSync(existingOnly ? uri.href : path);
      try {
        // No rollback journal: the lock database holds no data, so taking the lock writes nothing, even on a full disk.
        lock.exec('PRAGMA busy_timeout = 0; PRAGMA journal_mode = MEMORY; BEGIN EXCLUSIVE');
      } catch (error) {
        lock.close();
        throw error;
      }
      let released = false;
      return {release: () => {
        if (released) return;
        released = true;
        if (lock.isTransaction) lock.exec('ROLLBACK');
        lock.close();
        held.delete(path);
        if (key !== undefined) heldFiles.delete(key);
      }};
    } catch (error) {
      held.delete(path);
      if (key !== undefined) heldFiles.delete(key);
      if (errcode(error) !== SQLITE_BUSY) throw error;
      signal.throwIfAborted();
      await wait(LEASE_POLL_MS);
    }
  }
}
