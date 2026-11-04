import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import * as realOperator from '../bunny.mjs';
import {agents, installDiagnostics, installSignin, plist} from '../mac-host-install.mjs';
import {engineWait, healthWait, operatorFor, startAtSignIn} from '../mac-signin.mjs';

const revision = 'a'.repeat(40);
const compose = '/releases/old/compose.production.yaml';
const core = (running, labels = {}) => ({
  Id: 'c'.repeat(64),
  State: {Running: running},
  Config: {Labels: {'org.opencontainers.image.revision': revision, 'com.docker.compose.project.config_files': compose, ...labels}},
});

// A fake engine and operator; any `docker start` reaching the fake fails the test.
function host({info = core(false), ids = ['c'], engine = () => 'ok', health = () => '{"status":"ok"}', maintain = () => ({status: 'running'}), exists = () => true} = {}) {
  const state = {calls: [], reports: [], time: 0, plans: []};
  const options = {
    run: async args => {
      state.calls.push(args);
      if (args[0] === 'start' || args[0] === 'restart') assert.fail('started the container directly');
      if (args[0] === 'info') return engine();
      if (args[0] === 'ps') return ids.join('\n');
      if (args[0] === 'inspect') return JSON.stringify([info]);
      if (args[0] === 'exec') return health();
      return assert.fail(`unexpected docker ${args[0]}`);
    },
    load: async path => {
      state.loaded = path;
      return {parse: argv => realOperator.parse(argv), maintain: async plan => {state.plans.push(plan); return maintain(plan);}};
    },
    exists: async path => exists(path),
    sleep: async ms => {state.time += ms;},
    now: () => state.time,
    report: fields => state.reports.push(fields),
  };
  return {state, options};
}
const selection = {project: 'bunny-mac-personal', releases: '/releases'};
const refusedWith = reason => error => error.reason === reason;

test('a stopped core starts through the release operator of its own image, then reports health', async () => {
  const {state, options} = host();
  assert.deepEqual(await startAtSignIn(selection, options), {outcome: 'running'});
  assert.equal(state.loaded, `/releases/${revision}/source/scripts/bunny.mjs`);
  assert.equal(state.plans.length, 1);
  assert.equal(state.plans[0].command, 'start');
  assert.equal(state.plans[0].project, 'bunny-mac-personal');
  assert.equal(state.plans[0].compose, compose);
  assert.deepEqual(state.reports.map(r => r.outcome), ['ready', 'started', 'ok']);
});

test('the real operator parses the arguments and exports what the starter calls', () => {
  assert.equal(typeof realOperator.maintain, 'function');
  assert.equal(realOperator.parse(['start', '--project', 'bunny-mac-personal', '--compose', compose]).command, 'start');
});

test('an older release layout is found under build/source', async () => {
  const exists = async path => path.includes('/build/source/');
  const found = await operatorFor(core(false), '/releases', exists);
  assert.equal(found.path, `/releases/${revision}/build/source/scripts/bunny.mjs`);
});

test('waits for Docker, then refuses once the bound passes', async () => {
  let answers = 0;
  const waited = host({engine: () => {answers += 1; if (answers < 4) throw new Error('down'); return 'ok';}});
  await startAtSignIn(selection, waited.options);
  assert.ok(waited.state.time > 0 && waited.state.time < engineWait);

  const down = host({engine: () => {throw new Error('down');}});
  await assert.rejects(startAtSignIn(selection, down.options), refusedWith('docker-unavailable'));
  assert.ok(down.state.time >= engineWait);
  assert.equal(down.state.plans.length, 0);
});

test('a running core is left alone', async () => {
  const {state, options} = host({info: core(true)});
  await startAtSignIn(selection, options);
  assert.equal(state.plans.length, 0);
  assert.deepEqual(state.reports.map(r => r.outcome), ['ready', 'already-running', 'ok']);
});

