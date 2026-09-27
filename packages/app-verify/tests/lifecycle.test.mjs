// Lifecycle operations against real transient user units, with short leases.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {validateReceipt} from '@jimmie-potts/app-verify';
import {alive, refused, sandbox, show, supervisorSkipReason, units, until} from './helpers.mjs';

const skip = supervisorSkipReason();
const sha256 = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const runIdPattern = app => new RegExp(`^${app}-\\d{8}T\\d{6}Z-[0-9a-f]{6}$`);

test('start runs the app under a leased unit, doctor reads it, stop removes what it owned', {skip}, async () => {
  const box = await sandbox();
  try {
    const started = await box.cli(['start', '--lease', '5']);
    assert.equal(started.code, 0, started.stderr);
    const {runId, url, port} = started.result;
    assert.match(runId, runIdPattern(box.app));
    assert.equal(started.result.state, 'running');
    assert.equal(url, `http://127.0.0.1:${port}/`);

    const receipt = await box.receipt(runId);
    assert.deepEqual(validateReceipt(receipt), {ok: true});
    assert.equal(receipt.state, 'running');
    assert.equal(receipt.roots.proof, '<canonical checkout>/.local/evidence/verify');
    assert.equal(receipt.roots.runtime, box.stateRoot, 'an overridden runtime root is named as given');
    assert.deepEqual(receipt.build, {sourceRevision: box.git('rev-parse', 'HEAD'), dirty: false, artifactDigest: sha256(Buffer.from(await (await fetch(url + 'app.js')).arrayBuffer())), version: '1.0.0-fixture'});
    assert.equal(receipt.scenario.name, 'reference');
    assert.equal(receipt.scenario.version, receipt.build.sourceRevision);
    assert.deepEqual(receipt.checks.map(c => [c.id, c.outcome]), [['readiness', 'passed'], ['seeded-scenario', 'passed'], ['windows-loopback', 'skipped']]);
    assert.equal(receipt.owned.unit, `app-verify-${runId}.service`);
    assert.equal(receipt.owned.leaseTimer, `app-verify-${runId}-lease.timer`);
    assert.equal(receipt.owned.port, port);

    // The unit belongs to the user manager, its identity matches the receipt and the lease timer elapses at expiresAt.
    const unit = show(receipt.owned.unit, 'ActiveState', 'MainPID', 'ExecMainStartTimestampMonotonic', 'ControlGroup', 'KillMode');
    assert.equal(unit.ActiveState, 'active');
    assert.equal(Number(unit.MainPID), receipt.owned.mainPid);
    assert.equal(Number(unit.ExecMainStartTimestampMonotonic), receipt.owned.mainStartMonotonic);
    assert.match(unit.ControlGroup, /\/user@\d+\.service\/app\.slice\//);
    assert.equal(unit.KillMode, 'control-group');
    const timer = show(receipt.owned.leaseTimer, 'ActiveState', 'NextElapseUSecRealtime');
    assert.equal(timer.ActiveState, 'active');
    assert.equal(Number(timer.NextElapseUSecRealtime.slice(1)), Date.parse(receipt.preview.expiresAt) / 1000);
    const remaining = Date.parse(receipt.preview.expiresAt) - Date.now();
    assert.ok(remaining > 4 * 60000 && remaining <= 5 * 60000 + 1000, `lease of 5 minutes, ${remaining} ms left`);

    // Runtime state is private and outside the checkout; proof lives under the canonical checkout.
    const runtimeDir = join(box.stateRoot, runId);
    assert.equal((await stat(runtimeDir)).mode & 0o777, 0o700);
    assert.ok(existsSync(join(runtimeDir, 'data/scenario.json')));
    assert.ok(existsSync(join(box.proofRoot, runId, 'events.jsonl')));
    assert.deepEqual((await box.events(runId)).map(e => e.event).filter(e => ['created', 'seeded', 'lease-started', 'unit-started', 'ready', 'running'].includes(e)), ['created', 'seeded', 'lease-started', 'unit-started', 'ready', 'running'], 'start follows the contract order: receipt, seed, lease, unit, readiness');

    const doctor = await box.cli(['doctor']);
    assert.equal(doctor.code, 0, doctor.stderr);
    assert.equal(doctor.result.runs.length, 1);
    const [row] = doctor.result.runs;
    assert.equal(row.runId, runId);
    assert.equal(row.state, 'running');
    assert.deepEqual(row.reasons, []);
    assert.equal(row.health.outcome, 'passed');
    assert.equal(row.artifact, 'matches');
    assert.equal(row.unit.mainPid, receipt.owned.mainPid);
    assert.equal(row.preview.expiresAt, receipt.preview.expiresAt);
    assert.equal(row.windows.outcome, 'skipped');
    assert.equal(receipt.owned.runtimeDir, runId);

    const stopped = await box.cli(['stop', runId]);
    assert.equal(stopped.code, 0, stopped.stderr);
    assert.equal(stopped.result.state, 'stopped');
    assert.equal(stopped.result.cleanup.result, 'clean');
    assert.deepEqual(units(box.app), []);
    assert.equal(existsSync(runtimeDir), false);
    assert.ok(await refused(port), 'a stopped run answers nothing on its port');
    const final = await box.receipt(runId);
    assert.deepEqual(validateReceipt(final), {ok: true});
    assert.equal(final.state, 'stopped');
    assert.equal(final.cleanup.result, 'clean');
    assert.deepEqual(final.cleanup.items.map(i => [i.kind, i.outcome]), [['lease-timer', 'removed'], ['unit', 'removed'], ['runtime-dir', 'removed']]);

    const again = await box.cli(['stop', runId]);
    assert.equal(again.code, 0, 'stop is idempotent');
    assert.equal(again.result.state, 'stopped');
    assert.equal((await box.receipt(runId)).cleanup.at, final.cleanup.at, 'a repeated stop does not rewrite the final receipt');
  } finally {
    await box.close();
  }
});

test('help lists operations, scenarios and capture steps', async () => {
  const box = await sandbox();
  try {
    const help = await box.cli(['help']);
    assert.equal(help.code, 0);
    assert.ok(help.result.operations.includes('start [--scenario <name>] [--lease <minutes>]'));
    assert.equal(help.result.scenarios.reference, 'Counter at 0 that adds one per click');
    assert.equal(help.result.steps['count-twice'], 'Two clicks advance the counter by two');
    const usage = await box.cli(['launch']);
    assert.equal(usage.code, 2);
    assert.equal(usage.result.error, 'usage');
  } finally {
    await box.close();
  }
});

/** No unit, timer or runtime directory remains, and the failed receipt that doctor lists says why. */
async function assertFailedAndClean(box, result, cause) {
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.result.state, 'failed');
  assert.equal(result.result.cause, cause);
  assert.equal(result.result.cleanup.result, 'clean');
  const {runId} = result.result;
  assert.deepEqual(units(box.app), [], 'no unit or lease timer is left');
  assert.equal(existsSync(join(box.stateRoot, runId)), false, 'the runtime directory is removed');
  const receipt = await box.receipt(runId);
  assert.deepEqual(validateReceipt(receipt), {ok: true});
  assert.equal(receipt.state, 'failed');
  assert.equal(receipt.failure.cause, cause);
  assert.match(receipt.failure.at, /Z$/);
  assert.equal(receipt.cleanup.result, 'clean');
  const doctor = await box.cli(['doctor', runId]);
  assert.equal(doctor.code, 0);
  assert.equal(doctor.result.runs[0].state, 'failed');
  assert.equal(doctor.result.runs[0].failure.cause, cause);
  return receipt;
}

