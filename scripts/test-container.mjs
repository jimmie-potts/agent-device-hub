// `npm run test:container`: one test job in a disposable, limited Linux container that starts from prebuilt
// dependencies (Hub #1638). The job's source is a private snapshot of the current tracked and nonignored files,
// mounted read-only; the container copies it over the image's node_modules, builds unless told not to and runs one
// package script. docs/development.md "One test job in a container" is the procedure.
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {constants, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {snapshot} from './runtime-container.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const recipePath = 'scripts/test-container/Dockerfile';
const keyLabel = 'org.bunny.test-deps.key';
const USAGE = 'usage: npm run test:container -- --issue <n> --job <name> [--size standard|wide] [--no-build] [--network] -- <package script> [arguments...]';

// The owner's container sizes. Swap equal to memory means the container cannot swap.
export const sizes = Object.freeze({
  standard: Object.freeze({cpus:'2', memory:'1250m', slots:1, suffix:''}),
  wide: Object.freeze({cpus:'4', memory:'2048m', slots:2, suffix:'-wide'}),
});
const order = ['standard', 'wide'];

// Package scripts known not to fit a smaller size, with the measurement behind each row.
export const minimums = Object.freeze({
  // Hub #1637: at 1250 MiB the verification suite was killed for memory (oom_kill 2, browser-speech crashed); it
  // passed at 1536 MiB, its largest process-memory sample being 1.18 GB.
  'test:runtime:verify:built': Object.freeze({size:'wide', message:'test:runtime:verify:built needs more than 1250 MiB: use --size wide, or npm run test:runtime:container -- --suite verify, which has its own 1536 MiB limit'}),
  // Hub #1635: the SDK suite failed 8 of 20 runs at 2 CPUs or fewer and 0 of 4 at 4 CPUs.
  'test:sdk:built': Object.freeze({size:'wide', message:'test:sdk:built fails below 4 CPUs: use --size wide'}),
});

// Package scripts that never run in a test container.
export const refused = Object.freeze({
  // Hub #1636: each lint shard holds 1.4 to 1.9 GB under a 2,048 MB heap budget.
  'lint:js': 'lint:js does not fit a test container: run it natively, one at a time, with npm run lint:js (see docs/static-analysis.md "Heap budget")',
  'test:container': 'test:container starts Docker on the host and cannot run inside a test container',
  'test:runtime:container': 'test:runtime:container starts Docker on the host: run it directly with npm run test:runtime:container',
});

/** The plan for a command line, or an Error naming what was refused. `scripts` is package.json's scripts. */
export function parse(args, scripts) {
  const separator = args.indexOf('--');
  if (separator === -1) throw new Error(USAGE);
  const own = args.slice(0, separator);
  const [script, ...rest] = args.slice(separator + 1);
  const plan = {issue:undefined, job:undefined, size:'standard', build:true, network:false};
  for (let i = 0; i < own.length; i++) {
    const option = own[i];
    if (option === '--no-build') plan.build = false;
    else if (option === '--network') plan.network = true;
    else if (['--issue', '--job', '--size'].includes(option) && i + 1 < own.length) plan[option.slice(2)] = own[++i];
    else throw new Error(USAGE);
  }
  if (plan.issue === undefined || plan.job === undefined || script === undefined) throw new Error(USAGE);
  if (!/^[1-9]\d{0,5}$/.test(plan.issue)) throw new Error(`the issue must be a GitHub issue number, not ${plan.issue}`);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(plan.job) || plan.job.endsWith('-wide')) {
    throw new Error(`the job name must be lowercase letters, digits and inner hyphens, at most 32 characters, not ending in -wide: ${plan.job}`);
  }
  if (!Object.hasOwn(sizes, plan.size)) throw new Error(`the size must be standard or wide, not ${plan.size}`);
  if (Object.hasOwn(refused, script)) throw new Error(refused[script]);
  if (!Object.hasOwn(scripts, script)) throw new Error(`no package script named ${script}: pass the name of a package.json script, not a command`);
  const size = sizes[plan.size];
  return Object.freeze({...plan, script, args:rest, name:`bunny-gh${plan.issue}-${plan.job}${size.suffix}`, slots:size.slots});
}

