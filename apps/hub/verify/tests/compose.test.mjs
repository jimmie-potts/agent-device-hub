// Hub #495: the composition orchestrator against real transient user units.
// The Hub is this checkout's real adapter, running the real hub CLI in its
// integrated scenario; the two consumers are stand-in adapters
// (fixture-consumer.mjs) in disposable pinned Git checkouts, started through
// their own wrappers exactly as the real Nanoleaf and Pixoo adapters are.
// Every run uses private roots, and each test stops only what it created.
// Without a user manager these tests skip with the reason.
import assert from 'node:assert/strict';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../..', import.meta.url)).replace(/\/$/, '');
const compose = join(root, 'apps/hub/verify/compose.mjs');
const shortTmp = () => (tmpdir().length <= 40 ? tmpdir() : '/tmp');

function skipReason() {
  const state = (spawnSync('systemctl', ['--user', 'is-system-running'], {encoding: 'utf8'}).stdout ?? '').trim();
  if (['running', 'degraded', 'starting', 'initializing'].includes(state)) return undefined;
  const reason = `no systemd --user manager (is-system-running: ${state || 'no answer'})`;
  if (process.env.APP_VERIFY_REQUIRE_SYSTEMD === '1') throw new Error(`APP_VERIFY_REQUIRE_SYSTEMD=1 but ${reason}`);
  process.stderr.write(`SKIP Hub composition tests: ${reason}.\n`);
  return reason;
}
const skip = skipReason();
const hubClean = () => execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).trim() === '';

/** A disposable Git checkout whose wrapper runs the stand-in consumer adapter. */
async function standIn(base, name, {kind, app, fault}) {
  const checkout = join(base, name);
  await mkdir(join(checkout, 'scripts'), {recursive: true});
  await writeFile(join(checkout, 'served.txt'), `stand-in ${kind}\n`);
  await writeFile(join(checkout, 'scripts/verify.mjs'), [
    `import {runCli} from ${JSON.stringify(join(root, 'packages/app-verify/dist/index.js'))};`,
    `import {createPlugin} from ${JSON.stringify(join(root, 'apps/hub/verify/tests/fixture-consumer.mjs'))};`,
    `process.exitCode = await runCli(createPlugin(${JSON.stringify({root: checkout, kind, app, ...(fault ? {fault} : {})})}), process.argv.slice(2));`,
  ].join('\n') + '\n');
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], {encoding: 'utf8'});
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Stand-in', '-c', 'user.email=stand-in@example.invalid', 'commit', '-q', '-m', 'stand-in');
  return {checkout, revision: git('rev-parse', 'HEAD').trim(), git};
}

