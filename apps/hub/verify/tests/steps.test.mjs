// Hub #494: the Hub capture steps judged without a supervisor, so they also run
// on CI hosts without systemd --user. Each step gets its own freshly seeded hub
// (serve.mjs started directly), because state persists within one process.
// The reference steps pass on the correct app and fail, at their own
// assertions, on each known-broken behavior serve.mjs can seed.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {runCaptureStep} from '@jimmie-potts/app-verify';
import plugin from '../plugin.mjs';

/**
 * The hub's launch socket lives at <state root>/<run-id>/data/h/bunny-launch.sock and must stay under
 * 108 bytes. A long TMPDIR (such as a per-task cache path) would exceed it, so these few small files
 * then go under /tmp instead.
 */
const shortTmp = () => (tmpdir().length <= 40 ? tmpdir() : '/tmp');

const serve = fileURLToPath(new URL('../serve.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../../..', import.meta.url));

/** Seed a scenario with the plug-in's own seed, optionally add a fault, and start the hub process on 127.0.0.1:0. */
async function started(base, name, scenario, fault) {
  const runtimeDir = join(base, name), dataDir = join(runtimeDir, 'data');
  await mkdir(dataDir, {recursive: true, mode: 0o700});
  await plugin.scenarios[scenario].seed({runId: `hub-unmanaged-${name}`, root, runtimeDir, dataDir, scenario});
  if (fault) {
    const seeded = JSON.parse(await readFile(join(dataDir, 'scenario.json'), 'utf8'));
    await writeFile(join(dataDir, 'scenario.json'), JSON.stringify({...seeded, fault}), {mode: 0o600});
  }
  const child = spawn(process.execPath, [serve, '--data', dataDir, '--port', '0'], {cwd: root, env: {...process.env, TMPDIR: join(runtimeDir)}, stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.on('data', chunk => (stderr += chunk));
  const url = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', chunk => {
      text += chunk;
      const line = text.split('\n').find(l => l.startsWith('{'));
      if (line) resolve(JSON.parse(line).url);
    });
    child.on('exit', code => reject(new Error(`serve exited ${code}: ${stderr}`)));
  });
  return {url, dataDir, runtimeDir, stop: () => new Promise(resolve => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
  })};
}

let runs = 0;
const judged = [];
async function judge(base, step, scenario, fault) {
  // Short directory names keep the hub's Unix socket path under 108 bytes.
  const app = await started(base, `r${++runs}`, scenario, fault);
  try {
    const result = await runCaptureStep(plugin, step, {url: app.url, outputDir: join(base, `o${runs}`), scenario, dataDir: app.dataDir, runtimeDir: app.runtimeDir});
    // Every token the run held, including any a later reseed rotated, is checked against its log.
    const tokens = [await readFile(join(app.dataDir, 'api-token'), 'utf8'), await readFile(join(app.dataDir, 'reader-token'), 'utf8')];
    judged.push({step, result, tokens});
    return result;
  } finally {
    await app.stop();
  }
}

const assertFailedAt = (result, assertion, why) => {
  assert.equal(result.outcome, 'failed', why);
  assert.ok(result.reason.startsWith(`assertion failed: ${assertion}`), `${why}: failed at "${assertion}", not "${result.reason}"`);
};

test('the Hub reference steps pass on the correct app and fail on each known-broken behavior, without a supervisor', {timeout: 360000}, async () => {
  const base = await realpath(await mkdtemp(join(shortTmp(), 'hv-')));
  try {
    for (const [step, scenario] of [['task-appears', 'lifecycle-basic'], ['command-reaches-fake', 'lifecycle-basic'], ['uncertain-no-replay', 'lifecycle-basic'], ['offline-recovers', 'pixel-offline']]) {
      const result = await judge(base, step, scenario);
      assert.equal(result.outcome, 'passed', `${step}: ${result.reason}`);
      assert.ok(result.assertions.length >= 2, `${step} asserts its observations`);
      assert.ok(result.video && result.screenshot, `${step} keeps its screenshot and video`);
    }

    // Known-broken behaviors, seeded by serve.mjs, judged by the unchanged reference steps.
    assertFailedAt(await judge(base, 'task-appears', 'lifecycle-basic', 'write-on-read'), 'read-only browsing sent no controller command', 'an unsolicited command while reading');
    assertFailedAt(await judge(base, 'command-reaches-fake', 'lifecycle-basic', 'duplicate-forward'), 'the fake received exactly one brightness.set of 30', 'a command delivered twice');
    assertFailedAt(await judge(base, 'uncertain-no-replay', 'lifecycle-basic', 'duplicate-forward'), 'the uncertain command reached the fake once and was not retried', 'an uncertain command delivered twice');
    assertFailedAt(await judge(base, 'offline-recovers', 'pixel-offline', 'replay-on-recovery'), 'recovery sent no command', 'a command replayed when the device returns');
    assertFailedAt(await judge(base, 'uncertain-no-replay', 'lifecycle-basic', 'replay-on-recovery'), 'recovery replayed nothing', 'the uncertain command replayed on recovery');

    // Controls that report failed by design.
    const installed = await judge(base, 'control-installed-links', 'control-installed-links');
    assertFailedAt(installed, 'no run link leads to an installed service port', 'a link to the installed wall');
    assert.match(installed.reason, /http:\/\/127\.0\.0\.1:8765\/wall/);
    assertFailedAt(await judge(base, 'control-missing-session', 'lifecycle-basic'), 'an unseeded session is shown', 'an unseeded session');

    // No run credential enters any log, reference, fault or control alike.
    for (const {step, result, tokens} of judged) {
      const log = await readFile(result.log, 'utf8');
      for (const token of tokens) assert.equal(log.includes(token), false, `${step}: no run credential in the assertion log`);
    }
  } finally {
    await rm(base, {recursive: true, force: true});
  }
});

test('an unknown fault name refuses to start instead of serving a correct app', {timeout: 60000}, async () => {
  const base = await realpath(await mkdtemp(join(shortTmp(), 'hv-')));
  try {
    await assert.rejects(started(base, 'bad', 'lifecycle-basic', 'no-such-fault'), /hub-start-failed: unknown-fault/);
  } finally {
    await rm(base, {recursive: true, force: true});
  }
});
