// Hub #944: the opt-in, host-wide refusal of a second run. A wrapper opts in with APP_VERIFY_SINGLE_RUN=1; these tests
// pass it per command, and the suite's own sandbox never sets it, so every other test still starts runs side by side.
//
// The guard reads the whole host, and another session may have a run live while this suite runs. Each guarded command
// here therefore runs with a systemctl on its PATH that lists only this sandbox's run units (`scoped`), or none at all
// (`blind`); every other systemctl call passes through. The real listing is exercised directly through `liveRuns`.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {chmod, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {liveRuns, runActiveDetail} from '@jimmie-potts/app-verify';
import {assertRefusal, expectedBody, sandbox, show, supervisorSkipReason, units, until} from './helpers.mjs';

const skip = supervisorSkipReason();
const systemctl = (...args) => spawnSync('systemctl', ['--user', ...args], {encoding: 'utf8'});
const transient = (...args) => spawnSync('systemd-run', ['--user', '--quiet', ...args], {encoding: 'utf8'});
const unloaded = unit => show(unit, 'LoadState').LoadState !== 'loaded';

/**
 * The environment of a guarded command. `scoped` narrows the core's unit listing to this sandbox's apps, `blind` makes
 * that listing fail; either way every other systemctl call reaches the real one.
 */
async function guarded(box, mode = 'scoped') {
  const real = spawnSync('sh', ['-c', 'command -v systemctl'], {encoding: 'utf8'}).stdout.trim();
  const dir = join(box.base, `systemctl-${mode}`);
  if (!existsSync(dir)) {
    await mkdir(dir);
    const swap = mode === 'blind' ? 'exit 1' : `a='app-verify-${box.app}-*.service'`;
    await writeFile(join(dir, 'systemctl'), `#!/bin/sh\nn=$#\ni=0\nwhile [ "$i" -lt "$n" ]; do\n  a=$1; shift; i=$((i+1))\n  [ "$a" = 'app-verify-*.service' ] && ${swap}\n  set -- "$@" "$a"\ndone\nexec ${real} "$@"\n`);
    await chmod(join(dir, 'systemctl'), 0o755);
  }
  return {APP_VERIFY_SINGLE_RUN: '1', PATH: `${dir}:${process.env.PATH}`};
}

// No skip: the wording, and the README's example of it, need no user manager.
test('the refusal names up to three live runs, and the README shows the line the core prints', async () => {
  const ids = [1, 2, 3, 4, 5].map(n => `hub-20260927T060259Z-00000${n}`);
  assert.match(runActiveDetail(ids.slice(0, 1)), /^run hub-20260927T060259Z-000001 is still live on this host, and only one run may start at a time; stop it /);
  assert.match(runActiveDetail(ids.slice(0, 3)), /^runs hub-20260927T060259Z-000001, hub-20260927T060259Z-000002, hub-20260927T060259Z-000003 are still live /);
  assert.match(runActiveDetail(ids), /^runs hub-20260927T060259Z-000001, hub-20260927T060259Z-000002, hub-20260927T060259Z-000003 and 2 more are still live .*; stop them /);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const section = readme.slice(readme.indexOf('## One run at a time'));
  const line = JSON.parse(/^```json\n(.+)\n```$/m.exec(section)?.[1] ?? 'null');
  const detail = runActiveDetail(['hub-20260927T060259Z-3f9a1c']);
  assert.deepEqual(line, {operation: 'start', error: 'run-active', detail, errorBody: expectedBody('run-active', detail)});
  const live = await liveRuns();
  assert.ok(live === undefined || Array.isArray(live), 'liveRuns answers a list of run ids, or undefined when units cannot be listed');
});

