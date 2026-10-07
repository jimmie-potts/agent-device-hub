// The writer lease per bulb (Hub #928). Copied from `acquireWriterLease` in controllers/tidbyt/src/runner.ts at main
// 483d3a93, which the local controller host takes for each LIFX bulb as `lifx:<address>`, and converted for the module:
// the lease files live in the module's private folder, and a lease the module cannot take is an answer that says why,
// not a throw, so the module keeps running and reports that bulb unavailable (policy A). A lease is an exclusive
// transaction on its own SQLite file, so a second holder in another process is refused until the first releases it or
// its process ends. A second holder in this process is refused before it opens the file: closing a second descriptor
// of a file drops every POSIX lock this process holds on it, which would free the first lease for other processes.
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, realpathSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export type Lease = {release(): void};
/**
 * Why a lease was refused: another holder has it (`busy`), the folder or the file is not a private one this user owns,
 * or is a link (`not-private`), or the file could not be opened or locked for another reason (`failed`).
 */
export type LeaseRefusal = 'busy' | 'not-private' | 'failed';
export type LeaseResult = {status: 'held'; lease: Lease} | {status: 'refused'; reason: LeaseRefusal};

/** SQLite's result code for a lock another connection holds, from a node:sqlite error's `errcode`. */
const SQLITE_BUSY = 5;

/** The lease files this process holds, so a second holder in the same process is refused too. */
const held = new Set<string>();

/** The lease file is not a private regular file this user owns. */
class NotPrivate extends Error {}

const own = (uid: number): boolean => uid === process.getuid?.();
const refused = (reason: LeaseRefusal): LeaseResult => ({status: 'refused', reason});
const codeOf = (error: unknown): unknown => typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
const busy = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'errcode' in error && error.errcode === SQLITE_BUSY;

/**
 * Takes the writer lease for the bulb at `address` under `folder`, which is created owner-only when missing. Answers the
 * lease, or why it was refused.
 */
export function acquireLease(folder: string, address: string): LeaseResult {
  let path: string;
  try {
    mkdirSync(folder, {recursive: true, mode: 0o700});
    const stat = lstatSync(folder);
    if (!stat.isDirectory() || !own(stat.uid) || (stat.mode & 0o077) !== 0) return refused('not-private');
    path = join(realpathSync(folder), `${createHash('sha256').update(`lifx:${address}`).digest('hex')}.sqlite`);
  } catch {
    return refused('failed');
  }
  if (held.has(path)) return refused('busy');
  held.add(path);
  let database: DatabaseSync | undefined;
  try {
    const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const file = fstatSync(fd);
      if (!file.isFile() || !own(file.uid) || (file.mode & 0o077) !== 0) throw new NotPrivate();
    } finally {
      closeSync(fd);
    }
    database = new DatabaseSync(path);
    database.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE');
  } catch (error) {
    database?.close();
    held.delete(path);
    if (busy(error)) return refused('busy');
    // A link in the file's place is refused by O_NOFOLLOW with ELOOP.
    if (codeOf(error) === 'ELOOP' || error instanceof NotPrivate) return refused('not-private');
    return refused('failed');
  }
  const opened = database;
  let released = false;
  return {
    status: 'held',
    lease: {
      release: () => {
        if (released) return;
        released = true;
        try {
          opened.close();
        } finally {
          held.delete(path);
        }
      },
    },
  };
}
