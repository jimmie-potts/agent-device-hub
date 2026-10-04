import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../dist/cli.js';
import { acquireInstanceLock, defaultLockPath } from '../dist/lock.js';
import { FakeTransport } from '../dist/fake-transport.js';
import { CONTROLLER, STOCK_CHOMPI } from './helpers.mjs';

const bin = fileURLToPath(new URL('../bin/chompi-bridge.mjs', import.meta.url));

function io() {
  const out = [], err = [];
  return { stdout: { write: s => { out.push(s); return true; } }, stderr: { write: s => { err.push(s); return true; } }, out: () => out.join(''), err: () => err.join('') };
}

function runtimeDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chompi-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('usage errors exit 2 without touching a transport', async () => {
  for (const argv of [[], ['nope'], ['probe', '--extra'], ['monitor'], ['run', '--test-pattern', '--test-pattern']]) {
    const streams = io();
    let created = 0;
    const code = await main(argv, { ...streams, createHidTransport: () => { created++; return new FakeTransport([]); } });
    assert.equal(code, 2, JSON.stringify(argv));
    assert.match(streams.err(), /^usage: chompi-bridge/m);
    assert.equal(created, 0);
  }
});

test('probe lists matching controllers without serials or paths and only counts other devices', async () => {
  const streams = io();
  const transport = new FakeTransport([CONTROLLER, STOCK_CHOMPI, { ...STOCK_CHOMPI, path: 'x', product: 'Keyboard' }]);
  assert.equal(await main(['probe'], { ...streams, createHidTransport: () => transport }), 0);
  assert.deepEqual(JSON.parse(streams.out()), {
    matches: [{ vendorId: '1209', productId: '000c', product: 'Agent Controller', usagePage: 'ff00', usage: '01' }],
    otherHidDevices: 2,
  });
  assert.equal(transport.opens.length, 0, 'probe never opens a device');
  for (const secret of [CONTROLLER.serialNumber, CONTROLLER.path, 'CHOMPI', 'Keyboard']) assert.equal(streams.out().includes(secret), false);
});

test('run refuses to start while another instance holds the lock, before creating a transport', async t => {
  const env = { XDG_RUNTIME_DIR: runtimeDir(t) };
  const held = await acquireInstanceLock(defaultLockPath({ env }));
  t.after(() => held.release());
  const streams = io();
  let created = 0;
  const code = await main(['run'], { ...streams, env, createHidTransport: () => { created++; return new FakeTransport([CONTROLLER]); } });
  assert.equal(code, 3);
  assert.equal(streams.err(), 'chompi-bridge-already-running\n');
  assert.equal(created, 0);
});

test('monitor --simulate prints a scripted session as JSON lines and exits', async () => {
  const streams = io();
  assert.equal(await main(['monitor', '--simulate'], streams), 0);
  const lines = streams.out().trim().split('\n').map(line => JSON.parse(line));
  const summary = lines.map(e => e.type === 'input' ? `${e.kind}:${e.control}${e.synthetic ? ':synthetic' : ''}` : e.type);
  assert.deepEqual(summary, [
    'connected', 'press:1', 'release:1', 'turn:41', 'turn:41', 'press:33', 'release:33', 'press:26',
    'release:26:synthetic', 'disconnected', 'connected', 'press:15', 'release:15:synthetic', 'disconnected',
  ]);
  assert.ok(lines.every(e => Number.isInteger(e.at)));
});

test('the bin runs a simulated bridge under the lock, refuses a second instance, and stops on SIGTERM', { skip: process.platform === 'win32' && 'POSIX signals' }, async t => {
  const env = { PATH: process.env.PATH, XDG_RUNTIME_DIR: runtimeDir(t) };
  const start = () => {
    const child = spawn(process.execPath, [bin, 'run', '--simulate', '--test-pattern'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill('SIGKILL'));
    const output = { out: '', err: '' };
    child.stdout.on('data', d => { output.out += d; });
    child.stderr.on('data', d => { output.err += d; });
    return { child, output };
  };
  const first = start();
  while (!first.output.out.includes('"type":"connected"')) {
    assert.equal(first.child.exitCode, null, first.output.err);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const second = start();
  const [code] = await once(second.child, 'exit');
  assert.equal(code, 3);
  assert.deepEqual(second.output, { out: '', err: 'chompi-bridge-already-running\n' });
  first.child.kill('SIGTERM');
  const [firstCode] = await once(first.child, 'exit');
  assert.equal(firstCode, 0, first.output.err);
  assert.match(first.output.out, /"type":"disconnected","at":\d+,"epoch":\d+,"reason":"stopped"/);
});
