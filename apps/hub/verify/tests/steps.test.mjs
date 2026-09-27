// Hub #494: the Hub capture steps judged without a supervisor, so they also run
// on CI hosts without systemd --user. Each step gets its own freshly seeded hub
// (serve.mjs started directly), because state persists within one process.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
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
import {runCaptureStep} from '@jimmie-potts/app-verify';
import plugin from '../plugin.mjs';

const serve = fileURLToPath(new URL('../serve.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../../..', import.meta.url));

/** Seed a scenario with the plug-in's own seed and start the hub process on 127.0.0.1:0. */
async function started(base, name, scenario) {
  const runtimeDir = join(base, name), dataDir = join(runtimeDir, 'data');
  await mkdir(dataDir, {recursive: true, mode: 0o700});
  await plugin.scenarios[scenario].seed({runId: `hub-unmanaged-${name}`, root, runtimeDir, dataDir, scenario});
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
  return {url, dataDir, runtimeDir, stderr: () => stderr, stop: () => new Promise(resolve => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
  })};
}

let runs = 0;
async function judge(base, step, scenario) {
  // Short directory names keep the hub's Unix socket path under 108 bytes.
  const app = await started(base, `r${++runs}`, scenario);
  try {
    return {...(await runCaptureStep(plugin, step, {url: app.url, outputDir: join(base, `${step}-out`), scenario, dataDir: app.dataDir, runtimeDir: app.runtimeDir})), tokens: [await readFile(join(app.dataDir, 'api-token'), 'utf8'), await readFile(join(app.dataDir, 'reader-token'), 'utf8')]};
  } finally {
    await app.stop();
  }
}

test('the Hub reference steps pass and its negative controls fail, without a supervisor', {timeout: 240000}, async () => {
  const base = await realpath(await mkdtemp(join(shortTmp(), 'hv-')));
  try {
    for (const [step, scenario] of [['task-appears', 'lifecycle-basic'], ['command-reaches-fake', 'lifecycle-basic'], ['uncertain-no-replay', 'lifecycle-basic'], ['offline-recovers', 'pixel-offline']]) {
      const result = await judge(base, step, scenario);
      assert.equal(result.outcome, 'passed', `${step}: ${result.reason}`);
      assert.ok(result.assertions.length >= 2, `${step} asserts its observations`);
      assert.ok(result.video && result.screenshot, `${step} keeps its screenshot and video`);
      const log = await readFile(result.log, 'utf8');
      for (const token of result.tokens) assert.equal(log.includes(token), false, 'no run credential enters the assertion log');
    }
    const duplicate = await judge(base, 'control-duplicate-command', 'lifecycle-basic');
    assert.equal(duplicate.outcome, 'failed');
    assert.match(duplicate.reason, /expected 2 commands, saw 1/, 'the control fails because exactly one command reached the fake');
    const installed = await judge(base, 'control-installed-links', 'control-installed-links');
    assert.equal(installed.outcome, 'failed');
    assert.match(installed.reason, /links to installed ports: http:\/\/127\.0\.0\.1:8765\/wall/, 'the link check catches a link to the installed wall');
    const missing = await judge(base, 'control-missing-session', 'lifecycle-basic');
    assert.equal(missing.outcome, 'failed');
    assert.match(missing.reason, /^assertion failed: an unseeded session is shown/);
  } finally {
    await rm(base, {recursive: true, force: true});
  }
});
