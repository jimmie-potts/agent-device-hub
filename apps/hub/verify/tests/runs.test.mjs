// Hub #494: the Hub adapter through its documented wrapper against real
// transient user units. Every run uses private state and proof roots, a
// run-generated credential and the fake controllers; tests stop only the run
// ids they created. Without a user manager these tests skip with the reason.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {chmod, mkdtemp, readdir, readFile, realpath, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

/**
 * The hub's launch socket lives at <state root>/<run-id>/data/h/bunny-launch.sock and must stay under
 * 108 bytes. A long TMPDIR (such as a per-task cache path) would exceed it, so these few small files
 * then go under /tmp instead.
 */
const shortTmp = () => (tmpdir().length <= 40 ? tmpdir() : '/tmp');
import {chromium} from 'playwright';
import {validateReceipt} from '@jimmie-potts/app-verify';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const wrapper = join(root, 'scripts/verify.mjs');
const INSTALLED_PORTS = [8788, 8765, 8787, 8791, 41230, 41231];

function skipReason() {
  const state = (spawnSync('systemctl', ['--user', 'is-system-running'], {encoding: 'utf8'}).stdout ?? '').trim();
  if (['running', 'degraded', 'starting', 'initializing'].includes(state)) return undefined;
  const reason = `no systemd --user manager (is-system-running: ${state || 'no answer'})`;
  if (process.env.APP_VERIFY_REQUIRE_SYSTEMD === '1') throw new Error(`APP_VERIFY_REQUIRE_SYSTEMD=1 but ${reason}`);
  process.stderr.write(`SKIP Hub verification run tests: ${reason}. apps/hub/verify/tests/steps.test.mjs still judges every step.\n`);
  return reason;
}
const skip = skipReason();

async function roots() {
  const base = await realpath(await mkdtemp(join(shortTmp(), 'hr-')));
  const env = {...process.env, APP_VERIFY_STATE_ROOT: join(base, 's'), APP_VERIFY_PROOF_ROOT: join(base, 'p'), APP_VERIFY_WINDOWS_CHECK: 'off'};
  const outputs = [];
  const verify = (...args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrapper, ...args], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('error', reject);
    child.on('close', code => {
      outputs.push(stdout, stderr);
      const lines = stdout.trim().split('\n');
      assert.equal(lines.length, 1, 'one JSON result line on stdout');
      resolve({code, result: JSON.parse(lines[0]), stderr});
    });
  });
  const mine = new Set();
  const start = async (...args) => {
    const started = await verify('start', ...args);
    if (started.result.runId) mine.add(started.result.runId);
    return started;
  };
  const receipt = async runId => JSON.parse(await readFile(join(base, 'p', runId, 'receipt.json'), 'utf8'));
  const token = async runId => (await readFile(join(base, 's', runId, 'data/api-token'), 'utf8')).trim();
  const readerToken = async runId => (await readFile(join(base, 's', runId, 'data/reader-token'), 'utf8')).trim();
  async function close() {
    for (const runId of mine) {
      for (const unit of [`app-verify-${runId}.service`, `app-verify-${runId}-lease.timer`]) spawnSync('systemctl', ['--user', 'stop', unit]);
    }
    const left = mine.size ? spawnSync('systemctl', ['--user', 'list-units', '--all', '--plain', '--no-legend', ...[...mine].map(id => `app-verify-${id}*`)], {encoding: 'utf8'}).stdout.trim() : '';
    spawnSync('chmod', ['-R', 'u+w', base]);
    await rm(base, {recursive: true, force: true});
    assert.equal(left, '', 'no unit of these runs is left');
  }
  return {base, env, verify, start, receipt, token, readerToken, outputs, close, track: runId => mine.add(runId)};
}

async function files(directory) {
  const found = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(path));
    else found.push(path);
  }
  return found;
}

const hubJson = async (url, token, path) => (await fetch(new URL(path, url), {headers: {authorization: `Bearer ${token}`}})).json();
/** A sessions read without its read-time stamps and ages, for comparing state across time. */
const timeless = value => JSON.parse(JSON.stringify(value, (key, v) => (key === 'asOfMs' || key.endsWith('AgeMs') ? undefined : v)));

