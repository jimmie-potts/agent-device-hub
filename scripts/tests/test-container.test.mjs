import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {admit, imageKey, parse, runArgs, runJob, sizes} from '../test-container.mjs';
import {statusOf, steps} from '../test-container/inside.mjs';

const scripts = {'test:runtime:built':'node --test x', 'test:runtime:verify:built':'node --test y', 'test:sdk:built':'node --test z', 'lint:js':'eslint .'};
const image = 'sha256:' + 'b'.repeat(64);
const id = 'c'.repeat(64);

test('a job is named for its issue and job, and the wide size says so in its name', () => {
  const plan = parse(['--issue','1638','--job','unit','--','test:runtime:built','--test-name-pattern=x'], scripts);
  assert.deepEqual({...plan}, {issue:'1638', job:'unit', size:'standard', build:true, network:false, script:'test:runtime:built', args:['--test-name-pattern=x'], name:'bunny-gh1638-unit', slots:1});
  const wide = parse(['--size','wide','--issue','7','--job','sdk','--no-build','--network','--','test:sdk:built'], scripts);
  assert.equal(wide.name, 'bunny-gh7-sdk-wide');
  assert.equal(wide.slots, 2);
  assert.equal(wide.build, false);
  assert.equal(wide.network, true);
});

test('the command refuses malformed options, raw commands, unknown scripts and lint', () => {
  const refusal = args => { try { parse(args, scripts); } catch (error) { return error.message; } return 'accepted'; };
  assert.match(refusal(['--issue','1','--job','a','test:runtime:built']), /^usage: npm run test:container/);
  assert.match(refusal(['--job','a','--','test:runtime:built']), /^usage:/);
  assert.match(refusal(['--issue','1','--job','a','--extra','--','test:runtime:built']), /^usage:/);
  assert.match(refusal(['--issue','1','--job','a','--']), /^usage:/);
  assert.match(refusal(['--issue','01','--job','a','--','test:runtime:built']), /issue must be a GitHub issue number/);
  for (const job of ['Unit','-a','a-','a_b','x'.repeat(33),'unit-wide']) assert.match(refusal(['--issue','1','--job',job,'--','test:runtime:built']), /job name must be/);
  assert.match(refusal(['--issue','1','--job','a','--size','huge','--','test:runtime:built']), /size must be standard or wide/);
  assert.equal(refusal(['--issue','1','--job','a','--','lint:js']), 'lint:js does not fit a test container: run it natively, one at a time, with npm run lint:js (see docs/static-analysis.md "Heap budget")');
  assert.equal(refusal(['--issue','1','--job','a','--','node','--test','x']), 'no package script named node: pass the name of a package.json script, not a command');
  assert.match(refusal(['--issue','1','--job','a','--','test:container']), /cannot run inside a test container/);
});

test('a job known not to fit is refused at a smaller size with its routes, and a taken name is never reused', () => {
  const plan = (size, script) => parse(['--issue','1','--job','a','--size',size,'--',script], scripts);
  assert.equal(admit(plan('standard','test:runtime:verify:built'), {nameTaken:false}), 'test:runtime:verify:built needs more than 1250 MiB: use --size wide, or npm run test:runtime:container -- --suite verify, which has its own 1536 MiB limit');
  assert.equal(admit(plan('wide','test:runtime:verify:built'), {nameTaken:false}), null);
  assert.equal(admit(plan('standard','test:sdk:built'), {nameTaken:false}), 'test:sdk:built fails below 4 CPUs: use --size wide');
  assert.equal(admit(plan('standard','test:runtime:built'), {nameTaken:false}), null);
  assert.match(admit(plan('standard','test:runtime:built'), {nameTaken:true}), /^a container named bunny-gh1-a already exists; .*never stops or removes a container it did not start/);
});

test('the docker run arguments pin the name, removal, limits, no swap, no network, hardening and a read-only snapshot', () => {
  const where = {imageId:image, source:'/tmp/s/source', cidfile:'/tmp/w/cid'};
  const tail = ['--cap-drop','ALL','--cap-add','CHOWN','--security-opt','no-new-privileges','--restart','no',
    '--volume','/tmp/s/source:/snapshot:ro','--env','TMPDIR=/tmp','--env','XDG_RUNTIME_DIR=','--env','DBUS_SESSION_BUS_ADDRESS=',image];
  assert.deepEqual(runArgs(parse(['--issue','1638','--job','unit','--','test:runtime:built','--x'], scripts), where), [
    'run','--rm','--init','--name','bunny-gh1638-unit','--cidfile','/tmp/w/cid','--network','none',
    '--cpus','2','--memory','1250m','--memory-swap','1250m',...tail,'build','test:runtime:built','--x']);
  assert.deepEqual(runArgs(parse(['--issue','1638','--job','sdk','--size','wide','--no-build','--','test:sdk:built'], scripts), where), [
    'run','--rm','--init','--name','bunny-gh1638-sdk-wide','--cidfile','/tmp/w/cid','--network','none',
    '--cpus','4','--memory','2048m','--memory-swap','2048m',...tail,'no-build','test:sdk:built']);
  const networked = runArgs(parse(['--issue','1','--job','a','--network','--','test:runtime:built'], scripts), where);
  assert.equal(networked[networked.indexOf('--network') + 1], 'bridge');
  assert.throws(() => runArgs(parse(['--issue','1','--job','a','--','test:runtime:built'], scripts), {...where, source:'/tmp/a b'}), /scratch-path-refused/);
  assert.deepEqual(Object.keys(sizes), ['standard','wide']);
});

