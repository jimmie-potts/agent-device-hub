// Host-side setup and ExecStopPost cleanup for one command's temporary files.
import {spawn} from 'node:child_process';
import {mkdir, writeFile, readFile, lstat, rm} from 'node:fs/promises';
import {dirname, basename, join, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

function validate(root, token) {
  if (!isAbsolute(root) || !/^[a-f0-9-]{36}$/.test(token) || basename(root) !== `vh-${token.slice(0, 8)}` ||
      basename(dirname(root)) !== 'scratch' || basename(dirname(dirname(root))) !== '.local') throw new Error('invalid temporary ownership');
}
export async function createTemporary(root, token) {
  validate(root, token);
  await mkdir(dirname(root), {recursive: true});
  await mkdir(root, {mode: 0o700}); // A collision must never reuse another command's files.
  await writeFile(join(root, '.owner'), token, {flag: 'wx', mode: 0o600});
}
export async function cleanupTemporary(root, token) {
  validate(root, token);
  let info;
  try { info = await lstat(root); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!info.isDirectory() || await readFile(join(root, '.owner'), 'utf8') !== token) throw new Error('temporary ownership mismatch');
  await rm(root, {recursive: true});
}
export async function inspectTemporary(root) {
  try { await lstat(root); return 'retained'; }
  catch (error) { return error.code === 'ENOENT' ? 'removed' : 'unknown'; }
}
export async function runCommand(root, token, argv) {
  await createTemporary(root, token);
  // ExecStopPost owns cleanup, including when this process is killed. No shell.
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {stdio: 'inherit', env: {...process.env, TMPDIR: root}});
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, root, token, ...args] = process.argv.slice(2);
  try {
    if (operation === 'cleanup' && args.length === 0) await cleanupTemporary(root, token);
    else if (operation === 'run' && args.length > 0) process.exitCode = await runCommand(root, token, args);
    else throw new Error('invalid host helper operation');
  } catch { console.error('Host temporary-directory setup or cleanup failed; inspect this command’s owned scratch path.'); process.exitCode = 1; }
}
