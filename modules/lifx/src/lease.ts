// The writer lease per bulb (Hub #928). Copied from `acquireWriterLease` in controllers/tidbyt/src/runner.ts at main
// 483d3a93, which the local controller host takes for each LIFX bulb as `lifx:<address>`, and converted for the module:
// the lease files live in the module's private folder, and a lease another holder has is an answer, not a throw, so the
// module keeps running and reports that bulb unavailable (policy A). A lease is an exclusive transaction on its own SQLite
// file, so a second holder in this or another process is refused until the first releases it or its process ends.
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, realpathSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export type Lease = {release(): void};

/** The lease files this process holds, so a second holder in the same process is refused too. */
const held = new Set<string>();

const own = (uid: number): boolean => uid === process.getuid?.();

/**
 * Takes the writer lease for the bulb at `address` under `root`, a folder created owner-only when missing. Answers
 * undefined when another holder has it, or when the folder or the lease file is not a private one this user owns.
 */
export function acquireLease(root: string, address: string): Lease | undefined {
  let database: DatabaseSync | undefined;
  let path: string | undefined;
  try {
    mkdirSync(root, {recursive: true, mode: 0o700});
    const folder = lstatSync(root);
    if (!folder.isDirectory() || !own(folder.uid) || (folder.mode & 0o077) !== 0) return undefined;
    path = join(realpathSync(root), `${createHash('sha256').update(`lifx:${address}`).digest('hex')}.sqlite`);
    if (held.has(path)) return undefined;
    held.add(path);
    const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const file = fstatSync(fd);
      if (!file.isFile() || !own(file.uid) || (file.mode & 0o077) !== 0) throw new Error('lease-not-private');
    } finally {
      closeSync(fd);
    }
    database = new DatabaseSync(path);
    database.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE');
  } catch {
    database?.close();
    if (path !== undefined) held.delete(path);
    return undefined;
  }
  const opened = database, file = path;
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      try {
        opened.close();
      } finally {
        held.delete(file);
      }
    },
  };
}
