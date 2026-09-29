import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {DirectoryLock} from '../lock.mjs';
import {processIdentity} from '../adapter-runner.mjs';
import {createServer} from 'node:http';
import {awaitReady, runCompose} from '../compose.mjs';

test('reset resolves a composition and reports a missing one without creating a run', async t => {
  const root = await mkdtemp(join(tmpdir(), 'compose-reset-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const lines = [];
  const code = await runCompose(['reset', 'compose-20260929T120000Z-abcdef'], {
    env: {...process.env, APP_VERIFY_PROOF_ROOT: root},
    stdout: line => lines.push(JSON.parse(line)), stderr: () => {},
  });
  assert.equal(code, 1);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].operation, 'reset');
  assert.equal(lines[0].error, 'unknown-composition');
});


test('aggregate operations wait for the live holder; a dead holder permits diagnosis and stop', {timeout: 20000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'compose-operation-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const id = 'compose-20260929T120000Z-abcdef', dir = join(root, id);
  await mkdir(dir);
  const record = {id, state: 'resetting', reset: {attempt: 'interrupted', phase: 'pause', service: null}, readiness: null,
    services: [{id: 'nanoleaf', role: 'consumer', runId: null}, {id: 'pixoo', role: 'consumer', runId: null}, {id: 'hub', role: 'owner', runId: null}]};
  await writeFile(join(dir, 'composition.json'), JSON.stringify(record));
  const lockModule = fileURLToPath(new URL('../lock.mjs', import.meta.url));
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import {DirectoryLock} from ${JSON.stringify(lockModule)};
    await new DirectoryLock(process.argv[1], '.operation.lock').run(async () => {
      process.stdout.write('held\\n'); await new Promise(() => { setInterval(() => {}, 1000); });
    });`, dir], {stdio: ['ignore', 'pipe', 'inherit']});
  t.after(() => holder.kill('SIGKILL'));
  await once(holder.stdout, 'data');
  const cli = async args => {
    const lines = [];
    const code = await runCompose(args, {env: {...process.env, APP_VERIFY_PROOF_ROOT: root}, stdout: line => lines.push(JSON.parse(line)), stderr: () => {}});
    assert.equal(lines.length, 1); return {code, result: lines[0]};
  };
  const attempts = [['doctor', id], ['reset', id], ['stop', id], ['handoff', id], ['extend', id], ['capture', id, 'one-owner'], ['inject', id, 'consumer-loss', 'pixoo'], ['start', '--restarts', id]];
  const results = await Promise.all(attempts.map(cli));
  for (const result of results) { assert.equal(result.code, 1); assert.equal(result.result.error, 'composition-locked'); }
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'composition.json'), 'utf8')), record, 'busy callers changed nothing');
  const exited = once(holder, 'exit'); holder.kill('SIGKILL'); await exited;
  const diagnosed = await cli(['doctor', id]);
  assert.equal(diagnosed.result.state, 'resetting');
  assert.deepEqual(diagnosed.result.reset, record.reset, 'the incomplete phase is visible after interruption');
  const stopped = await cli(['stop', id]);
  assert.equal(stopped.code, 0); assert.equal(stopped.result.cleanup.result, 'clean');
  assert.deepEqual(stopped.result.cleanup.services.map(s => s.id), ['hub', 'pixoo', 'nanoleaf']);
});

for (const mode of ['process', 'group']) test(`cleanup after a killed operation ${mode} cannot race its surviving adapter descendants`, {timeout: 15000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'compose-orphan-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const id = 'compose-20260929T120000Z-abcdef', dir = join(root, id);
  await mkdir(dir);
  const wrapper = join(root, 'wrapper.mjs'), marker = join(root, 'entered'), late = join(root, 'late');
  await writeFile(wrapper, `
    import {spawn} from 'node:child_process';
    import {writeFileSync} from 'node:fs';
    spawn(process.execPath, ['--input-type=module', '-e', "import {writeFileSync} from 'node:fs'; setTimeout(() => writeFileSync(process.argv[1], 'late descendant'), 1200);", ${JSON.stringify(late)}], {stdio: 'inherit'});
    writeFileSync(${JSON.stringify(marker)}, 'entered');
    setTimeout(() => { console.log('{}'); }, 1400);
  `);
  const services = ['nanoleaf', 'pixoo', 'hub'].map(id => ({id, role: id === 'hub' ? 'owner' : 'consumer', runId: null, run: [process.execPath, wrapper], checkout: root, revision: 'a'.repeat(40)}));
  await writeFile(join(dir, 'composition.json'), JSON.stringify({id, state: 'running', services}));
  const env = {...process.env, APP_VERIFY_PROOF_ROOT: root};
  const cliPath = fileURLToPath(new URL('../compose.mjs', import.meta.url));
  const child = spawn(process.execPath, [cliPath, 'handoff', id], {env, detached: true, stdio: 'ignore'});
  t.after(() => child.kill('SIGKILL'));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (const deadline = Date.now() + 3000; ;) {
    try { await readFile(marker); break; } catch (error) { if (error.code !== 'ENOENT' || Date.now() > deadline) throw error; await delay(10); }
  }
  const exited = once(child, 'exit'); process.kill(mode === 'group' ? -child.pid : child.pid, 'SIGKILL'); await exited;
  const lines = [];
  const code = await runCompose(['stop', id], {env, stdout: line => lines.push(JSON.parse(line)), stderr: () => {}});
  assert.equal(code, 0); assert.equal(lines[0].cleanup.result, 'clean');
  await delay(1500);
  await assert.rejects(readFile(late), {code: 'ENOENT'}, 'no orphan adapter can mutate after cleanup');
});


test('an adapter runner delayed behind recovery never starts for its dead parent', {timeout: 10000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'compose-late-runner-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  t.after(() => parent.kill('SIGKILL'));
  const started = await processIdentity(parent.pid);
  assert.ok(started);
  const marker = join(root, 'late'); let runner, ended;
  await new DirectoryLock(root, '.adapter.lock').run(async () => {
    const config = {directory: root, parent: parent.pid, started, timeoutMs: 3000,
      argv: [process.execPath, '-e', "require('fs').writeFileSync(process.argv[1], 'started')", marker]};
    runner = spawn(process.execPath, [fileURLToPath(new URL('../adapter-runner.mjs', import.meta.url)), '--run-adapter', JSON.stringify(config)], {stdio: 'ignore'});
    ended = once(runner, 'exit');
    const gone = once(parent, 'exit'); parent.kill('SIGKILL'); await gone;
  });
  const [code] = await ended;
  assert.equal(code, 1);
  await assert.rejects(readFile(marker), {code: 'ENOENT'});
});


test('readiness timeout names the sole failing consumer without inventing one for mixed failures', async t => {
  const root = await mkdtemp(join(tmpdir(), 'compose-readiness-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'hub-test', 'data'), {recursive: true});
  await writeFile(join(root, 'hub-test', 'data/api-token'), 'synthetic-read-token');
  let wallCurrent = true;
  const server = createServer((req, res) => {
    const body = req.url === '/api/monitor/v1/sessions' ? {snapshot: {revision: 7, sessions: []}}
      : req.url === '/api/hub/v1/health' ? {devices: [{id: 'wall', health: 'ready'}, {id: 'pixel', health: 'ready'}]}
      : req.url === '/verify/state' ? {apiVersion: 'wall-verify/1', feed: {connection: wallCurrent ? 'current' : 'stale', ownerId: 'verify-owner', revision: 7, source: 'shared'}, integration: {applied: 0, queued: 0, failed: 0}}
      : req.url === '/api/integration/v1/sessions' ? {connection: 'unavailable', ownerId: 'verify-owner', snapshot: null}
      : req.url === '/api/device/simulator' ? {mode: 'simulator', writer: {setBrightness: {admitted: 0}}} : {};
    res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const composition = {services: [{id: 'hub', role: 'owner', runId: 'hub-test', url}, {id: 'nanoleaf', role: 'consumer', url}, {id: 'pixoo', role: 'consumer', url}]};
  const inspect = expected => assert.rejects(awaitReady({APP_VERIFY_STATE_ROOT: root}, composition, () => {}, 0), error => {
    assert.equal(error.failure, 'readiness-timeout'); assert.equal(error.service, expected);
    assert.ok(error.checks.some(check => check.id === 'pixoo-feed-current' && check.outcome === 'failed')); return true;
  });
  await inspect('pixoo');
  wallCurrent = false; await inspect(null);
});
