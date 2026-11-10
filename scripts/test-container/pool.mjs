// The shared test pool (Hub #1641): one cgroup in the Docker VM, /sys/fs/cgroup/bunny-tests, that holds every container
// `npm run test:container` and `npm run test:runtime:container` start, under one memory and CPU ceiling, and admission
// by headroom without a daemon. The cgroup lives in the VM's memory, so a Docker VM restart removes it and the next
// run recreates it. The helpers write only that directory; nothing here writes the VM's root cgroup or `docker/`.
// docs/development.md "One test job in a container" is the procedure.
import {randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {loadavg, platform} from 'node:os';
import {join} from 'node:path';

// The pinned multi-architecture alpine index every helper and reader runs.
export const IMAGE = 'docker.io/library/alpine@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf';
// For the scratch exercises only: a different pool directory, one safe path segment that starts with bunny-.
export const SCRATCH_ENV = 'BUNNY_TEST_POOL_SCRATCH_NAME';
export const DEFAULT_POOL = 'bunny-tests';
export const CORE = 'bunny-mac-personal-core-1';
// 5 GiB, no swap, 6 CPUs, and a CPU weight of 25 against the default 100 that the core keeps (#1635 Appendix A).
export const LIMITS = Object.freeze({'memory.max':'5368709120', 'memory.swap.max':'0', 'cpu.max':'600000 100000', 'cpu.weight':'25'});
export const MAX_LOAD = 8;
export const MAX_CHECK_MS = 500;
export const SLOTS = 5; // The count check when there is no pool.
export const RECHECK_MS = 30_000;
export const HOLD_MS = 30_000; // A start keeps the lock this long after its container exists.
export const STALE_MS = 10 * 60_000;
export const GAVE_UP = 75;

/** The pool directory name: the default, or the scratch override after validation. */
export function poolName(env = process.env) {
  const name = env[SCRATCH_ENV];
  if (name === undefined || name === '') return DEFAULT_POOL;
  if (!validName(name)) throw new Error(`${SCRATCH_ENV} must be one path segment of lowercase letters, digits and inner hyphens that starts with bunny- (at most 48 characters), not ${name}`);
  return name;
}

const validName = name => typeof name === 'string' && name.length <= 48 && /^bunny-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
const checked = name => { if (!validName(name)) throw new Error('pool-name-refused'); return name; };
const helper = id => ['run','--rm','--name',`bunny-tests-pool-${id}`,'--network','none'];
const confined = ['--cap-drop','ALL','--security-opt','no-new-privileges','--read-only'];

// $1 is the pool name. Prints key=value lines; reads only.
export const READ = [
  'p="/hostcg/$1"',
  'echo "controllers=$(cat /hostcg/cgroup.subtree_control)"',
  'if [ -d "$p" ]; then echo exists=1; for f in memory.max memory.swap.max cpu.max cpu.weight; do echo "$f=$(cat "$p/$f")"; done;',
  'awk \'$1=="anon"||$1=="shmem"{print $1"="$2}\' "$p/memory.stat"; awk \'$1=="oom_kill"{print "oom_kill="$2}\' "$p/memory.events";',
  'else echo exists=0; fi',
].join('\n');
// $1..$4 are the limits; /pool is the pool's own directory and nothing else.
export const SET = 'echo "$1" > /pool/memory.max && echo "$2" > /pool/memory.swap.max && echo "$3" > /pool/cpu.max && echo "$4" > /pool/cpu.weight';
// $1 is /sys/fs/cgroup/<pool>, $2..$5 the limits. Writes only inside $1, which must already exist.
export const PRIVILEGED_SET = 'p="$1"; [ -d "$p" ] || exit 3; echo "$2" > "$p/memory.max" && echo "$3" > "$p/memory.swap.max" && echo "$4" > "$p/cpu.max" && echo "$5" > "$p/cpu.weight"';
const values = () => [LIMITS['memory.max'], LIMITS['memory.swap.max'], LIMITS['cpu.max'], LIMITS['cpu.weight']];

export const readerArgs = (name, id) => [...helper(id), ...confined, '--volume','/sys/fs/cgroup:/hostcg:ro', IMAGE, 'sh','-c', READ, 'reader', checked(name)];
export const createArgs = (name, id) => [...helper(id), ...confined, '--cgroup-parent', `/${checked(name)}`, IMAGE, 'true'];
export const setterArgs = (name, id) => [...helper(id), ...confined, '--volume', `/sys/fs/cgroup/${checked(name)}:/pool`, IMAGE, 'sh','-c', SET, 'setter', ...values()];
export const privilegedSetterArgs = (name, id) => [...helper(id), '--privileged','--cgroupns=host', IMAGE, 'sh','-c', PRIVILEGED_SET, 'setter', `/sys/fs/cgroup/${checked(name)}`, ...values()];

/** The reader's key=value output as an object. */
export function parseReading(text) {
  const fields = Object.fromEntries(text.split('\n').map(line => line.split('=')).filter(parts => parts.length >= 2).map(([key, ...rest]) => [key.trim(), rest.join('=').trim()]));
  const number = key => (fields[key] === undefined ? 0 : Number(fields[key]));
  return {
    controllers: (fields.controllers ?? '').split(/\s+/).filter(Boolean),
    exists: fields.exists === '1',
    limits: Object.fromEntries(Object.keys(LIMITS).map(key => [key, fields[key]])),
    anon: number('anon'), shmem: number('shmem'), oomKill: number('oom_kill'),
  };
}

const matches = reading => Boolean(reading?.exists) && Object.entries(LIMITS).every(([key, value]) => reading.limits[key] === value);
const gib = bytes => (bytes / 1024 ** 3).toFixed(1);

/** One line describing a reading's limits. */
export function describe(reading) {
  const {limits} = reading;
  const [quota, period] = (limits['cpu.max'] ?? '').split(' ').map(Number);
  const cpus = quota && period ? String(quota / period) : limits['cpu.max'];
  const swap = limits['memory.swap.max'] === '0' ? 'no swap' : `swap ${limits['memory.swap.max']}`;
  const memory = /^\d+$/.test(limits['memory.max'] ?? '') ? `${gib(Number(limits['memory.max']))} GiB memory` : `memory ${limits['memory.max']}`;
  return `${memory}, ${swap}, ${cpus} CPUs, CPU weight ${limits['cpu.weight']}`;
}

/** The pool's current reading, or null when the reader cannot run. */
export function readPool(io, name, id = randomUUID) {
  const out = io.read(readerArgs(name, id()));
  return out === null ? null : parseReading(out);
}

/**
 * Makes sure the pool exists with its limits, creating it after a VM restart, and returns its name; or null after
 * printing why it is unavailable, in which case the caller uses per-container limits and the count check.
 */
export async function ensurePool(io, name, id = randomUUID) {
  const unavailable = reason => { io.log(`pool unavailable: ${reason}; using per-container limits and the count check`); return null; };
  const attempt = async args => (await io.run(args).catch(() => 1)) === 0;
  let reading = readPool(io, name, id);
  if (!reading) return unavailable('the read-only pool reader could not run');
  const missing = ['memory', 'cpu'].filter(controller => !reading.controllers.includes(controller));
  if (missing.length) return unavailable(`the VM's root cgroup does not give its children the ${missing.join(' and ')} controller`);
  if (!reading.exists) {
    if (!await attempt(createArgs(name, id())) || !(reading = readPool(io, name, id))?.exists) return unavailable(`the /${name} cgroup could not be created`);
  }
  let setBy = 'nobody: they were already set';
  if (!matches(reading)) {
    setBy = 'the unprivileged helper';
    if (!await attempt(setterArgs(name, id())) || !matches(reading = readPool(io, name, id))) {
      setBy = 'the privileged helper';
      if (!await attempt(privilegedSetterArgs(name, id())) || !matches(reading = readPool(io, name, id))) {
        return unavailable(`neither helper could set the /${name} limits`);
      }
    }
  }
  io.log(`pool /${name}: ${describe(reading)} (read back; set by ${setBy})`);
  return name;
}

/** The installed core's health from `docker inspect --format '{{json .State.Health}}'`, or null when there is none. */
export function coreHealth(text) {
  if (text === null || text === '' || text === 'null') return null;
  try {
    const health = JSON.parse(text);
    const last = health?.Log?.at(-1);
    const ms = last ? Date.parse(last.End) - Date.parse(last.Start) : NaN;
    return {status: health?.Status ?? 'unknown', lastMs: Number.isFinite(ms) ? Math.round(ms) : null};
  } catch { return {status: 'unreadable', lastMs: null}; }
}

/** Slots taken by running containers under the rule: all but the core, diagnostics, Tronbyt and pool helpers. */
export function countSlots(names) {
  return (names ?? '').split('\n').map(name => name.trim()).filter(Boolean).reduce((sum, name) => {
    if (name === CORE || /^bunny-(?:diagnostics|tronbyt)-/.test(name) || /^bunny-tests-pool-/.test(name)) return sum;
    return sum + (name.endsWith('-wide') ? 2 : 1);
  }, 0);
}

/** Everything admission reads. */
export function readings(io, pool) {
  const load = io.loadavg()[0];
  const core = coreHealth(io.read(['inspect','--format','{{json .State.Health}}',CORE]));
  if (pool) return {load, core, pool: readPool(io, pool)};
  return {load, core, used: countSlots(io.read(['ps','--format','{{.Names}}']))};
}

/** Why a start must wait, or null. `need` is {bytes, slots}. */
export function decide(reading, need) {
  if (reading.load >= MAX_LOAD) return `the host's 1-minute load is ${reading.load.toFixed(1)}, at or above ${String(MAX_LOAD)}`;
  if (reading.core) {
    if (reading.core.status !== 'healthy') return `the installed core is ${reading.core.status}, not healthy`;
    if (reading.core.lastMs !== null && reading.core.lastMs >= MAX_CHECK_MS) return `the installed core's last health check took ${String(reading.core.lastMs)} ms, ${String(MAX_CHECK_MS)} or more`;
  }
  if ('pool' in reading) {
    if (!reading.pool?.exists) return 'the pool cannot be read';
    const max = Number(reading.pool.limits['memory.max']);
    const used = reading.pool.anon + reading.pool.shmem;
    if (max - used < need.bytes) return `the pool holds ${gib(used)} of ${gib(max)} GiB and this job needs ${gib(need.bytes)} GiB free`;
    return null;
  }
  if (reading.used + need.slots > SLOTS) return `${String(reading.used)} of ${String(SLOTS)} test-job slots are taken and this job needs ${String(need.slots)}`;
  return null;
}

/** The start lock's directory: one fixed path every session on this machine shares, whatever its TMPDIR. */
export const lockDirectory = () => (platform() === 'darwin' ? '/private/tmp/bunny-test-start' : '/tmp/bunny-test-start');

/** Takes the start lock, or reports that another start holds it. A lock whose owner is gone or is stale is taken over. */
export async function tryLock(io, directory) {
  await mkdir(directory, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (io.uid !== undefined && stat.uid !== io.uid)) {
    throw new Error(`the start lock directory ${directory} must be a directory of this user with mode 0700`);
  }
  const lock = join(directory, 'lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(lock, {mode:0o700});
      await writeFile(join(lock, 'owner'), JSON.stringify({pid: io.pid, at: io.now()}));
      let held = true;
      return {held, release: async () => { if (held) { held = false; await rm(lock, {recursive:true, force:true}); } }};
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await readFile(join(lock, 'owner'), 'utf8').then(JSON.parse).catch(() => null);
      const stale = !owner || io.now() - owner.at > STALE_MS || !io.alive(owner.pid);
      if (!stale || attempt > 0) return {held:false};
      io.log('took over a start lock whose owner is gone or that is older than 10 minutes');
      await rm(lock, {recursive:true, force:true});
    }
  }
  return {held:false};
}

