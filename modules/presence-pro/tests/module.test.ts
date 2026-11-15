import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {InProcessBus, type BunnyModule} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {FAMILY, type PresenceObservation} from '../src/contracts.js';
import {CONNECT_LIMIT_MS, createPresenceModule} from '../src/module.js';
import {NativeFault, type NativeCallbacks, type NativeFactory} from '../src/native.js';
import {SYNTHETIC_SECTION, reports} from '../src/simulated.js';
import {presenceValidator} from '../src/families.js';
import type {ScalarReport} from '../src/projection.js';

const flush = async (): Promise<void> => { for (let index = 0; index < 8; index++) await new Promise(resolve => { setImmediate(resolve); }); };
class World {
  now = 1_800_000_000_000;
  timers: {at: number; run: () => unknown; cancelled: boolean}[] = [];
  sessions: {id: string; callback: NativeCallbacks; closed: boolean}[] = [];
  states = new Map<string, PresenceObservation>();
  offline = new Set<string>();
  hang = new Set<string>();
  initialExtra: ScalarReport[] = [];
  readonly clock = {now: () => this.now};
  readonly scheduler = {after: (delay: number, run: () => unknown) => {
    const timer = {at: this.now + delay, run, cancelled: false}; this.timers.push(timer);
    return () => { timer.cancelled = true; };
  }};
  readonly native: NativeFactory = (sensor, _secrets, callback) => {
    const session = {id: sensor.id, callback, closed: false}; this.sessions.push(session);
    return {open: () => {
      if (this.hang.has(sensor.id)) return new Promise<void>(() => {});
      if (this.offline.has(sensor.id)) return Promise.reject(new NativeFault('unavailable'));
      for (const report of reports()) callback.report(report);
      for (const report of this.initialExtra) callback.report(report);
      return Promise.resolve();
    }, close: () => { session.closed = true; }};
  };
  async advance(delay: number): Promise<void> {
    const until = this.now + delay;
    for (;;) {
      const next = this.timers.filter(timer => !timer.cancelled && timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      this.now = next.at; next.cancelled = true; void next.run(); await flush();
    }
    this.now = until; await flush();
  }
  current(id = 'presence-a'): PresenceObservation { const state = this.states.get(id); assert.ok(state); return structuredClone(state); }
}
async function hosted(t: TestContext, world: World, directory?: string, section: unknown = SYNTHETIC_SECTION) {
  const stateDir = directory ?? await mkdtemp(join(tmpdir(), 'presence-module-'));
  const bus = new InProcessBus({now: world.clock.now});
  const reader = bus.connect('bunny/parts/presence-reader');
  await reader.subscribe<PresenceObservation>('bunny.state.presence-observation.*', message => { assert.equal(presenceValidator().validate(message, {nowMs: world.now}).ok, true); world.states.set(message.data.id, message.data); });
  const host = new ModuleHarness(createPresenceModule({native: world.native}), {bus, clock: world.clock, scheduler: world.scheduler, stateDir, section});
  let stopped = false;
  const stop = async (): Promise<void> => { if (stopped) return; stopped = true; await host.stop(); await reader.close(); };
  t.after(async () => { await stop(); if (directory === undefined) await rm(stateDir, {recursive: true, force: true}); });
  await host.start(); await flush();
  return {host, reader, stop};
}

void test('both initial caches populate valid public records, unchanged occupancy has no TTL, and sync retains receipts', async t => {
  const world = new World(); const {reader, host} = await hosted(t, world);
  assert.equal(world.current().connection, 'starting');
  await world.advance(0);
  for (const id of ['presence-a', 'presence-b']) {
    const state = world.current(id);
    assert.equal(state.connection, 'connected'); assert.equal(state.occupancy.value, 'occupied');
    assert.deepEqual(state.targets[0]?.apartmentMeters, {status: 'known', value: {x: 4, z: 2}});
  }
  const receipt = world.current().occupancy.receivedAtMs;
  await world.advance(24 * 3600_000);
  assert.equal(world.current().occupancy.value, 'occupied');
  const synced: PresenceObservation[] = [];
  await reader.sync<PresenceObservation>([FAMILY], change => { if (change.type === 'updated') synced.push(change.message.data); }, {timeoutMs: 1000});
  assert.equal(synced.length, 2); assert.deepEqual(synced[0]?.occupancy.receivedAtMs, receipt); assert.deepEqual(host.failures, []);
});
void test('disconnect is unknown, one sensor keeps working, and retired callbacks cannot revive reports', async t => {
  const world = new World(); await hosted(t, world); await world.advance(0);
  const old = world.sessions.find(session => session.id === 'presence-a'); assert.ok(old);
  old.callback.disconnected('unavailable'); await flush();
  assert.equal(world.current().connection, 'disconnected'); assert.equal(world.current().occupancy.value, 'unknown');
  assert.equal(world.current('presence-b').occupancy.value, 'occupied'); assert.equal(old.closed, true);
  for (const report of reports()) old.callback.report(report);
  await flush(); assert.equal(world.current().occupancy.value, 'unknown');
  await world.advance(1000); assert.equal(world.current().connection, 'connected');
  old.callback.report({key: 1, value: false}); await flush(); assert.equal(world.current().occupancy.value, 'occupied');
});
void test('silent attempts are disposed at 5s, one reconnect timer backs off to 30s, and stop fences late work', async t => {
  const world = new World(); world.hang.add('presence-a');
  const {stop} = await hosted(t, world); await world.advance(0);
  await world.advance(CONNECT_LIMIT_MS); assert.equal(world.current().connection, 'disconnected'); assert.equal(world.sessions[0]?.closed, true);
  assert.equal(world.current('presence-b').connection, 'connected');
  const delays: number[] = [];
  for (let index = 0; index < 7; index++) {
    const next = world.timers.filter(timer => !timer.cancelled).sort((a, b) => a.at - b.at)[0]; assert.ok(next);
    delays.push(next.at - world.now); await world.advance(next.at - world.now + CONNECT_LIMIT_MS);
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.ok(world.sessions.filter(session => !session.closed && session.id === 'presence-a').length <= 1);
  await stop(); const count = world.sessions.length;
  for (const session of world.sessions) session.callback.disconnected('unavailable');
  await world.advance(60_000); assert.equal(world.sessions.length, count);
});
void test('restart never restores occupancy or axes, revisions increase, and changed calibration starts unknown', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'presence-restart-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const firstWorld = new World(); const first = await hosted(t, firstWorld, directory); await firstWorld.advance(0);
  const revision = firstWorld.current().revision; await first.stop();
  const secondWorld = new World(); const section = structuredClone(SYNTHETIC_SECTION);
  const changed = section.sensors[0]?.calibration; assert.ok(changed); changed.revision = 2; changed.tx = 5;
  const second = await hosted(t, secondWorld, directory, section);
  assert.equal(secondWorld.current().occupancy.value, 'unknown'); assert.equal(secondWorld.current().targets[0]?.rawMm.x.status, 'unknown');
  assert.ok(secondWorld.current().revision > revision); await secondWorld.advance(0);
  assert.deepEqual(secondWorld.current().targets[0]?.apartmentMeters, {status: 'known', value: {x: 7, z: 2}});
  assert.deepEqual(secondWorld.current().targets[0]?.calibrationRevision, {status: 'known', value: 2}); await second.stop();
});

void test('pre-open reset transitions are applied in arrival order without resurrecting old axes', async t => {
  const world = new World(); world.initialExtra = [{key: 4, value: false}, {key: 4, value: true}];
  await hosted(t, world); await world.advance(0);
  assert.equal(world.current().occupancy.value, 'occupied');
  assert.equal(world.current().targets[0]?.apartmentMeters.status, 'unknown');
});

void test('a delayed secret read is inside the attempt bound; late resolution cannot create a retired connection', async t => {
  const world = new World(), directory = await mkdtemp(join(tmpdir(), 'presence-secret-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const section = structuredClone(SYNTHETIC_SECTION);
  const sensor = section.sensors[0]; assert.ok(sensor); sensor.security = {mode: 'noise', keySecret: 'key'};
  const original = createPresenceModule({native: world.native});
  let resolveSecret: ((value: string) => void) | undefined;
  const module: BunnyModule = {...original, start: context => original.start({...context, config: context.config as Parameters<typeof original.start>[0]['config'],
    secrets: {read: () => new Promise(resolve => { resolveSecret = resolve; })}})};
  const bus = new InProcessBus({now: world.clock.now}), reader = bus.connect('bunny/parts/reader');
  await reader.subscribe<PresenceObservation>('bunny.state.presence-observation.*', message => { world.states.set(message.data.id, message.data); });
  const host = new ModuleHarness(module, {bus, stateDir: directory, section, clock: world.clock, scheduler: world.scheduler});
  t.after(async () => { await host.stop(); await reader.close(); });
  await host.start(); await world.advance(0);
  assert.equal(world.sessions.filter(session => session.id === 'presence-a').length, 0);
  await world.advance(CONNECT_LIMIT_MS); assert.equal(world.current().connection, 'disconnected');
  resolveSecret?.(Buffer.alloc(32).toString('base64')); await flush();
  assert.equal(world.sessions.filter(session => session.id === 'presence-a').length, 0);
  assert.equal(world.current('presence-b').connection, 'connected');
});