test('a Hub run starts, captures stateful proof, hands off a signed-in preview and stops, with no credential in its proof', {skip, timeout: 240000}, async () => {
  const r = await roots();
  const browser = await chromium.launch({headless: true});
  try {
    const started = await r.start('--lease', '15');
    assert.equal(started.code, 0, started.stderr);
    const {runId, url, port} = started.result;
    assert.match(runId, /^hub-\d{8}T\d{6}Z-[0-9a-f]{6}$/);
    assert.ok(!INSTALLED_PORTS.includes(port));
    const receipt = await r.receipt(runId);
    assert.deepEqual(validateReceipt(receipt), {ok: true});
    const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).stdout.trim();
    const dirty = spawnSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).stdout.trim() !== '';
    const bundle = Buffer.from(await (await fetch(new URL('/dashboard.js', url))).arrayBuffer());
    assert.deepEqual(receipt.build, {sourceRevision: head, dirty, artifactDigest: 'sha256:' + createHash('sha256').update(bundle).digest('hex'), version: JSON.parse(await readFile(join(root, 'apps/hub/package.json'), 'utf8')).version});
    assert.deepEqual(receipt.checks.map(c => [c.id, c.outcome]), [['readiness', 'passed'], ['build-current', 'passed'], ['no-installed-ports', 'passed'], ['windows-loopback', 'skipped']]);
    assert.deepEqual(receipt.components.filter(c => c.kind === 'simulated').map(c => c.id), ['wall-controller', 'pixel-controller', 'lifecycle-events']);
    // Every credential the run ever held: fresh steps and resets rotate the token.
    const secrets = new Set([await r.token(runId), await r.readerToken(runId)]);
    // Both run credentials rotate with every reseed; collect each generation.
    const collect = async id => {
      secrets.add(await r.token(id));
      secrets.add(await r.readerToken(id));
    };
    const token = await r.token(runId);
    assert.equal((await stat(join(r.base, 's', runId, 'data/api-token'))).mode & 0o777, 0o600);

    const help = await r.verify('help');
    assert.equal(help.code, 0);
    assert.deepEqual(Object.keys(help.result.scenarios).sort(), ['control-installed-links', 'control-startup-fails', 'integrated', 'lifecycle-basic', 'moments', 'pixel-offline']);
    assert.deepEqual(Object.keys(help.result.steps).sort(), ['command-reaches-fake', 'control-installed-links', 'control-missing-session', 'control-replay-after-recovery', 'control-second-owner', 'integrated-command', 'integrated-lifecycle', 'moment-blocked-on-status', 'moment-plays', 'moment-uncertain-no-replay', 'offline-recovers', 'one-owner', 'pixoo-loss', 'task-appears', 'uncertain-no-replay']);
    // Hub #495: the integrated scenario needs the paired runs' four loopback URLs, and no input is required elsewhere.
    assert.deepEqual(help.result.scenarioInputs, {integrated: ['nanoleaf-controller', 'pixoo-controller', 'nanoleaf-preview', 'pixoo-preview']});
    assert.ok(Object.values(help.result.inputs).every(input => input.required === false));

    const command = await r.verify('capture', runId, 'command-reaches-fake');
    assert.equal(command.code, 0, command.stderr);
    assert.equal(command.result.outcome, 'passed');
    await collect(runId);
    const control = await r.verify('capture', runId, 'control-missing-session');
    assert.equal(control.code, 1);
    assert.equal(control.result.outcome, 'failed');
    await collect(runId);

    const extended = await r.verify('extend', runId, '--lease', '20');
    assert.equal(extended.code, 0, extended.stderr);
    assert.equal(extended.result.leaseTimer, `app-verify-${runId}-lease-2.timer`);
    assert.equal((await r.receipt(runId)).preview.expiresAt, extended.result.expiresAt);

    const handoff = await r.verify('handoff', runId, '--reset', 'lifecycle-basic');
    assert.equal(handoff.code, 0, handoff.stderr);
    assert.equal(handoff.result.url, url, 'the preview keeps its port across the reset');
    assert.equal(handoff.result.card[0], `Preview   ${url}   run ${runId}`);
    assert.equal(handoff.result.card[3], `Extend    npm run -s verify -- extend ${runId}`);
    assert.equal(new URL(handoff.result.url).search + new URL(handoff.result.url).hash, '', 'the preview URL carries no code or token');
    assert.equal(handoff.result.proofUrls.length, 3, 'only the passed capture is linked');
    for (const proof of handoff.result.proofUrls) {
      assert.equal(new URL(proof.url).origin, new URL(url).origin);
      const response = await fetch(proof.url);
      assert.equal(response.status, 200, proof.path);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(r.base, 'p', runId, proof.path)));
    }
    const repeated = await r.verify('handoff', runId);
    assert.deepEqual(repeated.result.proofUrls, handoff.result.proofUrls);
    const resetToken = await r.token(runId);
    assert.notEqual(resetToken, token, 'the reset seeds a new run-generated credential');
    await collect(runId);

    // The owner's view: a fresh browser opens the card's URL and is signed in by trusted-loopback.
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    const page = await context.newPage();
    await page.goto(handoff.result.url);
    await page.getByText('Control enabled · Local', {exact: true}).waitFor();
    await page.getByRole('heading', {name: 'Build the integration', exact: true}).waitFor();
    await page.getByRole('link', {name: 'pixel pixoo', exact: true}).click();
    await page.getByLabel('Brightness (%)').filter({visible: true}).waitFor();
    await context.close();
    const {port: controlPort} = JSON.parse(await readFile(join(r.base, 's', runId, 'data/control.json'), 'utf8'));
    const commands = await (await fetch(`http://127.0.0.1:${controlPort}/commands`, {headers: {authorization: `Bearer ${resetToken}`}})).json();
    assert.deepEqual(commands, [], 'exploring the reset preview sent no command');

    const doctor = await r.verify('doctor', runId);
    const [row] = doctor.result.runs;
    assert.equal(row.state, 'running');
    assert.equal(row.proof.sums, 'ok');
    assert.equal(row.listener.outcome, 'matches', 'the hub listens on the recorded port');
    assert.ok(row.listener.ports.length >= 4, 'the unit also holds the fake controllers and the control listener, all inside its cgroup');
    assert.deepEqual(row.checks.map(c => c.outcome), ['passed', 'passed']);

    // restart: a new run naming its predecessor, same candidate unless the tree changed meanwhile.
    const restarted = await r.verify('restart', runId);
    assert.equal(restarted.code, 0, restarted.stderr);
    r.track(restarted.result.runId);
    assert.equal(restarted.result.restarts, runId);
    assert.equal(restarted.result.continuity, dirty ? 'different-candidate' : 'same-candidate');
    assert.equal((await r.receipt(restarted.result.runId)).restarts, runId);
    assert.equal((await r.receipt(runId)).state, 'stopped');
    assert.equal(existsSync(join(r.base, 's', runId)), false, 'the runtime directory and its credentials are gone');
    assert.ok(existsSync(join(r.base, 'p', runId, 'verified/SHA256SUMS')), 'the frozen proof survives the runtime cleanup');
    await assert.rejects(fetch(handoff.result.proofUrls[0].url), 'the old listener no longer serves proof');
    await collect(restarted.result.runId);
    const stopped = await r.verify('stop', restarted.result.runId);
    assert.equal(stopped.result.cleanup.result, 'clean');

    // No run credential appears in any proof file or in anything an operation printed.
    for (const id of [runId, restarted.result.runId]) {
      for (const file of await files(join(r.base, 'p', id))) {
        const bytes = await readFile(file).catch(async error => {
          if (error.code !== 'EACCES') throw error;
          await chmod(file, 0o400);
          return readFile(file);
        });
        for (const secret of secrets) assert.equal(bytes.includes(secret), false, `${file} holds no credential`);
      }
    }
    for (const output of r.outputs) for (const secret of secrets) assert.equal(output.includes(secret), false, 'no operation printed a credential');
    // Four credential generations (start, the fresh command step, the reset, the restarted run), two tokens each.
    assert.equal(secrets.size, 8, 'the rotated API and reader tokens were all collected');
  } finally {
    await browser.close();
    await r.close();
  }
});

