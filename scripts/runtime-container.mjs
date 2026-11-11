// Disposable Linux checks for the current working tree, never the installed runtime.
import {spawn, spawnSync, execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {admission, DOCKER_TIMEOUT_MS, dockerRead, ensurePool, hostFacts, HOLD_MS, oomKills, poolName, poolSession, reportOverflow} from './test-container/pool.mjs';
import {profileLine, profiles, redactor, redactorFor, scratchBase, selectProfile} from './test-container/profile.mjs';

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

// The Mac profile's values (./test-container/profile.mjs), under the names tests import; each run takes its own
// profile's. Two CPUs keep node --test at a small worker count; swap equal to memory means no swap.
export const limits = profiles.mac.runtimeCheck;

// The free pool memory this runner waits for before its container (its own limit) and before an image build.
const needOf = profile => Number(profile.runtimeCheck.memory.slice(0, -1)) * 1024 ** 2;
export const NEED_BYTES = needOf(profiles.mac);
export const BUILD_BYTES = profiles.mac.buildBytes;

/** The container's create arguments; `pool` is the shared test pool's name (Hub #1641), or null. */
export function createArgs(name, imageId, suite, pool = null, profile = profiles.mac) {
  const limits = profile.runtimeCheck;
  return ['create','--init','--name',name,'--network','none','--cpus',limits.cpus,'--memory',limits.memory,'--memory-swap',limits.memory,
    ...(pool ? ['--cgroup-parent',`/${pool}`] : []),
    '--cap-drop','ALL','--cap-add','CHOWN','--security-opt','no-new-privileges','--restart','no',
    '--env','TMPDIR=/tmp','--env','XDG_RUNTIME_DIR=','--env','DBUS_SESSION_BUS_ADDRESS=',imageId,suite];
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

export const host = Object.freeze({
  ...hostFacts,
  env: process.env,
  run: (args, {timeout} = {}) => command('docker', args, timeout ? {timeout} : {}),
  // A Docker command whose output is needed and whose error text the person should see.
  capture: args => {
    const result = spawnSync('docker', args, {encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:DOCKER_TIMEOUT_MS});
    const stderr = result.stderr || (result.error ? result.error.message : '');
    if (stderr) process.stderr.write(stderr.endsWith('\n') ? stderr : stderr + '\n');
    return {status: result.status ?? 1, stdout: result.stdout ?? '', stderr};
  },
  read: dockerRead,
  snapshot,
  print: line => console.log(line),
  log: line => console.error('runtime-container: ' + line),
});

/** Runs the chosen suites in a disposable container and returns their status. `io` is the host, or a fake in tests. */
export async function runChecks(argv, io = host, repository = root) {
  // The profile comes first, so its line is the command's first own line even before a usage error.
  let profile;
  try { profile = selectProfile(io.env, io); } catch (error) { io.log(error.message); return 2; }
  if (profile.scratch === 'cache') {
    // Under the PC profile every line this run prints names the home and cache directories as ~ and $XDG_CACHE_HOME.
    const redact = redactor(profile, io.env);
    const {log, print} = io;
    io = Object.create(io, {log:{value: line => log(redact(line))}, print:{value: line => print(redact(line))}});
  }
  io.log(profileLine(profile));
  const suite = parse(argv);
  const session = poolSession();
  const pool = profile.pool ? await ensurePool(io, poolName(io.env), undefined, {session}) : null;
  let release = null;
  const admit = async bytes => {
    const gate = await admission(io, {pool, need:{bytes, slots:1}, waitMinutes:30, session, profile});
    if (gate.status !== 0) throw Object.assign(new Error('admission-gave-up'), {status:gate.status});
    release = gate.release;
  };
  const scratch = await mkdtemp(join(await scratchBase(profile, io.env), 'bunny-runtime-check-'));
  const name = 'bunny-runtime-check-' + randomUUID();
  let created = false;
  let status;
  let cleanupError;
  try {
    const source = join(scratch,'source');
    const files = await io.snapshot(repository, source);
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
    const missing = () => io.read(['image','inspect','--format','{{.Id}}',image]) === null;
    if (missing()) {
      await admit(profile.buildBytes);
      // A run that waited while another built the same image uses that image.
      if (missing()) {
        status = await io.run(['build','--tag',image,...(pool ? ['--cgroup-parent',`/${pool}`] : []),context]);
        if (status !== 0) throw Object.assign(new Error('container-check-failed'), {status});
      }
      await release(); release = null;
    }
    const imageId = io.read(['image','inspect','--format','{{.Id}}',image]) ?? '';
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('tool-image-identity-refused');
    await admit(needOf(profile));
    const before = oomKills(io, pool);
    io.print(pool ? `In the /${pool} pool.` : profile.pool ? 'No pool: per-container limits and the count check.' : "No pool: this host's profile has none.");
    const made = io.capture(createArgs(name, imageId, suite, pool, profile));
    const id = made.stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(id)) {
      // The engine may have created the container although the CLI failed or timed out. Remove it only by this run's own
      // unique name, and only if it exists.
      if (io.read(['container','inspect','--format','{{.Id}}',name]) !== null) await io.run(['rm','--force',name]);
      throw new Error(`container-create-failed: ${made.stderr.trim() || 'docker create returned no container ID'}`);
    }
    created = id;
    io.print('Disposable runtime checks: ' + name + ' ' + id);
    status = await io.run(['cp',source + '/.',id + ':/work/source']);
    if (status !== 0) throw Object.assign(new Error('container-check-failed'), {status});
    const held = release;
    io.later(HOLD_MS, () => { void held?.(); });
    status = await io.run(['start','--attach',id]);
    reportOverflow(io, pool, before, oomKills(io, pool));
    // docker start --attach may return zero for a failed process on some engine versions.
    const state = JSON.parse(io.read(['inspect','--format','{{json .State}}',id]) ?? '{"Running":true}');
    if (state.Running || state.Pid !== 0 || !Number.isInteger(state.ExitCode)) throw new Error('container-completion-unknown');
    status ||= state.ExitCode;
  } catch (error) {
    if (!error.status) throw error;
    status = error.status;
  } finally {
    await release?.().catch(() => {});
    if (created) {
      const cleaned = await io.run(['rm','--force',created]);
      if (cleaned !== 0) cleanupError = new Error('owned-container-cleanup-failed: ' + created);
    }
    await rm(scratch, {recursive:true, force:true});
  }
  if (cleanupError) throw cleanupError;
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runChecks(process.argv.slice(2)).then(status => {process.exitCode = status;}).catch(error => {console.error(redactorFor(host.env, host)(error.message));process.exitCode = 1;});
}
