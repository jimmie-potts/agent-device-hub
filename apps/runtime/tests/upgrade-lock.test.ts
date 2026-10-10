import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {chmod, mkdtemp, open, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';

const helper = join(process.cwd(), 'apps/runtime/bin/runtime-upgrade-check.mjs');
const run = promisify(execFile);
function check(root: string, descriptor?: number): Promise<{code: number | null; stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    // The named descriptor becomes child FD9. This tests identity only; the
    // documented manual shell is responsible for acquiring flock.
    const child = spawn(process.execPath, [helper, 'check-lock', root], {
      stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', descriptor ?? 'ignore'],
    });
    let stdout = '', stderr = '';
    child.stdout?.on('data', (bytes: Buffer) => { stdout += bytes.toString(); });
    child.stderr?.on('data', (bytes: Buffer) => { stderr += bytes.toString(); });
    child.once('error', reject);
    child.once('close', code => { resolve({code, stdout, stderr}); });
  });
}

void test('lock identity check accepts only inherited FD9 for the named persistent private lock', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-lock-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const lock = join(root, 'install.lock');
  await writeFile(lock, '', {flag: 'wx', mode: 0o600});
  const held = await open(lock, 'r');
  t.after(() => held.close());
  const result = await check(root, held.fd);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {lockIdentityVerified: true});
  assert.equal(result.stderr, '');

  await t.test('the same manual shell retains flock while a competing operation refuses', async () => {
    const script = 'set -eu\nexec 9<"$1/install.lock"\n/usr/bin/flock -n -E 75 9\n"$2" "$3" check-lock "$1"\n/usr/bin/flock -n -E 75 "$1/install.lock" /usr/bin/true';
    await assert.rejects(run('/bin/bash', ['-c', script, 'upgrade-lock-fixture', root, process.execPath, helper],
      {timeout: 3000, maxBuffer: 8192}), error => {
      assert.ok(error instanceof Error && 'code' in error && 'stdout' in error);
      assert.equal(error.code, 75);
      assert.deepEqual(JSON.parse(String(error.stdout)), {lockIdentityVerified: true});
      return true;
    });
  });
  await t.test('missing FD9 refuses', async () => {
    const failure = await check(root);
    assert.equal(failure.code, 1);
    assert.equal(failure.stdout, '');
    assert.deepEqual(JSON.parse(failure.stderr), {code: 'runtime-upgrade-lock-refused', verified: false});
  });
  await t.test('a descriptor for another private file refuses', async () => {
    const other = join(root, 'other.lock');
    await writeFile(other, '', {flag: 'wx', mode: 0o600});
    const handle = await open(other, 'r');
    try { assert.equal((await check(root, handle.fd)).code, 1); }
    finally { await handle.close(); }
  });
  await t.test('non-private permissions refuse', async () => {
    await chmod(lock, 0o644);
    assert.equal((await check(root, held.fd)).code, 1);
    await chmod(lock, 0o600);
  });
  await t.test('replacing the named path cannot reuse the old descriptor', async () => {
    await rename(lock, join(root, 'retained.lock'));
    await writeFile(lock, '', {flag: 'wx', mode: 0o600});
    assert.equal((await check(root, held.fd)).code, 1);
  });
  await t.test('a link back to the retained inode still refuses', async () => {
    await rm(lock);
    await symlink('retained.lock', lock);
    assert.equal((await check(root, held.fd)).code, 1);
  });
});