test('nothing starts for a missing or ambiguous core or an unusable identity', async () => {
  for (const [changes, reason] of [
    [{ids: []}, 'core-missing'],
    [{ids: ['a', 'b']}, 'core-ambiguous'],
    [{info: core(false, {'org.opencontainers.image.revision': 'not-a-revision'})}, 'identity-invalid'],
    [{info: core(false, {'com.docker.compose.project.config_files': 'one.yaml,two.yaml'})}, 'identity-invalid'],
    [{exists: () => false}, 'operator-missing'],
  ]) {
    const {state, options} = host(changes);
    await assert.rejects(startAtSignIn(selection, options), refusedWith(reason));
    assert.equal(state.plans.length, 0);
  }
});

test('an operator refusal, such as an unfinished deployment, is final', async () => {
  const {state, options} = host({maintain: () => {throw Object.assign(new Error('refused'), {code: 'operation-refused'});}});
  await assert.rejects(startAtSignIn(selection, options), refusedWith('start-refused'));
  assert.equal(state.plans.length, 1);
  assert.equal(state.calls.some(args => args[0] === 'exec'), false);
  assert.deepEqual(state.reports.at(-1), {step: 'start', outcome: 'refused', code: 'operation-refused'});
});

test('an operator that cannot load is refused rather than bypassed', async () => {
  const {state, options} = host();
  options.load = async () => {throw new Error('no module');};
  await assert.rejects(startAtSignIn(selection, options), refusedWith('operator-unusable'));
  assert.equal(state.calls.some(args => args[0] === 'exec'), false);
});

test('health waits for the runtime, then reports failure without stopping it', async () => {
  let answers = 0;
  const late = host({health: () => {answers += 1; if (answers < 3) throw new Error('not yet'); return '{"status":"ok"}';}});
  await startAtSignIn(selection, late.options);
  assert.equal(answers, 3);

  const never = host({health: () => '{"status":"degraded"}'});
  await assert.rejects(startAtSignIn(selection, never.options), refusedWith('health-failed'));
  assert.ok(never.state.time >= healthWait);
  assert.equal(never.state.calls.some(args => args[0] === 'stop'), false);
});

test('the runtime agent runs once per sign-in and the route agents stay up', () => {
  const [runtime, forwarder, serve] = agents({home: '/Users/owner', node: '/node'});
  assert.equal(runtime.keepAlive, false);
  assert.equal(forwarder.keepAlive, true);
  assert.equal(serve.keepAlive, true);
  assert.match(plist(runtime), /<key>KeepAlive<\/key>\n {2}<false\/>/);
  assert.match(plist(forwarder), /<key>KeepAlive<\/key>\n {2}<true\/>/);
  assert.ok(runtime.path.split(':').includes('/Users/owner/.docker/bin'));
  assert.match(plist({...runtime, log: '/a&b'}), /\/a&amp;b/);
});

async function fixture(t) {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'bunny-mac-host-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  return home;
}

test('sign-in install writes the starter and three lintable agents, with no release path or credential', async t => {
  const home = await fixture(t);
  await assert.rejects(installSignin({home, node: '/node'}), /private-route-missing/);
  const route = join(home, '.config', 'bunny', 'private-access');
  await mkdir(route, {recursive: true});
  await writeFile(join(route, 'start-forwarder.sh'), '#!/bin/sh\n');
  const result = await installSignin({home, node: '/node'});
  assert.deepEqual(result.installed, ['org.bunny.runtime-signin', 'org.bunny.private-forwarder', 'org.bunny.private-serve']);
  const installed = join(home, '.local', 'share', 'bunny', 'signin', 'mac-signin.mjs');
  assert.equal((await stat(installed)).mode & 0o777, 0o700);
  assert.deepEqual(await readFile(installed), await readFile(new URL('../mac-signin.mjs', import.meta.url)));
  assert.doesNotMatch(await readFile(installed, 'utf8'), /from '(?!node:)/);
  for (const label of result.installed) {
    const file = join(home, 'Library', 'LaunchAgents', `${label}.plist`);
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /releases|forwarder\.env|TOKEN|PASSWORD/i);
    if (process.platform === 'darwin') await promisify(execFile)('plutil', ['-lint', file]);
  }
});

