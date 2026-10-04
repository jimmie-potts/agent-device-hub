import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main, USAGE } from '../dist/cli.js';
import { ManualClock } from '../dist/clock.js';
import { ChompiSimulator } from '../dist/simulator.js';
import { FakeTransport } from '../dist/fake-transport.js';
import { DEFAULT_PROFILE_PATH } from '../dist/routing/profile.js';
import { CONTROLLER } from './helpers.mjs';
import { FakeAdapter, FakeHub, advance, codexTask, settle, tempDir, tid } from './routing-helpers.mjs';

const TOKEN = 'cli-secret-token-abcdef';

function io() {
  const out = [], err = [];
  return { stdout: { write: s => { out.push(s); return true; } }, stderr: { write: s => { err.push(s); return true; } }, out: () => out.join(''), err: () => err.join('') };
}

function files(t, profile = JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8'))) {
  const dir = tempDir(t, 'chompi-run-');
  const paths = { profile: join(dir, 'profile.json'), token: join(dir, 'token'), state: join(dir, 'state'), runtime: dir };
  writeFileSync(paths.profile, JSON.stringify(profile));
  writeFileSync(paths.token, `${TOKEN}\n`, { mode: 0o600 });
  return paths;
}

const routingArgs = paths => ['run', '--profile', paths.profile, '--hub', 'http://127.0.0.1:8788', '--token-file', paths.token, '--state', paths.state];

test('routing flags come together and exclude the test pattern', async () => {
  assert.match(USAGE, /--profile <file> --hub <origin> --token-file <path> --state <dir>/);
  for (const argv of [
    ['run', '--profile', 'p.json'],
    ['run', '--profile', 'p.json', '--hub', 'http://127.0.0.1:1', '--token-file', 't'],
    ['run', '--profile', 'p.json', '--hub', 'http://127.0.0.1:1', '--token-file', 't', '--state', 's', '--test-pattern'],
    ['run', '--hub', 'http://127.0.0.1:1'],
    ['run', '--profile'],
  ]) {
    const streams = io();
    let created = 0;
    assert.equal(await main(argv, { ...streams, createHidTransport: () => { created++; return new FakeTransport([]); } }), 2, JSON.stringify(argv));
    assert.equal(created, 0);
  }
});

test('an invalid profile or an unavailable OS adapter stops before any device is opened', async t => {
  const bad = files(t, { schemaVersion: 1 });
  let streams = io();
  let created = 0;
  const transport = () => { created++; return new FakeTransport([CONTROLLER]); };
  assert.equal(await main(routingArgs(bad), { ...streams, env: { XDG_RUNTIME_DIR: bad.runtime }, createHidTransport: transport, createOsAdapter: async () => new FakeAdapter(new ManualClock()) }), 1);
  assert.match(streams.err(), /^chompi-bridge-profile-invalid: profile\.profileVersion: required/m);

  const good = files(t);
  streams = io();
  assert.equal(await main(routingArgs(good), { ...streams, env: { XDG_RUNTIME_DIR: good.runtime }, createHidTransport: transport, createOsAdapter: async () => { throw new Error('os-adapter-unavailable: linux'); } }), 1);
  assert.match(streams.err(), /^chompi-bridge-os-adapter-unavailable/m);
  assert.equal(created, 0);
});

test('run with a profile wires lock, bridge, feed and router: a slot press opens the task and the wheel sends once', async t => {
  const paths = files(t);
  const clock = new ManualClock(1_700_000_000_000);
  const simulator = new ChompiSimulator({ clock });
  simulator.plug();
  t.after(() => simulator.unplug());
  const hub = new FakeHub();
  hub.sessions = [codexTask(1)];
  const adapter = new FakeAdapter(clock);
  adapter.codexThreads.set(tid(1), 'Task 1');
  const controller = new AbortController();
  const streams = io();
  const running = main(routingArgs(paths), {
    ...streams, env: { XDG_RUNTIME_DIR: paths.runtime }, clock, fetch: hub.fetch, signal: controller.signal,
    createHidTransport: () => simulator.transport, createOsAdapter: async () => adapter,
  });
  // Virtual time with Hub heartbeats every 100 ms, as the real Hub sends every second.
  const run = async ms => { for (let elapsed = 0; elapsed < ms; elapsed += 100) { if (hub.stream && !hub.stream.closed) hub.heartbeat(); await advance(clock, 100, 50); } };
  // The token file read runs on the libuv pool, outside virtual time.
  for (let i = 0; i < 100 && hub.streams.length === 0; i++) { await new Promise(resolve => setTimeout(resolve, 5)); await run(100); }
  await run(3500);
  assert.equal(simulator.display, 'host');
  // The slot file write runs on the libuv pool, outside virtual time.
  for (let i = 0; i < 200 && !existsSync(join(paths.state, 'slots.json')); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(existsSync(join(paths.state, 'slots.json')), `slot 1 was assigned and persisted\n${streams.out()}${streams.err()}`);

  simulator.click(1);
  await run(300);
  assert.deepEqual(adapter.opened, [`codex://threads/${tid(1)}`]);
  simulator.click(33);
  await run(300);
  simulator.click(33);
  await run(300);
  assert.equal(adapter.enters, 1, 'one Enter for a repeated click');
  for (const control of [29, 30, 31, 32]) simulator.click(control);
  await run(300);
  assert.equal(adapter.enters, 1, 'small-knob clicks never send');
  assert.deepEqual(simulator.leds[0], JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8')).colors.selected, 'the device shows the selected slot');

  simulator.press(26);
  await run(200);
  assert.equal(adapter.held.size, 2);
  simulator.unplug();
  await run(1000);
  assert.equal(adapter.held.size, 0, 'unplugging during Record releases the chord');

  controller.abort();
  assert.equal(await running, 0, streams.err());
  assert.ok(adapter.calls.some(c => c[0] === 'close'));
  const lines = streams.out().trim().split('\n').map(line => JSON.parse(line));
  const types = lines.map(l => l.type);
  for (const type of ['connected', 'slot-assigned', 'focused', 'sent', 'invalidated']) assert.ok(types.includes(type), type);
  assert.ok(!streams.out().includes(TOKEN) && !streams.err().includes(TOKEN), 'the token is never printed');
  assert.ok(!streams.out().includes('Task 1'), 'titles are never printed');
  assert.ok(hub.requests.every(r => r.method === 'GET'));
  await settle();
});
