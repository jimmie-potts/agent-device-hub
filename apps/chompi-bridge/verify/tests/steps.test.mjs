// Hub #853: the CHOMPI bridge capture steps judged without a supervisor, so they also run on CI hosts without
// systemd --user. Each step gets its own freshly seeded run process (serve.mjs started directly). The reference
// steps and every catalog scenario step pass; the negative control fails at its own assertion.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runCaptureStep } from '@jimmie-potts/app-verify';
import plugin from '../plugin.mjs';

const shortTmp = () => (tmpdir().length <= 60 ? tmpdir() : '/tmp');
const serve = fileURLToPath(new URL('../serve.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../../..', import.meta.url));

async function started(base, name, scenario) {
  const runtimeDir = join(base, name), dataDir = join(runtimeDir, 'data');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await plugin.scenarios[scenario].seed({ runId: `chompi-unmanaged-${name}`, root, runtimeDir, dataDir, scenario, inputs: {} });
  const child = spawn(process.execPath, [serve, '--data', dataDir, '--port', '0'], { cwd: root, env: { ...process.env, TMPDIR: runtimeDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => (stderr += chunk));
  const url = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', chunk => {
      text += chunk;
      const line = text.split('\n').find(l => l.startsWith('{"ready"'));
      if (line) resolve(JSON.parse(line).url);
    });
    child.on('exit', code => reject(new Error(`serve exited ${code}: ${stderr}`)));
  });
  return { url, dataDir, runtimeDir, stop: () => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); }) };
}

let runs = 0;
async function judge(base, step) {
  const scenario = plugin.captureSteps[step].scenario ?? plugin.defaultScenario;
  const app = await started(base, `r${++runs}`, scenario);
  try {
    const result = await runCaptureStep(plugin, step, { url: app.url, outputDir: join(base, `o${runs}`), scenario, dataDir: app.dataDir, runtimeDir: app.runtimeDir });
    const token = (await readFile(join(app.dataDir, 'feed-token'), 'utf8')).trim();
    assert.ok(!(await readFile(result.log, 'utf8')).includes(token), `${step}: the capture log never holds the feed token`);
    return result;
  } finally {
    await app.stop();
  }
}

test('the reference and catalog scenario steps pass, and the negative control fails, without a supervisor', { timeout: 600000 }, async () => {
  const base = await realpath(await mkdtemp(join(shortTmp(), 'cv-')));
  try {
    const reference = Object.keys(plugin.captureSteps).filter(step => !step.startsWith('control-'));
    assert.deepEqual(reference, ['controls-page', 'focus-and-send', 'scenario-send-front-window', 'scenario-record-dictation', 'scenario-claude-question-wheel',
      'scenario-codex-card-structure', 'scenario-reconnect-no-replay', 'scenario-profile-reload', 'scenario-task-pages', 'scenario-attention-key', 'scenario-volume-knob',
      'scenario-claude-model-knob', 'scenario-claude-effort-knob', 'scenario-claude-effort-unsupported', 'scenario-codex-model-knob', 'scenario-codex-effort-chords',
      'scenario-codex-effort-knob', 'scenario-knob-lagging-reads', 'scenario-knob-refusals', 'scenario-claude-next-step-pick', 'scenario-claude-ghost-accept',
      'scenario-next-step-refusals']);
    for (const step of reference) {
      const result = await judge(base, step);
      assert.equal(result.outcome, 'passed', `${step}: ${result.reason}`);
      assert.ok(result.assertions.length >= 3, `${step} asserts its observations`);
      if (step.startsWith('scenario-')) {
        const attached = JSON.parse(await readFile(result.attachments.find(file => file.endsWith('scenario-result.json')), 'utf8'));
        assert.deepEqual([attached.synthetic, attached.physical, attached.state], [true, false, 'passed']);
      }
    }
    const control = await judge(base, 'control-attention-light');
    assert.equal(control.outcome, 'failed');
    assert.ok(control.reason.startsWith('assertion failed: slot 1 shows attention'), control.reason);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
