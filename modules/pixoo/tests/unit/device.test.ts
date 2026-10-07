import { describe, expect, it } from 'vitest';
import { FakeDeviceAdapter } from '../../src/device/index.js';
import { present } from '../helpers/present.js';
import { rgbFrame } from '../helpers/rgb-fixtures.js';
import { ManualClock } from '../helpers/manual-clock.js';

describe('fake device adapter', () => {
  it('reports simulator availability with monotonic operation timing', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 7 });
    const pending = device.probe({ generation: 0 });
    clock.advance(7);
    expect(await pending).toEqual({
      ok: true, generation: 0,
      value: { mode: 'simulator', available: true, connected: false },
      timing: { submittedAtMs: 0, startedAtMs: 0, completedAtMs: 7, queueMs: 0, serviceMs: 7 },
    });
    expect(clock.pendingTimers).toBe(0);
  });
  it('snapshots every complete RGB frame and preserves row order and delays', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 5, readyDelayMs: 3 });
    const frames = [rgbFrame(11, 40), rgbFrame(22, 90)];
    const expected = frames.map(frame => ({ rgb: frame.rgb.slice(), delayMs: frame.delayMs }));
    const pending = device.uploadAnimation({ frames }, { generation: 0 });
    present(frames[0]).rgb.fill(255);
    frames.pop();
    clock.advance(10);
    expect(await pending).toMatchObject({ ok: true, value: { estimatedReadyAtMs: 13 } });
    const recorded = device.effects.filter(effect => effect.kind === 'frame');
    expect(recorded.map(effect => effect.frame)).toEqual(expected);
    expect(present(recorded[0]).frame.rgb.slice(63 * 3, 65 * 3)).toEqual(new Uint8Array([63, 0, 11, 0, 1, 11]));
    present(recorded[0]).frame.rgb.fill(99);
    expect(device.effects).not.toEqual(recorded);
  });
  it.each([
    { frames: new Array<ReturnType<typeof rgbFrame>>(1) },
    { frames: [] },
    { frames: [{ rgb: new Uint8Array(12287), delayMs: 40 }] },
    { frames: [{ rgb: new Uint8Array(12289), delayMs: 40 }] },
    ...[0, -1, NaN, Infinity, 1.5].map(delayMs => ({ frames: [rgbFrame(1, delayMs)] })),
  ])('rejects invalid animation without effects: %j', async animation => {
    const device = new FakeDeviceAdapter({ clock: new ManualClock() });
    expect(await device.uploadAnimation(animation, { generation: 0 })).toMatchObject({ ok: false, code: 'invalid-input', priorEffects: 'none' });
    expect(device.effects).toEqual([]);
  });
  it('keeps concurrent animations and controls in complete FIFO transactions', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 5 });
    const first = device.uploadAnimation({ frames: [rgbFrame(1), rgbFrame(2)] }, { generation: 0 });
    const second = device.uploadAnimation({ frames: [rgbFrame(3), rgbFrame(4)] }, { generation: 0 });
    const brightness = device.setBrightness(35, { generation: 0 });
    const screen = device.setScreen(false, { generation: 0 });
    const probe = device.probe({ generation: 0 });
    clock.advance(35);
    expect((await Promise.all([first, second, brightness, screen, probe])).every(result => result.ok)).toBe(true);
    expect(device.effects.map(effect => [effect.operationId, effect.kind])).toEqual([
      [1, 'frame'], [1, 'frame'], [2, 'frame'], [2, 'frame'], [3, 'brightness'], [4, 'screen'],
    ]);
    expect((await second).timing).toEqual({ submittedAtMs: 0, startedAtMs: 10, completedAtMs: 20, queueMs: 10, serviceMs: 10 });
    expect(device.operations.map(record => record.kind)).toEqual(['uploadAnimation', 'uploadAnimation', 'setBrightness', 'setScreen', 'probe']);
  });

  it.each(['cancelled', 'timeout', 'stale-generation'] as const)('interrupts an active upload with %s and preserves partial effects', async code => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 5 });
    const abort = new AbortController();
    const pending = device.uploadAnimation({ frames: [rgbFrame(1), rgbFrame(2), rgbFrame(3)] },
      { generation: 0, signal: abort.signal, timeoutMs: code === 'timeout' ? 7 : 100 });
    clock.advance(5);
    if (code === 'cancelled') abort.abort();
    if (code === 'stale-generation') device.invalidateGeneration();
    if (code === 'timeout') clock.advance(2);
    expect(await pending).toMatchObject({ ok: false, code, priorEffects: 'possible' });
    const fresh = device.setScreen(false, { generation: device.generation });
    clock.advance(100);
    expect((await fresh).ok).toBe(true);
    expect(device.effects.map(effect => effect.kind)).toEqual(['frame', 'screen']);
    expect(device.operations).toHaveLength(2);
    expect(clock.pendingTimers).toBe(0);
  });
  it.each(['cancelled', 'timeout'] as const)('settles queued %s without waiting for the writer', async code => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 20 });
    const active = device.uploadAnimation({ frames: [rgbFrame(1), rgbFrame(2)] }, { generation: 0 });
    const abort = new AbortController();
    const pending = device.setBrightness(50, { generation: 0, signal: abort.signal, timeoutMs: code === 'timeout' ? 5 : 100 });
    clock.advance(5);
    if (code === 'cancelled') abort.abort();
    expect(await pending).toMatchObject({ ok: false, code, priorEffects: 'none', timing: { startedAtMs: null, queueMs: 5, serviceMs: 0 } });
    expect(device.effects).toEqual([]);
    clock.advance(100);
    expect((await active).ok).toBe(true);
    expect(device.effects.map(effect => effect.kind)).toEqual(['frame', 'frame']);
    expect(clock.pendingTimers).toBe(0);
  });
  it('retires active and queued generations before allowing fresh work', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 5 });
    const active = device.uploadAnimation({ frames: [rgbFrame(1), rgbFrame(2)] }, { generation: 0 });
    const queued = device.setBrightness(90, { generation: 0 });
    clock.advance(5);
    expect(device.invalidateGeneration()).toBe(1);
    const late = device.setScreen(true, { generation: 0 });
    expect((await Promise.all([active, queued, late])).map(result => result.ok ? 'success' : result.code)).toEqual(['stale-generation', 'stale-generation', 'stale-generation']);
    const fresh = device.probe({ generation: 1 });
    clock.advance(100);
    expect((await fresh).ok).toBe(true);
    expect(device.effects).toHaveLength(1);
    expect(clock.pendingTimers).toBe(0);
  });
  it('honors pre-abort and lets a deadline win at the same instant as an effect', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 5 });
    const abort = new AbortController(); abort.abort();
    expect(await device.setScreen(true, { generation: 0, signal: abort.signal })).toMatchObject({ ok: false, code: 'cancelled' });
    const deadline = device.setBrightness(100, { generation: 0, timeoutMs: 5 });
    clock.advance(5);
    expect(await deadline).toMatchObject({ ok: false, code: 'timeout', priorEffects: 'none' });
    expect(device.effects).toEqual([]);
  });
  it.each([0, -1, Infinity, NaN])('rejects invalid timeout %s before effects', async timeoutMs => {
    const device = new FakeDeviceAdapter({ clock: new ManualClock() });
    expect(await device.probe({ generation: 0, timeoutMs })).toMatchObject({ ok: false, code: 'invalid-input' });
  });
  it.each([-1, 101, NaN, 0.5])('rejects invalid brightness %s', async percent => {
    const device = new FakeDeviceAdapter({ clock: new ManualClock() });
    expect(await device.setBrightness(percent, { generation: 0 })).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(device.effects).toEqual([]);
  });

  it('distinguishes upload failure from offline and releases the writer without retries', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 5 });
    device.failNextUpload(1);
    const upload = device.uploadAnimation({ frames: [rgbFrame(1), rgbFrame(2)] }, { generation: 0 });
    const control = device.setBrightness(20, { generation: 0 });
    clock.advance(15);
    expect(await upload).toMatchObject({ ok: false, code: 'upload-failed', priorEffects: 'possible' });
    expect((await control).ok).toBe(true);
    device.setOnline(false);
    const offline = device.probe({ generation: 0 });
    clock.advance(5);
    expect(await offline).toMatchObject({ ok: false, code: 'offline', priorEffects: 'none' });
    device.setOnline(true);
    const fresh = device.uploadAnimation({ frames: [rgbFrame(3)] }, { generation: 0 });
    clock.advance(100);
    expect((await fresh).ok).toBe(true);
    expect(device.effects.map(effect => effect.kind)).toEqual(['frame', 'brightness', 'frame']);
    expect(device.operations.map(record => record.outcome)).toEqual(['upload-failed', 'success', 'offline', 'success']);
    expect(clock.pendingTimers).toBe(0);
  });
  it('observes loss of connectivity during upload and never records remaining frames', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 5 });
    const upload = device.uploadAnimation({ frames: [rgbFrame(1), rgbFrame(2)] }, { generation: 0 });
    clock.advance(5); device.setOnline(false); clock.advance(5);
    expect(await upload).toMatchObject({ ok: false, code: 'offline', priorEffects: 'possible' });
    device.setOnline(true); clock.advance(100);
    expect(device.effects).toHaveLength(1);
  });
  it('captures failure injection for the next upload even when it waits in the queue', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 5 });
    const first = device.probe({ generation: 0 });
    device.failNextUpload();
    const failed = device.uploadAnimation({ frames: [rgbFrame(1)] }, { generation: 0 });
    const success = device.uploadAnimation({ frames: [rgbFrame(2)] }, { generation: 0 });
    clock.advance(15);
    expect((await first).ok).toBe(true);
    expect(await failed).toMatchObject({ ok: false, code: 'upload-failed', priorEffects: 'none' });
    expect((await success).ok).toBe(true);
    expect(device.effects).toHaveLength(1);
  });

  it('keeps returned result and record mutations away from adapter-owned history', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock });
    const pending = device.probe({ generation: 0 }); clock.advance(0);
    const result = await pending;
    result.timing.completedAtMs = 999;
    const records = device.operations;
    present(records[0]).timing.queueMs = 999;
    expect(device.operations[0]?.timing).toEqual({ submittedAtMs: 0, startedAtMs: 0, completedAtMs: 0, queueMs: 0, serviceMs: 0 });
  });
  it('rejects invalid screen and generation values without scheduling effects', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock });
    expect(await device.setScreen('on' as unknown as boolean, { generation: 0 })).toMatchObject({ ok: false, code: 'invalid-input' });
    for (const generation of [-1, NaN, Infinity, 0.5]) {
      expect(await device.probe({ generation })).toMatchObject({ ok: false, code: 'invalid-input' });
    }
    expect(await device.probe({ generation: 1 })).toMatchObject({ ok: false, code: 'stale-generation' });
    expect(clock.pendingTimers).toBe(0);
  });
  it('cleans up a backlog on invalidation without executing stale controls', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 5 });
    const pending = Array.from({ length: 2000 }, () => device.setScreen(true, { generation: 0 }));
    device.invalidateGeneration();
    expect((await Promise.all(pending)).every(result => !result.ok && result.code === 'stale-generation')).toBe(true);
    expect(clock.pendingTimers).toBe(0);
    clock.advance(5000);
    expect(device.effects).toEqual([]);
  });
  it('counts admitted and successful operations by kind, even without history', async () => {
    const clock = new ManualClock();
    const device = new FakeDeviceAdapter({ clock, latencyMs: 5, recordHistory: false });
    const zero = { admitted: 0, succeeded: 0 };
    expect(device.counts).toEqual({ probe: zero, uploadAnimation: zero, setBrightness: zero, setScreen: zero });
    const applied = device.setBrightness(25, { generation: 0 });
    expect(await device.setBrightness(101, { generation: 0 })).toMatchObject({ ok: false, code: 'invalid-input' });
    clock.advance(5);
    expect(await applied).toMatchObject({ ok: true });
    const retired = device.setBrightness(30, { generation: 0 });
    device.invalidateGeneration();
    expect(await retired).toMatchObject({ ok: false, code: 'stale-generation' });
    expect(await device.setBrightness(40, { generation: 0 })).toMatchObject({ ok: false, code: 'stale-generation' });
    const probe = device.probe({ generation: 1 }); clock.advance(5);
    expect(await probe).toMatchObject({ ok: true });
    const counts = device.counts;
    expect(counts).toEqual({ probe: { admitted: 1, succeeded: 1 }, uploadAnimation: zero, setBrightness: { admitted: 2, succeeded: 1 }, setScreen: zero });
    counts.setBrightness.admitted = 99;
    expect(device.counts.setBrightness).toEqual({ admitted: 2, succeeded: 1 });
    expect([device.operations, device.effects]).toEqual([[], []]);
  });
  it('rejects invalid fake setup and fault parameters', () => {
    for (const value of [-1, NaN, Infinity]) {
      expect(() => new FakeDeviceAdapter({ latencyMs: value })).toThrow(RangeError);
      expect(() => new FakeDeviceAdapter({ readyDelayMs: value })).toThrow(RangeError);
      expect(() => new FakeDeviceAdapter().failNextUpload(value)).toThrow(RangeError);
    }
  });

});