test('failed starts clean up everything they created and keep a failed receipt', {skip}, async () => {
  const box = await sandbox();
  try {
    // A broken build: the app listens but never announces readiness.
    const timeout = await box.cli(['start', '--scenario', 'never-ready']);
    const receipt = await assertFailedAndClean(box, timeout, 'readiness-timeout');
    assert.ok(receipt.scenario.seededAt === null && receipt.preview === null);
    assert.ok((await box.events(timeout.result.runId)).some(e => e.event === 'seeded'), 'cleanup removed a directory that had already been seeded');

    // The app starts a setsid helper and exits: the control group takes the helper with it.
    const crash = await box.cli(['start', '--scenario', 'crash']);
    await assertFailedAndClean(box, crash, 'unit-exited');
    const helper = Number(await readFile(join(box.base, 'helper.pid'), 'utf8'));
    assert.ok(helper > 0);
    await until(() => !alive(helper), 'the setsid helper died with the unit', 5000);

    await assertFailedAndClean(box, await box.cli(['start', '--scenario', 'seed-fails']), 'seed-failed');
    const check = await box.cli(['start', '--scenario', 'check-fails']);
    const checked = await assertFailedAndClean(box, check, 'check-failed');
    assert.deepEqual(checked.checks.map(c => [c.id, c.outcome]), [['readiness', 'passed'], ['seeded-scenario', 'failed']]);

    const doctor = await box.cli(['doctor']);
    assert.deepEqual(doctor.result.runs.map(r => r.state), ['failed', 'failed', 'failed', 'failed'], 'doctor lists every failed start');
  } finally {
    await box.close();
  }
});

