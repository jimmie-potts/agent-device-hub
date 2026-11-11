import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  admission, countSlots, coreHealth, createArgs, decide, describe, ensurePool, IMAGE, LIMITS, NOT_READY, parseContainers,
  parseReading, poolName, readings, lockDirectory, PRIVILEGED_SET, privilegedSetterArgs, READ, readerArgs, reportOverflow, SET, setterArgs, tryLock,
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
function fake({poolReads = [reading()], loads = [1], runs = [], core = healthy, names = 'bunny-mac-personal-core-1\trunning', alive = () => true} = {}) {
  const calls = [];
  const lines = [];
  let clock = 0;
  let reads = 0;
  let ran = 0;
  const sleeps = [];
  return {
    calls, lines, sleeps,
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
    sleep: async ms => { sleeps.push(ms); clock += ms; },
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
    [{poolReads:[null]}, [say('the read-only pool reader could not run')], 0],
    [{poolReads:[reading({controllers:'cpu pids'})]}, [say("the VM's root cgroup does not give its children the memory controller")], 0],
    [{poolReads:[reading({exists:false})], runs:[1]}, [say('the /bunny-tests cgroup could not be created')], 1],
    [{poolReads:[reading({limits:{...LIMITS, 'cpu.weight':'100'}})], runs:[1, 1]}, [
      'the unprivileged helper could not set the /bunny-tests limits (exit status 1); trying the owner-approved privileged helper',
      say('neither helper could set the /bunny-tests limits')], 2],
  ];
  for (const [options, lines, runCalls] of cases) {
    const io = fake(options);
    assert.equal(await ensurePool(io, 'bunny-tests', ids()), null);
    assert.deepEqual(io.lines, lines);
    assert.equal(io.calls.filter(call => call[0] === 'run').length, runCalls);
  }
});

test('before the privileged helper runs the command says why the unprivileged one did not do', async () => {
  const wrong = reading({limits:{...LIMITS, 'cpu.weight':'100'}});
  const io = fake({poolReads:[wrong, wrong, reading()], runs:[0, 0]});
  assert.equal(await ensurePool(io, 'bunny-tests', ids()), 'bunny-tests');
  assert.deepEqual(io.lines, [
    'the unprivileged helper could not set the /bunny-tests limits (its readback was 5.0 GiB memory, no swap, 6 CPUs, CPU weight 100); trying the owner-approved privileged helper',
    'pool /bunny-tests: 5.0 GiB memory, no swap, 6 CPUs, CPU weight 25 (read back; set by the privileged helper)']);
  assert.ok(io.calls.filter(call => call[0] === 'run').at(-1).includes('--privileged'));
});

test('a start waits for load, the core, the slot count and pool memory, and fails closed', () => {
  const pool = parseReading(reading({anon:3 * 1024 ** 3, shmem:0.5 * 1024 ** 3}));
  const need = {bytes:1250 * 1024 ** 2, slots:1};
  const ok = {load:3, core:{status:'healthy', lastMs:80}, used:0, pool};
  assert.equal(decide(ok, need), null);
  assert.equal(decide({...ok, load:8}, need), "the host's 1-minute load is 8.0, at or above 8");
  assert.equal(decide({...ok, core:{status:'starting', lastMs:80}}, need), 'the installed core is starting, not healthy');
  assert.equal(decide({...ok, core:{status:'healthy', lastMs:500}}, need), "the installed core's last health check took 500 ms, 500 or more");
  assert.equal(decide({...ok, core:{status:'unreadable', lastMs:null}}, need), "the installed core's health cannot be read");
  assert.equal(decide({...ok, core:null}, need), null, 'a machine with no core container skips that check');
  assert.equal(decide({load:3, error:'docker ps failed, so the running test jobs cannot be counted'}, need), 'docker ps failed, so the running test jobs cannot be counted');
  // The slot count applies with the pool as well as without it.
  assert.equal(decide({...ok, used:5}, need), '5 of 5 test-job slots are taken and this job needs 1');
  assert.equal(decide({...ok, used:4}, {bytes:need.bytes, slots:2}), '4 of 5 test-job slots are taken and this job needs 2');
  assert.equal(decide({...ok, used:4}, need), null);
  assert.equal(decide(ok, {bytes:2048 * 1024 ** 2, slots:1}), 'the pool holds 3.5 of 5.0 GiB and this job needs 2.0 GiB free');
  // Only a pool that reads back with exactly its limits admits.
  for (const bad of [null, {exists:false}, parseReading(reading({limits:{...LIMITS, 'memory.max':'max'}})), parseReading(reading({limits:{...LIMITS, 'memory.max':'10737418240'}}))]) {
    assert.equal(decide({...ok, pool:bad}, need), NOT_READY);
  }
  assert.equal(decide({load:3, core:null, used:4}, need), null, 'without a pool the count alone decides');
  assert.equal(countSlots(['bunny-mac-personal-core-1','bunny-diagnostics-loki-1','bunny-tronbyt-server-1','bunny-tests-pool-x','bunny-gh1-a','bunny-gh2-b-wide','bunny-runtime-check-z','other']), 5);
  assert.deepEqual(parseContainers('bunny-mac-personal-core-1\trunning\nbunny-gh1-a\texited\nbunny-gh1-b\trunning'), {names:['bunny-mac-personal-core-1','bunny-gh1-a','bunny-gh1-b'], running:['bunny-mac-personal-core-1','bunny-gh1-b']});
  assert.deepEqual(coreHealth(healthy), {status:'healthy', lastMs:80});
  assert.deepEqual(coreHealth(null), {status:'unreadable', lastMs:null});
});

