// Hub #944: the opt-in, host-wide refusal of a second run. A wrapper opts in with APP_VERIFY_SINGLE_RUN=1; these tests
// pass it per command, and the suite's own sandbox never sets it, so every other test still starts runs side by side.
//
// The guard reads the whole host and holds one host-wide claim unit, and another session may have a run or a start in
// flight while this suite runs. Each guarded command here therefore runs with a systemctl and a systemd-run on its PATH
// (scope-shim.mjs) that list only this sandbox's run units and take a claim of their own (`scoped`), or cannot list
// units at all (`blind`); every other call passes through. The real listing is exercised directly through `liveRuns`.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {holdSingleRun, liveRuns, runActiveDetail} from '@jimmie-potts/app-verify';
import {assertRefusal, expectedBody, sandbox, show, supervisorSkipReason, units, until} from './helpers.mjs';
import {callsOf, scopeShim} from './scope-shim.mjs';

const skip = supervisorSkipReason();
const systemctl = (...args) => spawnSync('systemctl', ['--user', ...args], {encoding: 'utf8'});
const transient = (...args) => spawnSync('systemd-run', ['--user', '--quiet', ...args], {encoding: 'utf8'});
const unloaded = unit => show(unit, 'LoadState').LoadState !== 'loaded';
/** The claim unit a scoped guarded start takes. */
const claimOf = box => `app-verify-start-claim-${box.app}.service`;

/** The directory of the shim a guarded command runs with, which holds its call log. */
const shimDir = (box, mode) => join(box.base, `shim-${mode}`);

/**
 * The environment of a guarded command: the guard on, and a PATH whose systemctl and systemd-run are scoped to this
 * sandbox. `mode` injects a fault: `blind` (no unit listing) or `noclaim` (no claim unit).
 */