test('a second start is refused while a run is live: it names the run, creates nothing and leaves the run untouched', {skip, timeout: 120000}, async () => {
  const box = await sandbox();
  try {
    const env = await guarded(box);
    const started = await box.cli(['start', '--lease', '5'], {extraEnv: env});
    assert.equal(started.code, 0, started.stderr);
    const {runId, url} = started.result;
    const before = {
      receipt: await box.receipt(runId),
      unit: show(`app-verify-${runId}.service`, 'ActiveState', 'MainPID', 'ExecMainStartTimestampMonotonic'),
      timer: show(`app-verify-${runId}-lease.timer`, 'ActiveState', 'NextElapseUSecRealtime'),
      proof: await readdir(box.proofRoot), runtime: await readdir(box.stateRoot), units: units(box.app),
    };
    assert.ok(before.units.includes(`app-verify-${runId}.service`));

    // The same adapter, then another adapter on the same host: the guard is host-wide, not per app.
    const other = await box.wrapper(box.repo, 'verify-other.mjs', {app: `${box.app}-b`});
    for (const entry of [undefined, other]) {
      const refused = await box.cli(['start', '--lease', '5'], {extraEnv: env, ...(entry ? {entry} : {})});
      assert.equal(refused.code, 1, refused.stderr);
      assert.equal(refused.lines.length, 1, 'one result line');
      assertRefusal(refused.result, 'run-active');
      assert.equal(refused.result.operation, 'start');
      assert.match(refused.result.detail, new RegExp(`${runId}\\b`), 'the refusal names the live run');
      assert.match(refused.result.detail, /stop|lease/, 'and says how it ends');
      assert.deepEqual(refused.result.errorBody.error, {code: 'capacity', retryable: true, detail: `run-active: ${refused.result.detail}`});
    }

    assert.deepEqual(await readdir(box.proofRoot), before.proof, 'a refusal creates no proof directory');
    assert.deepEqual(await readdir(box.stateRoot), before.runtime, 'and no runtime directory');
    assert.deepEqual(units(box.app), before.units, 'and no unit or timer');
    assert.deepEqual(await box.receipt(runId), before.receipt, 'the live run keeps its receipt');
    assert.deepEqual(show(`app-verify-${runId}.service`, 'ActiveState', 'MainPID', 'ExecMainStartTimestampMonotonic'), before.unit, 'its process');
    assert.deepEqual(show(`app-verify-${runId}-lease.timer`, 'ActiveState', 'NextElapseUSecRealtime'), before.timer, 'and its lease');
    assert.equal((await fetch(url, {signal: AbortSignal.timeout(5000)})).status, 200, 'and still serves');
    const [row] = (await box.cli(['doctor', runId])).result.runs;
    assert.equal(row.state, 'running');
    assert.deepEqual(row.reasons, []);

    // The guard lifts as soon as the run is gone, for either adapter.
    assert.equal((await box.cli(['stop', runId])).code, 0);
    const next = await box.cli(['start', '--lease', '5'], {extraEnv: env, entry: other});
    assert.equal(next.code, 0, next.stderr);
    assert.equal((await box.cli(['stop', next.result.runId], {entry: other})).code, 0);
  } finally {
    await box.close();
  }
});

test('without the variable, or with any value but 1, a live run does not block a start', {skip, timeout: 120000}, async () => {
  const box = await sandbox();
  try {
    const live = await box.cli(['start', '--lease', '5']);
    assert.equal(live.code, 0, live.stderr);
    for (const value of ['0', 'true', '']) {
      const side = await box.cli(['start', '--lease', '5'], {extraEnv: {APP_VERIFY_SINGLE_RUN: value}});
      assert.equal(side.code, 0, `APP_VERIFY_SINGLE_RUN=${JSON.stringify(value)}: ${side.stderr}`);
      assert.equal((await box.cli(['stop', side.result.runId])).code, 0);
    }
    assert.equal((await box.cli(['stop', live.result.runId])).code, 0);
  } finally {
    await box.close();
  }
});

