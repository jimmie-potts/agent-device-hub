// Portable boundary tests. Real systemd freeze/timer semantics are covered by
// compose.test.mjs; this fake records commands and supplies timer observations.
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {currentLease, thawWithLease} from '../safety-thaw.mjs';

const runId = 'avt-safety-20260929T120000Z-abcdef';
const unit = `app-verify-${runId}.service`;
const timer = `app-verify-${runId}-lease-2.timer`;

async function fixture(t, {expired = false, missingTimer = false, failStop = false} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'thaw-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const path = join(dir, 'receipt.json');
  const expiry = Math.floor(Date.now() / 1000) + (expired ? -10 : 600);
  const receipt = {runId, owned: {unit, leaseTimer: timer}, preview: {expiresAt: new Date(expiry * 1000).toISOString()}};
  await writeFile(path, JSON.stringify(receipt));
  const calls = [];
  let frozen = true, active = true;
  const control = async args => {
    calls.push(args);
    if (args[0] === 'thaw') { assert.equal(args[1], unit); frozen = false; return ''; }
    if (args[0] === 'stop') {
      assert.equal(args[1], unit);
      assert.equal(frozen, false, 'a frozen unit must be thawed before stop');
      if (failStop) throw new Error('stop refused');
      active = false;
      return '';
    }
    assert.equal(args[0], 'show');
    if (args[1] === timer) return missingTimer ? 'LoadState=not-found\nActiveState=inactive\n' : `LoadState=loaded\nActiveState=active\nNextElapseUSecRealtime=@${expiry}\n`;
    assert.equal(args[1], unit);
    return `LoadState=${active ? 'loaded' : 'not-found'}\nActiveState=${active ? 'active' : 'inactive'}\nFreezerState=${frozen ? 'frozen' : 'running'}\n`;
  };
  return {path, receipt, control, calls};
}

test('the live per-run expiry is read again after a change outside compose', async t => {
  const f = await fixture(t);
  assert.equal((await currentLease(runId, f.path, f.control)).valid, true);
  f.receipt.preview.expiresAt = new Date(Date.now() - 1000).toISOString();
  await writeFile(f.path, JSON.stringify(f.receipt));
  assert.equal((await currentLease(runId, f.path, f.control)).valid, false);
});

test('thaw preserves a consumer whose current lease is still armed', async t => {
  const f = await fixture(t);
  assert.equal((await thawWithLease(runId, f.path, f.control)).leaseValid, true);
  assert.equal(f.calls.some(a => a[0] === 'stop'), false);
});

for (const options of [{expired: true}, {missingTimer: true}]) {
  test(`thaw stops an owned consumer with ${options.expired ? 'an expired lease' : 'no armed timer'}`, async t => {
    const f = await fixture(t, options);
    const result = await thawWithLease(runId, f.path, f.control);
    assert.equal(result.stopped, true);
    assert.equal(result.leaseValid, false);
    assert.deepEqual(f.calls.filter(a => ['thaw', 'stop'].includes(a[0])), [['thaw', unit], ['stop', unit]]);
  });
}

test('a lease changed during thaw is judged after thaw', async t => {
  const f = await fixture(t);
  const control = async args => {
    const value = await f.control(args);
    if (args[0] === 'thaw') {
      f.receipt.preview.expiresAt = new Date(Date.now() - 1000).toISOString();
      await writeFile(f.path, JSON.stringify(f.receipt));
    }
    return value;
  };
  assert.equal((await thawWithLease(runId, f.path, control)).stopped, true);
});

test('unreadable or mismatched receipt stops only the owned unit', async t => {
  const f = await fixture(t);
  f.receipt.owned.unit = 'unrelated.service';
  await writeFile(f.path, JSON.stringify(f.receipt));
  assert.equal((await thawWithLease(runId, f.path, f.control)).stopped, true);
  await writeFile(f.path, '{');
  assert.equal((await thawWithLease(runId, f.path, f.control)).stopped, true);
  assert.equal(f.calls.some(a => a.includes('unrelated.service')), false);
});

test('failed cleanup is an error, never a claimed safe thaw', async t => {
  const f = await fixture(t, {expired: true, failStop: true});
  await assert.rejects(thawWithLease(runId, f.path, f.control), /did not reach a safe state/);
});

test('malformed run ids cannot select a unit', async t => {
  const f = await fixture(t);
  await assert.rejects(thawWithLease('*', f.path, f.control), /invalid owned run id/);
  assert.equal(f.calls.length, 0);
});
