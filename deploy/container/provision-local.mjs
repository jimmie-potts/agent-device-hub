// One-shot public-shape provisioning for newly created, stopped host-local volumes only.
import {constants} from 'node:fs';
import {lstat, open, readdir, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const seed = '{"schema":"runtime-config/1.0","modules":{}}\n';
const config = {schema: 'runtime-config/1.0', modules: {}, edge: {
  credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false,
}};
async function privateEntry(path, directory) {
  const st = await lstat(path);
  if ((directory ? !st.isDirectory() : !st.isFile()) || st.isSymbolicLink() || st.uid !== process.getuid()
    || (st.mode & 0o7777) !== (directory ? 0o700 : 0o600) || (!directory && st.nlink !== 1)) throw new Error('provision-refused');
}
async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {await file.sync();} finally {await file.close();}
}
async function writeNew(path, value) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {await file.writeFile(JSON.stringify(value) + '\n'); await file.sync();} finally {await file.close();}
}
export async function provisionLocal(configDir = '/etc/bunny', secretsDir = '/run/secrets/bunny') {
  if (process.platform !== 'linux' || process.getuid?.() === 0) throw new Error('provision-refused');
  await privateEntry(configDir, true); await privateEntry(secretsDir, true);
  if ((await readdir(configDir)).join() !== 'runtime.json' || (await readdir(secretsDir)).length !== 0) throw new Error('provision-refused');
  const path = join(configDir, 'runtime.json'); await privateEntry(path, false);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {if (await file.readFile('utf8') !== seed) throw new Error('provision-refused');} finally {await file.close();}
  // Config is published last. An interruption leaves evidence that refuses an automatic retry.
  await writeNew(join(secretsDir, 'edge.json'), {schema: 'edge-credentials/1.0', credentials: []});
  await syncDirectory(secretsDir);
  const pending = join(configDir, '.runtime-local-pending'); await writeNew(pending, config);
  await rename(pending, path); await syncDirectory(configDir);
  return {operation: 'provision-local', status: 'complete', clientCredentials: 0, startup: 'stopped'};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2 || process.getuid?.() !== 1000) throw new Error('provision-refused');
    process.stdout.write(JSON.stringify(await provisionLocal()) + '\n');
  } catch {process.stderr.write('local provisioning refused; preserve the new volumes and inspect their preparation\n'); process.exitCode = 2;}
}
