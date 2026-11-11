// The shared test pool (Hub #1641): one cgroup in the Docker VM, /sys/fs/cgroup/bunny-tests, that holds every container
// `npm run test:container` and `npm run test:runtime:container` start, under one memory and CPU ceiling, and admission
// by headroom without a daemon. The cgroup lives in the VM's memory, so a Docker VM restart removes it and the next
// run recreates it. The helpers write only that directory. Nothing in this change writes `cgroup.subtree_control` or
// anything under `docker/`; the container runtime enables the pool's controllers when it creates a container there, as
// it already does under `docker/`.
// docs/development.md "One test job in a container" is the procedure.
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {loadavg, platform, release} from 'node:os';
import {join} from 'node:path';
import {profiles} from './profile.mjs';

// The pinned multi-architecture alpine index every helper and reader runs.
export const IMAGE = 'docker.io/library/alpine@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf';
// For the scratch exercises only: a different pool directory, one safe path segment that starts with bunny-.
export const SCRATCH_ENV = 'BUNNY_TEST_POOL_SCRATCH_NAME';
// The Mac profile's values (./profile.mjs), under the names other scripts and tests import. Only the Mac has a pool.
export const DEFAULT_POOL = profiles.mac.pool.name;
export const CORE = profiles.mac.core;
// 5 GiB, no swap, 6 CPUs, and a CPU weight of 25 against the default 100 that the core keeps (#1635 Appendix A).
export const LIMITS = profiles.mac.pool.limits;
export const MAX_LOAD = profiles.mac.startLoad;
export const MAX_CHECK_MS = 500;
// The rule's slot count (docs/development.md "Test work on the Mac", rule 1). The command enforces it with and without the
// pool. It counts containers only; a session still counts its native suites itself under the rule's start check.
export const SLOTS = profiles.mac.slots;
export const RECHECK_MS = 30_000;
export const LOCK_RECHECK_MS = 3_000; // When the only reason to wait is another start holding the lock.
export const HOLD_MS = 30_000; // A start keeps the lock this long after its container exists.
export const OWNER_GRACE_MS = 10_000; // A lock without an owner file is stale only after this long.
export const DOCKER_TIMEOUT_MS = 60_000; // No Docker read may hang past the wait.
export const HELPER_TIMEOUT_MS = 60_000; // A pool helper that runs longer has failed.
// A lock older than this is taken over even if a process with its owner's number is alive (the number may have been
// reused). It is far longer than the longest legitimate hold, which is a cold image build: a wait does not hold the lock.
export const MAX_HOLD_MS = 6 * 3_600_000;
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
  // A counter that is missing or not a whole number reads as NaN, which never admits (see decide) or reports.
  const number = key => (/^\d+$/.test(fields[key] ?? '') ? Number(fields[key]) : NaN);
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
 * One command invocation's pool state: the privileged helper is attempted at most once per invocation, and each pool
 * line is printed only when it differs from the last one printed.
 */
export const poolSession = () => ({privilegedTried:false, lastLine:null, repaired:new Set()});

/**
 * Makes sure the pool exists with its limits, creating it after a VM restart, and returns its name; or null after
 * printing why it is unavailable. At start-up the caller then uses per-container limits and the count check; during an
 * admission wait (`waiting`) the start keeps waiting instead.
 */
