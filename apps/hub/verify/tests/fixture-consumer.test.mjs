import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, open, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../..', import.meta.url));

test('a paused fixture keeps its published acknowledgment readable until the request changes', {timeout: 15000}, async t => {
  const base = await mkdtemp(join(tmpdir(), 'hub-fixture-ack-'));
  const data = join(base, 'data'), runtime = join(base, 'runtime');
  await mkdir(data, {mode: 0o700}); await mkdir(runtime, {mode: 0o700});
  // No feed connection is needed to exercise the fixture's pause protocol.
  await writeFile(join(data, 'scenario.json'), JSON.stringify({name: 'hub-paired', kind: 'nanoleaf', fault: 'no-feed'}), {mode: 0o600});
  const runId = 'fixture-20261002T120000Z-abcdef';
  const child = spawn(process.execPath, [fileURLToPath(new URL('fixture-consumer-serve.mjs', import.meta.url)),
    '--data', data, '--runtime', runtime, '--run-id', runId, '--port', '0', '--controller-port', '0'],
  {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null) child.kill('SIGTERM'); await exited; await rm(base, {recursive: true, force: true}); });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  async function waitFor(read, accepts, message) {
    for (let attempt = 0; attempt < 400; attempt++) {
      assert.equal(child.exitCode, null, errors);
      const value = await read();
      if (accepts(value)) return value;
      await delay(10);
    }
    assert.fail(message);
  }
  await waitFor(async () => output, value => value.includes('\n'), 'fixture did not start');
  const request = {version: 1, runId, nonce: 'a'.repeat(32)};
  const requestPath = join(runtime, 'feed-pause.request'), ackPath = join(runtime, 'feed-pause.ack');
  const readAck = () => readFile(ackPath, 'utf8').then(JSON.parse, error => { if (error.code === 'ENOENT') return null; throw error; });
  await writeFile(requestPath, JSON.stringify(request), {mode: 0o600});
  const ack = await waitFor(readAck, value => value?.nonce === request.nonce, 'pause was not acknowledged');
  assert.deepEqual(ack, {...request, pid: child.pid});
  const handle = await open(ackPath, 'r');
  try {
    // A real ownership reader may be descheduled between open and fstat.
    await delay(150);
    const info = await handle.stat();
    assert.equal(info.nlink, 1, 'a held acknowledgment must not be unlinked by repeated fixture ticks');
    assert.equal(info.mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await handle.readFile('utf8')), ack);
    assert.deepEqual(await readAck(), ack);
  } finally { await handle.close(); }
  const next = {...request, nonce: 'b'.repeat(32)};
  await writeFile(requestPath, JSON.stringify(next), {mode: 0o600});
  assert.deepEqual(await waitFor(readAck, value => value?.nonce === next.nonce, 'new request was not acknowledged'), {...next, pid: child.pid});
});