/** Why the plan must not start, or null. The one place that decides whether a job starts (#1641 adds headroom). */
export function admit(plan, {nameTaken}) {
  const minimum = minimums[plan.script];
  if (minimum && order.indexOf(plan.size) < order.indexOf(minimum.size)) return minimum.message;
  if (nameTaken) return `a container named ${plan.name} already exists; choose another --job name (this command never stops or removes a container it did not start)`;
  return null;
}

/** The dependency image key: the lockfile and the recipe, nothing else. */
export function imageKey(lockfile, recipe) {
  const hash = createHash('sha256').update('bunny-test-deps/1\0');
  for (const [name, bytes] of [['package-lock.json', lockfile], [recipePath, recipe]]) {
    hash.update(`${name}\0${String(bytes.length)}\0`).update(bytes);
  }
  return hash.digest('hex').slice(0, 24);
}

// A path docker's --volume and --cidfile options carry unchanged.
const safePath = path => /^\/[A-Za-z0-9._/-]+$/.test(path);

/** Every docker run argument of a job. The one place that builds them (#1641 adds --cgroup-parent here). */
export function runArgs(plan, {imageId, source, cidfile}) {
  if (!safePath(source) || !safePath(cidfile)) throw new Error('scratch-path-refused');
  const size = sizes[plan.size];
  return ['run','--rm','--init','--name',plan.name,'--cidfile',cidfile,'--network',plan.network ? 'bridge' : 'none',
    '--cpus',size.cpus,'--memory',size.memory,'--memory-swap',size.memory,
    '--cap-drop','ALL','--cap-add','CHOWN','--security-opt','no-new-privileges','--restart','no',
    '--volume',`${source}:/snapshot:ro`,
    '--env','TMPDIR=/tmp','--env','XDG_RUNTIME_DIR=','--env','DBUS_SESSION_BUS_ADDRESS=',
    imageId, plan.build ? 'build' : 'no-build', plan.script, ...plan.args];
}

/** A process's exit status as a shell reports it. */
export function exitStatus(code, signal) {
  if (code !== null && code !== undefined) return code;
  const number = signal ? constants.signals[signal] : undefined;
  return number === undefined ? 1 : 128 + number;
}

function spawned(program, args) {
  return new Promise((done, fail) => {
    const child = spawn(program, args, {stdio:'inherit'});
    child.once('error', fail);
    child.once('exit', (code, signal) => done(exitStatus(code, signal)));
  });
}

function captured(program, args) {
  try { return execFileSync(program, args, {encoding:'utf8', stdio:['ignore','pipe','ignore']}).trim(); } catch { return null; }
}

export const host = Object.freeze({
  run: args => spawned('docker', args),
  read: args => captured('docker', args),
  snapshot,
  log: line => process.stderr.write(`test-container: ${line}\n`),
  onInterrupt: handler => { process.on('SIGINT', handler); process.on('SIGTERM', handler); },
});

