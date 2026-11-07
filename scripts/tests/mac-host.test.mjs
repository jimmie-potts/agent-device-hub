import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {Outcome} from '../../packages/sdk/dist/src/index.js';
import {reconcileOperation, withOperation} from '../bunny-operations.mjs';
import * as realOperator from '../bunny.mjs';
import {agents, installDiagnostics, installSignin, plist} from '../mac-host-install.mjs';
import {engineWait, healthWait, operatorFor, startAtSignIn, startGate} from '../mac-signin.mjs';

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
    gate: async () => {},
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
  assert.match(plist(runtime), /<string>Background<\/string>/);
  assert.doesNotMatch(plist(serve), /ProcessType/);
  assert.deepEqual(agents({home: '/h', node: '/node', project: 'other'})[0].program.slice(-2), ['--project', 'other']);
  assert.ok(runtime.path.split(':').includes('/Users/owner/.docker/bin'));
  assert.match(plist({...runtime, log: '/a&b'}), /\/a&amp;b/);
});

test('only the serve agent runs the app binary as the CLI, which it needs without a terminal', () => {
  const [runtime, forwarder, serve] = agents({home: '/Users/owner', node: '/node'});
  const variable = /<key>TAILSCALE_BE_CLI<\/key>\n {4}<string>1<\/string>/;
  assert.match(plist(serve), variable);
  assert.match(plist(serve), /<key>PATH<\/key>\n {4}<string>\/Users\/owner\/\.docker\/bin:/);
  assert.doesNotMatch(plist(runtime), /TAILSCALE_BE_CLI/);
  assert.doesNotMatch(plist(forwarder), /TAILSCALE_BE_CLI/);
});

// Even as the CLI, the app binary starts as the GUI when its parent is launchd, so a waiting shell stays its parent.
const tailscale = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
test('the serve agent keeps a shell as the app binary\'s parent and forwards a stop to it', () => {
  const [runtime, forwarder, serve] = agents({home: '/Users/owner', node: '/node'});
  const [shell, flag, script, binary, ...rest] = serve.program;
  assert.deepEqual([shell, flag, binary, rest], ['/bin/sh', '-c', tailscale, []]);
  assert.doesNotMatch(script, /\bexec\b/);
  assert.ok(!script.includes(tailscale), 'the binary is an argument, not shell text');
  assert.match(script, /"\$0" serve --https=443 http:\/\/127\.0\.0\.1:18789 &/);
  assert.match(script, /trap '[^']*kill -TERM "\$c"[^']*wait "\$c"[^']*' TERM INT/);
  assert.match(script, /wait "\$c"$/);
  assert.equal(runtime.program[0], '/node');
  assert.deepEqual(forwarder.program, ['/bin/sh', '/Users/owner/.config/bunny/private-access/start-forwarder.sh']);
});

const waitFor = async (check, limit = 10_000) => {
  for (const deadline = Date.now() + limit; Date.now() < deadline; await new Promise(done => setTimeout(done, 50))) {
    const value = await check().catch(() => undefined);
    if (value) return value;
  }
  return assert.fail('timed out');
};
const alive = pid => {try {process.kill(pid, 0); return true;} catch {return false;}};

