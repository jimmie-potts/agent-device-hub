import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parse, snapshot, runSuites, createArgs, runChecks} from '../runtime-container.mjs';
import {LIMITS} from '../test-container/pool.mjs';

test('the runner accepts only fixed suites', () => {
  assert.equal(parse([]), 'all');
  assert.equal(parse(['--suite', 'browser']), 'browser');
  for (const args of [['--suite','arbitrary'], ['--image','installed'], ['--suite','verify','extra']]) assert.throws(() => parse(args));
});

test('the source snapshot takes changed and new source without ignored data or Git metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-container-test-'));
  try {
    const repo = join(root, 'source'); await mkdir(repo);
    execFileSync('git', ['init', '-q', repo]);
    await writeFile(join(repo,'.gitignore'), '.local/\n*.log\n');
    await writeFile(join(repo,'tracked.txt'), 'before');
    execFileSync('git', ['-C', repo, 'add', '.']);
    await writeFile(join(repo,'tracked.txt'), 'after');
    await writeFile(join(repo,'new.txt'), 'new');
    await mkdir(join(repo,'.local')); await writeFile(join(repo,'.local','private'), 'excluded');
    await writeFile(join(repo,'runtime.log'), 'excluded');
    const files = await snapshot(repo, join(root,'snapshot'));
    assert.deepEqual(files.sort(), ['.gitignore','new.txt','tracked.txt']);
    assert.equal(await readFile(join(root,'snapshot','tracked.txt'),'utf8'), 'after');
    await symlink('/etc/passwd', join(repo,'link'));
    await assert.rejects(snapshot(repo, join(root,'unsafe')), /source-entry-refused/);
  } finally {await rm(root, {recursive:true, force:true});}
});

test('suite failure is returned and stops subsequent suites', async () => {
  const calls = [];
  assert.equal(await runSuites('all', async args => {calls.push(args);return 17;}), 17);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['run','test:runtime:scenarios:built']);
  assert.equal(await runSuites('all', async args => {calls.push(args);return 0;}), 0);
  assert.deepEqual(calls.at(-1), ['run','test:runtime:verify:built']);
});

test('the check container keeps its protections and has CPU and memory limits and no swap', () => {
  const image = 'sha256:' + 'a'.repeat(64);
  assert.deepEqual(createArgs('bunny-runtime-check-test', image, 'verify'), [
    'create','--init','--name','bunny-runtime-check-test','--network','none',
    '--cpus','2','--memory','1536m','--memory-swap','1536m',
    '--cap-drop','ALL','--cap-add','CHOWN','--security-opt','no-new-privileges','--restart','no',
    '--env','TMPDIR=/tmp','--env','XDG_RUNTIME_DIR=','--env','DBUS_SESSION_BUS_ADDRESS=',image,'verify']);
  assert.deepEqual(createArgs('bunny-runtime-check-test', image, 'verify', 'bunny-tests'), [
    'create','--init','--name','bunny-runtime-check-test','--network','none',
    '--cpus','2','--memory','1536m','--memory-swap','1536m','--cgroup-parent','/bunny-tests',
    '--cap-drop','ALL','--cap-add','CHOWN','--security-opt','no-new-privileges','--restart','no',
    '--env','TMPDIR=/tmp','--env','XDG_RUNTIME_DIR=','--env','DBUS_SESSION_BUS_ADDRESS=',image,'verify']);
});

const id = 'd'.repeat(64);
const imageId = 'sha256:' + 'e'.repeat(64);
const poolText = ['controllers=cpu io memory pids', 'exists=1', ...Object.entries(LIMITS).map(([key, value]) => `${key}=${value}`), 'anon=0', 'shmem=0', 'oom_kill=0'].join('\n');

/** A fake host for runChecks: one tool image that may or may not exist yet, and a container that exits 0. */
async function runner({imagePresent = false, loads = [1], appearsWhileWaiting = false} = {}) {
  const lockDir = await mkdtemp(join(tmpdir(), 'runtime-container-lock-'));
  const calls = [];
  const lines = [];
  let clock = 0;
  let present = imagePresent;
  const io = {
    calls, lines, lockDir, env:{},
    log: line => lines.push(line), print: line => lines.push(line),
    loadavg: () => [loads[Math.min(Math.floor(clock / 30_000), loads.length - 1)], 0, 0],
    now: () => clock,
    sleep: async ms => { clock += ms; if (appearsWhileWaiting) present = true; },
    later: () => {}, alive: () => true, pid: 1, uid: process.getuid?.(),
    snapshot: async (_repository, destination) => {
      await mkdir(join(destination, 'scripts/runtime-container'), {recursive:true});
      await writeFile(join(destination, 'package-lock.json'), '{}');
      await writeFile(join(destination, 'package.json'), '{}');
      await writeFile(join(destination, 'scripts/runtime-container/Dockerfile'), 'FROM node');
      return ['package-lock.json', 'package.json', 'scripts/runtime-container/Dockerfile'];
    },
    read: args => {
      calls.push(['read', ...args]);
      if (args[0] === 'run') return poolText;
      if (args[0] === 'ps') return '';
      if (args[0] === 'image') return present ? imageId : null;
      if (args[0] === 'create') return id;
      if (args[0] === 'inspect') return JSON.stringify({Running:false, Pid:0, ExitCode:0});
      return null;
    },
    run: async args => { calls.push(args); if (args[0] === 'build') present = true; return 0; },
  };
  return {io, done: () => rm(lockDir, {recursive:true, force:true})};
}

test('the runtime runner skips the build for an existing image, waits for admission and starts in the pool', async () => {
  const {io, done} = await runner({imagePresent:true, loads:[9.1, 2]});
  try {
    assert.equal(await runChecks(['--suite','browser'], io), 0);
    assert.equal(io.calls.some(call => call[0] === 'build'), false);
    assert.ok(io.lines.includes("waiting: the host's 1-minute load is 9.1, at or above 8"));
    const create = io.calls.find(call => call[0] === 'read' && call[1] === 'create').slice(1);
    assert.deepEqual(create.slice(create.indexOf('--cgroup-parent'), create.indexOf('--cgroup-parent') + 2), ['--cgroup-parent','/bunny-tests']);
    assert.ok(io.lines.includes('In the /bunny-tests pool.'));
  } finally { await done(); }
});

test('the runtime runner builds a missing image in the pool, or uses one another run built while it waited', async () => {
  const fresh = await runner();
  try {
    assert.equal(await runChecks(['--suite','browser'], fresh.io), 0);
    const build = fresh.io.calls.find(call => call[0] === 'build');
    assert.deepEqual(build.slice(-3, -1), ['--cgroup-parent','/bunny-tests']);
  } finally { await fresh.done(); }
  const waited = await runner({loads:[9.1, 2], appearsWhileWaiting:true});
  try {
    assert.equal(await runChecks(['--suite','browser'], waited.io), 0);
    assert.equal(waited.io.calls.some(call => call[0] === 'build'), false, 'the tag was rechecked after the wait');
  } finally { await waited.done(); }
});

test('the runtime runner returns 75 and creates nothing when admission gives up', async () => {
  const {io, done} = await runner({imagePresent:true, loads:[9.1]});
  try {
    assert.equal(await runChecks(['--suite','browser'], io), 75);
    assert.equal(io.calls.some(call => call[1] === 'create' || call[0] === 'start'), false);
    assert.equal(io.lines.at(-1), "gave up after 30 min: the host's 1-minute load is 9.1, at or above 8");
  } finally { await done(); }
});
