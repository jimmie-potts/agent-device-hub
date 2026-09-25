import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateFiles } from './helpers.mjs';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** A LIFX-only configuration: the process opens no socket to a bulb until a command arrives, and none does here. */
function run(t, config) {
  const home = join(config.dir, 'home');
  mkdirSync(home, { mode: 0o700 });
  const child = spawn(process.execPath, [cli, config.path], { env: { PATH: process.env.PATH, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  return { child, home, output: () => ({ stdout, stderr }) };
}

test('the CLI starts, stops on SIGTERM and releases its bulb leases', async t => {
  const s = privateFiles(t);
  const path = s.write('host.json', { port: 0, credentials: [{ ...s.host.credentials[0], devices: ['desk', 'shelf'] }], lifx: s.host.lifx });
  const { child, home, output } = run(t, { dir: s.dir, path });
  while (!output().stdout.includes('local-controllers-started') && child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(output().stdout, 'local-controllers-started\n');
  assert.ok(existsSync(join(home, '.local/state/agent-device-hub/lifx')));
  child.kill('SIGTERM');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.deepEqual(output(), { stdout: 'local-controllers-started\nlocal-controllers-stopped\n', stderr: '' });
});

test('an invalid configuration fails with a generic message', async t => {
  const s = privateFiles(t);
  const path = s.write('host.json', { ...s.host, sentinel: 'private-sentinel' });
  const { child, output } = run(t, { dir: s.dir, path });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.deepEqual(output(), { stdout: '', stderr: 'local-controllers-start-failed\n' });
});

test('a stop signal the instant the host announces startup still stops it cleanly', async t => {
  const s = privateFiles(t);
  const path = s.write('host.json', { port: 0, credentials: [{ ...s.host.credentials[0], devices: ['desk', 'shelf'] }], lifx: s.host.lifx });
  const home = join(s.dir, 'home');
  mkdirSync(home, { mode: 0o700 });
  // Without a handler installed before the started line, most of these exits were a bare SIGTERM with no lease release.
  for (let i = 0; i < 10; i++) {
    const child = spawn(process.execPath, [cli, path], { env: { PATH: process.env.PATH, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill('SIGKILL'));
    let stdout = '', signalled = false;
    child.stdout.on('data', d => { stdout += d; if (!signalled && stdout.includes('local-controllers-started')) { signalled = true; child.kill('SIGTERM'); } });
    // `close` waits for the output streams too, so the stopped line is never missed.
    const [code, signal] = await once(child, 'close');
    assert.deepEqual([code, signal, stdout], [0, null, 'local-controllers-started\nlocal-controllers-stopped\n'], `run ${i}`);
  }
});