export async function ensurePool(io, name, id = randomUUID, {waiting = false, session = poolSession()} = {}) {
  const say = line => { if (line !== session.lastLine) { session.lastLine = line; io.log(line); } };
  const unavailable = reason => {
    say(waiting ? `pool not ready: ${reason}; still waiting` : `pool unavailable: ${reason}; using per-container limits and the count check`);
    return null;
  };
  // A helper that fails, cannot start or outlasts HELPER_TIMEOUT_MS has failed.
  const attempt = async args => io.run(args, {timeout:HELPER_TIMEOUT_MS}).catch(() => 1);
  let reading = readPool(io, name, id);
  if (!reading) return unavailable('the read-only pool reader could not run');
  const missing = ['memory', 'cpu'].filter(controller => !reading.controllers.includes(controller));
  if (missing.length) return unavailable(`the VM's root cgroup does not give its children the ${missing.join(' and ')} controller`);
  if (!reading.exists) {
    if (await attempt(createArgs(name, id())) !== 0 || !(reading = readPool(io, name, id))?.exists) return unavailable(`the /${name} cgroup could not be created`);
  }
  let setBy = 'nobody: they were already set';
  if (!matches(reading)) {
    setBy = 'the unprivileged helper';
    const status = await attempt(setterArgs(name, id()));
    if (status !== 0 || !matches(reading = readPool(io, name, id))) {
      const why = status !== 0 ? `exit status ${String(status)}` : `its readback was ${reading ? describe(reading) : 'unreadable'}`;
      if (session.privilegedTried) return unavailable(`the unprivileged helper could not set the /${name} limits (${why}), and the privileged helper already ran once in this run`);
      say(`the unprivileged helper could not set the /${name} limits (${why}); trying the owner-approved privileged helper`);
      session.privilegedTried = true;
      setBy = 'the privileged helper';
      if (await attempt(privilegedSetterArgs(name, id())) !== 0 || !matches(reading = readPool(io, name, id))) {
        return unavailable(`neither helper could set the /${name} limits`);
      }
    }
  }
  say(`pool /${name}: ${describe(reading)} (read back; set by ${setBy})`);
  return name;
}

/** The installed core's health from `docker inspect --format '{{json .State.Health}}'`; unreadable output is not healthy. */
export function coreHealth(text) {
  if (text === null || text === '' || text === 'null') return {status:'unreadable', lastMs:null};
  try {
    const health = JSON.parse(text);
    const last = health?.Log?.at(-1);
    const ms = last ? Date.parse(last.End) - Date.parse(last.Start) : NaN;
    return {status: health?.Status ?? 'unreadable', lastMs: Number.isFinite(ms) ? Math.round(ms) : null};
  } catch { return {status:'unreadable', lastMs:null}; }
}

/** Containers from `docker ps -a --format '{{.Names}}\t{{.State}}'`: {names, states, running}. A paused one counts as running. */
export function parseContainers(text) {
  const rows = text.split('\n').map(line => line.split('\t').map(part => part.trim())).filter(([name]) => name);
  return {
    names: rows.map(([name]) => name),
    states: Object.fromEntries(rows.map(([name, state]) => [name, state ?? ''])),
    running: rows.filter(([, state]) => state === 'running' || state === 'paused').map(([name]) => name),
  };
}

/** Slots taken by running containers under the rule: all but the core, diagnostics, Tronbyt and pool helpers. */
export function countSlots(names) {
  return names.reduce((sum, name) => {
    if (name === CORE || /^bunny-(?:diagnostics|tronbyt)-/.test(name) || /^bunny-tests-pool-/.test(name)) return sum;
    return sum + (name.endsWith('-wide') ? 2 : 1);
  }, 0);
}

/** Everything admission reads. A failed read is kept as an error, which makes the start wait. */
export function readings(io, pool, profile = profiles.mac) {
  const load = io.loadavg()[0];
  const listing = io.read(['ps','-a','--format','{{.Names}}\t{{.State}}']);
  if (listing === null) return {load, error:'docker ps failed, so the running test jobs cannot be counted'};
  const containers = parseContainers(listing);
  // A profile without a core checks none. Otherwise only a machine with no container of that name has no installed
  // core, and any failure to read its health is a wait.
  const name = profile.core;
  const core = name && containers.names.includes(name)
    ? {...coreHealth(io.read(['inspect','--format','{{json .State.Health}}',name])), state: containers.states[name]}
    : null;
  const reading = {load, core, used: countSlots(containers.running)};
  if (pool) reading.pool = readPool(io, pool);
  return reading;
}

export const NOT_READY = 'the pool is missing, unreadable or without its limits';
// What a pool repair depends on: existence, controllers and limits, not the memory counters that change all the time.
const poolKey = pool => JSON.stringify(pool ? {exists:pool.exists, controllers:pool.controllers, limits:pool.limits} : null);
export const LOCK_BUSY = 'another test job is starting';