test('the image key changes with the lockfile or the recipe and with nothing else', () => {
  const lock = Buffer.from('{"lockfileVersion":3}');
  const recipe = Buffer.from('FROM node');
  const key = imageKey(lock, recipe);
  assert.match(key, /^[a-f0-9]{24}$/);
  assert.equal(imageKey(Buffer.from(lock), Buffer.from(recipe)), key);
  assert.notEqual(imageKey(Buffer.from('{"lockfileVersion":3} '), recipe), key);
  assert.notEqual(imageKey(lock, Buffer.from('FROM node\n')), key);
  assert.notEqual(imageKey(recipe, lock), imageKey(lock, recipe));
});

test('the in-container steps copy the snapshot, commit it, build unless told not to and run the script', () => {
  assert.deepEqual(steps('build', 'test:runtime:built', ['--x']).map(([program, args]) => [program, ...args].join(' ')), [
    'cp -R /snapshot/. /work/source/', 'git init -q', 'git add .',
    'git -c user.name=Disposable test job -c user.email=checks@invalid commit -q -m Current task source snapshot',
    'npm run build', 'npm run test:runtime:built -- --x']);
  assert.deepEqual(steps('no-build', 'test:runtime:built', []).at(-1), ['npm', ['run', 'test:runtime:built']]);
  assert.equal(steps('no-build', 'test:runtime:built', []).length, 5);
  assert.throws(() => steps('maybe', 'x', []), /usage/);
  assert.equal(statusOf({status:0, signal:null}), 0);
  assert.equal(statusOf({status:3, signal:null}), 3);
  assert.equal(statusOf({status:null, signal:'SIGTERM'}), 143);
  assert.equal(statusOf({status:null, signal:'SIGKILL'}), 137);
  assert.equal(statusOf({status:null, signal:null}), 1);
});

/** A fake Docker host: an image store keyed by tag, a container table and a call log. */
function fakeHost({exit = 0, images = new Map(), linger = false, interruptDuringRun = false, interruptBeforeId = false, runWithoutId = null, rmExit = 0, buildExit = 0} = {}) {
  const calls = [];
  const containers = new Set();
  let interrupt;
  const io = {
    calls, images,
    log: () => {},
    onInterrupt: handler => { interrupt = handler; },
    snapshot: async (_repository, destination) => {
      await mkdir(join(destination, 'scripts/test-container'), {recursive:true});
      await writeFile(join(destination, 'package-lock.json'), '{"lockfileVersion":3}');
      await writeFile(join(destination, 'scripts/test-container/Dockerfile'), 'FROM node');
      await writeFile(join(destination, 'package.json'), '{}');
      return ['package-lock.json', 'package.json', 'scripts/test-container/Dockerfile'];
    },
    read: args => {
      calls.push(['read', ...args]);
      if (args[0] === 'container') return containers.has(args.at(-1)) ? args.at(-1) : null;
      const entry = images.get(args.at(-1));
      if (!entry) return null;
      return args[3] === '{{.Id}}' ? entry.id : `${entry.id} ${entry.label}`;
    },
    run: async args => {
      calls.push(args);
      if (args[0] === 'build') { if (buildExit === 0) images.set(args[2], {id:image, label:args[4].split('=')[1]}); return buildExit; }
      if (args[0] === 'kill') { containers.delete(args[1]); return 0; }
      if (args[0] === 'rm') { if (rmExit === 0) containers.delete(args.at(-1)); return rmExit; }
      if (args[0] === 'run') {
        // docker run refusing before it creates a container writes no cidfile, like a 125 from the engine.
        if (runWithoutId !== null) return runWithoutId;
        if (interruptBeforeId) { interrupt(); await new Promise(wait => setTimeout(wait, 20)); return 130; }
        containers.add(id);
        await writeFile(args[args.indexOf('--cidfile') + 1], id + '\n');
        if (interruptDuringRun) {
          await new Promise(wait => setTimeout(wait, 150));
          interrupt();
          await new Promise(wait => setTimeout(wait, 20));
          return 137;
        }
        if (!linger) containers.delete(id);
        return exit;
      }
      return 1;
    },
  };
  return io;
}

async function repository() {
  const path = await mkdtemp(join(tmpdir(), 'test-container-repo-'));
  await writeFile(join(path, 'package.json'), JSON.stringify({scripts}));
  return path;
}

const argv = ['--issue','1638','--job','unit','--','test:runtime:built'];