test('readings count running containers in pool mode, and a failed read of the core or of docker ps is a wait', () => {
  const pooled = readings(fake({names:'bunny-mac-personal-core-1\trunning\nbunny-gh9-a\trunning\nbunny-gh9-b-wide\trunning\nbunny-gh9-c\texited\nbunny-tests-pool-1\trunning'}), 'bunny-tests');
  assert.equal(pooled.used, 3);
  assert.equal(pooled.core.status, 'healthy');
  assert.ok(pooled.pool.exists);
  assert.equal(readings(fake({names:'other\trunning'}), null).core, null, 'no core container: no core check');
  assert.equal(decide(readings(fake({core:null}), 'bunny-tests'), {bytes:1, slots:1}), "the installed core's health cannot be read");
  assert.equal(decide(readings(fake({names:null}), 'bunny-tests'), {bytes:1, slots:1}), 'docker ps failed, so the running test jobs cannot be counted');
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
  assert.deepEqual([...new Set(other.sleeps)], [3_000], 'a lock wait rechecks every 3 s');
  assert.deepEqual([...new Set(io.sleeps)], [30_000], 'other waits recheck every 30 s');
  await gate.release();
  assert.equal((await admission(fake(), {pool:'bunny-tests', need:{bytes:1, slots:1}, waitMinutes:1, directory})).status, 0);
});

test('a pool that vanishes or loses its limits mid-wait is set up again, not waited on until give-up', async () => {
  const unset = reading({limits:{'memory.max':'max','memory.swap.max':'max','cpu.max':'max 100000','cpu.weight':'100'}});
  // Readings: the first admission check finds it gone; ensurePool recreates and limits it; the next check admits.
  const io = fake({poolReads:[reading({exists:false}), reading({exists:false}), unset, reading(), reading()]});
  const gate = await admission(io, {pool:'bunny-tests', need:{bytes:1, slots:1}, waitMinutes:5, directory:lockDir()});
  assert.equal(gate.status, 0);
  assert.deepEqual(io.lines, [`waiting: ${NOT_READY}`, 'pool /bunny-tests: 5.0 GiB memory, no swap, 6 CPUs, CPU weight 25 (read back; set by the unprivileged helper)']);
  await gate.release();
  const stuck = fake({poolReads:[unset], runs:[1, 1]});
  assert.equal((await admission(stuck, {pool:'bunny-tests', need:{bytes:1, slots:1}, waitMinutes:1, directory:lockDir()})).status, 75, 'an unlimited pool never admits');
  assert.ok(stuck.lines.includes('pool not ready: neither helper could set the /bunny-tests limits; still waiting'));
  assert.equal(stuck.lines.at(-1), `gave up after 1 min: ${NOT_READY}`);
});