/** Runs one job and returns its exit status. `io` is the host, or a fake in tests. */
export async function runJob(argv, io = host, repository = root) {
  let plan;
  try {
    plan = parse(argv, JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')).scripts ?? {});
  } catch (error) { io.log(error.message); return 2; }
  const refusal = admit(plan, {nameTaken: io.read(['container','inspect','--format','{{.Id}}',plan.name]) !== null});
  if (refusal) { io.log(refusal); return 2; }
  const state = {interrupted:false, id:null};
  io.onInterrupt(() => { state.interrupted = true; if (state.id) kill(io, state.id); });
  const scratch = await mkdtemp(join(tmpdir(), 'bunny-test-container-')); // Mode 0700; it holds only the snapshot.
  const work = await mkdtemp(join(tmpdir(), 'bunny-test-container-work-'));
  const source = join(scratch, 'source');
  const cidfile = join(work, 'cid');
  let status = 1;
  try {
    if (!safePath(source) || !safePath(cidfile)) {
      io.log(`the scratch path ${scratch} cannot be passed to docker unchanged: set TMPDIR to a directory whose path uses only letters, digits, dot, underscore, slash and hyphen`);
      status = 2;
    } else {
      status = await job(plan, io, state, {repository, source, work, cidfile});
    }
  } catch (error) {
    io.log(error instanceof Error ? error.message : String(error));
  } finally {
    state.id ??= await containerId(cidfile);
    // --rm removes the container when it exits; remove it here only if it is still there, and only by its own ID.
    // A cleanup failure is reported; it turns a passing job into status 1 and leaves a failing job's status alone.
    if (state.id && io.read(['container','inspect','--format','{{.Id}}',state.id]) !== null) {
      const removed = await io.run(['rm','--force',state.id]).catch(error => {
        io.log(`could not run docker rm: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
      });
      if (removed !== 0) {
        io.log(`could not remove container ${state.id}`);
        if (status === 0) status = 1;
      }
    }
    for (const directory of [scratch, work]) {
      await rm(directory, {recursive:true, force:true, maxRetries:3}).catch(error => {
        io.log(`could not remove ${directory}: ${error instanceof Error ? error.message : String(error)}`);
        if (status === 0) status = 1;
      });
    }
  }
  return status;
}

/** Kills the job's own container by its ID; a failure to do so is reported and the run goes on to its cleanup. */
function kill(io, id) {
  io.run(['kill', id]).catch(error => io.log(`could not run docker kill: ${error instanceof Error ? error.message : String(error)}`));
}

async function containerId(cidfile) {
  const id = (await readFile(cidfile, 'utf8').catch(() => '')).trim();
  return /^[a-f0-9]{64}$/.test(id) ? id : null;
}

async function job(plan, io, state, {repository, source, work, cidfile}) {
  const files = await io.snapshot(repository, source);
  if (!files.includes('package-lock.json') || !files.includes(recipePath)) throw new Error('the snapshot has no package-lock.json or dependency recipe');
  const recipe = await readFile(join(source, recipePath));
  const key = imageKey(await readFile(join(source, 'package-lock.json')), recipe);
  const tag = `bunny-test-deps:${key}`;
  if (io.read(['image','inspect','--format','{{.Id}}',tag]) === null) {
    io.log(`building ${tag}, the dependencies for this lockfile and recipe. This is a host step with network, outside the job's limits; later runs with the same lockfile reuse the image.`);
    const context = join(work, 'context');
    for (const path of files.filter(file => file === 'package-lock.json' || /(?:^|\/)package\.json$/.test(file))) {
      await mkdir(dirname(join(context, path)), {recursive:true});
      await writeFile(join(context, path), await readFile(join(source, path)));
    }
    await writeFile(join(context, 'Dockerfile'), recipe);
    const built = await io.run(['build','--tag',tag,'--build-arg',`BUNNY_TEST_DEPS_KEY=${key}`,context]);
    if (built !== 0) { io.log(`the dependency image build failed with status ${String(built)}`); return built; }
  }
  const [imageId, label] = (io.read(['image','inspect','--format',`{{.Id}} {{index .Config.Labels "${keyLabel}"}}`,tag]) ?? '').split(' ');
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId ?? '') || label !== key) {
    io.log(`${tag} does not carry this lockfile's key, so it is not used: ask the owner to remove the ${tag} tag, then run again to rebuild it`);
    return 2;
  }
  if (state.interrupted) return 130;
  const size = sizes[plan.size];
  io.log(`${plan.name}: ${plan.size} size (${size.cpus} CPUs, ${size.memory} memory, no swap), ${String(size.slots)} slot${size.slots === 1 ? '' : 's'}, network ${plan.network ? 'enabled for this job' : 'none'}`);
  let settled = false;
  const running = io.run(runArgs(plan, {imageId, source, cidfile})).finally(() => { settled = true; });
  // docker run writes the container ID once it has created the container. Until then an interrupt reaches the
  // container through docker run's own signal proxy.
  while (!settled && !state.id) {
    state.id = await containerId(cidfile);
    if (!state.id) await new Promise(wait => setTimeout(wait, 50));
  }
  if (state.id && state.interrupted) kill(io, state.id);
  return await running;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runJob(process.argv.slice(2)).then(status => { process.exitCode = status; }, error => {
    host.log(`stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