test('start refuses without a user manager or with runtime state inside a checkout, and creates nothing', {skip}, async () => {
  const box = await sandbox();
  try {
    const noManager = await box.cli(['start'], {extraEnv: {XDG_RUNTIME_DIR: join(box.base, 'no-runtime'), DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + join(box.base, 'no-bus')}});
    assert.equal(noManager.code, 3, noManager.stderr);
    assert.equal(noManager.result.cause, 'supervisor-unavailable');
    const inside = await box.cli(['start'], {extraEnv: {APP_VERIFY_STATE_ROOT: join(box.repo, 'state')}});
    assert.equal(inside.code, 1);
    assert.equal(inside.result.cause, 'runtime-root-unusable');
    assert.equal(existsSync(box.proofRoot), false, 'no proof directory was created');
    assert.equal(existsSync(join(box.repo, 'state')), false);
    assert.deepEqual(units(box.app), []);
  } finally {
    await box.close();
  }
});

test('an interrupted start is discoverable by doctor and stop removes what exists', {skip}, async () => {
  const box = await sandbox();
  try {
    // Killed after seeding, before the lease and unit: doctor shows a stale starting receipt.
    let child;
    const pending = box.cli(['start', '--scenario', 'slow-seed'], {onSpawn: c => (child = c)});
    const marker = await until(async () => {
      const {readdir} = await import('node:fs/promises');
      const names = existsSync(box.markerDir) ? await readdir(box.markerDir) : [];
      return names.find(n => n.endsWith('.seeded'));
    }, 'seeded marker');
    child.kill('SIGKILL');
    await pending;
    const runId = marker.replace(/\.seeded$/, '');
    const [row] = (await box.cli(['doctor'])).result.runs;
    assert.equal(row.runId, runId);
    assert.equal(row.receipt.state, 'starting');
    assert.equal(row.state, 'stale');
    assert.deepEqual(row.reasons, ['unit-gone', 'runtime-dir-awaits-stop']);
    assert.equal(row.runtimeDir, 'present');
    const stopped = await box.cli(['stop', runId]);
    assert.equal(stopped.code, 0, stopped.stderr);
    assert.equal(stopped.result.cleanup.result, 'clean');
    assert.equal(existsSync(join(box.stateRoot, runId)), false);

    // Killed while waiting for readiness: the unit runs under its lease and doctor reports `starting`.
    let second;
    const waiting = box.cli(['start', '--scenario', 'never-ready'], {onSpawn: c => (second = c)});
    const unit = await until(() => units(box.app).find(n => n.endsWith('.service') && !n.includes('-lease')), 'the app unit exists');
    second.kill('SIGKILL');
    await waiting;
    const liveId = unit.replace(/^app-verify-/, '').replace(/\.service$/, '');
    const live = (await box.cli(['doctor', liveId])).result.runs[0];
    assert.equal(live.state, 'starting');
    assert.equal(live.leaseTimer.name, `app-verify-${liveId}-lease.timer`, 'the lease exists before the application');
    const cleaned = await box.cli(['stop', liveId]);
    assert.equal(cleaned.code, 0, cleaned.stderr);
    assert.deepEqual(cleaned.result.cleanup.items.map(i => [i.kind, i.outcome]), [['lease-timer', 'removed'], ['unit', 'removed'], ['runtime-dir', 'removed']]);
    assert.deepEqual(units(box.app), []);
  } finally {
    await box.close();
  }
});

