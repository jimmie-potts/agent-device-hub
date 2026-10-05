import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../dist/cli.js';
import { ManualClock } from '../dist/clock.js';
import { DEFAULT_PROFILE_PATH } from '../dist/routing/profile.js';
import { SyntheticHub } from '../dist/sim/hub.js';
import { advance, onCleanup, tempDir, tid } from './routing-helpers.mjs';

const TOKEN = 'synthetic-run-token-0123456789';

function io() {
  const out = [];
  return { stdout: { write: s => { out.push(s); return true; } }, stderr: { write: s => { out.push(s); return true; } }, text: () => out.join('') };
}

test('--desktop takes only `sim` and only with the routing flags', async () => {
  const routing = ['--profile', 'p.json', '--hub', 'http://127.0.0.1:1', '--token-file', 't', '--state', 's'];
  for (const argv of [['run', '--desktop', 'sim'], ['run', '--simulate', '--desktop', 'sim'], ['run', ...routing, '--desktop', 'windows'], ['run', ...routing, '--desktop']]) {
    const streams = io();
    let created = 0;
    assert.equal(await main(argv, { ...streams, createHidTransport: () => { created++; throw new Error('no'); } }), 2, JSON.stringify(argv));
    assert.equal(created, 0);
  }
});

test('the bridge never loads the simulated desktop or the synthetic feed without the flag', () => {
  const dist = new URL('../dist/', import.meta.url);
  const code = `
    import { registerHooks } from 'node:module';
    const seen = [];
    registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); seen.push(result.url); return result; } });
    await import(${JSON.stringify(new URL('cli.js', dist).href)});
    await import(${JSON.stringify(new URL('index.js', dist).href)});
    const before = seen.filter(url => url.includes('/dist/sim/'));
    await import(${JSON.stringify(new URL('sim/desktop.js', dist).href)});
    process.stdout.write(JSON.stringify({ all: seen.length, sim: before, control: seen.filter(url => url.includes('/dist/sim/')).length }));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.ok(result.all > 10, 'the hook saw the module graph');
  assert.deepEqual(result.sim, [], 'cli.js and index.js do not import src/sim');
  assert.ok(result.control >= 1, 'control: the hook does see a sim module once one is imported');
});

test('run --simulate --desktop sim routes through the simulated controller and desktop only', async t => {
  const dir = tempDir(t, 'chompi-sim-run-');
  const paths = { profile: join(dir, 'profile.json'), token: join(dir, 'token'), state: join(dir, 'state') };
  writeFileSync(paths.profile, readFileSync(DEFAULT_PROFILE_PATH));
  writeFileSync(paths.token, `${TOKEN}\n`, { mode: 0o600 });
  const clock = new ManualClock(1_700_000_000_000);
  const hub = new SyntheticHub({ token: TOKEN, clock });
  onCleanup(t, () => hub.close());
  hub.addSession({ provider: 'codex', sessionId: tid(1), title: 'Synthetic Codex task 1' });
  let parts;
  let hid = 0, platform = 0;
  const controller = new AbortController();
  const streams = io();
  const running = main(['run', '--simulate', '--desktop', 'sim', '--profile', paths.profile, '--hub', 'http://127.0.0.1:9', '--token-file', paths.token, '--state', paths.state], {
    ...streams, env: { XDG_RUNTIME_DIR: dir }, clock, fetch: hub.fetch, signal: controller.signal,
    process: Object.assign(new EventEmitter(), { exit() { throw new Error('unexpected exit'); } }),
    createHidTransport: () => { hid++; throw new Error('no HID in a simulated run'); },
    createOsAdapter: async () => { platform++; throw new Error('no platform adapter in a simulated run'); },
    onSimulation: value => {
      parts = value;
      value.desktop.addCodexThread(tid(1), 'Synthetic Codex task 1');
    },
  });
  onCleanup(t, async () => { controller.abort(); await running.catch(() => {}); });
  for (let i = 0; i < 100 && !(parts?.simulator.display === 'host' && streams.text().includes('slot-assigned')); i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    await advance(clock, 100, 50);
  }
  assert.ok(parts?.simulator && parts.desktop, 'both simulated parts reached the hook');
  assert.equal(parts.simulator.display, 'host');
  parts.simulator.click(1);
  await advance(clock, 400, 50);
  const snapshot = parts.desktop.snapshot();
  assert.equal(snapshot.foreground, 'codex');
  assert.equal(snapshot.windows.codex.selected, tid(1));
  assert.equal(snapshot.windows.codex.composer.focused, true);
  assert.match(streams.text(), /"type":"focused","slot":1,"client":"codex"/);
  controller.abort();
  assert.equal(await running, 0, streams.text());
  assert.deepEqual([hid, platform], [0, 0], 'neither the HID transport nor the platform adapter was created');
  assert.ok(parts.desktop.calls.includes('close'));
});