/** Why a start must wait, or null. `need` is {bytes, slots}; `profile` gives the load threshold and slot count. */
export function decide(reading, need, profile = profiles.mac) {
  const {startLoad, slots} = profile;
  if (reading.error) return reading.error;
  if (!Number.isFinite(reading.load)) return "the host's 1-minute load cannot be read";
  if (reading.load >= startLoad) return `the host's 1-minute load is ${reading.load.toFixed(1)}, at or above ${String(startLoad)}`;
  if (reading.core) {
    if (reading.core.state !== 'running') return `the installed core is ${reading.core.state || 'in an unknown state'}, not running`;
    if (reading.core.status === 'unreadable') return "the installed core's health cannot be read";
    if (reading.core.status !== 'healthy') return `the installed core is ${reading.core.status}, not healthy`;
    if (!Number.isFinite(reading.core.lastMs) || reading.core.lastMs < 0) return "the installed core's last health check time cannot be read";
    if (reading.core.lastMs >= MAX_CHECK_MS) return `the installed core's last health check took ${String(reading.core.lastMs)} ms, ${String(MAX_CHECK_MS)} or more`;
  }
  if (!Number.isInteger(reading.used) || reading.used < 0) return 'the running test jobs cannot be counted';
  if (reading.used + need.slots > slots) return `${String(reading.used)} of ${String(slots)} test-job slots are taken and this job needs ${String(need.slots)}`;
  if ('pool' in reading) {
    // Fail closed: only a pool that reads back with exactly its intended limits is a ceiling to admit against.
    if (!matches(reading.pool) || !Number.isFinite(reading.pool.anon) || !Number.isFinite(reading.pool.shmem)) return NOT_READY;
    const max = Number(LIMITS['memory.max']);
    const used = reading.pool.anon + reading.pool.shmem;
    if (max - used < need.bytes) return `the pool holds ${gib(used)} of ${gib(max)} GiB and this job needs ${gib(need.bytes)} GiB free`;
  }
  return null;
}

/** The start lock's directory: one fixed path every session on this machine shares, whatever its TMPDIR. */
export const lockDirectory = () => (platform() === 'darwin' ? '/private/tmp/bunny-test-start' : '/tmp/bunny-test-start');

const ownerOf = lock => readFile(join(lock, 'owner'), 'utf8').then(JSON.parse).catch(() => null);
// Stale: the owner's process is gone, or the lock is older than MAX_HOLD_MS, or it has had no owner file for the grace.
const isStale = async (io, lock, owner) => {
  if (!owner) return await ageOf(io, lock) > OWNER_GRACE_MS;
  if (!io.alive(owner.pid)) return true;
  // A live owner's lock is taken over only when its recorded age is a number past the bound; an unreadable age waits.
  const age = io.now() - owner.at;
  return Number.isFinite(age) && age > MAX_HOLD_MS;
};
// How long ago a path last changed; a path that cannot be read counts as new. `io.ageOf` replaces it in tests.
const ageOf = (io, path) => (io.ageOf ? io.ageOf(path) : lstat(path).then(stat => Date.now() - stat.mtimeMs).catch(() => 0));

/**
 * Takes the start lock, or reports that another start holds it. The lock carries a random token, and release removes it
 * only while the token is still this holder's. A lock is taken over only when its owner's process is gone, when it is
 * older than MAX_HOLD_MS (longer than any legitimate hold, so a reused process number cannot keep it forever), or when it
 * has had no owner file for OWNER_GRACE_MS. One taker at a time removes a stale lock, under a second directory that
 * `mkdir` creates atomically, and re-tests the lock there first.
 */