/**
 * Waits until a start may go ahead and returns {status: 0, release} holding the start lock, or {status: 75} after
 * `waitMinutes`, or {status: 130} when interrupted. Prints a line only when the reason for waiting changes.
 */
export async function admission(io, {pool, need, waitMinutes, directory = io.lockDir, interrupted = () => false, signal}) {
  const deadline = io.now() + waitMinutes * 60_000;
  let last = null;
  for (;;) {
    if (interrupted()) return {status:130};
    let reason;
    const lock = await tryLock(io, directory);
    if (!lock.held) reason = 'another test job is starting';
    else {
      reason = decide(readings(io, pool), need);
      if (reason === null) return {status:0, release: lock.release};
      await lock.release();
    }
    if (reason !== last) { io.log(`waiting: ${reason}`); last = reason; }
    if (io.now() >= deadline) { io.log(`gave up after ${String(waitMinutes)} min: ${reason}`); return {status:GAVE_UP}; }
    await io.sleep(RECHECK_MS, signal);
  }
}

/** The pool's oom_kill count, or null. */
export const oomKills = (io, pool) => (pool ? readPool(io, pool)?.oomKill ?? null : null);

/** Says once that a job in the pool was killed for memory, so nobody raises the ceiling by reflex. */
export function reportOverflow(io, pool, before, after) {
  if (before === null || after === null || after <= before) return;
  io.log(`the pool killed ${String(after - before)} process(es) for memory while this job ran: treat that as a failed run to retry, not a reason to raise the /${pool} ceiling`);
}

/** The host side of the pool: timing, load and process facts. Docker calls come from the caller's io. */
export const hostFacts = Object.freeze({
  loadavg,
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise(done => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); done(); }, {once:true});
  }),
  later: (ms, task) => { setTimeout(task, ms).unref(); },
  alive: pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } },
  pid: process.pid,
  uid: process.getuid?.(),
  lockDir: lockDirectory(),
});