test('diagnostics install copies one revision to the fixed home, keeps the previous copy and recreates from it', async t => {
  const home = await fixture(t);
  const root = join(home, '.local', 'share', 'bunny', 'diagnostics');
  const calls = [];
  const command = async (file, args) => {
    calls.push([file, ...args]);
    if (file === 'git') await writeFile(args[args.indexOf('-o') + 1], '');
    if (file === 'tar') await writeFile(join(args[args.indexOf('-C') + 1], 'compose.yaml'), `from ${calls.length}\n`);
    return '';
  };
  await assert.rejects(installDiagnostics('main', {home, command}), /revision-invalid/);
  const first = await installDiagnostics(revision, {home, command});
  assert.equal(first.compose, join(root, 'current', 'compose.yaml'));
  assert.equal(await readFile(join(root, 'current', 'revision.txt'), 'utf8'), `${revision}\n`);
  assert.deepEqual(calls.at(-1), ['docker', 'compose', '-f', first.compose, 'up', '-d', '--no-build', '--pull', 'missing', '--force-recreate']);

  const second = 'b'.repeat(40);
  await installDiagnostics(second, {home, command});
  assert.equal(await readFile(join(root, 'current', 'revision.txt'), 'utf8'), `${second}\n`);
  assert.equal(await readFile(join(root, 'previous', 'revision.txt'), 'utf8'), `${revision}\n`);
});

test('a copy that does not validate leaves the installed stack alone', async t => {
  const home = await fixture(t);
  const root = join(home, '.local', 'share', 'bunny', 'diagnostics');
  const good = async (file, args) => {
    if (file === 'git') await writeFile(args[args.indexOf('-o') + 1], '');
    return '';
  };
  await installDiagnostics(revision, {home, command: good});
  const bad = async (file, args) => {
    if (file === 'docker') throw new Error('invalid');
    return good(file, args);
  };
  await assert.rejects(installDiagnostics('b'.repeat(40), {home, command: bad}), /invalid/);
  assert.equal(await readFile(join(root, 'current', 'revision.txt'), 'utf8'), `${revision}\n`);
});

// #1410's hang only shows with the real module graph, so this one runs the starter as a process against a fake engine.
test('the installed starter settles through the real operator and reports its refusal', {timeout: 60_000}, async t => {
  if (process.platform === 'win32') return t.skip('POSIX only');
  const home = await fixture(t);
  const bin = join(home, 'bin'), calls = join(home, 'calls.log');
  const releases = join(home, 'releases', revision);
  await mkdir(bin);
  await mkdir(releases, {recursive: true});
  await symlink(fileURLToPath(new URL('../..', import.meta.url)), join(releases, 'source'));
  // The operator refuses this container: it has none of the owned mounts, which is enough to prove the path settles.
  await writeFile(join(home, 'inspect.json'), JSON.stringify([core(false)]));
  await writeFile(join(bin, 'docker'), `#!/bin/sh
echo "$*" >> "${calls}"
case "$1" in
  info) echo 1 ;;
  ps) echo ${'c'.repeat(64)} ;;
  inspect) cat "${join(home, 'inspect.json')}" ;;
  compose) echo ${'c'.repeat(64)} ;;
esac
`, {mode: 0o755});
  await writeFile(join(bin, 'osascript'), `#!/bin/sh\necho "osascript $*" >> "${calls}"\n`, {mode: 0o755});
  const starter = fileURLToPath(new URL('../mac-signin.mjs', import.meta.url));
  const child = await new Promise(done => {
    execFile(process.execPath, [starter, '--project', 'synthetic', '--releases', join(home, 'releases')], {
      env: {PATH: `${bin}:/usr/bin:/bin`, HOME: home}, timeout: 50_000,
    }, (error, stdout) => done({code: error?.code, stdout}));
  });
  assert.equal(child.code, 1);
  const reports = child.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(reports.at(-1).reason, 'start-refused');
  assert.equal(reports.at(-2).outcome, 'refused');
  const log = await readFile(calls, 'utf8');
  assert.match(log, /osascript -e display notification .*start-refused/);
  assert.doesNotMatch(log, /^(start|restart) /m);
});