export async function tryLock(io, directory) {
  await mkdir(directory, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (io.uid !== undefined && stat.uid !== io.uid)) {
    throw new Error(`the start lock directory ${directory} must be a directory of this user with mode 0700`);
  }
  const lock = join(directory, 'lock');
  const takeover = join(directory, 'takeover');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(lock, {mode:0o700});
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await ownerOf(lock);
      const stale = await isStale(io, lock, owner);
      if (!stale || attempt > 0) return {held:false, owner};
      try { await mkdir(takeover, {mode:0o700}); } catch (taken) {
        if (taken.code !== 'EEXIST') throw taken;
        if (await ageOf(io, takeover) > OWNER_GRACE_MS) await rm(takeover, {recursive:true, force:true});
        return {held:false, owner};
      }
      try {
        // Re-test under the takeover directory: another taker may have replaced the stale lock already, perhaps with a
        // fresh lock that has no owner file yet, so the token must be unchanged and the lock must still be stale.
        const again = await ownerOf(lock);
        if ((again?.token ?? null) !== (owner?.token ?? null) || !await isStale(io, lock, again)) return {held:false, owner:again};
        await rm(lock, {recursive:true, force:true});
        io.log(`took over the start lock ${lock}, whose owner process ${String(owner?.pid ?? 'unknown')} is gone or whose lock is too old`);
      } finally { await rm(takeover, {recursive:true, force:true}); }
      continue;
    }
    const token = randomUUID();
    await writeFile(join(lock, 'owner'), JSON.stringify({pid: io.pid, at: io.now(), token}));
    let held = true;
    return {held, token, release: async () => {
      if (!held) return;
      held = false;
      if ((await ownerOf(lock))?.token === token) await rm(lock, {recursive:true, force:true});
    }};
  }
  return {held:false};
}

/**
 * Waits until a start may go ahead and returns {status: 0, release} holding the start lock, or {status: 75} after
 * `waitMinutes`, or {status: 130} when interrupted. Prints a line only when the reason for waiting changes. A pool that
 * is missing or without its limits is set up again with `ensurePool`, once for each distinct reading of it. The only
 * repeated side effect is the read-only pool reader, once per recheck.
 */
export async function admission(io, {pool, need, waitMinutes, directory = io.lockDir, interrupted = () => false, signal, session = poolSession(), profile = profiles.mac}) {
  const deadline = io.now() + waitMinutes * 60_000;
  let last = null;
  for (;;) {
    if (interrupted()) return {status:130};
    let reason;
    let reading = null;
    const lock = await tryLock(io, directory);
    const busy = !lock.held;
    if (busy) reason = `${LOCK_BUSY} (lock ${join(directory, 'lock')}, held by process ${String(lock.owner?.pid ?? 'unknown')})`;
    else {
      reading = readings(io, pool, profile);
      reason = decide(reading, need, profile);
      if (reason === null) return {status:0, release: lock.release};
      await lock.release();
    }
    if (reason !== last) { io.log(`waiting: ${reason}`); last = reason; }
    // Repair the pool at most once for each distinct reading of it in this run, never on a timer.
    if (reason === NOT_READY) {
      const key = poolKey(reading?.pool);
      if (!session.repaired.has(key)) { session.repaired.add(key); await ensurePool(io, pool, randomUUID, {waiting:true, session}); }
    }
    if (io.now() >= deadline) { io.log(`gave up after ${String(waitMinutes)} min: ${reason}`); return {status:GAVE_UP}; }
    await io.sleep(busy ? LOCK_RECHECK_MS : RECHECK_MS, signal);
  }
}

/** The pool's oom_kill count, or null. */
export const oomKills = (io, pool) => { const count = pool ? readPool(io, pool)?.oomKill : null; return Number.isFinite(count) ? count : null; };

/** Says once that a job in the pool was killed for memory, so nobody raises the ceiling by reflex. */
export function reportOverflow(io, pool, before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) return;
  io.log(`the pool killed ${String(after - before)} process(es) for memory while this job ran: treat that as a failed run to retry, not a reason to raise the /${pool} ceiling`);
}

/** The host side of the pool: timing, load and process facts. Docker calls come from the caller's io. */
export const hostFacts = Object.freeze({
  loadavg,
  // What ./profile.mjs `selectProfile` checks before it gives the PC profile: the platform and the kernel release.
  platform: platform(),
  osRelease: release(),
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

/** Runs a Docker command and returns its trimmed output, or null on failure or after `DOCKER_TIMEOUT_MS`. */
export function dockerRead(args) {
  try { return execFileSync('docker', args, {encoding:'utf8', stdio:['ignore','pipe','ignore'], timeout:DOCKER_TIMEOUT_MS}).trim(); } catch { return null; }
}