test('the serve agent\'s shell is the binary\'s parent, ends it on a stop and exits with it', {timeout: 30_000, skip: process.platform === 'win32'}, async t => {
  const home = await fixture(t);
  const fake = join(home, 'Tailscale');
  // Records its parent and arguments, then runs until a TERM, as the serve does.
  await writeFile(fake, `#!/bin/sh
echo "$$ $PPID $*" > "${home}/started"
trap 'echo terminated > "${home}/stopped"; exit 0' TERM
[ -f "${home}/exit-now" ] && exit 3
while :; do sleep 0.05; done
`, {mode: 0o755});
  const [, , serve] = agents({home: '/Users/owner', node: '/node'});
  // Swapped wherever it appears, so no shape of the agent can ever run the real app binary here.
  const program = serve.program.map(arg => (arg === tailscale ? fake : arg));
  assert.ok(!program.some(arg => arg.includes('Tailscale.app')));
  // A failing run must not leave the fake looping, which would also hold the test runner open.
  const spawned = [];
  t.after(() => spawned.forEach(pid => {try {process.kill(pid, 'SIGKILL');} catch {/* already gone */}}));
  const run = () => {
    const shell = spawn(program[0], program.slice(1), {stdio: 'ignore'});
    spawned.push(shell.pid);
    const exited = new Promise(done => shell.on('exit', (code, signal) => done({code, signal})));
    return {shell, exited};
  };

  const {shell, exited} = run();
  const [child, parent, ...args] = (await waitFor(() => readFile(join(home, 'started'), 'utf8'))).trim().split(' ');
  spawned.push(Number(child));
  assert.equal(Number(parent), shell.pid);
  assert.deepEqual(args, ['serve', '--https=443', 'http://127.0.0.1:18789']);
  shell.kill('SIGTERM');
  assert.deepEqual(await exited, {code: 0, signal: null});
  assert.equal(await readFile(join(home, 'stopped'), 'utf8'), 'terminated\n');
  assert.equal(alive(Number(child)), false);

  // When the serve exits by itself, so does the job, which lets KeepAlive restart it.
  await rm(join(home, 'started'));
  await writeFile(join(home, 'exit-now'), '');
  assert.deepEqual(await run().exited, {code: 3, signal: null});
});

async function fixture(t) {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'bunny-mac-host-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  return home;
}