test('frozen proof URLs close at lease expiry while local proof remains', {skip, timeout: 90000}, async () => {
  const r = await roots();
  try {
    const started = await r.start('--lease', '5');
    assert.equal(started.code, 0, started.stderr);
    const {runId} = started.result;
    const captured = await r.verify('capture', runId, 'task-appears');
    assert.equal(captured.code, 0, captured.stderr);
    const handed = await r.verify('handoff', runId);
    assert.equal(handed.code, 0, handed.stderr);
    const proof = handed.result.proofUrls.find(p => p.path.endsWith('/after.png'));
    const bytes = Buffer.from(await (await fetch(proof.url)).arrayBuffer());
    const extended = await r.verify('extend', runId, '--lease', '0.05');
    assert.equal(extended.code, 0, extended.stderr);
    const deadline = Date.parse(extended.result.expiresAt) + 12000;
    let refused = false;
    while (Date.now() < deadline) {
      try {await (await fetch(proof.url)).arrayBuffer();} catch {refused = true; break;}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(refused, true, 'lease expiry removes the proof listener');
    assert.deepEqual(await readFile(join(r.base, 'p', runId, proof.path)), bytes);
    const stopped = await r.verify('stop', runId);
    assert.equal(stopped.result.state, 'expired');
    assert.equal(stopped.result.cleanup.result, 'clean');
  } finally {await r.close();}
});

test('two Hub runs share nothing, and reseeding one leaves the other unchanged', {skip, timeout: 180000}, async () => {
  const r = await roots();
  try {
    const [a, b] = await Promise.all([r.start('--lease', '15'), r.start('--lease', '15')]);
    assert.equal(a.code, 0, a.stderr);
    assert.equal(b.code, 0, b.stderr);
    assert.notEqual(a.result.port, b.result.port);
    // Both runs receive the same question; only the reseeded one loses it.
    const ask = async runId => {
      const token = await r.token(runId);
      const {port} = JSON.parse(await readFile(join(r.base, 's', runId, 'data/control.json'), 'utf8'));
      const response = await fetch(`http://127.0.0.1:${port}/event`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify({kind: 'question.continuing'})});
      assert.equal(response.status, 200);
    };
    await ask(a.result.runId);
    await ask(b.result.runId);
    const tokenB = await r.token(b.result.runId);
    const before = timeless(await hubJson(b.result.url, tokenB, '/api/monitor/v1/sessions'));
    const identityB = (await r.receipt(b.result.runId)).owned;

    const reseeded = await r.verify('scenario', a.result.runId, 'lifecycle-basic');
    assert.equal(reseeded.code, 0, reseeded.stderr);
    assert.equal(reseeded.result.port, a.result.port);
    assert.deepEqual(timeless(await hubJson(b.result.url, tokenB, '/api/monitor/v1/sessions')), before, 'the other run keeps its sessions');
    assert.deepEqual((await r.receipt(b.result.runId)).owned, identityB, 'the other run keeps its process and lease');
    const tokenA = await r.token(a.result.runId);
    const sessionsA = JSON.stringify(await hubJson(a.result.url, tokenA, '/api/monitor/v1/sessions'));
    assert.match(sessionsA, /Build the integration/, 'the reseeded run serves its scenario');
    assert.doesNotMatch(sessionsA, /"question"/, 'the reseeded run starts from the scenario again');
    assert.match(JSON.stringify(before), /"question"/, 'the other run still has its question');
    for (const run of [a, b]) assert.equal((await r.verify('stop', run.result.runId)).code, 0);
  } finally {
    await r.close();
  }
});

