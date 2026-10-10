import {fstatSync, type Stats} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {checkStateDirectory} from './state.js';

const refused = (): never => { throw new Error('runtime-upgrade-lock-refused'); };

function privateLock(info: Stats): boolean {
  const uid = process.getuid?.();
  return uid !== undefined && info.isFile() && !info.isSymbolicLink() && info.nlink === 1
    && info.uid === uid && (info.mode & 0o7777) === 0o600;
}

/** Checks identity, not flock acquisition. The owning manual shell holds FD9. */
export async function requireUpgradeLock(directory: string): Promise<void> {
  try {
    const root = await checkStateDirectory(directory);
    const before = await lstat(root);
    if (!before.isDirectory()) return refused();
    const named = await lstat(join(root, 'install.lock'));
    const held = fstatSync(9);
    if (!privateLock(named) || !privateLock(held) || named.dev !== held.dev || named.ino !== held.ino) return refused();
    await checkStateDirectory(root);
    const after = await lstat(root);
    const current = await lstat(join(root, 'install.lock'));
    if (before.dev !== after.dev || before.ino !== after.ino || !privateLock(current)
      || current.dev !== held.dev || current.ino !== held.ino) return refused();
  } catch {
    return refused();
  }
}