test('two concurrent runs share nothing, and a reseed changes only its own run', {skip}, async () => {
  const box = await sandbox();
  try {
    const [a, b] = await Promise.all([box.cli(['start', '--lease', '10']), box.cli(['start', '--lease', '10'])]);
    assert.equal(a.code, 0, a.stderr);
    assert.equal(b.code, 0, b.stderr);
    assert.notEqual(a.result.runId, b.result.runId);
    assert.notEqual(a.result.port, b.result.port);
    const doctor = await box.cli(['doctor']);
    assert.deepEqual(doctor.result.runs.map(r => r.state), ['running', 'running']);

    const before = await box.receipt(a.result.runId);
    const bBefore = await readFile(join(box.stateRoot, b.result.runId, 'data/scenario.json'), 'utf8');
    const reseeded = await box.cli(['scenario', a.result.runId, 'second']);
    assert.equal(reseeded.code, 0, reseeded.stderr);
    assert.equal(reseeded.result.port, a.result.port, 'the reseeded run keeps its port');
    const page = await (await fetch(a.result.url)).text();
    assert.match(page, /Count: 10/);
    assert.match(await (await fetch(b.result.url)).text(), /Count: 0/, 'the other run still serves its own state');
    assert.equal(await readFile(join(box.stateRoot, b.result.runId, 'data/scenario.json'), 'utf8'), bBefore);
    const after = await box.receipt(a.result.runId);
    assert.equal(after.scenario.name, 'second');
    assert.equal(after.owned.leaseTimer, before.owned.leaseTimer);
    assert.equal(after.preview.expiresAt, before.preview.expiresAt, 'the lease is unchanged');
    assert.notEqual(after.owned.mainPid, before.owned.mainPid);
    assert.equal((await box.cli(['doctor', a.result.runId])).result.runs[0].state, 'running', 'doctor accepts the relaunched identity');

    const unknown = await box.cli(['scenario', a.result.runId, 'nope']);
    assert.equal(unknown.code, 2);
    for (const run of [a, b]) assert.equal((await box.cli(['stop', run.result.runId])).code, 0);
    const refusedReseed = await box.cli(['scenario', a.result.runId, 'reference']);
    assert.equal(refusedReseed.code, 1);
    assert.equal(refusedReseed.result.error, 'run-not-running');
  } finally {
    await box.close();
  }
});

test('extend replaces the lease, and an expired lease stops the unit and reads as expired', {skip}, async () => {
  const box = await sandbox();
  try {
    const started = await box.cli(['start', '--lease', '0.15']);
    assert.equal(started.code, 0, started.stderr);
    const {runId, port} = started.result;
    const extended = await box.cli(['extend', runId, '--lease', '0.25']);
    assert.equal(extended.code, 0, extended.stderr);
    const receipt = await box.receipt(runId);
    assert.equal(receipt.owned.leaseTimer, `app-verify-${runId}-lease-2.timer`);
    assert.equal(receipt.preview.leaseMinutes, 0.25);
    assert.equal(extended.result.expiresAt, receipt.preview.expiresAt);
    assert.ok(extended.result.card.some(line => line.includes(receipt.preview.expiresAt.replace('T', ' '))), 'the card shows the new expiry');
    assert.equal(show(`app-verify-${runId}-lease.timer`, 'LoadState').LoadState, 'not-found', 'the old timer is gone');
    assert.equal(Number(show(receipt.owned.leaseTimer, 'NextElapseUSecRealtime').NextElapseUSecRealtime.slice(1)), Date.parse(receipt.preview.expiresAt) / 1000);

    // The first lease would have elapsed by now; the replaced one still holds.
    await until(() => Date.now() > Date.parse(started.result.expiresAt) + 2000, 'the original expiry passes', 20000);
    assert.equal(show(receipt.owned.unit, 'ActiveState').ActiveState, 'active', 'the extension kept the run alive');
    await until(() => show(receipt.owned.unit, 'LoadState').LoadState === 'not-found', 'the lease stops the unit', 25000);
    assert.ok(await refused(port));
    const [row] = (await box.cli(['doctor', runId])).result.runs;
    assert.equal(row.state, 'expired');
    assert.equal(row.preview.expiresAt, receipt.preview.expiresAt);
    assert.equal(row.runtimeDir, 'present', 'the runtime directory waits for stop');
    const stopped = await box.cli(['stop', runId]);
    assert.equal(stopped.result.state, 'expired');
    assert.equal(stopped.result.cleanup.result, 'clean');
    const final = await box.receipt(runId);
    assert.equal(final.state, 'expired');
    assert.deepEqual(units(box.app), []);
    const late = await box.cli(['extend', runId]);
    assert.equal(late.code, 1, 'an expired run cannot be extended');
    assert.equal(late.result.error, 'run-not-running');
  } finally {
    await box.close();
  }
});