/** A test world: private roots, stand-in checkouts, a manifest and the compose CLI. */
async function world({faults = {}} = {}) {
  const base = await realpath(await mkdtemp(join(shortTmp(), 'hc-')));
  const tag = `c${Math.random().toString(16).slice(2, 7)}`;
  const env = {...process.env, APP_VERIFY_STATE_ROOT: join(base, 's'), APP_VERIFY_PROOF_ROOT: join(base, 'p'), APP_VERIFY_WINDOWS_CHECK: 'off'};
  const nanoleaf = await standIn(base, 'nl', {kind: 'nanoleaf', app: `${tag}-nl`, fault: faults.nanoleaf});
  const pixoo = await standIn(base, 'px', {kind: 'pixoo', app: `${tag}-px`, fault: faults.pixoo});
  const manifest = join(base, 'compose.json');
  const service = (id, app, revision) => ({id, role: 'consumer', app, repository: `stand-in/${id}`, revision, coreVersion: '1.1.0', scenario: 'hub-paired', run: [process.execPath, 'scripts/verify.mjs']});
  const writeManifest = pins => writeFile(manifest, JSON.stringify({manifestVersion: 'hub-compose/1', services: [
    service('nanoleaf', `${tag}-nl`, pins?.nanoleaf ?? nanoleaf.revision),
    service('pixoo', `${tag}-px`, pins?.pixoo ?? pixoo.revision),
    {id: 'hub', role: 'owner', app: 'hub', repository: 'jimmie-potts/agent-device-hub', revision: 'self', coreVersion: '1.1.0', scenario: 'integrated', run: [process.execPath, 'scripts/verify.mjs']},
  ]}));
  await writeManifest();
  const outputs = [];
  const run = (...args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [compose, ...args], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('error', reject);
    child.on('close', code => {
      outputs.push(stdout, stderr);
      const lines = stdout.trim().split('\n');
      assert.equal(lines.length, 1, `one JSON result line on stdout, saw: ${stdout}\n${stderr.slice(-2000)}`);
      resolve({code, result: JSON.parse(lines[0]), stderr});
    });
  });
  const start = (...extra) => run('start', '--manifest', manifest, '--checkout', `nanoleaf=${nanoleaf.checkout}`, '--checkout', `pixoo=${pixoo.checkout}`, ...(extra.includes('--lease') ? [] : ['--lease', '10']), ...(hubClean() ? [] : ['--unpinned']), ...extra);
  const composition = async id => JSON.parse(await readFile(join(base, 'p', id, 'composition.json'), 'utf8'));
  const events = async id => (await readFile(join(base, 'p', id, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const units = () => spawnSync('systemctl', ['--user', 'list-units', '--all', '--plain', '--no-legend', `app-verify-${tag}-*`], {encoding: 'utf8'}).stdout.trim();
  const hubRuns = new Set();
  async function close() {
    // Every Hub run this world's compositions recorded, and every stand-in unit by its unique app name.
    for (const name of existsSync(join(base, 'p')) ? await readdir(join(base, 'p')) : []) {
      if (!name.startsWith('compose-')) continue;
      for (const s of (await composition(name).catch(() => ({services: []}))).services) if (s.runId) hubRuns.add(s.runId);
    }
    for (const runId of hubRuns) for (const unit of [`app-verify-${runId}.service`, `app-verify-${runId}-lease.timer`]) {
      spawnSync('systemctl', ['--user', 'thaw', unit]);
      spawnSync('systemctl', ['--user', 'stop', unit]);
    }
    const left = units();
    spawnSync('chmod', ['-R', 'u+w', base]);
    await rm(base, {recursive: true, force: true});
    assert.equal(left, '', 'no stand-in unit is left');
  }
  return {base, tag, env, nanoleaf, pixoo, manifest, writeManifest, run, start, composition, events, units, outputs, close};
}

/** Tokens written for pairing, from each run's runtime directory. */
async function pairingTokens(w, c) {
  const tokens = [];
  for (const s of c.services) {
    const dir = join(w.base, 's', s.runId);
    if (!existsSync(dir)) continue;
    for (const name of await readdir(dir)) if (name.endsWith('-token')) tokens.push((await readFile(join(dir, name), 'utf8')).trim());
  }
  return tokens;
}

test('a pin mismatch or a dirty checkout fails identity-mismatch before anything is created', {skip, timeout: 120000}, async () => {
  const w = await world();
  try {
    const first = w.nanoleaf.revision;
    await writeFile(join(w.nanoleaf.checkout, 'served.txt'), 'moved on\n');
    w.nanoleaf.git('-c', 'user.name=Stand-in', '-c', 'user.email=stand-in@example.invalid', 'commit', '-q', '-am', 'moved');
    await w.writeManifest({nanoleaf: first});
    const moved = await w.run('start', '--manifest', w.manifest, '--checkout', `nanoleaf=${w.nanoleaf.checkout}`, '--checkout', `pixoo=${w.pixoo.checkout}`);
    assert.equal(moved.code, 1);
    assert.equal(moved.result.error, 'identity-mismatch');
    assert.match(moved.result.detail, /nanoleaf at [0-9a-f]{12}, pinned [0-9a-f]{12}/);
    await w.writeManifest();
    await writeFile(join(w.pixoo.checkout, 'served.txt'), 'uncommitted\n');
    const dirty = await w.run('start', '--manifest', w.manifest, '--checkout', `nanoleaf=${w.nanoleaf.checkout}`, '--checkout', `pixoo=${w.pixoo.checkout}`);
    assert.equal(dirty.code, 1);
    assert.equal(dirty.result.error, 'identity-mismatch');
    assert.match(dirty.result.detail, /pixoo at [0-9a-f]{12} with tracked changes/);
    assert.equal(existsSync(join(w.base, 'p')) && (await readdir(join(w.base, 'p'))).length > 0, false, 'no composition or proof was created');
    assert.equal(existsSync(join(w.base, 's')), false, 'no runtime directory was created');
    assert.equal(w.units(), '', 'no unit was started');
  } finally {
    await w.close();
  }
});

test('a composition pairs three runs, is ready across the boundaries, survives a consumer loss without replay, and stops the Hub first', {skip, timeout: 480000}, async () => {
  const w = await world();
  try {
    const started = await w.start();
    assert.equal(started.code, 0, JSON.stringify(started.result));
    const id = started.result.compositionId;
    assert.equal(started.result.state, 'running');
    assert.equal(started.result.pinned, hubClean(), 'pinned only when every checkout is clean at its pin');
    let c = await w.composition(id);
    assert.deepEqual(c.services.map(s => [s.id, s.state, s.scenario]), [['nanoleaf', 'running', 'hub-paired'], ['pixoo', 'running', 'hub-paired'], ['hub', 'running', 'integrated']]);
    for (const s of c.services) assert.match(s.runId, new RegExp(`^${s.app}-\\d{8}T\\d{6}Z-[0-9a-f]{6}$`));
    assert.deepEqual(c.readiness.checks.filter(k => k.outcome !== 'passed'), []);
    assert.ok(['hub-owner', 'hub-reads-nanoleaf', 'hub-reads-pixoo', 'nanoleaf-feed-current', 'pixoo-feed-current', 'hub-devices-current', 'nanoleaf-run', 'pixoo-run', 'hub-run'].every(k => c.readiness.checks.some(x => x.id === k)));
    // Each run id was recorded before the next service started.
    const events = await w.events(id);
    const order = events.filter(e => ['run-recorded', 'service-starting'].includes(e.event)).map(e => `${e.event}:${e.service}`);
    assert.deepEqual(order, ['service-starting:nanoleaf', 'run-recorded:nanoleaf', 'service-starting:pixoo', 'run-recorded:pixoo', 'service-starting:hub', 'run-recorded:hub']);
    // The Hub runs the real CLI, pointing Places at the paired wall run, and each consumer announced its controller.
    const hubRun = c.services.find(s => s.id === 'hub');
    const token = (await readFile(join(w.base, 's', hubRun.runId, 'data/api-token'), 'utf8')).trim();
    const context = await (await fetch(new URL('/api/dashboard/v1/context', hubRun.url), {headers: {authorization: `Bearer ${token}`}})).json();
    assert.deepEqual(context.places, {wall: c.services[0].url});
    assert.deepEqual(context.components.map(x => x.id), ['wall', 'pixel']);
    for (const consumer of c.services.slice(0, 2)) assert.match(consumer.endpoints.controller, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const host = JSON.parse(await readFile(join(w.base, 's', hubRun.runId, 'data/host.json'), 'utf8'));
    assert.deepEqual(host.controllers.map(x => x.endpoint), c.services.slice(0, 2).map(s => `${s.endpoints.controller}controller/v1`));
    for (const s of c.services) {
      for (const name of await readdir(join(w.base, 's', s.runId))) if (name.endsWith('-token')) assert.equal((await stat(join(w.base, 's', s.runId, name))).mode & 0o777, 0o600, name);
    }
    const tokens = await pairingTokens(w, c);
    assert.equal(tokens.length, 2 * 2 + 2 * 2, 'two files per consumer and two per consumer on the Hub');

    const doctor = await w.run('doctor', id);
    assert.equal(doctor.code, 0, JSON.stringify(doctor.result.checks?.filter(k => k.outcome !== 'passed')));
    const listed = await w.run('doctor');
    assert.deepEqual(listed.result.compositions.map(x => [x.compositionId, x.state]), [[id, 'running']]);

    // Consumer loss and recovery through the Hub's real controller client, then the replay control.
    const loss = await w.run('inject', id, 'consumer-loss', 'pixoo');
    assert.equal(loss.code, 0, JSON.stringify(loss.result));
    assert.equal(loss.result.outcome, 'passed');
    assert.ok(loss.result.frozenAt && loss.result.thawedAt && loss.result.thawedBy === 'step');
    const attachment = JSON.parse(await readFile(join(loss.result.capture.captureDir, 'loss-command.json'), 'utf8'));
    assert.ok([0, 1].includes(attachment.deliveredAtWriter));
    assert.equal(attachment.hubOutcome, 'uncertain-result');
    const replay = await w.run('inject', id, 'consumer-loss', 'pixoo', '--step', 'control-replay-after-recovery');
    assert.equal(replay.code, 1, 'the replay control must fail');
    assert.match(replay.result.capture.reason, /^assertion failed: recovery replayed nothing/);
    assert.equal(spawnSync('systemctl', ['--user', 'show', `app-verify-${c.services[1].runId}.service`, '-p', 'FreezerState', '--value'], {encoding: 'utf8'}).stdout.trim(), 'running', 'the orchestrator always thaws');
    const owner = await w.run('capture', id, 'control-second-owner');
    assert.equal(owner.code, 1, 'the second-owner control must fail');
    assert.match(owner.result.reason, /^assertion failed: the Pixoo Monitor lists a session the Hub never saw/);

    // Extend and handoff apply to all three runs.
    const before = (await w.composition(id)).services.map(s => s.expiresAt);
    const extended = await w.run('extend', id, '--lease', '15');
    assert.equal(extended.code, 0, JSON.stringify(extended.result));
    assert.equal(extended.result.services.filter(s => s.ok).length, 3);
    c = await w.composition(id);
    c.services.forEach((s, i) => assert.ok(s.expiresAt > before[i], `${s.id} lease moved`));
    const handed = await w.run('handoff', id);
    assert.equal(handed.code, 0, JSON.stringify(handed.result));
    assert.equal(handed.result.services.filter(s => s.frozenAt).length, 3);

    // No pairing credential appears in any output or composition record.
    const record = await readFile(join(w.base, 'p', id, 'composition.json'), 'utf8') + await readFile(join(w.base, 'p', id, 'events.jsonl'), 'utf8');
    for (const secret of [...tokens, token]) {
      assert.equal(record.includes(secret), false, 'no credential in the composition record');
      assert.equal(w.outputs.some(o => o.includes(secret)), false, 'no credential in any output');
    }

    // A unit left frozen, as by an interrupted injection, shows in doctor, and stop thaws it before stopping.
    const pixooUnit = `app-verify-${c.services[1].runId}.service`;
    spawnSync('systemctl', ['--user', 'freeze', pixooUnit]);
    const frozen = await w.run('doctor', id);
    assert.equal(frozen.code, 1);
    assert.ok(frozen.result.checks.some(k => k.id === 'pixoo-frozen' && k.outcome === 'failed'), JSON.stringify(frozen.result.checks));

    const stopped = await w.run('stop', id);
    assert.equal(stopped.code, 0, JSON.stringify(stopped.result));
    assert.deepEqual(stopped.result.cleanup.services.map(s => [s.id, s.result]), [['hub', 'clean'], ['pixoo', 'clean'], ['nanoleaf', 'clean']]);
    assert.match(w.outputs.at(-1), /thawed app-verify-.+ before stopping it/);
    const stops = (await w.events(id)).filter(e => e.event === 'service-stopped').map(e => e.service);
    assert.deepEqual(stops, ['hub', 'pixoo', 'nanoleaf'], 'the Hub stops first, then the consumers');
    for (const s of c.services) assert.equal(existsSync(join(w.base, 's', s.runId)), false, `${s.id} runtime directory removed`);
    const again = await w.run('stop', id);
    assert.equal(again.result.repeated, true);
  } finally {
    await w.close();
  }
});

test('a partial start stops only the recorded runs, in reverse order, and reports each cleanup', {skip, timeout: 240000}, async () => {
  const failed = await world({faults: {pixoo: 'start-fails'}});
  try {
    const result = await failed.start();
    assert.equal(result.code, 1);
    assert.equal(result.result.state, 'failed');
    assert.equal(result.result.cause, 'service-start-failed');
    assert.equal(result.result.service, 'pixoo');
    assert.match(result.result.detail, /stand-in-start-failed|unit-exited|readiness/);
    assert.deepEqual(result.result.cleanup.services.map(s => [s.id, s.result]), [['hub', 'none'], ['pixoo', 'clean'], ['nanoleaf', 'clean']]);
    const c = await failed.composition(result.result.compositionId);
    assert.equal(c.services.find(s => s.id === 'hub').runId, null, 'the Hub never started');
    assert.equal(failed.units(), '');
  } finally {
    await failed.close();
  }
  const unpaired = await world({faults: {pixoo: 'no-controller'}});
  try {
    const result = await unpaired.start();
    assert.equal(result.code, 1);
    assert.equal(result.result.cause, 'pairing-failed');
    assert.equal(result.result.service, 'pixoo');
    assert.deepEqual(result.result.cleanup.services.map(s => [s.id, s.result]), [['hub', 'clean'], ['pixoo', 'clean'], ['nanoleaf', 'clean']]);
    const stops = (await unpaired.events(result.result.compositionId)).filter(e => e.event === 'service-stopped').map(e => e.service);
    assert.deepEqual(stops, ['hub', 'pixoo', 'nanoleaf']);
  } finally {
    await unpaired.close();
  }
});

test('an installed port announced during pairing fails the start and cleans up', {skip, timeout: 240000}, async () => {
  const w = await world({faults: {nanoleaf: 'installed-endpoint'}});
  try {
    const result = await w.start();
    assert.equal(result.code, 1);
    assert.equal(result.result.cause, 'pairing-failed');
    assert.equal(result.result.service, 'nanoleaf');
    assert.match(result.result.detail, /port-reserved|reset-failed/);
    assert.ok(result.result.cleanup.services.every(s => ['clean', 'none'].includes(s.result)), JSON.stringify(result.result.cleanup));
    assert.equal(w.units(), '');
  } finally {
    await w.close();
  }
});

test('readiness fails truthfully when a consumer never reads the Hub feed', {skip, timeout: 240000}, async () => {
  const w = await world({faults: {pixoo: 'no-feed'}});
  try {
    const result = await w.start();
    assert.equal(result.code, 1);
    assert.equal(result.result.cause, 'readiness-timeout');
    assert.match(result.result.detail, /pixoo-feed-current: feed unavailable/);
    const c = await w.composition(result.result.compositionId);
    assert.equal(c.readiness.outcome, 'failed');
    assert.ok(c.readiness.checks.some(k => k.id === 'nanoleaf-feed-current' && k.outcome === 'passed'), 'the healthy consumer is reported healthy');
    assert.equal(w.units(), '');
  } finally {
    await w.close();
  }
});

test('a crashed consumer fails doctor, and stop continues past a service it cannot stop', {skip, timeout: 300000}, async () => {
  const w = await world();
  try {
    const started = await w.start();
    assert.equal(started.code, 0, JSON.stringify(started.result));
    const id = started.result.compositionId;
    const c = await w.composition(id);
    const pixooUnit = `app-verify-${c.services[1].runId}.service`;
    spawnSync('systemctl', ['--user', 'kill', '--signal=SIGKILL', pixooUnit]);
    const doctor = await w.run('doctor', id);
    assert.equal(doctor.code, 1);
    assert.equal(doctor.result.state, 'degraded');
    const failing = doctor.result.checks.filter(k => k.outcome !== 'passed').map(k => k.id);
    for (const check of ['hub-reads-pixoo', 'pixoo-feed-current', 'pixoo-run']) assert.ok(failing.includes(check), `${check} fails: ${failing}`);
    assert.ok(!failing.includes('nanoleaf-run') && !failing.includes('nanoleaf-feed-current'), 'the healthy consumer stays healthy');
    // The wall's wrapper disappears: stop still stops the others and names what it could not.
    await rm(join(w.nanoleaf.checkout, 'scripts/verify.mjs'));
    const stopped = await w.run('stop', id);
    assert.equal(stopped.code, 1);
    const byId = Object.fromEntries(stopped.result.cleanup.services.map(s => [s.id, s.result]));
    assert.equal(byId.hub, 'clean');
    assert.ok(['clean', 'partial'].includes(byId.pixoo), `pixoo ${byId.pixoo}`);
    assert.equal(byId.nanoleaf, 'unknown');
    spawnSync('systemctl', ['--user', 'stop', `app-verify-${c.services[0].runId}.service`, `app-verify-${c.services[0].runId}-lease.timer`]);
  } finally {
    await w.close();
  }
});

test('an expired composition reports expired, stops with each run expired, and restarts as a new linked composition', {skip, timeout: 300000}, async () => {
  const w = await world();
  try {
    const started = await w.start('--lease', '0.6');
    assert.equal(started.code, 0, JSON.stringify(started.result));
    const id = started.result.compositionId;
    const deadline = Date.now() + 90000;
    let doctor;
    do {
      await new Promise(resolve => setTimeout(resolve, 3000));
      doctor = await w.run('doctor', id);
    } while (doctor.result.state !== 'expired' && Date.now() < deadline);
    assert.equal(doctor.code, 1);
    assert.equal(doctor.result.state, 'expired', JSON.stringify(doctor.result.runs));
    assert.deepEqual(Object.values(doctor.result.runs), ['expired', 'expired', 'expired']);
    const stopped = await w.run('stop', id);
    assert.equal(stopped.code, 0, JSON.stringify(stopped.result));
    assert.deepEqual(stopped.result.cleanup.services.map(s => [s.id, s.state]), [['hub', 'expired'], ['pixoo', 'expired'], ['nanoleaf', 'expired']]);
    const refused = await w.start('--restarts', `compose-20260101T000000Z-000000`);
    assert.equal(refused.code, 1);
    assert.equal(refused.result.error, 'unknown-composition');
    const restarted = await w.start('--restarts', id);
    assert.equal(restarted.code, 0, JSON.stringify(restarted.result));
    assert.equal(restarted.result.restarts, id);
    assert.equal(restarted.result.continuity, hubClean() ? 'same-candidate' : 'different-candidate');
    assert.notEqual(restarted.result.compositionId, id);
    const running = await w.run('start', '--manifest', w.manifest, '--checkout', `nanoleaf=${w.nanoleaf.checkout}`, '--checkout', `pixoo=${w.pixoo.checkout}`, '--unpinned', '--restarts', restarted.result.compositionId);
    assert.equal(running.code, 2, 'a running composition must be stopped before it restarts');
    assert.equal((await w.run('stop', restarted.result.compositionId)).code, 0);
  } finally {
    await w.close();
  }
});

test('the Hub cannot start directly in integrated: its pairing credentials exist only after a start', {skip, timeout: 120000}, async () => {
  const base = await realpath(await mkdtemp(join(shortTmp(), 'hc-')));
  const env = {...process.env, APP_VERIFY_STATE_ROOT: join(base, 's'), APP_VERIFY_PROOF_ROOT: join(base, 'p'), APP_VERIFY_WINDOWS_CHECK: 'off'};
  let runId;
  try {
    const url = 'http://127.0.0.1:9/';
    const child = spawnSync(process.execPath, [join(root, 'scripts/verify.mjs'), 'start', '--scenario', 'integrated', '--lease', '5', ...['nanoleaf-controller', 'nanoleaf-preview', 'pixoo-controller', 'pixoo-preview'].flatMap(name => ['--input', `${name}=${url}`])], {cwd: root, env, encoding: 'utf8'});
    const result = JSON.parse(child.stdout.trim());
    runId = result.runId;
    assert.equal(child.status, 1);
    assert.equal(result.cause, 'seed-failed');
    assert.match(result.detail, /pairing credential nanoleaf-feed-token is missing; write the pairing files before reseeding integrated/);
    assert.equal(result.cleanup.result, 'clean');
    const missing = spawnSync(process.execPath, [join(root, 'scripts/verify.mjs'), 'start', '--scenario', 'integrated'], {cwd: root, env, encoding: 'utf8'});
    assert.equal(missing.status, 2, 'the scenario requires the paired runs\' URLs');
    assert.match(JSON.parse(missing.stdout.trim()).detail, /scenario integrated requires input nanoleaf-controller/);
  } finally {
    if (runId) for (const unit of [`app-verify-${runId}.service`, `app-verify-${runId}-lease.timer`]) spawnSync('systemctl', ['--user', 'stop', unit]);
    await rm(base, {recursive: true, force: true});
  }
});
