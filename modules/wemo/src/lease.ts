// Adapted from the LIFX module writer lease; same privacy, SQLite exclusion and release semantics.
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
 * Takes the writer lease for the plug identity `address` under `folder`, which is created owner-only when missing. Answers the
 * lease, or why it was refused.
 */
export function acquireLease(folder: string, address: string): LeaseResult {
  let path: string;
  try {
    mkdirSync(folder, {recursive: true, mode: 0o700});
    const stat = lstatSync(folder);
    if (!stat.isDirectory() || !own(stat.uid) || (stat.mode & 0o077) !== 0) return refused('not-private');
    path = join(realpathSync(folder), `${createHash('sha256').update(`wemo:${address}`).digest('hex')}.sqlite`);
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
