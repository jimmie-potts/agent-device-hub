// Per-host limits for test jobs (Hub #1681): one settings object per host, read by `npm run test:container`,
// `npm run test:runtime:container` and the shared admission in ./pool.mjs. The Mac profile is the default, for the Mac
// and for every host that does not ask for another one, including hosted CI. The PC profile applies only when
// BUNNY_TEST_HOST=pc is set on a WSL kernel, so the Mac can never get the PC's larger numbers.
// docs/development.md "Test work on the Mac" and "Test work on the PC" are the rules.
import {mkdir} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {isAbsolute, join} from 'node:path';

export const PROFILE_ENV = 'BUNNY_TEST_HOST';

const MIB = 1024 ** 2;
const freeze = value => Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item && typeof item === 'object' ? freeze(item) : item])));

export const profiles = freeze({
  // The Mac (#1635, #1641): its Docker VM also runs the installed core, the diagnostics stack and the Tronbyt server.
  mac: {
    name: 'mac',
    // At most 5 test jobs; start under a 1-minute load of 8; the newest job stops above 12 (a rule sessions apply
    // themselves: the tooling checks only the start).
    slots: 5, startLoad: 8, stopLoad: 12,
    // The shared test pool: 5 GiB, no swap, 6 CPUs, and a CPU weight of 25 against the default 100 the core keeps.
    pool: {name: 'bunny-tests', limits: {'memory.max':'5368709120', 'memory.swap.max':'0', 'cpu.max':'600000 100000', 'cpu.weight':'25'}},
    core: 'bunny-mac-personal-core-1',
    // Swap equal to memory means the container cannot swap.
    sizes: {standard: {cpus:'2', memory:'1250m', slots:1, suffix:''}, wide: {cpus:'4', memory:'2048m', slots:2, suffix:'-wide'}},
    // The free pool memory an image build waits for. Its RUN steps run in the pool; the engine's image export does not.
    buildBytes: 2048 * MIB,
    // `npm run test:runtime:container`: two CPUs keep node --test at a small worker count.
    runtimeCheck: {cpus:'2', memory:'1536m'},
    // Where a job's private source snapshot is written: the user's temporary directory.
    scratch: 'tmpdir',
  },
  // The owner's PC (owner decisions of 2026-11-11 on Hub #1681): 32 threads, Docker in WSL with about 19.5 GiB for
  // the Docker VM, no installed core and so no pool.
  pc: {
    name: 'pc',
    // Eight slots of 4 CPUs fill its 32 threads. The Mac's thresholds are 0.67 and 1.0 per core; with no core to
    // protect the PC starts under 0.75 per thread (24), and stops above 1.0 per thread (32). In the first PC run
    // (#1681), eight jobs at once peaked at a load of 24.59 with no kills; one timing-sensitive test failed (#1695).
    slots: 8, startLoad: 24, stopLoad: 32,
    pool: null,
    core: null,
    // Measured with test:runtime:built: about 1.2 GiB at 4 CPUs and 2.2 GiB at 8. Eight standard ceilings make 16 GiB,
    // as do four wide ones, which leaves about 3.5 GiB of the Docker VM for the engine, builds and the WSL distro.
    // One wide test:runtime:verify:built job peaked at 1660 MiB of 3584 and passed (#1696).
    sizes: {standard: {cpus:'4', memory:'2048m', slots:1, suffix:''}, wide: {cpus:'8', memory:'3584m', slots:2, suffix:'-wide'}},
    // Used only for pool headroom, so it has no effect without a pool.
    buildBytes: 2048 * MIB,
    runtimeCheck: {cpus:'2', memory:'1536m'},
    // Not /tmp, which is a small memory-backed tmpfs in the PC's WSL: $XDG_CACHE_HOME or ~/.cache.
    scratch: 'cache',
  },
});

/** The profile this host uses. Throws an Error naming the setting when it is malformed or asks for the PC elsewhere. */
export function selectProfile(env, {platform, osRelease} = {}) {
  const value = env[PROFILE_ENV];
  if (value === undefined || value === '' || value === 'mac') return profiles.mac;
  if (value !== 'pc') throw new Error(`${PROFILE_ENV} must be mac or pc, or unset for the Mac profile, not ${JSON.stringify(value)}`);
  // A WSL 2 kernel names itself microsoft-standard; hosted runners and other Linux machines do not.
  if (platform !== 'linux' || !/microsoft/i.test(osRelease ?? '')) {
    throw new Error(`${PROFILE_ENV}=pc is for the PC's WSL Linux only; unset it to use the Mac profile`);
  }
  return profiles.pc;
}

/** The one line that tells a reader which limits applied. */
export function profileLine(profile) {
  const {standard, wide} = profile.sizes;
  return `profile ${profile.name}: ${String(profile.slots)} slots, start under load ${String(profile.startLoad)}, stop above ${String(profile.stopLoad)}, `
    + `standard ${standard.cpus} CPUs ${standard.memory}, wide ${wide.cpus} CPUs ${wide.memory}, `
    + `${profile.pool ? `pool /${profile.pool.name}` : 'no pool'}, ${profile.core ? `core check ${profile.core}` : 'no core check'}`;
}

const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A function that rewrites a message for a profile whose scratch is under the cache: the cache directory (an absolute
 * $XDG_CACHE_HOME) becomes `$XDG_CACHE_HOME` and the home directory `~`, so a pasted message names no local user. For
 * the Mac profile the message is returned unchanged.
 */
export function redactor(profile, env, home = homedir()) {
  if (profile.scratch !== 'cache') return text => text;
  // A value that is only slashes strips to nothing and is skipped. The longer path goes first, so a cache directory that
  // is a parent of the home directory cannot leave the user name visible. A path is replaced only where it starts a
  // path (not after a path character) and ends one (at a slash, the end, or a character that is not a path character).
  const strip = value => (typeof value === 'string' ? value.replace(/\/+$/, '') : '');
  const pairs = [];
  const cache = env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? strip(env.XDG_CACHE_HOME) : '';
  if (cache) pairs.push([cache, '$XDG_CACHE_HOME']);
  if (strip(home)) pairs.push([strip(home), '~']);
  pairs.sort(([a], [b]) => b.length - a.length);
  const rules = pairs.map(([from, to]) => [new RegExp(`(?<![A-Za-z0-9._/-])${escaped(from)}(?=/|$|[^A-Za-z0-9._-])`, 'g'), to]);
  return text => rules.reduce((out, [pattern, to]) => out.replace(pattern, () => to), String(text));
}

/** The redactor for the profile `env` selects, or no change when the selection itself is refused. */
export function redactorFor(env, facts, home = homedir()) {
  try { return redactor(selectProfile(env, facts), env, home); } catch { return text => text; }
}

/**
 * Where a profile writes a job's scratch directories: the temporary directory, or for `cache` a bunny-test-container
 * directory under $XDG_CACHE_HOME (when absolute) or ~/.cache, created owner-only.
 */
export async function scratchBase(profile, env) {
  if (profile.scratch !== 'cache') return tmpdir();
  const cache = env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(homedir(), '.cache');
  const base = join(cache, 'bunny-test-container');
  await mkdir(base, {recursive:true, mode:0o700});
  return base;
}
