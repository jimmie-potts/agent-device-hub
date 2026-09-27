// The receipt lock under contention, without a supervisor: concurrent updates
// against a lock left by a killed operation lose nothing, and a displaced
// holder never writes.
import assert from 'node:assert/strict';
import {execFile, spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';
import {RECEIPT_VERSION} from '@jimmie-potts/app-verify';

const worker = fileURLToPath(new URL('fixture-app/lock-worker.mjs', import.meta.url));

const receipt = () => ({
  receiptVersion: RECEIPT_VERSION, runId: 'avt-20260927T060259Z-3f9a1c', app: 'avt', repository: 'jimmie-potts/agent-device-hub',
  roots: {proof: '<canonical checkout>/.local/evidence/verify', runtime: '~/.local/state/app-verify'}, state: 'starting', startedAt: '2026-09-27T06:02:59Z',
  build: {sourceRevision: 'unknown', dirty: true, artifactDigest: null, version: '1.0.0'}, scenario: {name: 'reference', version: 'unknown', seededAt: null},
  components: [], checks: [], captures: [], preview: null,
  owned: {unit: 'app-verify-avt-20260927T060259Z-3f9a1c.service', leaseTimer: 'app-verify-avt-20260927T060259Z-3f9a1c-lease.timer', port: null, runtimeDir: 'avt-20260927T060259Z-3f9a1c', proofDir: 'avt-20260927T060259Z-3f9a1c', mainPid: null, mainStartMonotonic: null},
  proof: {frozenAt: null}, failure: null, cleanup: {result: null}, secrets: 'none recorded',
});

/** A lock left by a killed operation: a holder record whose process has exited. */
async function deadLock(dir) {
  const pid = Number(String(spawnSync('sh', ['-c', 'echo $$']).stdout).trim());
  await mkdir(join(dir, '.receipt.lock'));
  await writeFile(join(dir, '.receipt.lock', 'holder'), `${pid} 1 killed\n`);
}

test('concurrent receipt updates against a dead lock lose nothing', {timeout: 180000}, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'app-verify-lock-')));
  try {
    for (const [contenders, rounds, dead] of [[2, 10, true], [3, 8, true], [6, 5, true], [6, 5, false]]) {
      const dir = join(base, `${contenders}-${dead}`);
      await mkdir(dir);
      await writeFile(join(dir, 'receipt.json'), JSON.stringify(receipt()));
      if (dead) await deadLock(dir);
      const results = await Promise.all(Array.from({length: contenders}, () => promisify(execFile)(process.execPath, [worker, dir, String(rounds)]).then(r => JSON.parse(r.stdout))));
      const applied = results.reduce((sum, r) => sum + r.applied, 0);
      assert.deepEqual(results.flatMap(r => r.errors), [], `${contenders} contenders: no update was refused`);
      assert.equal(applied, contenders * rounds);
      assert.equal(JSON.parse(await readFile(join(dir, 'receipt.json'), 'utf8')).counter, applied, `${contenders} contenders${dead ? ' after a dead lock' : ''}: every update survived`);
    }
  } finally {
    await rm(base, {recursive: true, force: true});
  }
});

test('a stuck lock breaker ends in receipt-locked within the deadline, and a holder-less one is cleared', {timeout: 60000}, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'app-verify-breaker-')));
  const {spawn} = await import('node:child_process');
  const {utimes} = await import('node:fs/promises');
  const sleeper = spawn('sleep', ['60']);
  try {
    // A breaker whose holder is alive but stopped, over a dead main lock.
    const stuck = join(base, 'stuck');
    await mkdir(stuck);
    await writeFile(join(stuck, 'receipt.json'), JSON.stringify(receipt()));
    await deadLock(stuck);
    const stat = await readFile(`/proc/${sleeper.pid}/stat`, 'utf8');
    await mkdir(join(stuck, '.receipt.lock.break'));
    await writeFile(join(stuck, '.receipt.lock.break', 'holder'), `${sleeper.pid} ${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]} breaker\n`);
    process.kill(sleeper.pid, 'SIGSTOP');
    const began = Date.now();
    const blocked = JSON.parse((await promisify(execFile)(process.execPath, [worker, stuck, '1'])).stdout);
    assert.ok(Date.now() - began < 15000, 'the wait is bounded');
    assert.equal(blocked.applied, 0);
    assert.match(blocked.errors[0], new RegExp(`^a lock breaker \\(pid ${sleeper.pid}\\) held the receipt lock for 10 s`));

    // A breaker directory that never recorded a holder, left long enough ago, is cleared.
    const orphan = join(base, 'orphan');
    await mkdir(orphan);
    await writeFile(join(orphan, 'receipt.json'), JSON.stringify(receipt()));
    await deadLock(orphan);
    await mkdir(join(orphan, '.receipt.lock.break'));
    const past = new Date(Date.now() - 30000);
    await utimes(join(orphan, '.receipt.lock.break'), past, past);
    const cleared = JSON.parse((await promisify(execFile)(process.execPath, [worker, orphan, '1'])).stdout);
    assert.deepEqual(cleared, {applied: 1, errors: []});
    assert.equal(JSON.parse(await readFile(join(orphan, 'receipt.json'), 'utf8')).counter, 1);
  } finally {
    sleeper.kill('SIGKILL');
    await rm(base, {recursive: true, force: true});
  }
});
