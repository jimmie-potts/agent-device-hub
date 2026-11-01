// Disposable Linux checks for the current working tree, never the installed runtime.
import {spawn, execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const suites = Object.freeze({all: ['test:runtime:scenarios:built', 'test:runtime:verify:built'],
  scenarios: ['test:runtime:scenarios:built'], verify: ['test:runtime:verify:built'], browser: ['test:runtime-dashboard:smoke']});
const privatePart = /^(?:\.git|\.local|\.private|private|secrets|backups|node_modules|dist|artifacts|coverage|test-results|playwright-report|__pycache__|\.codex|\.claude)$/i;
const privateName = /^(?:\.env(?:\..*)?|config\.local\..*|CLAUDE\.local\.md|\.DS_Store|Thumbs\.db)$|(?:\.local\.json|\.log|\.sqlite(?:3)?(?:-.*)?|\.db(?:-.*)?|\.key|\.pem|\.pfx|\.p12|\.pyc)$/i;

export function parse(args) {
  if (!args.length) return 'all';
  if (args.length === 2 && args[0] === '--suite' && Object.hasOwn(suites, args[1])) return args[1];
  throw new Error('usage: npm run test:runtime:container -- [--suite all|scenarios|verify|browser]');
}

export async function snapshot(repository, destination) {
  const entries = execFileSync('git', ['-C', repository, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {encoding:'utf8', maxBuffer:32 * 1024 * 1024}).split('\0').filter(Boolean);
  await mkdir(destination, {mode:0o755});
  const copied = [];
  for (const path of [...new Set(entries)].sort()) {
    const parts = path.split('/');
    if (parts.some(part => privatePart.test(part) || privateName.test(part))) continue;
    if (path.startsWith('/') || parts.some(part => !part || part === '.' || part === '..') || [...path].some(character => character === '\\' || character.charCodeAt(0) < 32)) throw new Error('source-entry-refused');
    // Check ancestors as well: a changed directory must not redirect reads outside the task.
    let missing = false;
    for (let i = 1; i <= parts.length; i++) {
      const stat = await lstat(join(repository, ...parts.slice(0,i))).catch(error => {if(error.code === 'ENOENT') return null; throw error;});
      if (!stat) {missing = true; break;}
      if (stat.isSymbolicLink() || (i === parts.length ? !stat.isFile() : !stat.isDirectory())) throw new Error('source-entry-refused');
    }
    if (missing) continue; // Tracked deletions are part of the current tree.
    const output = join(destination, path);
    await mkdir(dirname(output), {recursive:true, mode:0o755});
    await copyFile(join(repository,path), output);
    await chmod(output, (await lstat(output)).mode & 0o111 ? 0o755 : 0o644);
    copied.push(path);
  }
  return copied;
}

export async function runSuites(suite, run) {
  for (const name of suites[suite]) {
    const status = await run(['run', name]);
    if (status !== 0) return status;
  }
  return 0;
}

function command(program, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {stdio:'inherit', ...options});
    child.once('error', reject);
    child.once('exit', (status, signal) => resolvePromise(signal ? 1 : status ?? 1));
  });
}

async function main() {
  const suite = parse(process.argv.slice(2));
  const scratch = await mkdtemp(join(tmpdir(), 'bunny-runtime-check-'));
  const name = 'bunny-runtime-check-' + randomUUID();
  let created = false;
  let status;
  let cleanupError;
  try {
    const source = join(scratch,'source');
    const files = await snapshot(root, source);
    const context = join(scratch,'tool'); await mkdir(context, {mode:0o700});
    const manifests = files.filter(path => path === 'package-lock.json' || /(?:^|\/)package\.json$/.test(path));
    const hash = createHash('sha256');
    for (const path of manifests) {
      const bytes = await readFile(join(source,path)); hash.update(path).update(bytes);
      await mkdir(dirname(join(context,path)), {recursive:true}); await writeFile(join(context,path), bytes);
    }
    const recipe = await readFile(join(source,'scripts/runtime-container/Dockerfile'));
    hash.update(recipe); await writeFile(join(context,'Dockerfile'), recipe);
    const image = 'bunny-runtime-check-tools:' + hash.digest('hex').slice(0,24);
    status = await command('docker', ['build','--tag',image,context]);
    if (status !== 0) throw Object.assign(new Error('container-check-failed'), {status});
    const imageId = execFileSync('docker', ['image','inspect','--format','{{.Id}}',image], {encoding:'utf8'}).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('tool-image-identity-refused');
    const id = execFileSync('docker', ['create','--name',name,'--network','none','--cap-drop','ALL','--cap-add','CHOWN','--security-opt','no-new-privileges','--restart','no','--env','TMPDIR=/tmp','--env','XDG_RUNTIME_DIR=','--env','DBUS_SESSION_BUS_ADDRESS=',imageId,suite], {encoding:'utf8'}).trim();
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('container-identity-refused');
    created = id;
    console.log('Disposable runtime checks: ' + name + ' ' + id);
    status = await command('docker',['cp',source + '/.',id + ':/work/source']);
    if (status !== 0) throw Object.assign(new Error('container-check-failed'), {status});
    status = await command('docker',['start','--attach',id]);
    // docker start --attach may return zero for a failed process on some engine versions.
    const state = JSON.parse(execFileSync('docker',['inspect','--format','{{json .State}}',id],{encoding:'utf8'}));
    if (state.Running || state.Pid !== 0 || !Number.isInteger(state.ExitCode)) throw new Error('container-completion-unknown');
    status ||= state.ExitCode;
  } catch (error) {
    if (!error.status) throw error;
    status = error.status;
  } finally {
    if (created) {
      const cleaned = await command('docker',['rm','--force',created]);
      if (cleaned !== 0) cleanupError = new Error('owned-container-cleanup-failed: ' + created);
    }
    await rm(scratch, {recursive:true, force:true});
  }
  if (cleanupError) throw cleanupError;
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(status => {process.exitCode = status;}).catch(error => {console.error(error.message);process.exitCode = 1;});
}
