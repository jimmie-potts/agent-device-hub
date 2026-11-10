import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  admission, countSlots, coreHealth, createArgs, decide, describe, ensurePool, IMAGE, LIMITS, parseReading, poolName,
  lockDirectory, PRIVILEGED_SET, privilegedSetterArgs, READ, readerArgs, reportOverflow, SET, setterArgs, tryLock,
} from '../test-container/pool.mjs';

const scratch = await mkdtemp(join(tmpdir(), 'test-container-pool-'));
after(() => rm(scratch, {recursive:true, force:true}));
let directories = 0;
const lockDir = () => join(scratch, `lock-${String(directories++)}`);
const healthy = JSON.stringify({Status:'healthy', Log:[{Start:'2026-11-10T00:00:00.000Z', End:'2026-11-10T00:00:00.080Z'}]});
const reading = ({exists = true, limits = LIMITS, anon = 0, shmem = 0, oom = 0, controllers = 'cpu io memory pids'} = {}) => [
  `controllers=${controllers}`, `exists=${exists ? 1 : 0}`,
  ...(exists ? [...Object.entries(limits).map(([key, value]) => `${key}=${value}`), `anon=${String(anon)}`, `shmem=${String(shmem)}`, `oom_kill=${String(oom)}`] : []),
].join('\n');

/** A fake host: `poolReads` answers the pool reader in turn, `loads` the load per 30 s step, `runs` each helper's status. */
function fake({poolReads = [reading()], loads = [1], runs = [], core = healthy, names = '', alive = () => true} = {}) {
  const calls = [];
  const lines = [];
  let clock = 0;
  let reads = 0;
  let ran = 0;
  return {
    calls, lines,
    log: line => lines.push(line),
    read: args => {
      calls.push(['read', ...args]);
      if (args[0] === 'run') { const answer = poolReads[Math.min(reads++, poolReads.length - 1)]; return answer; }
      if (args[0] === 'inspect') return core;
      if (args[0] === 'ps') return names;
      return null;
    },
    run: async args => { calls.push(args); return runs[ran++] ?? 0; },
    loadavg: () => [loads[Math.min(Math.floor(clock / 30_000), loads.length - 1)], 0, 0],
    now: () => clock,
    sleep: async ms => { clock += ms; },
    alive, pid: 4242, uid: process.getuid?.(),
  };
}
const ids = () => { let n = 0; return () => `u${String(n++)}`; };

test('the reader, creator and both setters are pinned, and nothing writes outside /sys/fs/cgroup/<pool>', () => {
  assert.equal(IMAGE, 'docker.io/library/alpine@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf');
  const confined = ['--cap-drop','ALL','--security-opt','no-new-privileges','--read-only'];
  assert.deepEqual(readerArgs('bunny-tests', 'u'), ['run','--rm','--name','bunny-tests-pool-u','--network','none',...confined,'--volume','/sys/fs/cgroup:/hostcg:ro',IMAGE,'sh','-c',READ,'reader','bunny-tests']);
  assert.deepEqual(createArgs('bunny-tests', 'u'), ['run','--rm','--name','bunny-tests-pool-u','--network','none',...confined,'--cgroup-parent','/bunny-tests',IMAGE,'true']);
  assert.deepEqual(setterArgs('bunny-tests', 'u'), ['run','--rm','--name','bunny-tests-pool-u','--network','none',...confined,'--volume','/sys/fs/cgroup/bunny-tests:/pool',IMAGE,'sh','-c',SET,'setter','5368709120','0','600000 100000','25']);
  assert.deepEqual(privilegedSetterArgs('bunny-tests', 'u'), ['run','--rm','--name','bunny-tests-pool-u','--network','none','--privileged','--cgroupns=host',IMAGE,'sh','-c',PRIVILEGED_SET,'setter','/sys/fs/cgroup/bunny-tests','5368709120','0','600000 100000','25']);
  // Every write target in the setters is inside the pool's own directory.
  assert.deepEqual([...SET.matchAll(/> (\S+)/g)].map(match => match[1]), ['/pool/memory.max','/pool/memory.swap.max','/pool/cpu.max','/pool/cpu.weight']);
  assert.deepEqual([...PRIVILEGED_SET.matchAll(/> (\S+)/g)].map(match => match[1]), ['"$p/memory.max"','"$p/memory.swap.max"','"$p/cpu.max"','"$p/cpu.weight"']);
  assert.match(PRIVILEGED_SET, /^p="\$1"; \[ -d "\$p" \] \|\| exit 3;/);
  assert.equal(/>/.test(READ.replaceAll('2>', '')), false, 'the reader writes nothing');
  for (const name of ['docker', '../docker', 'bunny-tests/../docker', 'bunny-', 'Bunny-tests', 'bunny-tests/x', 'bunny--x', `bunny-${'x'.repeat(48)}`]) {
    for (const build of [readerArgs, createArgs, setterArgs, privilegedSetterArgs]) assert.throws(() => build(name, 'u'), /pool-name-refused/, name);
  }
});