test('a first run builds the keyed image, a second run reuses it, and both return the job status and leave nothing', async () => {
  const repo = await repository();
  try {
    const io = fakeHost({exit:0});
    assert.equal(await runJob(argv, io, repo), 0);
    const run = io.calls.find(call => call[0] === 'run');
    const source = run[run.indexOf('--volume') + 1].split(':')[0];
    assert.equal(existsSync(source), false, 'the snapshot is removed');
    assert.equal(io.calls.filter(call => call[0] === 'build').length, 1);
    const again = fakeHost({exit:3, images:io.images});
    assert.equal(await runJob(argv, again, repo), 3, 'a failing job returns its status');
    assert.equal(again.calls.filter(call => call[0] === 'build').length, 0, 'an unchanged lockfile builds nothing');
    assert.equal(again.calls.filter(call => call[0] === 'rm').length, 0, 'a container --rm removed is not removed again');
  } finally { await rm(repo, {recursive:true, force:true}); }
});

test('a container still present after its run is removed by its own ID, and an interrupt kills only that ID', async () => {
  const repo = await repository();
  try {
    const lingering = fakeHost({exit:0, linger:true});
    assert.equal(await runJob(argv, lingering, repo), 0);
    assert.deepEqual(lingering.calls.filter(call => call[0] === 'rm'), [['rm','--force',id]]);
    const interrupted = fakeHost({interruptDuringRun:true});
    assert.equal(await runJob(argv, interrupted, repo), 137);
    assert.deepEqual(interrupted.calls.filter(call => call[0] === 'kill'), [['kill', id]]);
  } finally { await rm(repo, {recursive:true, force:true}); }
});

test('an image without this lockfile key is never used, and a taken name or refused script starts nothing', async () => {
  const repo = await repository();
  try {
    const key = imageKey(Buffer.from('{"lockfileVersion":3}'), Buffer.from('FROM node'));
    const stale = fakeHost({images:new Map([[`bunny-test-deps:${key}`, {id:image, label:'0'.repeat(24)}]])});
    const said = [];
    stale.log = line => said.push(line);
    assert.equal(await runJob(argv, stale, repo), 2);
    assert.equal(stale.calls.some(call => call[0] === 'run'), false);
    assert.ok(said.includes(`bunny-test-deps:${key} does not carry this lockfile's key, so it is not used: ask the owner to remove the bunny-test-deps:${key} tag, then run again to rebuild it`));
    const taken = fakeHost();
    taken.read = args => { taken.calls.push(['read', ...args]); return args[0] === 'container' ? id : null; };
    let snapshotted = false;
    taken.snapshot = async () => { snapshotted = true; return []; };
    assert.equal(await runJob(argv, taken, repo), 2);
    assert.equal(snapshotted, false);
    assert.equal(taken.calls.some(call => ['run','rm','kill'].includes(call[0])), false);
    const lint = fakeHost();
    assert.equal(await runJob(['--issue','1','--job','a','--','lint:js'], lint, repo), 2);
    assert.deepEqual(lint.calls, []);
  } finally { await rm(repo, {recursive:true, force:true}); }
});

test('an interrupt before the container ID exists, or a docker run refused before it, kills and removes nothing', async () => {
  const repo = await repository();
  try {
    const early = fakeHost({interruptBeforeId:true});
    assert.equal(await runJob(argv, early, repo), 130);
    assert.equal(early.calls.some(call => call[0] === 'kill' || call[0] === 'rm'), false);
    const refused = fakeHost({runWithoutId:125});
    assert.equal(await runJob(argv, refused, repo), 125);
    assert.equal(refused.calls.some(call => call[0] === 'kill' || call[0] === 'rm'), false);
  } finally { await rm(repo, {recursive:true, force:true}); }
});

test('a failed removal turns a passing job into status 1 and leaves a failing job its own status', async () => {
  const repo = await repository();
  try {
    assert.equal(await runJob(argv, fakeHost({exit:0, linger:true, rmExit:1}), repo), 1);
    assert.equal(await runJob(argv, fakeHost({exit:3, linger:true, rmExit:1}), repo), 3);
  } finally { await rm(repo, {recursive:true, force:true}); }
});

test('a failed image build returns its status and runs nothing', async () => {
  const repo = await repository();
  try {
    const io = fakeHost({buildExit:17});
    assert.equal(await runJob(argv, io, repo), 17);
    assert.equal(io.calls.some(call => call[0] === 'run'), false);
  } finally { await rm(repo, {recursive:true, force:true}); }
});

test('a scratch path docker cannot carry unchanged is refused with what to do, and nothing runs', async () => {
  const repo = await repository();
  const odd = await mkdtemp(join(tmpdir(), 'test container '));
  const saved = process.env.TMPDIR;
  try {
    process.env.TMPDIR = odd;
    const lines = [];
    const io = fakeHost();
    io.log = line => lines.push(line);
    assert.equal(await runJob(argv, io, repo), 2);
    assert.match(lines.join('\n'), /set TMPDIR to a directory whose path uses only letters, digits, dot, underscore, slash and hyphen/);
    assert.equal(io.calls.some(call => ['build','run'].includes(call[0])), false);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    await rm(odd, {recursive:true, force:true});
    await rm(repo, {recursive:true, force:true});
  }
});