test('only a live run unit counts: failed units, stray timers, the host route\'s command unit and a lease service never block', {skip, timeout: 120000}, async () => {
  const box = await sandbox();
  const strays = [];
  try {
    const stamp = '20260101T000000Z';
    const failed = `${box.app}-${stamp}-aaaaaa`, timer = `${box.app}-${stamp}-bbbbbb-lease`, leased = `${box.app}-${stamp}-cccccc-lease`;
    const command = `app-verify-command-${randomUUID()}`, live = `${box.app}-${stamp}-dddddd`;
    // Without --collect a failed unit stays loaded, as a stale one would.
    assert.equal(transient(`--unit=app-verify-${failed}`, 'false').status, 0);
    strays.push(`app-verify-${failed}.service`);
    await until(() => show(`app-verify-${failed}.service`, 'ActiveState').ActiveState === 'failed', 'the stand-in unit failed');
    assert.equal(transient(`--unit=app-verify-${timer}`, '--on-active=1h', '--collect', 'true').status, 0);
    strays.push(`app-verify-${timer}.timer`);
    for (const name of [`app-verify-${leased}`, command]) {
      assert.equal(transient(`--unit=${name}`, '--collect', 'sleep', '120').status, 0);
      strays.push(`${name}.service`);
    }
    // The listing the core really reads, host-wide: it names this live unit's run and none of the others.
    assert.equal(transient(`--unit=app-verify-${live}`, '--collect', 'sleep', '120').status, 0);
    strays.push(`app-verify-${live}.service`);
    const listed = await liveRuns();
    assert.ok(Array.isArray(listed), 'systemctl lists units');
    assert.ok(listed.includes(live), 'a live run unit counts');
    for (const ignored of [failed, timer, leased]) assert.equal(listed.includes(ignored), false, `${ignored} does not count`);
    assert.equal(listed.some(id => id.includes('command')), false, 'the host route\'s command unit does not count');
    assert.equal(show(`app-verify-${failed}.service`, 'ActiveState').ActiveState, 'failed', 'the failed unit is still loaded');
    assert.equal(show(`${command}.service`, 'ActiveState').ActiveState, 'active', 'the command unit is live');

    // Stop the one live stand-in; with only the others left, a guarded start goes ahead.
    systemctl('stop', `app-verify-${live}.service`);
    const started = await box.cli(['start', '--lease', '5'], {extraEnv: await guarded(box)});
    assert.equal(started.code, 0, started.stderr);
    assert.equal(started.result.state, 'running');
    assert.equal((await box.cli(['stop', started.result.runId])).code, 0);
  } finally {
    for (const unit of strays) systemctl('stop', unit);
    for (const unit of strays) systemctl('reset-failed', unit);
    await until(() => strays.every(unloaded), 'the stand-in units are unloaded', 10000).catch(() => undefined);
    await box.close();
    assert.deepEqual(strays.filter(unit => !unloaded(unit)), [], 'every stand-in unit this test created is gone');
  }
});

test('restart, scenario, doctor and stop work while the guard is on, and a start that cannot read the unit list goes ahead and says so', {skip, timeout: 180000}, async () => {
  const box = await sandbox();
  try {
    const env = await guarded(box);
    const started = await box.cli(['start', '--lease', '5'], {extraEnv: env});
    assert.equal(started.code, 0, started.stderr);
    const {runId} = started.result;
    // `restart` replaces the run: it never adds a second one.
    const restarted = await box.cli(['restart', runId], {extraEnv: env});
    assert.equal(restarted.code, 0, restarted.stderr);
    assert.equal(restarted.result.restarts, runId);
    const next = restarted.result.runId;
    assert.notEqual(next, runId);
    assert.equal((await box.cli(['scenario', next, 'second'], {extraEnv: env})).code, 0);
    assert.equal((await box.cli(['doctor'], {extraEnv: env})).result.runs.find(run => run.runId === next).state, 'running');

    // A systemctl that cannot list the run units: the check is skipped, never turned into a refusal.
    const blind = await box.cli(['start', '--lease', '5'], {extraEnv: await guarded(box, 'blind')});
    assert.equal(blind.code, 0, blind.stderr);
    assert.match(blind.stderr, /one-run check was skipped/);
    for (const id of [next, blind.result.runId]) assert.equal((await box.cli(['stop', id], {extraEnv: env})).code, 0);
  } finally {
    await box.close();
  }
});

// No skip: a runner without a user manager, forced here by hiding the user bus, still answers as it did.
test('with the guard on, a start without a user manager still exits 3 and creates nothing', async () => {
  const box = await sandbox();
  try {
    const hidden = {XDG_RUNTIME_DIR: join(box.base, 'no-runtime'), DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + join(box.base, 'no-bus')};
    const noManager = await box.cli(['start'], {extraEnv: {APP_VERIFY_SINGLE_RUN: '1', ...hidden}});
    assert.equal(noManager.code, 3, noManager.stderr);
    assert.equal(noManager.result.state, 'failed');
    assert.equal(noManager.result.cause, 'supervisor-unavailable');
    assert.equal(existsSync(box.proofRoot), false);
    assert.equal(existsSync(box.stateRoot), false);
    assert.deepEqual(units(box.app), []);
  } finally {
    await box.close();
  }
});