test('doctor reports a reused PID with another start time, a missing lease or runtime directory, and an orphan unit as stale', {skip}, async () => {
  const box = await sandbox();
  try {
    const started = await box.cli(['start', '--lease', '5']);
    const {runId} = started.result;
    const path = join(box.proofRoot, runId, 'receipt.json');
    const original = await readFile(path, 'utf8');
    const {writeFile, rename, rm} = await import('node:fs/promises');
    const tampered = JSON.parse(original);
    tampered.owned.mainStartMonotonic += 1;
    await writeFile(path, JSON.stringify(tampered));
    const [row] = (await box.cli(['doctor', runId])).result.runs;
    assert.equal(row.state, 'stale');
    assert.deepEqual(row.reasons, ['identity-mismatch']);
    assert.equal(await readFile(path, 'utf8'), JSON.stringify(tampered), 'doctor never repairs the receipt');
    await writeFile(path, original);

    const runtime = join(box.stateRoot, runId);
    await rename(runtime, runtime + '.moved');
    const missing = (await box.cli(['doctor', runId])).result.runs[0];
    assert.equal(missing.state, 'stale');
    assert.deepEqual(missing.reasons, ['runtime-dir-missing']);
    await rename(runtime + '.moved', runtime);

    const {spawnSync} = await import('node:child_process');
    spawnSync('systemctl', ['--user', 'stop', `app-verify-${runId}-lease.timer`]);
    const unleased = (await box.cli(['doctor', runId])).result.runs[0];
    assert.equal(unleased.state, 'stale');
    assert.deepEqual(unleased.reasons, ['lease-timer-missing']);

    // An orphan: a unit whose receipt is gone still appears.
    await rename(join(box.proofRoot, runId), join(box.base, 'proof-aside'));
    const orphan = (await box.cli(['doctor'])).result.runs.find(r => r.runId === runId);
    assert.equal(orphan.state, 'stale');
    assert.deepEqual(orphan.reasons, ['receipt-missing']);
    assert.equal(orphan.unit.active, 'active');
    const stopped = await box.cli(['stop', runId]);
    assert.equal(stopped.code, 0, 'stop removes an orphan by its unit names');
    assert.deepEqual(units(box.app), []);
    await rm(join(box.base, 'proof-aside'), {recursive: true, force: true});
  } finally {
    await box.close();
  }
});

test('stop of a running run whose runtime directory vanished records a partial cleanup', {skip}, async () => {
  const box = await sandbox();
  try {
    const {runId} = (await box.cli(['start', '--lease', '5'])).result;
    const {rm} = await import('node:fs/promises');
    await rm(join(box.stateRoot, runId), {recursive: true, force: true});
    const stopped = await box.cli(['stop', runId]);
    assert.equal(stopped.code, 0, 'the unit and timer were still stopped');
    assert.equal(stopped.result.cleanup.result, 'partial');
    assert.deepEqual(stopped.result.cleanup.items.map(i => [i.kind, i.outcome]), [['lease-timer', 'removed'], ['unit', 'removed'], ['runtime-dir', 'absent']]);
    assert.deepEqual(units(box.app), []);
  } finally {
    await box.close();
  }
});