test('admission gives up at its time limit with the last reason, and stops when interrupted', async () => {
  const io = fake({loads:[9]});
  assert.equal((await admission(io, {pool:null, need:{bytes:0, slots:1}, waitMinutes:2, directory:lockDir()})).status, 75);
  assert.deepEqual(io.lines, ["waiting: the host's 1-minute load is 9.0, at or above 8", "gave up after 2 min: the host's 1-minute load is 9.0, at or above 8"]);
  assert.equal(io.calls.filter(call => call[0] === 'read' && call[1] === 'run').length, 0, 'without a pool nothing reads it');
  assert.equal((await admission(fake(), {pool:null, need:{bytes:0, slots:1}, waitMinutes:2, directory:lockDir(), interrupted:() => true})).status, 130);
});

test('a lock whose owner process is gone is taken over, a live owner is never taken over, and release checks the token', async () => {
  const directory = lockDir();
  await mkdir(join(directory, 'lock'), {recursive:true, mode:0o700});
  await writeFile(join(directory, 'lock', 'owner'), JSON.stringify({pid:999999, at:0, token:'dead'}));
  const io = fake({alive:pid => pid !== 999999});
  const lock = await tryLock(io, directory);
  assert.equal(lock.held, true);
  assert.deepEqual(io.lines, ['took over a start lock whose owner is gone']);
  // A live owner keeps the lock however old it is: an image build may hold it a long time.
  await writeFile(join(directory, 'lock', 'owner'), JSON.stringify({pid:4242, at:-24 * 3_600_000, token:lock.token}));
  assert.equal((await tryLock(fake({alive:() => true}), directory)).held, false);
  await lock.release();
  const open = lockDir();
  await mkdir(open, {mode:0o755});
  await chmod(open, 0o755);
  await assert.rejects(tryLock(fake(), open), /must be a directory of this user with mode 0700/);
  assert.equal(lockDirectory(), process.platform === 'darwin' ? '/private/tmp/bunny-test-start' : '/tmp/bunny-test-start', 'one fixed path whatever TMPDIR is');
});

test('a release after a takeover leaves the new holder\'s lock, and two simultaneous takers get one lock', async () => {
  const directory = lockDir();
  const first = await tryLock(fake(), directory);
  assert.equal(first.held, true);
  // The first holder's process is now reported gone, so a second taker takes over.
  const second = await tryLock(fake({alive:() => false}), directory);
  assert.equal(second.held, true);
  await first.release();
  assert.equal(JSON.parse(await readFile(join(directory, 'lock', 'owner'), 'utf8')).token, second.token, 'the old holder did not remove the new lock');
  await second.release();
  assert.equal(existsSync(join(directory, 'lock')), false);
  const race = lockDir();
  await mkdir(join(race, 'lock'), {recursive:true, mode:0o700});
  await writeFile(join(race, 'lock', 'owner'), JSON.stringify({pid:999999, at:0, token:'dead'}));
  const takers = await Promise.all([1, 2, 3].map(() => tryLock(fake({alive:pid => pid !== 999999}), race)));
  assert.equal(takers.filter(taker => taker.held).length, 1);
  await Promise.all(takers.map(taker => taker.release?.()));
});

test('a lock without an owner file is stale only after a grace period', async () => {
  const directory = lockDir();
  await mkdir(join(directory, 'lock'), {recursive:true, mode:0o700});
  assert.equal((await tryLock(fake(), directory)).held, false, 'a fresh lock may not have written its owner yet');
  const old = new Date(Date.now() - 60_000);
  await utimes(join(directory, 'lock'), old, old);
  const taken = await tryLock(fake(), directory);
  assert.equal(taken.held, true);
  await taken.release();
});

test('a memory kill inside the pool is reported once with what to do', () => {
  const io = fake();
  reportOverflow(io, 'bunny-tests', 0, 0);
  reportOverflow(io, 'bunny-tests', null, 1);
  reportOverflow(io, 'bunny-tests', 2, 3);
  assert.deepEqual(io.lines, ['the pool killed 1 process(es) for memory while this job ran: treat that as a failed run to retry, not a reason to raise the /bunny-tests ceiling']);
});
