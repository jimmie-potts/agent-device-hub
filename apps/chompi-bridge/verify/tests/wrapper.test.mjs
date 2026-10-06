// Hub #853 review round 2: the boundary negative controls are start-only. `scenario` and `handoff --reset` refuse
// them before the core acts, so a running run is never reseeded into a seed whose boundary check stops it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import plugin, { START_ONLY, startOnlyRefusal } from '../plugin.mjs';

const wrapper = fileURLToPath(new URL('../../../../scripts/verify-chompi.mjs', import.meta.url));

test('only the three boundary negative controls are start-only; the capture-step control stays a step', () => {
  assert.deepEqual([...START_ONLY].sort(), ['control-desktop-calls', 'control-hid-device', 'control-installed-hub']);
  for (const name of START_ONLY) assert.match(plugin.scenarios[name].description, /^Negative control, not a catalog scenario, start-only: .*scenario refuses it on a running run$/);
  assert.ok(plugin.captureSteps['control-attention-light'], 'the capture-step negative control is unchanged');
  assert.equal(startOnlyRefusal(['capture', 'chompi-x', 'control-attention-light']), undefined);
  assert.equal(startOnlyRefusal(['start', '--scenario', 'control-hid-device']), undefined, 'a negative control still starts on its own');
  assert.equal(startOnlyRefusal(['scenario', 'chompi-x', 'desk-basic']), undefined);
  assert.equal(startOnlyRefusal(['scenario', 'chompi-x', 'control-installed-hub'])?.error, 'start-only-scenario');
  assert.equal(startOnlyRefusal(['handoff', 'chompi-x', '--reset', 'control-desktop-calls'])?.error, 'start-only-scenario');
});

test('the wrapper refuses a reseed into a boundary negative control before the core touches any run', t => {
  const state = mkdtempSync(join(tmpdir(), 'cw-'));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const run = argv => spawnSync(process.execPath, [wrapper, ...argv], { encoding: 'utf8', env: { ...process.env, APP_VERIFY_STATE_ROOT: state, APP_VERIFY_WINDOWS_CHECK: 'off' } });
  for (const argv of [['scenario', 'chompi-20260101T000000Z-000000', 'control-hid-device'], ['handoff', 'chompi-20260101T000000Z-000000', '--reset', 'control-installed-hub']]) {
    const result = run(argv);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    const line = JSON.parse(result.stdout.trim());
    assert.equal(line.error, 'start-only-scenario');
    assert.match(line.detail, /start --scenario control-/);
  }
  const ordinary = run(['scenario', 'chompi-20260101T000000Z-000000', 'desk-basic']);
  assert.notEqual(JSON.parse(ordinary.stdout.trim().split('\n').at(-1)).error, 'start-only-scenario', 'other scenarios reach the core');
});