async function guarded(box, mode = 'scoped') {
  return {APP_VERIFY_SINGLE_RUN: '1', PATH: await scopeShim(shimDir(box, mode), box.app, {blind: mode === 'blind', noclaim: mode === 'noclaim'})};
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
    assert.equal(unloaded(claimOf(box)), true, 'and the start claim is given back, after a start and after a refusal');
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

test('two starts begun together cannot both pass: one runs, the other is refused, and the claim is given back', {skip, timeout: 120000}, async () => {
  const box = await sandbox();
  try {
    const env = await guarded(box);
    const both = await Promise.all([box.cli(['start', '--lease', '5'], {extraEnv: env}), box.cli(['start', '--lease', '5'], {extraEnv: env})]);
    const [won, lost] = both.sort((a, b) => a.code - b.code);
    assert.equal(won.code, 0, won.stderr);
    assert.equal(lost.code, 1, lost.stderr);
    assertRefusal(lost.result, 'run-active');
    assert.match(lost.result.detail, new RegExp(`${won.result.runId}\\b|another start is still creating a run`), 'the loser names the run, or the start still creating it');
    assert.deepEqual(await readdir(box.stateRoot), [won.result.runId], 'only the winner created a runtime directory');
    assert.deepEqual((await readdir(box.proofRoot)), [won.result.runId], 'and a proof directory');
    assert.equal(unloaded(claimOf(box)), true, 'and the claim is given back');
    assert.equal((await box.cli(['stop', won.result.runId])).code, 0);
  } finally {
    await box.close();
  }
});

test('a start whose claim is held by another start is refused and creates nothing; a start killed mid-way leaves no claim behind', {skip, timeout: 120000}, async () => {
  const box = await sandbox();
  try {
    const env = await guarded(box);
    // Another start is in flight: its claim exists and no run does yet.
    assert.equal(transient(`--unit=${claimOf(box).replace(/\.service$/, '')}`, '--collect', 'sleep', '120').status, 0);
    const refused = await box.cli(['start', '--lease', '5'], {extraEnv: env});
    assert.equal(refused.code, 1, refused.stderr);
    assertRefusal(refused.result, 'run-active');
    assert.match(refused.result.detail, /another start is still creating a run/);
    assert.equal(existsSync(box.proofRoot), false, 'a refused start creates no proof directory');
    assert.equal(existsSync(box.stateRoot), false, 'and no runtime directory');
    assert.deepEqual(units(box.app), [], 'and no unit');
    assert.equal(systemctl('stop', claimOf(box)).status, 0);
    const started = await box.cli(['start', '--lease', '5'], {extraEnv: env});
    assert.equal(started.code, 0, 'the start goes ahead once the claim is gone: ' + started.stderr);
    assert.equal((await box.cli(['stop', started.result.runId])).code, 0);

    // A claim names the process that holds it: when that process is gone, the claim goes within seconds.
    const holder = spawn('sleep', ['3'], {stdio: 'ignore'});
    const script = `import {claimStart} from ${JSON.stringify(new URL('../dist/systemd.js', import.meta.url).href)}; const first = await claimStart(${holder.pid}); const second = await claimStart(process.pid); console.log(JSON.stringify([first, second]));`;
    const claimed = spawnSync(process.execPath, ['--input-type=module', '-e', script], {env: {...process.env, PATH: env.PATH}, encoding: 'utf8'});
    const [first, second] = JSON.parse(claimed.stdout);
    assert.match(first.claimed, /^[0-9a-f]{32}$/, `the first claim names its unit's invocation: ${claimed.stdout} ${claimed.stderr}`);
    assert.equal(second, 'held');
    assert.equal(unloaded(claimOf(box)), false, 'the claim exists while its process lives');
    await until(() => unloaded(claimOf(box)), 'the claim goes when its process does', 15000);
    const later = await box.cli(['start', '--lease', '5'], {extraEnv: env});
    assert.equal(later.code, 0, 'a later guarded start goes ahead once the holder is gone: ' + later.stderr);
    assert.equal((await box.cli(['stop', later.result.runId])).code, 0);
  } finally {
    systemctl('stop', claimOf(box));
    await box.close();
  }
});

test('a start takes its claim before it reads the units', {skip, timeout: 120000}, async () => {
  const box = await sandbox();
  try {
    const env = await guarded(box);
    const started = await box.cli(['start', '--lease', '5'], {extraEnv: env});
    assert.equal(started.code, 0, started.stderr);
    // The claim comes first, so no other guarded start is between its check and its unit. Swapped, two starts begun
    // together can both read an empty host.
    const calls = await callsOf(shimDir(box, 'scoped'));
    const claimed = calls.findIndex(call => call.startsWith('systemd-run ') && call.includes(`--unit=app-verify-start-claim-${box.app} `));
    const listed = calls.findIndex(call => call.startsWith('systemctl ') && call.includes('list-units') && call.includes(`app-verify-${box.app}-*.service`));
    assert.ok(claimed >= 0 && listed >= 0, `the shim logged the claim and the unit listing:\n${calls.join('\n')}`);
    assert.ok(claimed < listed, `the claim is taken before the units are read:\n${calls.join('\n')}`);
    assert.equal((await box.cli(['stop', started.result.runId])).code, 0);
  } finally {
    await box.close();
  }
});

test('a release gives the claim back only while it is still the one that start took', {skip, timeout: 120000}, async () => {
  const box = await sandbox();
  const saved = process.env.PATH;
  try {
    const env = await guarded(box);
    // In process, so only the guard's own calls may see the shim: the test's helpers need the real systemctl.
    const withShim = async work => {
      process.env.PATH = env.PATH;
      try {
        return await work();
      } finally {
        process.env.PATH = saved;
      }
    };
    // A start that outlived the claim's RuntimeMaxSec finds another start's claim in its place: it must not stop it.
    const slot = await withShim(() => holdSingleRun());
    assert.equal(unloaded(claimOf(box)), false, 'this start holds the claim');
    assert.equal(systemctl('stop', claimOf(box)).status, 0, 'the claim expires');
    assert.equal(transient(`--unit=${claimOf(box).replace(/\.service$/, '')}`, '--collect', 'sleep', '120').status, 0, 'and another start takes it');
    const other = show(claimOf(box), 'InvocationID').InvocationID;
    await withShim(() => slot.release());
    assert.equal(show(claimOf(box), 'ActiveState').ActiveState, 'active', 'releasing the first start\'s claim leaves the other start\'s alone');
    assert.equal(show(claimOf(box), 'InvocationID').InvocationID, other);

    // Its own claim, still held, is given back.
    systemctl('stop', claimOf(box));
    const mine = await withShim(() => holdSingleRun());
    assert.equal(unloaded(claimOf(box)), false);
    await withShim(() => mine.release());
    assert.equal(unloaded(claimOf(box)), true, 'a release stops the claim that is still its own');
  } finally {
    process.env.PATH = saved;
    systemctl('stop', claimOf(box));
    await box.close();
  }
});

test('a start whose claim cannot be created goes ahead and says so', {skip, timeout: 120000}, async () => {
  const box = await sandbox();
  try {
    const started = await box.cli(['start', '--lease', '5'], {extraEnv: await guarded(box, 'noclaim')});
    assert.equal(started.code, 0, started.stderr);
    assert.match(started.stderr, /could not take the host's start claim/);
    assert.equal(started.result.state, 'running');
    assert.equal(unloaded(claimOf(box)), true, 'no claim was made');
    assert.equal((await box.cli(['stop', started.result.runId])).code, 0);
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
