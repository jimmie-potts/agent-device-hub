import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepare, runHost} from '../verify-host.mjs';

async function checkout(t, name = 'agent-device-hub') {
  const root = await mkdtemp(join(tmpdir(), 'verify-host-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'scripts'));
  await writeFile(join(root, 'package.json'), JSON.stringify({name}));
  await writeFile(join(root, 'scripts/verify.mjs'), '');
  return root;
}
const args = root => ['--host', '--app', 'hub', '--checkout', root, '--', 'start'];

test('host effects require explicit opt-in and a named existing adapter', async t => {
  const root = await checkout(t);
  await assert.rejects(prepare(args(root).slice(1)), /--host/);
  await assert.rejects(prepare([...args(root).slice(0, -1), 'shell']), /operation/);
  await assert.rejects(prepare(args(root).map(x => x === 'hub' ? 'pixoo' : x)), /checkout/);
});

test('independent worktrees retain exact candidates, literal argv, and distinct command identities', async t => {
  const a = await checkout(t), b = await checkout(t);
  const marker = '$(touch SHOULD_NOT_EXIST); quoted space';
  const pa = await prepare([...args(a), '--scenario', marker]);
  const pb = await prepare(args(b));
  assert.equal(pa.checkout, a); assert.equal(pb.checkout, b);
  assert.notEqual(pa.unit, pb.unit);
  assert.deepEqual(pa.adapterArgs.slice(-3), ['start', '--scenario', marker]);
  assert.equal(pa.adapterArgs[0], join(a, 'scripts/verify.mjs'));
});

test('unavailable manager refuses without any launch or cleanup effect', async t => {
  const plan = await prepare(args(await checkout(t)));
  const calls = [];
  const result = await runHost(plan, {execute: async (program, argv) => {
    calls.push([program, argv]); return {code: 1, stdout: '', stderr: 'Permission denied'};
  }});
  assert.equal(result.code, 3); assert.equal(result.value.state, 'unavailable');
  assert.equal(calls.length, 1); assert.match(calls[0][0], /systemctl$/);
});

const absent = {code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n'};
function supervisor({launch = {code: 0, stdout: '{"state":"running","runId":"owned-preview"}\n'}, cleanup = absent} = {}) {
  const calls = [];
  return {calls, execute: async (program, argv, options) => {
    calls.push({program, argv, options});
    if (argv.includes('is-system-running')) return {code: 1, stdout: 'degraded\n'};
    if (program.endsWith('/systemd-run')) return launch;
    if (argv.includes('show')) return cleanup;
    if (argv.includes('stop')) return {code: 0, stdout: ''};
    throw new Error('unexpected effect');
  }};
}

test('successful result preserves the preview and clears inherited environment/argument expansion', async t => {
  const plan = await prepare([...args(await checkout(t)), '--scenario', '$PRIVATE_TOKEN']);
  const fixture = supervisor();
  const result = await runHost(plan, fixture);
  assert.equal(result.code, 0); assert.equal(result.value.result.runId, 'owned-preview');
  assert.equal(result.value.cleanup, 'verified');
  const launched = fixture.calls.find(c => c.program.endsWith('/systemd-run'));
  assert.ok(launched.argv.includes('--expand-environment=no'));
  assert.ok(launched.argv.includes('--property=RuntimeMaxSec=900s'));
  const boundary = launched.argv.indexOf('/usr/bin/env');
  assert.equal(launched.argv[boundary+1], '-i');
  assert.equal(launched.argv.at(-1), '$PRIVATE_TOKEN');
  assert.equal(launched.options.env.XDG_RUNTIME_DIR, undefined);
  assert.equal(plan.hostEnv.NODE_OPTIONS, undefined);
  assert.equal(plan.hostEnv.APP_VERIFY_RUNTIME_ROOT, undefined);
  assert.ok(!fixture.calls.some(c => c.argv.includes('stop')));
});

test('lost output and failed cleanup remain uncertain without a start retry', async t => {
  const plan = await prepare(args(await checkout(t)));
  for (const fixture of [supervisor({launch: {code: null, stdout: '', interrupted: true}}),
    supervisor({cleanup: {code: 1, stdout: '', stderr: 'Permission denied'}}),
    supervisor({launch: {code: 0, stdout: 'not-json'}})]) {
    const result = await runHost(plan, fixture);
    assert.equal(result.code, 1); assert.equal(result.value.state, 'uncertain');
    assert.match(result.value.next, /Do not retry start/);
    assert.equal(fixture.calls.filter(c => c.program.endsWith('/systemd-run')).length, 1);
    for (const c of fixture.calls.filter(c => c.argv.includes('stop'))) assert.deepEqual(c.argv, ['--user', 'stop', plan.unit]);
  }
});

test('an adapter failure keeps its JSON and nonzero code', async t => {
  const plan = await prepare(args(await checkout(t)));
  const fixture = supervisor({launch: {code: 3, stdout: '{"state":"unavailable","error":"core-build-missing"}'}});
  const result = await runHost(plan, fixture);
  assert.equal(result.code, 3); assert.equal(result.value.state, 'failed');
  assert.equal(result.value.result.error, 'core-build-missing');
});

test('aborted calls never launch; interrupted launched calls clean only their command', async t => {
  const plan = await prepare(args(await checkout(t)));
  const fixture = supervisor();
  const signal = AbortSignal.abort();
  assert.equal((await runHost(plan, {...fixture, signal})).code, 3);
  assert.ok(!fixture.calls.some(c => c.program.endsWith('/systemd-run')));
  const control = new AbortController();
  const calls = [];
  const result = await runHost(plan, {signal: control.signal, execute: async (program, argv) => {
    calls.push(argv);
    if (argv.includes('is-system-running')) return {code: 0, stdout: 'running'};
    if (program.endsWith('/systemd-run')) { control.abort(); return {code: null, stdout: '', interrupted: true}; }
    if (argv.includes('stop')) return {code: 0, stdout: ''};
    return calls.some(a => a.includes('stop')) ? absent : {code: 0, stdout: 'LoadState=loaded\nActiveState=active\nMainPID=42\n'};
  }});
  assert.equal(result.value.state, 'uncertain'); assert.equal(result.value.cleanup, 'verified');
  assert.deepEqual(calls.find(c => c.includes('stop')), ['--user', 'stop', plan.unit]);
});

test('process transport preserves literal arguments and enforces its bound', async () => {
  const {execute} = await import('../verify-host.mjs');
  const literal = '$TOKEN; $(do-not-run)';
  const result = await execute(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv[1]))', literal], {env: {}, timeoutMs: 1000});
  assert.equal(result.code, 0); assert.equal(JSON.parse(result.stdout), literal);
  const timeout = await execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {env: {}, timeoutMs: 50});
  assert.equal(timeout.interrupted, true); assert.notEqual(timeout.code, 0);
});

test('all supported applications select their owned wrapper and optional tool paths', async t => {
  for (const [app, name] of [['hub', 'agent-device-hub'], ['nanoleaf', 'codex-nanoleaf'], ['pixoo', 'divoom-app-upgrade'], ['compose', 'agent-device-hub']]) {
    const root = await checkout(t, name);
    if (app === 'compose') {
      await mkdir(join(root, 'apps/hub/verify'), {recursive: true});
      await writeFile(join(root, 'apps/hub/verify/compose.mjs'), '');
    }
    const argv = ['--host', '--app', app, '--checkout', root, '--python', '/usr/bin/python3', '--', 'doctor'];
    const plan = await prepare(argv);
    assert.equal(plan.hostEnv.PYTHON, '/usr/bin/python3');
    assert.equal(plan.adapterArgs[0], join(root, app === 'compose' ? 'apps/hub/verify/compose.mjs' : 'scripts/verify.mjs'));
  }
});

test('missing adapter and invalid timeout refuse before effects', async t => {
  const root = await checkout(t);
  await assert.rejects(prepare(['--host', '--app', 'hub', '--checkout', root, '--timeout-seconds', '0', '--', 'start']), /timeout/);
  await rm(join(root, 'scripts/verify.mjs'));
  await assert.rejects(prepare(args(root)));
});
