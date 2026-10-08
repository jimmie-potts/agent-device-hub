// The Pixoo library migration on a real full disk (Hub #931), run by pixoo-migration.test.ts inside a user and mount
// namespace (`unshare -rm`), as #972's full-disk test runs the core. For each size, it mounts a private tmpfs of that
// size, migrates the library into a state directory on it with the free-space check given room, so the copy, the
// database or its last checkpoint meets ENOSPC, and prints one JSON line: the size, the exit code, the tool's line, which
// of the module's files are left, and, after a migration, the verifier's exit code.
//   node pixoo-full-disk.js <directory for the mounts> <library>
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {runPixooMigration} from '../../src/pixoo-migration.js';

const [dir = '', library = ''] = process.argv.slice(2);
if (dir === '' || library === '') throw new Error('usage: pixoo-full-disk.js <directory> <library>');
const SIZES_KIB = Array.from({length: 26}, (_, index) => 100 + index * 20);
const FILES = ['pixoo.sqlite', 'pixoo.sqlite-wal', 'pixoo.sqlite-journal', 'pixoo.sqlite-shm', 'pixoo'];

const run = async (argv: string[], room: boolean): Promise<{exit: number; line: unknown}> => {
  let text = '';
  const exit = await runPixooMigration(argv, {
    write: line => { text += line; },
    ...(room ? {freeSpace: () => Promise.resolve({freeBytes: 2 ** 40, blockSize: 4096})} : {}),
  });
  return {exit, line: JSON.parse(text) as unknown};
};

for (const sizeKiB of SIZES_KIB) {
  const mount = join(dir, String(sizeKiB));
  mkdirSync(mount);
  const mounted = spawnSync('mount', ['-t', 'tmpfs', '-o', `size=${String(sizeKiB)}k,mode=700`, 'tmpfs', mount], {encoding: 'utf8'});
  if (mounted.status !== 0) throw new Error(`mount failed: ${mounted.stderr}`);
  const state = join(mount, 'state');
  const migrated = await run(['migrate', '--library', library, '--state-dir', state, '--min-free-bytes', '0'], true);
  const left = FILES.filter(name => existsSync(join(state, 'modules', name)));
  const verify = migrated.exit === 0 ? (await run(['verify', '--library', library, '--state-dir', state], false)).exit : undefined;
  process.stdout.write(`${JSON.stringify({sizeKiB, exit: migrated.exit, line: migrated.line, left, ...(verify === undefined ? {} : {verify})})}\n`);
  spawnSync('umount', [mount]);
}