test('restart names its predecessor and says when the candidate changed', {skip}, async () => {
  const box = await sandbox();
  try {
    const first = await box.cli(['start', '--scenario', 'second', '--lease', '5']);
    const same = await box.cli(['restart', first.result.runId]);
    assert.equal(same.code, 0, same.stderr);
    assert.equal(same.result.restarts, first.result.runId);
    assert.equal(same.result.continuity, 'same-candidate');
    assert.equal(same.result.scenario, 'second', 'the recorded scenario is reseeded');
    assert.equal((await box.receipt(first.result.runId)).state, 'stopped');
    const receipt = await box.receipt(same.result.runId);
    assert.equal(receipt.restarts, first.result.runId);
    assert.equal(receipt.preview.leaseMinutes, 5);

    const {writeFile} = await import('node:fs/promises');
    await writeFile(join(box.repo, 'tracked.txt'), 'changed\n');
    const changed = await box.cli(['restart', same.result.runId]);
    assert.equal(changed.code, 0, changed.stderr);
    assert.equal(changed.result.continuity, 'different-candidate');
    assert.equal(changed.result.build.dirty, true);
    assert.ok(changed.result.card.some(line => /\(dirty\)/.test(line)), 'the card labels the dirty candidate');
    assert.ok((await box.events(changed.result.runId)).some(e => e.event === 'restarts' && e.continuity === 'different-candidate'));
    await box.cli(['stop', changed.result.runId]);
  } finally {
    await box.close();
  }
});

test('a linked worktree keeps proof in the canonical checkout', {skip}, async () => {
  const box = await sandbox();
  try {
    const worktree = join(box.base, 'linked');
    box.git('worktree', 'add', '-q', worktree, '-b', 'linked');
    const entry = await box.wrapper(worktree);
    const started = await box.cli(['start', '--lease', '5'], {cwd: worktree, entry});
    assert.equal(started.code, 0, started.stderr);
    assert.ok(started.result.proofDir.startsWith(box.proofRoot + '/'), 'proof lives under the main worktree');
    assert.equal(existsSync(join(worktree, '.local')), false);
    assert.equal((await box.cli(['stop', started.result.runId], {cwd: worktree, entry})).code, 0);
  } finally {
    await box.close();
  }
});

test('a degraded user manager is available; an offline one is not', {skip}, async () => {
  const box = await sandbox();
  try {
    const {writeFile, mkdir, chmod} = await import('node:fs/promises');
    const shim = async (name, answer) => {
      const dir = join(box.base, name);
      await mkdir(dir);
      // Answers is-system-running like this host (degraded, exit 1) and passes everything else to the real systemctl.
      await writeFile(join(dir, 'systemctl'), `#!/bin/sh\nif [ "$2" = is-system-running ]; then echo ${answer}; exit 1; fi\nexec /usr/bin/systemctl "$@"\n`);
      await chmod(join(dir, 'systemctl'), 0o755);
      return {PATH: `${dir}:${process.env.PATH}`};
    };
    const degraded = await box.cli(['start', '--lease', '5'], {extraEnv: await shim('degraded', 'degraded')});
    assert.equal(degraded.code, 0, degraded.stderr);
    assert.equal(degraded.result.state, 'running');
    assert.equal((await box.cli(['stop', degraded.result.runId])).code, 0);
    const offline = await box.cli(['start'], {extraEnv: await shim('offline', 'offline')});
    assert.equal(offline.code, 3);
    assert.equal(offline.result.cause, 'supervisor-unavailable');
    assert.match(offline.result.detail, /answered offline/);
  } finally {
    await box.close();
  }
});

test('an artifact of several files is digested in order, as sha256sum prints it', {skip}, async () => {
  const box = await sandbox();
  try {
    const {writeFile} = await import('node:fs/promises');
    const {execFileSync} = await import('node:child_process');
    await writeFile(join(box.repo, 'page.html'), '<p>page</p>');
    await writeFile(join(box.repo, 'asset.js'), 'export {};');
    const options = JSON.stringify({artifact: {files: ['page.html', 'asset.js']}}).slice(1, -1);
    const entry = await box.wrapper(box.repo, 'verify-files.mjs');
    await writeFile(entry, (await readFile(entry, 'utf8')).replace('"root":', options + ',"root":'));
    const started = await box.cli(['start', '--lease', '5'], {entry});
    assert.equal(started.code, 0, started.stderr);
    const expected = 'sha256:' + execFileSync('sh', ['-c', 'sha256sum page.html asset.js | sha256sum'], {cwd: box.repo, encoding: 'utf8'}).split(' ')[0];
    assert.equal((await box.receipt(started.result.runId)).build.artifactDigest, expected);
    assert.equal((await box.cli(['doctor', started.result.runId], {entry})).result.runs[0].artifact, 'matches');
    await box.cli(['stop', started.result.runId], {entry});
  } finally {
    await box.close();
  }
});