test('sign-in install writes the starter and three lintable agents, with no release path or credential', async t => {
  const home = await fixture(t);
  await assert.rejects(installSignin({home, node: '/node'}), /private-route-missing/);
  await assert.rejects(installSignin({home, node: '/node', project: '../x'}), /project-invalid/);
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

test('a failed recreate returns the folder and the stack to the previous copy', async t => {
  const home = await fixture(t);
  const root = join(home, '.local', 'share', 'bunny', 'diagnostics');
  const ups = [];
  let failing = false;
  const command = async (file, args) => {
    if (file === 'git') await writeFile(args[args.indexOf('-o') + 1], '');
    if (args.includes('up')) {
      ups.push(await readFile(join(root, 'current', 'revision.txt'), 'utf8'));
      if (failing) {failing = false; throw new Error('port in use');}
    }
    return '';
  };
  await installDiagnostics(revision, {home, command});
  failing = true;
  await assert.rejects(installDiagnostics('b'.repeat(40), {home, command}), /port in use/);
  assert.equal(await readFile(join(root, 'current', 'revision.txt'), 'utf8'), `${revision}\n`);
  assert.deepEqual(ups, [`${revision}\n`, `${'b'.repeat(40)}\n`, `${revision}\n`]);
});

test('the start gate refuses a hold and only a failed deployment\'s own replacement', async t => {
  const operations = await fixture(t);
  const gate = {project: 'synthetic', operations};
  const info = {Id: 'c'.repeat(64)};
  await startGate(gate, info);
  await mkdir(join(operations, 'synthetic.records'));
  const record = (name, value) => writeFile(join(operations, 'synthetic.records', `${name}.json`), JSON.stringify({schema: 'bunny-batch-record/1.0', ...value}));
  await record('completed', {id: 'a', replacementContainer: info.Id, completedAt: 'then'});
  await record('reconciled-success', {id: 'b', replacementContainer: info.Id, reconciledFrom: {}, completedAt: 'then'});
  await record('reconciled-other', {id: 'c', replacementContainer: 'd'.repeat(64), reconciledFrom: {}});
  await startGate(gate, info);
  await record('reconciled-failed', {id: 'd', replacementContainer: info.Id, reconciledFrom: {}});
  await assert.rejects(startGate(gate, info), refusedWith('failed-deployment'));
  await rm(join(operations, 'synthetic.records', 'reconciled-failed.json'));
  const image = `sha256:${'2'.repeat(64)}`;
  const replacement = {Id: info.Id, Image: image, Created: '2026-11-04T10:00:00Z'};
  await record('unnamed', {id: 'e', targetImage: image, reconciledFrom: {}, reconciledAt: '2026-11-04T11:00:00Z'});
  await assert.rejects(startGate(gate, replacement), refusedWith('failed-deployment'));
  await startGate(gate, {...replacement, Created: '2026-11-04T12:00:00Z'});
  await startGate(gate, {...replacement, Image: `sha256:${'3'.repeat(64)}`});
  await rm(join(operations, 'synthetic.records', 'unnamed.json'));
  await writeFile(join(operations, 'synthetic.records', 'broken.json'), '{');
  await assert.rejects(startGate(gate, info), refusedWith('records-unreadable'));
  await writeFile(join(operations, 'synthetic.records', 'broken.json'), JSON.stringify({schema: 'bunny-batch-record/2.0'}));
  await assert.rejects(startGate(gate, info), refusedWith('records-unreadable'));
  await rm(join(operations, 'synthetic.records', 'broken.json'));
  await writeFile(join(operations, 'synthetic.start-hold'), '');
  await assert.rejects(startGate(gate, info), refusedWith('held'));
});

// Hand-written records cannot notice a format change, so these come from the real writers and pin the deployment's fields.
test('the start gate reads what a failed deployment and its reconcile really write', async t => {
  const operations = await fixture(t);
  const gate = {project: 'synthetic', operations};
  const failed = {id: 'deployment', schema: 'bunny-batch-record/1.0', phase: 'checking-health', outcome: Outcome.failed, targetImage: 'sha256:target'};
  const fail = (record, root = operations) => withOperation({root, project: 'synthetic'}, async lease => {
    await lease.record(record);
    throw new Error('stop here, as a failed deployment does');
  });
  const reconcile = () => reconcileOperation({root: operations, project: 'synthetic'}, async () => ({status: 'exited'}));
  const replacement = {Id: 'c'.repeat(64), Image: 'sha256:target', Created: '2026-01-01T00:00:00.000000000Z'};

  await assert.rejects(fail({...failed, replacementContainer: replacement.Id}), /stop here/);
  await reconcile();
  await assert.rejects(startGate(gate, replacement), refusedWith('failed-deployment'));
  await startGate(gate, {...replacement, Id: 'd'.repeat(64), Image: 'sha256:other'});

  // Also the case with no recorded ID: nanoseconds as Docker writes them, older than the reconcile.
  await rm(join(operations, 'synthetic.records'), {recursive: true});
  await assert.rejects(fail(failed), /stop here/);
  await reconcile();
  await assert.rejects(startGate(gate, {...replacement, Id: 'e'.repeat(64)}), refusedWith('failed-deployment'));

  const batch = await readFile(new URL('../deployment/batch.mjs', import.meta.url), 'utf8');
  for (const written of ["schema:'bunny-batch-record/1.0'", 'targetImage:', 'record.replacementContainer=', 'completedAt:']) assert.ok(batch.includes(written), written);
});

// #1410's hang and a broken module graph only show with the real operator, so these run the starter as a process.
const coreId = 'c'.repeat(64);
const stoppedCore = {
  ...core(false),
  Id: coreId,
  Image: `sha256:${'2'.repeat(64)}`,
  State: {Status: 'exited', Running: false, Restarting: false, Pid: 0},
  Config: {User: '1000:1000', Labels: {...core(false).Config.Labels, 'com.docker.compose.project': 'synthetic', 'com.docker.compose.service': 'core'}},
  HostConfig: {RestartPolicy: {Name: 'no'}, PortBindings: {}, NetworkMode: 'none'},
  NetworkSettings: {Networks: {}},
  Mounts: [['state', '/var/lib/bunny', true], ['config', '/etc/bunny', false], ['secrets', '/run/secrets/bunny', false]]
    .map(([Name, Destination, RW]) => ({Type: 'volume', Name, Destination, RW})),
};
async function starterHost(t) {
  const home = await fixture(t);
  const bin = join(home, 'bin'), calls = join(home, 'calls.log'), inspect = join(home, 'inspect.json');
  const releases = join(home, 'releases', revision);
  const operations = join(home, '.local', 'state', 'bunny-operations');
  await mkdir(bin);
  await mkdir(releases, {recursive: true});
  await mkdir(operations, {recursive: true, mode: 0o700});
  await symlink(fileURLToPath(new URL('../..', import.meta.url)), join(releases, 'source'));
  await writeFile(inspect, JSON.stringify([stoppedCore]));
  const running = JSON.stringify([{...stoppedCore, State: {Status: 'running', Running: true, Restarting: false, Pid: 42}}]);
  await writeFile(join(home, 'running.json'), running);
  await writeFile(join(bin, 'docker'), `#!/bin/sh
echo "$*" >> "${calls}"
case "$1" in
  info) echo 1 ;;
  ps) echo ${coreId} ;;
  inspect) cat "${inspect}" ;;
  volume) echo '[{"Name":"'"$3"'","Driver":"local","Scope":"local","Options":null}]' ;;
  start) cp "${join(home, 'running.json')}" "${inspect}" ;;
  exec) echo '{"status":"ok"}' ;;
esac
`, {mode: 0o755});
  await writeFile(join(bin, 'osascript'), `#!/bin/sh\necho "osascript $*" >> "${calls}"\n`, {mode: 0o755});
  const starter = fileURLToPath(new URL('../mac-signin.mjs', import.meta.url));
  const run = (path = starter) => new Promise(done => {
    execFile(process.execPath, [path, '--project', 'synthetic', '--releases', join(home, 'releases')], {
      env: {PATH: `${bin}:/usr/bin:/bin`, HOME: home}, timeout: 50_000,
    }, (error, stdout) => done({code: error?.code, reports: stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))}));
  });
  return {run, home, starter, operations, log: () => readFile(calls, 'utf8')};
}
const posixOnly = {timeout: 60_000, skip: process.platform === 'win32'};

