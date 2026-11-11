import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  admission, countSlots, coreHealth, createArgs, decide, describe, ensurePool, IMAGE, LIMITS, NOT_READY, parseContainers,
  parseReading, poolName, poolSession, readings, lockDirectory, MAX_HOLD_MS, PRIVILEGED_SET, privilegedSetterArgs, READ, readerArgs, reportOverflow, SET, setterArgs, tryLock,
  MAX_LOAD, SLOTS,
} from '../test-container/pool.mjs';
import {profileLine, profiles, redactor, redactorFor, selectProfile} from '../test-container/profile.mjs';

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
  const this_options = [];
  return {
    runOptions: this_options,
    calls, lines, sleeps,
    log: line => lines.push(line),
    read: args => {
      calls.push(['read', ...args]);
      if (args[0] === 'run') { const answer = poolReads[Math.min(reads++, poolReads.length - 1)]; return answer; }
      if (args[0] === 'inspect') return core;
      if (args[0] === 'ps') return names;
      return null;
    },
    run: async (args, options) => { calls.push(args); this_options.push(options); return typeof runs === 'function' ? runs(args) : runs[ran++] ?? 0; },
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
  const ok = {load:3, core:{status:'healthy', lastMs:80, state:'running'}, used:0, pool};
  assert.equal(decide(ok, need), null);
  assert.equal(decide({...ok, load:NaN}, need), "the host's 1-minute load cannot be read");
  for (const used of [-1, 1.5, NaN]) assert.equal(decide({...ok, used}, need), 'the running test jobs cannot be counted', String(used));
  assert.equal(decide({...ok, core:{status:'healthy', lastMs:-5, state:'running'}}, need), "the installed core's last health check time cannot be read");
  assert.equal(decide({...ok, core:{status:'healthy', lastMs:80}}, need), 'the installed core is in an unknown state, not running', 'a core without a state never admits');
  assert.equal(decide({...ok, load:8}, need), "the host's 1-minute load is 8.0, at or above 8");
  assert.equal(decide({...ok, core:{status:'starting', lastMs:80, state:'running'}}, need), 'the installed core is starting, not healthy');
  assert.equal(decide({...ok, core:{status:'healthy', lastMs:500, state:'running'}}, need), "the installed core's last health check took 500 ms, 500 or more");
  assert.equal(decide({...ok, core:{status:'unreadable', lastMs:null, state:'running'}}, need), "the installed core's health cannot be read");
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
  assert.deepEqual(parseContainers('bunny-mac-personal-core-1\trunning\nbunny-gh1-a\texited\nbunny-gh1-b\trunning\nbunny-gh1-c\tpaused'), {
    names:['bunny-mac-personal-core-1','bunny-gh1-a','bunny-gh1-b','bunny-gh1-c'],
    states:{'bunny-mac-personal-core-1':'running','bunny-gh1-a':'exited','bunny-gh1-b':'running','bunny-gh1-c':'paused'},
    running:['bunny-mac-personal-core-1','bunny-gh1-b','bunny-gh1-c']}, 'a paused container still counts');
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
  const busy = `another test job is starting (lock ${join(directory, 'lock')}, held by process 4242)`;
  assert.deepEqual(other.lines, [`waiting: ${busy}`, `gave up after 1 min: ${busy}`], 'the wait line names the lock and its owner');
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
  assert.deepEqual(io.lines, [`took over the start lock ${join(directory, 'lock')}, whose owner process 999999 is gone or whose lock is too old`]);
  // A live owner keeps the lock for up to MAX_HOLD_MS (6 h), longer than a 240-minute wait plus a cold build.
  await writeFile(join(directory, 'lock', 'owner'), JSON.stringify({pid:4242, at:-5 * 3_600_000, token:lock.token}));
  assert.equal((await tryLock(fake({alive:() => true}), directory)).held, false);
  // Past that bound the lock is taken over even if a process with the owner's number is alive (a reused number).
  await writeFile(join(directory, 'lock', 'owner'), JSON.stringify({pid:4242, at:-(MAX_HOLD_MS + 1), token:lock.token}));
  const reused = await tryLock(fake({alive:() => true}), directory);
  assert.equal(reused.held, true);
  await reused.release();
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

test('a pool that no helper can limit costs one privileged attempt per run and prints each line once, however long the wait', async () => {
  const unset = reading({limits:{'memory.max':'max','memory.swap.max':'max','cpu.max':'max 100000','cpu.weight':'100'}});
  // Start-up found the pool limited; then a VM restart recreated it without limits, and every helper now fails.
  const io = fake({poolReads:[unset], runs:() => 1});
  const session = poolSession();
  const gate = await admission(io, {pool:'bunny-tests', need:{bytes:1, slots:1}, waitMinutes:240, directory:lockDir(), session});
  assert.equal(gate.status, 75);
  const runs = io.calls.filter(call => call[0] === 'run');
  assert.equal(runs.filter(call => call.includes('--privileged')).length, 1, 'one privileged attempt in 240 minutes');
  assert.equal(runs.filter(call => call.includes('/sys/fs/cgroup/bunny-tests:/pool')).length, 1, 'one unprivileged attempt: the reading never changed');
  assert.equal(runs.length, 2, 'no creator: the pool exists');
  // One reader per 30 s recheck (481 checks in 240 minutes) plus the repair's one read; a helper that exits nonzero
  // gets no readback.
  assert.equal(io.calls.filter(call => call[0] === 'read' && call[1] === 'run').length, 481 + 1);
  assert.deepEqual(io.lines, [
    `waiting: ${NOT_READY}`,
    'the unprivileged helper could not set the /bunny-tests limits (exit status 1); trying the owner-approved privileged helper',
    'pool not ready: neither helper could set the /bunny-tests limits; still waiting',
    `gave up after 240 min: ${NOT_READY}`,
  ]);
  assert.deepEqual([...new Set(io.runOptions.map(options => options?.timeout))], [60_000], 'every helper run has a timeout');
});

test('after the privileged helper has run once, a later repair in the same run uses only the unprivileged one', async () => {
  const wrong = reading({limits:{...LIMITS, 'cpu.weight':'100'}});
  const unset = reading({limits:{'memory.max':'max','memory.swap.max':'max','cpu.max':'max 100000','cpu.weight':'100'}});
  // At start-up the unprivileged helper fails and the privileged one sets the limits.
  const io = fake({poolReads:[wrong, reading(), unset], runs:args => (args.includes('--privileged') ? 0 : 1)});
  const session = poolSession();
  assert.equal(await ensurePool(io, 'bunny-tests', ids(), {session}), 'bunny-tests');
  // Later the pool loses its limits; the wait repairs it once, without the privileged helper, then gives up.
  assert.equal((await admission(io, {pool:'bunny-tests', need:{bytes:1, slots:1}, waitMinutes:10, directory:lockDir(), session})).status, 75);
  assert.equal(io.calls.filter(call => call[0] === 'run' && call.includes('--privileged')).length, 1);
  assert.ok(io.lines.includes('pool not ready: the unprivileged helper could not set the /bunny-tests limits (exit status 1), and the privileged helper already ran once in this run; still waiting'));
});

test('a helper that times out is a failed helper', async () => {
  const wrong = reading({limits:{...LIMITS, 'cpu.weight':'100'}});
  const io = fake({poolReads:[wrong], runs:[143, 143]});
  assert.equal(await ensurePool(io, 'bunny-tests', ids()), null);
  assert.ok(io.lines[0].includes('(exit status 143)'));
});

test('a pool reading without numeric anon and shmem does not admit', () => {
  const need = {bytes:1, slots:1};
  const base = {load:1, core:null, used:0};
  for (const fields of [{anon:''}, {anon:'x'}, {shmem:'-1'}]) {
    const text = reading().replace(/anon=0/, `anon=${fields.anon ?? '0'}`).replace(/shmem=0/, `shmem=${fields.shmem ?? '0'}`);
    assert.equal(decide({...base, pool:parseReading(text)}, need), NOT_READY, JSON.stringify(fields));
  }
  const missing = parseReading(reading().split('\n').filter(line => !line.startsWith('anon=')).join('\n'));
  assert.equal(Number.isNaN(missing.anon), true);
  assert.equal(decide({...base, pool:missing}, need), NOT_READY);
  assert.equal(decide({...base, pool:parseReading(reading())}, need), null);
});

test('the core must be listed as running and have a readable check time', () => {
  const need = {bytes:1, slots:1};
  const at = state => decide(readings(fake({names:`bunny-mac-personal-core-1\t${state}`}), 'bunny-tests'), need);
  assert.equal(at('running'), null);
  assert.equal(at('exited'), 'the installed core is exited, not running');
  assert.equal(at('restarting'), 'the installed core is restarting, not running');
  const noLog = JSON.stringify({Status:'healthy', Log:[]});
  assert.equal(decide(readings(fake({core:noLog}), 'bunny-tests'), need), "the installed core's last health check time cannot be read");
});

test('a takeover re-tests the lock under the takeover directory, so a lock that became fresh is never removed', async () => {
  const directory = lockDir();
  await mkdir(join(directory, 'lock'), {recursive:true, mode:0o700});
  // An ownerless lock that looks stale at the first look and fresh at the re-test (a rival replaced it meanwhile).
  const ages = [60_000, 0];
  const io = {...fake(), ageOf: async () => ages.shift() ?? 0};
  assert.equal((await tryLock(io, directory)).held, false);
  assert.equal(existsSync(join(directory, 'lock')), true, 'the fresh lock is left alone');
  assert.equal(existsSync(join(directory, 'takeover')), false);
});

test('a pool reading that flips between two values is repaired once per distinct reading, not on every flip', async () => {
  const unset = reading({limits:{'memory.max':'max','memory.swap.max':'max','cpu.max':'max 100000','cpu.weight':'100'}});
  let n = 0;
  // The reader alternates between failing and an unlimited pool; every helper fails.
  const io = fake({runs:() => 1});
  io.read = args => { io.calls.push(['read', ...args]); if (args[0] === 'run') return (n++ % 2 === 0 ? null : unset); if (args[0] === 'inspect') return healthy; if (args[0] === 'ps') return 'bunny-mac-personal-core-1\trunning'; return null; };
  assert.equal((await admission(io, {pool:'bunny-tests', need:{bytes:1, slots:1}, waitMinutes:60, directory:lockDir()})).status, 75);
  const runs = io.calls.filter(call => call[0] === 'run');
  assert.equal(runs.filter(call => call.includes('--privileged')).length, 1);
  assert.equal(runs.filter(call => call.includes('/sys/fs/cgroup/bunny-tests:/pool')).length, 1, 'two distinct readings, one repair each');
  assert.equal(io.lines.filter(line => line.startsWith('waiting:')).length, 1);
});

test('a live owner whose recorded time is unreadable keeps the lock', async () => {
  const directory = lockDir();
  await mkdir(join(directory, 'lock'), {recursive:true, mode:0o700});
  await writeFile(join(directory, 'lock', 'owner'), JSON.stringify({pid:4242, token:'t'}));
  assert.equal((await tryLock(fake({alive:() => true}), directory)).held, false);
});

test('each host profile has its slots, load thresholds, sizes and pool, and the Mac profile keeps today\'s values', () => {
  assert.deepEqual(Object.keys(profiles), ['mac', 'pc']);
  const {mac, pc} = profiles;
  assert.equal(mac.slots, 5);
  assert.equal(mac.startLoad, 8);
  assert.equal(mac.stopLoad, 12);
  assert.equal(mac.core, 'bunny-mac-personal-core-1');
  assert.deepEqual(mac.pool, {name:'bunny-tests', limits:LIMITS});
  assert.deepEqual(mac.sizes, {standard:{cpus:'2', memory:'1250m', slots:1, suffix:''}, wide:{cpus:'4', memory:'2048m', slots:2, suffix:'-wide'}});
  assert.equal(mac.buildBytes, 2048 * 1024 ** 2);
  assert.deepEqual(mac.runtimeCheck, {cpus:'2', memory:'1536m'});
  assert.equal(mac.scratch, 'tmpdir');
  assert.equal(pc.slots, 8);
  assert.equal(pc.startLoad, 24);
  assert.equal(pc.stopLoad, 32);
  assert.equal(pc.core, null, 'no installed core, so no core health check');
  assert.equal(pc.pool, null, 'no pool, so no helper, cgroup or pool headroom');
  assert.deepEqual(pc.sizes, {standard:{cpus:'4', memory:'2048m', slots:1, suffix:''}, wide:{cpus:'8', memory:'3584m', slots:2, suffix:'-wide'}});
  assert.deepEqual(pc.runtimeCheck, {cpus:'2', memory:'1536m'});
  assert.equal(pc.scratch, 'cache', 'not the memory-backed WSL /tmp');
  // Eight standard jobs' ceilings, or four wide ones, stay within 16 GiB of the PC's 19.5 GiB Docker VM.
  const mib = memory => Number(memory.slice(0, -1));
  assert.ok(pc.slots * mib(pc.sizes.standard.memory) <= 16 * 1024);
  assert.ok((pc.slots / 2) * mib(pc.sizes.wide.memory) <= 16 * 1024);
  for (const profile of [mac, pc]) assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.sizes) && Object.isFrozen(profile.sizes.standard));
  assert.equal(SLOTS, mac.slots);
  assert.equal(MAX_LOAD, mac.startLoad);
});