test('the pool name is bunny-tests unless a valid scratch name is set', () => {
  assert.equal(poolName({}), 'bunny-tests');
  assert.equal(poolName({BUNNY_TEST_POOL_SCRATCH_NAME:'bunny-gh1641-scratch'}), 'bunny-gh1641-scratch');
  for (const name of ['docker', '../bunny-x', 'bunny-x/y', 'x']) assert.throws(() => poolName({BUNNY_TEST_POOL_SCRATCH_NAME:name}), /must be one path segment/);
});

test('a reading parses and describes its limits', () => {
  const parsed = parseReading(reading({anon:100, shmem:5, oom:2}));
  assert.deepEqual(parsed, {controllers:['cpu','io','memory','pids'], exists:true, limits:{...LIMITS}, anon:100, shmem:5, oomKill:2});
  assert.equal(describe(parsed), '5.0 GiB memory, no swap, 6 CPUs, CPU weight 25');
  assert.equal(parseReading(reading({exists:false})).exists, false);
});

test('an existing pool with its limits is used as it is', async () => {
  const io = fake();
  assert.equal(await ensurePool(io, 'bunny-tests', ids()), 'bunny-tests');
  assert.deepEqual(io.calls.filter(call => call[0] === 'run'), []);
  assert.deepEqual(io.lines, ['pool /bunny-tests: 5.0 GiB memory, no swap, 6 CPUs, CPU weight 25 (read back; set by nobody: they were already set)']);
});

test('after a VM restart the pool is created and limited by the unprivileged helper, or else the privileged one', async () => {
  const unset = reading({limits:{'memory.max':'max','memory.swap.max':'max','cpu.max':'max 100000','cpu.weight':'100'}});
  const io = fake({poolReads:[reading({exists:false}), unset, reading()]});
  assert.equal(await ensurePool(io, 'bunny-tests', ids()), 'bunny-tests');
  assert.deepEqual(io.calls.filter(call => call[0] === 'run'), [createArgs('bunny-tests', 'u1'), setterArgs('bunny-tests', 'u3')]);
  assert.match(io.lines.at(-1), /set by the unprivileged helper\)$/);
  const fallback = fake({poolReads:[reading({exists:false}), unset, reading()], runs:[0, 1, 0]});
  assert.equal(await ensurePool(fallback, 'bunny-tests', ids()), 'bunny-tests');
  assert.deepEqual(fallback.calls.filter(call => call[0] === 'run').map(call => call.includes('--privileged')), [false, false, true]);
  assert.match(fallback.lines.at(-1), /set by the privileged helper\)$/);
});

test('when the pool cannot be read, created or limited the caller is told to use the count check', async () => {
  const say = reason => `pool unavailable: ${reason}; using per-container limits and the count check`;
  const cases = [
    [{poolReads:[null]}, say('the read-only pool reader could not run'), 0],
    [{poolReads:[reading({controllers:'cpu pids'})]}, say("the VM's root cgroup does not give its children the memory controller"), 0],
    [{poolReads:[reading({exists:false})], runs:[1]}, say('the /bunny-tests cgroup could not be created'), 1],
    [{poolReads:[reading({limits:{...LIMITS, 'cpu.weight':'100'}})], runs:[1, 1]}, say('neither helper could set the /bunny-tests limits'), 2],
  ];
  for (const [options, line, runCalls] of cases) {
    const io = fake(options);
    assert.equal(await ensurePool(io, 'bunny-tests', ids()), null);
    assert.deepEqual(io.lines, [line]);
    assert.equal(io.calls.filter(call => call[0] === 'run').length, runCalls);
  }
});