test('the starter starts a stopped core through the real operator, which issues the only start', posixOnly, async t => {
  const {run, operations, log} = await starterHost(t);
  const {code, reports} = await run();
  assert.equal(code, undefined);
  assert.deepEqual(reports.map(r => r.outcome), ['ready', 'started', 'ok']);
  assert.match(await log(), new RegExp(`^start ${coreId}$`, 'm'));
  assert.equal((await stat(join(operations, 'synthetic.operation-owner'))).mode & 0o777, 0o600);
});

test('a pending deployment record stops the real operator', posixOnly, async t => {
  const {run, operations, log} = await starterHost(t);
  await writeFile(join(operations, 'synthetic.pending.json'), JSON.stringify({id: 'deployment', phase: 'checking-health'}), {mode: 0o600});
  const {code, reports} = await run();
  assert.equal(code, 1);
  assert.equal(reports.at(-1).reason, 'start-refused');
  assert.equal(reports.at(-2).code, 'operation-refused');
  const calls = await log();
  assert.match(calls, /osascript -e display notification .*start-refused/);
  assert.doesNotMatch(calls, /^(start|restart) /m);
});

test('a lease another operation holds stops the real operator', posixOnly, async t => {
  const {run, operations, log} = await starterHost(t);
  const {takeLock} = await import('../../apps/runtime/dist/src/core/lock.js');
  const lease = await takeLock(join(operations, 'synthetic.operation'), AbortSignal.abort());
  t.after(() => lease.release());
  const {code, reports} = await run();
  assert.equal(code, 1);
  assert.equal(reports.at(-1).reason, 'start-refused');
  assert.doesNotMatch(await log(), /^(start|restart) /m);
});

test('a start hold keeps the core stopped before the operator is reached', posixOnly, async t => {
  const {run, operations, log} = await starterHost(t);
  await writeFile(join(operations, 'synthetic.start-hold'), '');
  const {code, reports} = await run();
  assert.equal(code, 1);
  assert.equal(reports.at(-1).reason, 'held');
  const calls = await log();
  assert.match(calls, /start hold/);
  assert.doesNotMatch(calls, /^(start|restart|volume) /m);
});

// Node resolves a symlink for import.meta.url but keeps it in argv, so a path comparison missed and exited 0 (#1470).
test('the starter reaches its entry point through a symlinked path', posixOnly, async t => {
  const {run, home, starter, operations, log} = await starterHost(t);
  await writeFile(join(operations, 'synthetic.start-hold'), '');
  const linked = join(home, 'signin', 'mac-signin.mjs');
  await mkdir(join(home, 'signin'));
  await symlink(starter, linked);
  for (const path of [starter, linked]) {
    const {code, reports} = await run(path);
    assert.equal(code, 1, path);
    assert.equal(reports.at(-1)?.reason, 'held', path);
  }
  assert.doesNotMatch(await log(), /^(start|restart|volume) /m);
});