test('a Hub that refuses to start leaves no unit, timer or runtime directory and a failed receipt', {skip, timeout: 120000}, async () => {
  const r = await roots();
  try {
    const failed = await r.start('--scenario', 'control-startup-fails');
    assert.equal(failed.code, 1);
    assert.equal(failed.result.state, 'failed');
    assert.equal(failed.result.cause, 'unit-exited');
    assert.match(failed.result.detail, /; app: hub-start-failed: invalid-configuration$/, 'the hub\'s own stable cause is recorded');
    assert.equal(failed.result.cleanup.result, 'clean');
    const {runId} = failed.result;
    assert.equal(existsSync(join(r.base, 's', runId)), false);
    const [row] = (await r.verify('doctor', runId)).result.runs;
    assert.equal(row.state, 'failed');
    assert.equal(row.failure.cause, 'unit-exited');
  } finally {
    await r.close();
  }
});

test('a Hub run outlives the process tree and scope that started it', {skip, timeout: 120000}, async () => {
  const r = await roots();
  const scope = `hv-session-${randomBytes(3).toString('hex')}.scope`;
  const out = join(r.base, 'start.json');
  try {
    // The scope stands in for an agent session: the wrapper runs inside it, and then the whole scope is stopped.
    const session = spawn('systemd-run', ['--user', '--scope', `--unit=${scope}`, '--collect', '--quiet', '--', '/bin/sh', '-c', `"$0" "$1" start --lease 10 > "$2"; exec sleep 300`, process.execPath, wrapper, out], {cwd: root, env: r.env, stdio: 'ignore'});
    const deadline = Date.now() + 60000;
    while (!(existsSync(out) && (await readFile(out, 'utf8')).includes('\n'))) {
      if (Date.now() > deadline) throw new Error('start inside the scope did not finish');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const started = JSON.parse(await readFile(out, 'utf8'));
    r.track(started.runId);
    assert.equal(started.state, 'running');
    spawnSync('systemctl', ['--user', 'stop', scope]);
    await new Promise(resolve => (session.exitCode !== null ? resolve() : session.once('exit', resolve)));
    const cgroup = spawnSync('systemctl', ['--user', 'show', `app-verify-${started.runId}.service`, '-p', 'ControlGroup', '--value'], {encoding: 'utf8'}).stdout.trim();
    assert.match(cgroup, /\/user@\d+\.service\/app\.slice\/app-verify-/, 'the unit belongs to the user manager, not the caller');
    const [row] = (await r.verify('doctor', started.runId)).result.runs;
    assert.equal(row.state, 'running', 'the run keeps serving after its starting scope ended');
    assert.equal(row.health.outcome, 'passed');
    assert.equal((await r.verify('stop', started.runId)).code, 0);
  } finally {
    spawnSync('systemctl', ['--user', 'stop', scope]);
    const runId = existsSync(out) ? JSON.parse((await readFile(out, 'utf8')) || '{}').runId : undefined;
    if (runId) spawnSync('systemctl', ['--user', 'stop', `app-verify-${runId}.service`, `app-verify-${runId}-lease.timer`]);
    await r.close();
  }
});
