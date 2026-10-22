import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const entry = fileURLToPath(new URL('../entrypoint.mjs', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('container core refuses a second owner and retains authenticated state across restart', {
  skip: process.platform !== 'linux', timeout: 90_000,
}, async t => {
  const [{tokenDigest, CREDENTIALS_SCHEMA}, {connectRemote}, {observation, SESSION_ID}, {holdRuntimeLease}] = await Promise.all([
    import('../../../apps/runtime/dist/src/credentials.js'), import('../../../packages/sdk/dist/src/index.js'),
    import('../../../apps/runtime/dist/tests/fixtures/agents.js'), import('../../../apps/runtime/dist/src/lease.js'),
  ]);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-container-test-')));
  const state = join(root, 'state'), config = join(root, 'config.json'), credentials = join(root, 'credentials.json');
  const active = new Set();
  t.after(async () => {
    for (const run of active) run.child.kill('SIGKILL');
    await Promise.all([...active].map(run => run.done));
    await rm(root, {recursive: true, force: true});
  });
  await mkdir(state, {mode: 0o700});
  const reader = 'synthetic-container-reader', producer = 'synthetic-container-producer';
  await writeFile(credentials, JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: [
    {id: 'reader', source: 'bunny/parts/reader', digest: tokenDigest(reader), scopes: ['read']},
    {id: 'hook', source: 'bunny/parts/hook', digest: tokenDigest(producer), scopes: ['ingest']},
  ]}), {mode: 0o600});
  // Even a supplied device section cannot instantiate that factory with the default disabled mode.
  await writeFile(config, JSON.stringify({schema: 'runtime-config/1.0', modules: {pixoo: {}}, edge: {credentials}}), {mode: 0o600});
  function start(port = '8788', extra = {}) {
    const child = spawn(process.execPath, [entry], {stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, BUNNY_CONTROL: 'disabled', BUNNY_STATE_DIR: state, BUNNY_CONFIG: config, BUNNY_PORT: port, ...extra,
    }});
    let output = '';
    child.stdout.on('data', bytes => {output = (output + bytes).slice(-65_536);});
    child.stderr.on('data', () => {});
    const run = {child, output: () => output};
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 25_000);
    run.done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {clearTimeout(watchdog); active.delete(run); resolve({code, signal});});
    });
    active.add(run);
    return run;
  }
  async function ready(run) {
    for (let i = 0; i < 600; i++) {
      const line = run.output().split('\n').find(value => value.includes('runtime.ready'));
      if (line) return JSON.parse(line).url;
      assert.equal(run.child.exitCode, null, 'startup exited before readiness');
      assert.equal(run.child.signalCode, null, 'startup terminated before readiness');
      await pause(25);
    }
    assert.fail('bounded startup readiness expired');
  }
  async function stop(run) {
    assert.equal(run.child.kill('SIGTERM'), true);
    assert.deepEqual(await run.done, {code: 0, signal: null});
  }
  async function sessions(url) {
    const response = await fetch(url + '/api/v2/families/session', {headers: {authorization: 'Bearer ' + reader}, signal: AbortSignal.timeout(3000)});
    assert.equal(response.status, 200);
    return (await response.json()).records;
  }
  const first = start(), url = await ready(first);
  const health = await fetch(url + '/api/runtime/v1/health').then(response => response.json());
  assert.deepEqual(health.modules.map(module => [module.name, module.state]), [['core', 'running']]);
  await assert.rejects(holdRuntimeLease(state));
  const competing = start('8789');
  assert.deepEqual(await competing.done, {code: 2, signal: null});
  assert.equal(competing.output().includes('runtime.ready'), false);
  assert.equal((await fetch(url + '/api/v2/families/session')).status, 401);
  const hook = await connectRemote({url, source: 'bunny/parts/hook', token: producer});
  try {
    let sequence = 0;
    for (const event of [{kind: 'session-started'}, {kind: 'turn-started'}, {kind: 'turn-ended'}]) {
      const {key, draft} = observation(event, Date.now(), {sequence: ++sequence, title: {value: 'Synthetic container workflow', source: 'provider'}});
      await hook.publish(key, draft);
    }
  } finally {await hook.close();}
  let before;
  for (let i = 0; i < 100; i++) {
    before = (await sessions(url)).find(record => record.id === SESSION_ID);
    if (before?.activity === 'idle') break;
    await pause(25);
  }
  assert.equal(before?.title?.value, 'Synthetic container workflow');
  assert.equal(before?.activity, 'idle');
  await stop(first);
  const lease = await holdRuntimeLease(state); lease.release();
  const marker = join(state, '.restore-pending');
  await writeFile(marker, 'synthetic interrupted restore', {mode: 0o600});
  const interrupted = start('8789');
  assert.deepEqual(await interrupted.done, {code: 2, signal: null});
  assert.equal(await readFile(marker, 'utf8'), 'synthetic interrupted restore');
  await rm(marker); // Only the fixture simulates verified operator completion; startup never clears it.
  const second = start(), again = await ready(second);
  const after = (await sessions(again)).find(record => record.id === SESSION_ID);
  // Stored evidence survives; startup deliberately marks it uncertain until fresh lifecycle evidence.
  assert.deepEqual(after, {...before, revision: before.revision + 1, freshness: 'uncertain', restartUncertain: true});
  await stop(second);
  const released = await holdRuntimeLease(state); released.release();
  for (const kind of ['linked-modules', 'nonempty-owner', 'owner-sidecar', 'missing-owner', 'pending-link']) {
    await t.test(kind + ' refuses without modifying inherited coordination', async () => {
      const target = join(root, kind), modules = join(target, 'modules');
      await mkdir(target, {mode: 0o700});
      if (kind === 'pending-link') await symlink('missing-restore-marker', join(target, '.restore-pending'));
      else if (kind === 'linked-modules') {
        const outside = join(root, 'outside');
        await mkdir(outside, {mode: 0o700}); await symlink(outside, modules);
      } else {
        await mkdir(modules, {mode: 0o700});
        if (kind !== 'missing-owner') await writeFile(join(modules, 'core.sqlite-owner'), kind === 'nonempty-owner' ? 'synthetic inherited bytes' : '', {mode: 0o600});
        if (kind === 'owner-sidecar') await writeFile(join(modules, 'core.sqlite-owner-wal'), 'synthetic sidecar', {mode: 0o600});
      }
      const beforeNames = await readdir(target);
      const owner = join(modules, 'core.sqlite-owner');
      const beforeOwner = await readFile(owner).catch(error => {if (error.code === 'ENOENT') return null; throw error;});
      const refused = start('8789', {BUNNY_STATE_DIR: target});
      assert.deepEqual(await refused.done, {code: 2, signal: null});
      assert.equal(refused.output().includes('runtime.ready'), false);
      assert.deepEqual(await readdir(target), beforeNames);
      const afterOwner = await readFile(owner).catch(error => {if (error.code === 'ENOENT') return null; throw error;});
      assert.deepEqual(afterOwner, beforeOwner);
      if (kind === 'linked-modules') assert.deepEqual(await readdir(join(root, 'outside')), []);
      if (kind === 'owner-sidecar') assert.equal(await readFile(join(modules, 'core.sqlite-owner-wal'), 'utf8'), 'synthetic sidecar');
      if (kind === 'pending-link') assert.equal((await lstat(join(target, '.restore-pending'))).isSymbolicLink(), true);
    });
  }
});
