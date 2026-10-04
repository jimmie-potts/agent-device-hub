import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, existsSync, lstatSync, statSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireInstanceLock, defaultLockPath, InstanceLockHeldError } from '../dist/lock.js';

const windows = process.platform === 'win32';
const lockModule = new URL('../dist/lock.js', import.meta.url).href;

/** A lock path private to one test: a named pipe on Windows, a socket in a fresh directory elsewhere. */
function lockPath(t) {
  if (windows) return `\\\\.\\pipe\\agent-chompi-bridge-test-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const dir = mkdtempSync(join(tmpdir(), 'chompi-lock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'bridge.sock');
}

/** A separate process that holds the lock until it is told to exit or is killed. */
async function holder(t, path) {
  const source = `const {acquireInstanceLock}=await import(${JSON.stringify(lockModule)});
const lock=await acquireInstanceLock(${JSON.stringify(path)});
process.stdout.write('held\\n');
process.stdin.on('data',async()=>{await lock.release();process.exit(0);});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => child.kill('SIGKILL'));
  let out = '';
  child.stdout.on('data', d => { out += d; });
  while (!out.includes('held')) {
    if (child.exitCode !== null) throw new Error('holder exited early');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return child;
}

test('a second holder in the same process is refused until the first releases', async t => {
  const path = lockPath(t);
  const first = await acquireInstanceLock(path);
  await assert.rejects(acquireInstanceLock(path), error => error instanceof InstanceLockHeldError && error.code === 'chompi-bridge-already-running');
  await first.release();
  await first.release();
  const second = await acquireInstanceLock(path);
  await second.release();
});

test('another process holding the lock refuses this one; a clean exit releases it', async t => {
  const path = lockPath(t);
  const child = await holder(t, path);
  await assert.rejects(acquireInstanceLock(path), InstanceLockHeldError);
  child.stdin.write('release\n');
  assert.deepEqual(await once(child, 'exit'), [0, null]);
  const lock = await acquireInstanceLock(path);
  await lock.release();
});

test('a killed holder leaves no lasting lock; a stale socket file is probed and replaced', async t => {
  const path = lockPath(t);
  const child = await holder(t, path);
  child.kill('SIGKILL');
  await once(child, 'exit');
  if (!windows) assert.equal(lstatSync(path).isSocket(), true, 'the killed holder left its socket file behind');
  const lock = await acquireInstanceLock(path);
  await assert.rejects(acquireInstanceLock(path), InstanceLockHeldError);
  await lock.release();
  if (!windows) assert.equal(existsSync(path), false, 'release removes the socket file');
});

test('a non-socket file at the lock path is never removed', { skip: windows && 'named pipes have no file path' }, async t => {
  const path = lockPath(t);
  writeFileSync(path, 'not a socket');
  await assert.rejects(acquireInstanceLock(path), /lock-path-unsafe/);
  assert.equal(lstatSync(path).isFile(), true);
});

test('the default lock is per user', () => {
  assert.equal(defaultLockPath({ env: {}, platform: 'win32', username: 'Jane Doe', uid: -1 }), '\\\\.\\pipe\\agent-chompi-bridge-Jane_Doe');
  assert.equal(defaultLockPath({ env: { XDG_RUNTIME_DIR: '/run/user/1000' }, platform: 'linux', username: 'jane', uid: 1000 }), '/run/user/1000/agent-chompi-bridge.sock');
  assert.equal(defaultLockPath({ env: {}, platform: 'darwin', username: 'jane', uid: 501, tmp: '/var/folders/x/T' }), '/var/folders/x/T/agent-chompi-bridge-501/bridge.sock');
});

test('the fallback lock directory is created private and a shared one is refused', { skip: windows && 'named pipes have no directory' }, async t => {
  const base = mkdtempSync(join(tmpdir(), 'chompi-lockdir-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const path = defaultLockPath({ env: {}, platform: 'linux', username: 'x', uid: process.getuid(), tmp: base });
  const lock = await acquireInstanceLock(path);
  assert.equal(statSync(join(path, '..')).mode & 0o777, 0o700);
  await lock.release();
  const shared = join(base, 'shared');
  mkdirSync(shared);
  chmodSync(shared, 0o777);
  await assert.rejects(acquireInstanceLock(join(shared, 'bridge.sock')), /lock-path-unsafe/);
});