test('the PC profile needs the explicit setting and a WSL kernel; anything else gets the Mac profile or a refusal', () => {
  const wsl = {platform:'linux', osRelease:'5.15.167.4-microsoft-standard-WSL2'};
  assert.equal(selectProfile({}, wsl), profiles.mac, 'no setting: the Mac profile, even on the PC');
  assert.equal(selectProfile({BUNNY_TEST_HOST:''}, wsl), profiles.mac);
  assert.equal(selectProfile({BUNNY_TEST_HOST:'mac'}, wsl), profiles.mac);
  assert.equal(selectProfile({}, {platform:'darwin', osRelease:'27.0.0'}), profiles.mac);
  assert.equal(selectProfile({}, {platform:'linux', osRelease:'6.8.0-1017-azure'}), profiles.mac, 'a hosted runner is not the PC');
  assert.equal(selectProfile({BUNNY_TEST_HOST:'pc'}, wsl), profiles.pc);
  assert.throws(() => selectProfile({BUNNY_TEST_HOST:'pc'}, {platform:'darwin', osRelease:'27.0.0'}), /BUNNY_TEST_HOST=pc is for the PC's WSL Linux only/);
  assert.throws(() => selectProfile({BUNNY_TEST_HOST:'pc'}, {platform:'linux', osRelease:'6.8.0-1017-azure'}), /BUNNY_TEST_HOST=pc is for the PC's WSL Linux only/);
  for (const value of ['PC', 'big', 'pc ', 'windows']) assert.throws(() => selectProfile({BUNNY_TEST_HOST:value}, wsl), /BUNNY_TEST_HOST must be mac or pc, or unset for the Mac profile/, value);
  assert.equal(profileLine(profiles.mac), 'profile mac: 5 slots, start under load 8, stop above 12, standard 2 CPUs 1250m, wide 4 CPUs 2048m, pool /bunny-tests, core check bunny-mac-personal-core-1');
  assert.equal(profileLine(profiles.pc), 'profile pc: 8 slots, start under load 24, stop above 32, standard 4 CPUs 2048m, wide 8 CPUs 3584m, no pool, no core check');
});

test('under the PC profile messages name the home and cache directories as ~ and $XDG_CACHE_HOME; the Mac\'s are unchanged', () => {
  const home = '/home/someone';
  const pc = redactor(profiles.pc, {}, home);
  assert.equal(pc('could not remove /home/someone/.cache/bunny-test-container/bunny-test-container-abc123: EBUSY'), 'could not remove ~/.cache/bunny-test-container/bunny-test-container-abc123: EBUSY');
  assert.equal(pc("ENOENT: no such file, open '/home/someone/repo/package.json'"), "ENOENT: no such file, open '~/repo/package.json'");
  assert.equal(pc('/home/someone2/x and /home/someone'), '/home/someone2/x and ~', 'only the whole directory name is replaced');
  const custom = redactor(profiles.pc, {XDG_CACHE_HOME:'/data/cache/'}, home);
  assert.equal(custom('the scratch path /data/cache/bunny-test-container/x'), 'the scratch path $XDG_CACHE_HOME/bunny-test-container/x');
  const mac = redactor(profiles.mac, {XDG_CACHE_HOME:'/data/cache'}, home);
  const text = 'the scratch path /home/someone/tmp/x and /data/cache/y';
  assert.equal(mac(text), text, 'the Mac profile changes no message');
  assert.equal(redactorFor({}, {platform:'darwin'}, home)(text), text);
  assert.equal(redactorFor({BUNNY_TEST_HOST:'pc'}, {platform:'darwin'}, home)(text), text, 'a refused selection changes nothing');
  assert.equal(redactorFor({BUNNY_TEST_HOST:'pc'}, {platform:'linux', osRelease:'5.15.167.4-microsoft-standard-WSL2'}, home)('/home/someone/a'), '~/a');
});

test('the rewriting starts only where a path starts, skips slash-only values and applies the longer path first', () => {
  const home = '/home/someone';
  const pc = redactor(profiles.pc, {}, home);
  // (a) The home directory inside a longer path is left alone.
  assert.equal(pc('/srv/home/someone/w and x/home/someone and a.home/someone'), '/srv/home/someone/w and x/home/someone and a.home/someone');
  // A path at the start, or after =, :, a quote, a bracket, a space or a comma, is still rewritten.
  for (const [before, after] of [['/home/someone/a', '~/a'], ['TMPDIR=/home/someone/t', 'TMPDIR=~/t'], ['open:/home/someone', 'open:~'],
    ["open '/home/someone/p'", "open '~/p'"], ['"/home/someone"', '"~"'], ['[/home/someone/a]', '[~/a]'], ['(/home/someone)', '(~)'],
    ['x /home/someone, y', 'x ~, y'], ['line1\n/home/someone/b', 'line1\n~/b']]) assert.equal(pc(before), after, before);
  // (b) A home or cache directory of only slashes is skipped.
  for (const slashes of ['//', '///']) {
    const text = 'the scratch path /tmp/a/b, x/y';
    assert.equal(redactor(profiles.pc, {XDG_CACHE_HOME:slashes}, slashes)(text), text, slashes);
  }
  // (c) A cache directory that is a parent of home cannot leave the user name visible.
  const parent = redactor(profiles.pc, {XDG_CACHE_HOME:'/home'}, home);
  assert.equal(parent('/home/someone/x and /home/other/y'), '~/x and $XDG_CACHE_HOME/other/y');
  // A cache directory under home is named as the cache.
  const inner = redactor(profiles.pc, {XDG_CACHE_HOME:'/home/someone/.cache'}, home);
  assert.equal(inner('/home/someone/.cache/bunny-test-container/a and /home/someone/b'), '$XDG_CACHE_HOME/bunny-test-container/a and ~/b');
});

test('the PC profile admits on load and its eight slots alone, and never reads a core or a pool', () => {
  const need = {bytes:2048 * 1024 ** 2, slots:1};
  const ok = {load:3, core:null, used:0};
  assert.equal(decide(ok, need, profiles.pc), null);
  assert.equal(decide({...ok, load:23.9}, need, profiles.pc), null);
  assert.equal(decide({...ok, load:24}, need, profiles.pc), "the host's 1-minute load is 24.0, at or above 24");
  assert.equal(decide({...ok, used:7}, need, profiles.pc), null);
  assert.equal(decide({...ok, used:8}, need, profiles.pc), '8 of 8 test-job slots are taken and this job needs 1');
  assert.equal(decide({...ok, used:7}, {bytes:1, slots:2}, profiles.pc), '7 of 8 test-job slots are taken and this job needs 2');
  // The same readings decide as before under the Mac profile.
  assert.equal(decide({...ok, used:5}, need), '5 of 5 test-job slots are taken and this job needs 1');
  assert.equal(decide({...ok, load:8}, need, profiles.mac), "the host's 1-minute load is 8.0, at or above 8");
  // A container named like the Mac's core on the PC is never inspected for health.
  const io = fake({names:'bunny-mac-personal-core-1\trunning\nbunny-gh1-a\trunning', core:null});
  const reading = readings(io, null, profiles.pc);
  assert.equal(reading.core, null);
  assert.equal(reading.used, 1);
  assert.equal('pool' in reading, false);
  assert.equal(io.calls.some(call => call[1] === 'inspect' || call[1] === 'run'), false);
});

test('admission under the PC profile waits on its own load threshold and slot count', async () => {
  const io = fake({loads:[25, 25, 3], names:'bunny-gh1-a\trunning', core:null});
  const gate = await admission(io, {pool:null, need:{bytes:1, slots:1}, waitMinutes:5, directory:lockDir(), profile:profiles.pc});
  assert.equal(gate.status, 0);
  assert.deepEqual(io.lines, ["waiting: the host's 1-minute load is 25.0, at or above 24"]);
  await gate.release();
  assert.equal(io.calls.some(call => call[1] === 'inspect'), false);
});