test('a start waits for load, the core and pool memory, or for free slots without a pool', () => {
  const pool = parseReading(reading({anon:3 * 1024 ** 3, shmem:0.5 * 1024 ** 3}));
  const need = {bytes:1250 * 1024 ** 2, slots:1};
  const ok = {load:3, core:{status:'healthy', lastMs:80}, pool};
  assert.equal(decide(ok, need), null);
  assert.equal(decide({...ok, load:8}, need), "the host's 1-minute load is 8.0, at or above 8");
  assert.equal(decide({...ok, core:{status:'starting', lastMs:80}}, need), 'the installed core is starting, not healthy');
  assert.equal(decide({...ok, core:{status:'healthy', lastMs:500}}, need), "the installed core's last health check took 500 ms, 500 or more");
  assert.equal(decide({...ok, core:null}, need), null, 'a machine without the installed core skips that check');
  assert.equal(decide(ok, {bytes:2048 * 1024 ** 2, slots:2}), 'the pool holds 3.5 of 5.0 GiB and this job needs 2.0 GiB free');
  assert.equal(decide({...ok, pool:{exists:false}}, need), 'the pool cannot be read');
  assert.equal(decide({load:3, core:null, used:4}, need), null);
  assert.equal(decide({load:3, core:null, used:4}, {bytes:0, slots:2}), '4 of 5 test-job slots are taken and this job needs 2');
  assert.equal(countSlots('bunny-mac-personal-core-1\nbunny-diagnostics-loki-1\nbunny-tronbyt-server-1\nbunny-tests-pool-x\nbunny-gh1-a\nbunny-gh2-b-wide\nbunny-runtime-check-z\nother'), 5);
  assert.deepEqual(coreHealth(healthy), {status:'healthy', lastMs:80});
  assert.equal(coreHealth(null), null);
});

test('admission waits with one line per reason, starts when it clears and holds the lock until released', async () => {
  const io = fake({loads:[9.2, 9.2, 9.2, 3]});
  const directory = lockDir();
  const gate = await admission(io, {pool:'bunny-tests', need:{bytes:1, slots:1}, waitMinutes:30, directory});
  assert.equal(gate.status, 0);
  assert.deepEqual(io.lines, ["waiting: the host's 1-minute load is 9.2, at or above 8"]);
  const other = fake();
  const blocked = await admission(other, {pool:'bunny-tests', need:{bytes:1, slots:1}, waitMinutes:1, directory});
  assert.equal(blocked.status, 75, 'a second start waits while the first holds the lock');
  assert.deepEqual(other.lines, ['waiting: another test job is starting', 'gave up after 1 min: another test job is starting']);
  await gate.release();
  assert.equal((await admission(fake(), {pool:'bunny-tests', need:{bytes:1, slots:1}, waitMinutes:1, directory})).status, 0);
});

test('admission gives up at its time limit with the last reason, and stops when interrupted', async () => {
  const io = fake({loads:[9]});
  assert.equal((await admission(io, {pool:null, need:{bytes:0, slots:1}, waitMinutes:2, directory:lockDir()})).status, 75);
  assert.deepEqual(io.lines, ["waiting: the host's 1-minute load is 9.0, at or above 8", "gave up after 2 min: the host's 1-minute load is 9.0, at or above 8"]);
  assert.equal(io.calls.filter(call => call[0] === 'read' && call[1] === 'run').length, 0, 'without a pool nothing reads it');
  assert.equal((await admission(fake(), {pool:null, need:{bytes:0, slots:1}, waitMinutes:2, directory:lockDir(), interrupted:() => true})).status, 130);
});

test('a lock left by a process that is gone is taken over, and an unsafe lock directory is refused', async () => {
  const directory = lockDir();
  await mkdir(join(directory, 'lock'), {recursive:true, mode:0o700});
  await writeFile(join(directory, 'lock', 'owner'), JSON.stringify({pid:999999, at:0}));
  const io = fake({alive:() => false});
  const lock = await tryLock(io, directory);
  assert.equal(lock.held, true);
  assert.deepEqual(io.lines, ['took over a start lock whose owner is gone or that is older than 10 minutes']);
  await lock.release();
  const open = lockDir();
  await mkdir(open, {mode:0o755});
  await chmod(open, 0o755);
  await assert.rejects(tryLock(fake(), open), /must be a directory of this user with mode 0700/);
  assert.equal(lockDirectory(), process.platform === 'darwin' ? '/private/tmp/bunny-test-start' : '/tmp/bunny-test-start', 'one fixed path whatever TMPDIR is');
});

test('a memory kill inside the pool is reported once with what to do', () => {
  const io = fake();
  reportOverflow(io, 'bunny-tests', 0, 0);
  reportOverflow(io, 'bunny-tests', null, 1);
  reportOverflow(io, 'bunny-tests', 2, 3);
  assert.deepEqual(io.lines, ['the pool killed 1 process(es) for memory while this job ran: treat that as a failed run to retry, not a reason to raise the /bunny-tests ceiling']);
});
