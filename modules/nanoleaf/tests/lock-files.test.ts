// The module's lock files (Hub #972): the device's worker lock, the layout lock and the registry lock are exclusive
// transactions on their own SQLite files. Closing any descriptor of a file drops every POSIX lock this process holds on
// it, so the opener must never open an existing lock file outside SQLite: a refused second take in this process would
// otherwise free the first holder's lock for another process.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {lockFile} from '../src/devices.js';
import {workerLock} from '../src/enrollment.js';
import {privateDatabase} from '../src/sqlite.js';
import {suite, test} from './support.js';

// Another process's attempt on a lock file: `locked` while a holder has it, `taken` otherwise.
const OTHER_PROCESS = `const {DatabaseSync} = require('node:sqlite');
const lock = new DatabaseSync(process.argv[1], {timeout: 0});
try {
  lock.exec('BEGIN EXCLUSIVE');
  lock.exec('ROLLBACK');
  console.log('taken');
} catch (error) {
  console.log(error.errcode === 5 ? 'locked' : 'failed');
} finally {
  lock.close();
}`;
const other = (path: string): string => spawnSync(process.execPath, ['-e', OTHER_PROCESS, path], {encoding: 'utf8'}).stdout.trim();
const busy = (error: unknown): boolean => error instanceof Error && 'errcode' in error && error.errcode === 5;

function directory(context: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'nanoleaf-locks-'));
  context.after(() => { rmSync(dir, {recursive: true, force: true}); });
  return dir;
}

suite('lock files', () => {
  test('a second take of the device\'s worker lock in this process is refused and leaves the first holder\'s lock, so another process is still refused', async context => {
    const dir = directory(context);
    const path = join(dir, lockFile('wall'));
    const first = await workerLock(dir, 'wall');
    assert.ok(first, 'the first take holds the lock');
    try {
      assert.equal(other(path), 'locked', 'another process is refused while the first holds it');
      assert.equal(await workerLock(dir, 'wall'), null, 'a second take in this process is refused');
      assert.equal(other(path), 'locked', 'and another process is still refused after it');
    } finally {
      if (first.isTransaction) first.exec('ROLLBACK');
      first.close();
    }
    assert.equal(other(path), 'taken', 'once the first lets go, another process takes it');
  });

  test('a second open of a held lock file in this process is refused and leaves the holder\'s lock, so another process is still refused', context => {
    const dir = directory(context);
    const path = join(dir, 'layout-lock.sqlite');
    const holder = privateDatabase(path, {timeout: 0});
    context.after(() => { if (holder.isOpen) holder.close(); });
    holder.exec('BEGIN EXCLUSIVE');
    const second = privateDatabase(path, {timeout: 0});
    try {
      assert.throws(() => { second.exec('BEGIN EXCLUSIVE'); }, busy, 'the second open is refused the lock');
    } finally {
      second.close();
    }
    assert.equal(other(path), 'locked', 'another process is still refused after it');
  });

  test('a missing lock file is created owner-only, an older one narrowed to owner-only, and a link in its place refused', context => {
    const dir = directory(context);
    const created = join(dir, 'registry-lock.sqlite');
    privateDatabase(created, {timeout: 0}).close();
    assert.equal(statSync(created).mode & 0o777, 0o600, 'created owner-only');
    const older = join(dir, 'notification-lock.sqlite');
    writeFileSync(older, '');
    chmodSync(older, 0o644);
    privateDatabase(older, {timeout: 0}).close();
    assert.equal(statSync(older).mode & 0o777, 0o600, 'narrowed to owner-only');
    const target = join(dir, 'elsewhere.sqlite');
    writeFileSync(target, '', {mode: 0o600});
    const linked = join(dir, 'layout-lock.sqlite');
    symlinkSync(target, linked);
    assert.throws(() => privateDatabase(linked, {timeout: 0}), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ELOOP',
      'a link in the lock file\'s place');
  });
});