// An owner's maintenance script (a backup, a configuration write) records through the same lease, with its own fields
// and no schema. Before #1426's fix one such record kept the core stopped at every sign-in.
const maintenanceRecord = (id, container) => ({id, owner: 'synthetic configuration write', project: 'synthetic',
  phase: 'writing-configuration', outcome: 'uncertain', container, backup: {name: 'synthetic.tar'}, startedAt: new Date().toISOString()});
const maintain = (root, record) => withOperation({root, project: 'synthetic'}, async lease => {
  await lease.record(record);
  await lease.complete({...record, phase: 'succeeded', outcome: 'succeeded', result: {changed: true}, completedAt: new Date().toISOString()});
});

test('the start gate passes the operator\'s own maintenance records and still refuses an unknown one', async t => {
  const operations = await fixture(t);
  const gate = {project: 'synthetic', operations};
  const info = {Id: 'c'.repeat(64), Image: 'sha256:target', Created: '2026-01-01T00:00:00.000000000Z'};
  await maintain(operations, maintenanceRecord('maintenance-complete', info.Id));
  // A failed one that its owner reconciled names no replacement, so it holds nothing back either.
  await assert.rejects(withOperation({root: operations, project: 'synthetic'}, async lease => {
    await lease.record(maintenanceRecord('maintenance-failed', info.Id));
    throw new Error('stop here');
  }), /stop here/);
  await reconcileOperation({root: operations, project: 'synthetic'}, async () => ({status: 'exited'}));
  await startGate(gate, info);

  const records = join(operations, 'synthetic.records');
  const written = JSON.parse(await readFile(join(records, 'maintenance-complete.json'), 'utf8'));
  const unknown = async (name, value) => {
    await writeFile(join(records, name), typeof value === 'string' ? value : JSON.stringify(value), {mode: 0o600});
    await assert.rejects(startGate(gate, info), refusedWith('records-unreadable'), name);
    await rm(join(records, name));
  };
  await unknown('newer.json', {...written, id: 'newer', schema: 'bunny-maintenance-record/1.0'});
  await unknown('batch.json', {...written, id: 'batch', schema: 'bunny-batch-record/2.0'});
  await unknown('no-schema-replacement.json', {...written, id: 'no-schema-replacement', replacementContainer: info.Id, reconciledFrom: {}});
  await unknown('no-schema-image.json', {...written, id: 'no-schema-image', targetImage: info.Image});
  await unknown('renamed.json', written);
  await unknown('no-owner.json', {...written, id: 'no-owner', ownerProcess: undefined});
  await unknown('null.json', 'null');
  await unknown('corrupt.json', '{');
  await startGate(gate, info);
});

test('a completed maintenance record no longer stops the real starter', posixOnly, async t => {
  const {run, operations, log} = await starterHost(t);
  await maintain(operations, maintenanceRecord('maintenance-complete', coreId));
  const {code, reports} = await run();
  assert.equal(code, undefined, JSON.stringify(reports));
  assert.deepEqual(reports.map(r => r.outcome), ['ready', 'started', 'ok']);
  assert.match(await log(), new RegExp(`^start ${coreId}$`, 'm'));
});

test('an unknown or corrupt record beside a maintenance record still stops the real starter', posixOnly, async t => {
  const {run, operations, log} = await starterHost(t);
  await maintain(operations, maintenanceRecord('maintenance-complete', coreId));
  for (const [name, text] of [['newer.json', JSON.stringify({id: 'newer', schema: 'bunny-batch-record/2.0'})], ['corrupt.json', '{']]) {
    await writeFile(join(operations, 'synthetic.records', name), text, {mode: 0o600});
    const {code, reports} = await run();
    assert.equal(code, 1, name);
    assert.equal(reports.at(-1).reason, 'records-unreadable', name);
    await rm(join(operations, 'synthetic.records', name));
  }
  assert.doesNotMatch(await log(), /^(start|restart|volume) /m);
});
