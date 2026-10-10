import {expect, it} from 'vitest';
import sharp from 'sharp';
import {HttpDeviceAdapter, SPIKE_PROFILE} from '../../src/device/http-adapter.js';
import {Player} from '../../src/playback/index.js';
import {FakeDeviceAdapter} from '../../src/device/index.js';
import {MonitorPresentation} from '../../src/presentation/monitor-presentation.js';
import type {CardContext} from '../../src/presentation/card-context.js';
import type {PlaybackSourceStatus} from '../../src/presentation/sources.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';
import {syntheticDashboardViews} from '../../src/presentation/dashboard-examples.js';
import {present} from '../helpers/present.js';

const playing: PlaybackSourceStatus = {source: 'current', view: {card: true, status: 'playing', title: 'SAME', artist: 'SAME', stale: false}};
const context = (observation: string): CardContext => ({observation, artwork: {status: 'missing', generation: observation === 'A' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222'}});
const frame = (value: number): Uint8Array => new Uint8Array(12288).fill(value);
async function flush(clock: ManualClock): Promise<void> {for (let n = 0; n < 100; n++) {await Promise.resolve(); clock.advance(0);}}
async function run(clock: ManualClock, monitor: MonitorPresentation, ms: number): Promise<void> {
  for (let n = 0; n < ms; n += 100) {clock.advance(100); monitor.tick(); await flush(clock);}
}
async function monitorMode(clock: ManualClock, monitor: MonitorPresentation): Promise<void> {
  monitor.submit(present(syntheticDashboardViews()[3]).view);
  await monitor.configure({operation: 'mode', mode: 'monitor'});
  await run(clock, monitor, 1100);
}
async function artworkContext(observation: string): Promise<CardContext> {
  const png = await sharp({create: {width: 1, height: 1, channels: 3, background: observation === 'A' ? {r: 192, g: 24, b: 48} : {r: 24, g: 48, b: 192}}}).png().toBuffer();
  return {observation, artwork: {status: 'ready', generation: observation === 'A' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222', mediaType: 'image/png', width: 1, height: 1, base64: png.toString('base64')}};
}

it('rejects delayed same-text observation A after B and caches only B', async () => {
  const clock = new ManualClock(), device = new FakeDeviceAdapter({clock});
  const player = await Player.open({device, clock, store: new MemoryPlaybackStore()});
  const pending: {observation: string | undefined; resolve: (rgb: Uint8Array) => void}[] = [];
  const monitor = new MonitorPresentation(player, {save: async () => {}, clock: () => clock.now(),
    renderCard: (_view, input) => new Promise<Uint8Array>(resolve => {pending.push({observation: input?.observation, resolve});})});
  try {
    await monitorMode(clock, monitor);
    monitor.submitPlayback(playing, context('A')); await run(clock, monitor, 100);
    monitor.submitPlayback(playing, context('B')); await run(clock, monitor, 100);
    expect(pending.map(p => p.observation)).toEqual(['A', 'B']);
    const cut = device.effects.length;
    present(pending[0]).resolve(frame(11)); await run(clock, monitor, 1000);
    expect(monitor.cachedCard()).toBeNull();
    expect(device.effects.slice(cut).filter(e => e.kind === 'frame').some(e => e.kind === 'frame' && e.frame.rgb[0] === 11)).toBe(false);
    present(pending[1]).resolve(frame(22)); await run(clock, monitor, 1100);
    expect(monitor.cachedCard()).toEqual(frame(22));
    expect(device.effects.filter(e => e.kind === 'frame').at(-1)).toMatchObject({frame: {rgb: frame(22)}});
  } finally {await monitor.close(); await player.close();}
});

it('cancels a superseded queued card without changing player evidence or user brightness outcome', async () => {
  const clock = new ManualClock(), device = new FakeDeviceAdapter({clock, latencyMs: 1000});
  const player = await Player.open({device, clock, store: new MemoryPlaybackStore()});
  try {
    await player.pause();
    const brightness = player.setBrightness(60); await flush(clock);
    const before = player.getState(), controller = new AbortController();
    const upload = player.uploadDashboard([frame(11)], before.generation, {signal: controller.signal, current: () => !controller.signal.aborted});
    await flush(clock); controller.abort(); await flush(clock);
    expect(device.operations.find(e => e.kind === 'uploadAnimation')).toMatchObject({outcome: 'cancelled', priorEffects: 'none'});
    const cancelled = await upload;
    expect(cancelled).toMatchObject({ok: false, code: 'cancelled', priorEffects: 'none'});
    expect(player.getState()).toEqual(before);
    expect(player.getDisplayEvidence().transport).toBeNull();
    clock.advance(1000); await flush(clock);
    expect(await brightness).toMatchObject({ok: true});
    expect(device.effects).toEqual([expect.objectContaining({kind: 'brightness', percent: 60})]);
    expect(player.getDisplayEvidence()).toMatchObject({transport: {source: 'brightness', ok: true}, brightness: {acknowledged: {value: 60}}});
  } finally {await player.close();}
});

it('retains possible partial effects from an internally cancelled card', async () => {
  const clock = new ManualClock(), device = new FakeDeviceAdapter({clock, latencyMs: 1000});
  const player = await Player.open({device, clock, store: new MemoryPlaybackStore(), pauseOnUncertain: true});
  try {
    await player.pause();
    const controller = new AbortController();
    const upload = player.uploadDashboard([frame(11), frame(22)], player.getState().generation, {signal: controller.signal});
    await flush(clock); clock.advance(1000); await flush(clock);
    expect(device.effects.filter(e => e.kind === 'frame')).toHaveLength(1);
    controller.abort(); await flush(clock);
    expect(device.operations.find(e => e.kind === 'uploadAnimation')).toMatchObject({outcome: 'cancelled', priorEffects: 'possible'});
    expect(await upload).toMatchObject({ok: false, code: 'cancelled', priorEffects: 'possible'});
    expect(player.getState()).toMatchObject({intent: 'paused', lastError: {code: 'cancelled', priorEffects: 'possible'}});
  } finally {await player.close();}
});

it('invalidates the queued presentation card on a same-text handoff without suspending Monitor', async () => {
  const clock = new ManualClock(), device = new FakeDeviceAdapter({clock, latencyMs: 1000});
  const player = await Player.open({device, clock, store: new MemoryPlaybackStore()});
  const monitor = new MonitorPresentation(player, {save: async () => {}, clock: () => clock.now(),
    renderCard: (_view, input) => frame(input?.observation === 'A' ? 11 : 22)});
  try {
    await monitorMode(clock, monitor); await run(clock, monitor, 1100);
    const before = player.getState(), previousOutcome = monitor.status().lastOutcome;
    const brightness = player.setBrightness(60); await flush(clock);
    monitor.submitPlayback(playing, await artworkContext('A')); await run(clock, monitor, 100);
    expect(monitor.status().inFlight).toBe(1);
    const cut = device.effects.length;
    monitor.submitPlayback(playing, await artworkContext('B')); await flush(clock);
    expect(device.operations.find(e => e.kind === 'uploadAnimation' && e.outcome === 'cancelled')).toMatchObject({priorEffects: 'none'});
    expect(player.getState()).toEqual(before);
    expect(monitor.status()).toMatchObject({participating: true, lastOutcome: previousOutcome});
    await run(clock, monitor, 3500); expect(await brightness).toMatchObject({ok: true});
    const frames = device.effects.slice(cut).filter(e => e.kind === 'frame');
    expect(frames.some(e => e.kind === 'frame' && e.frame.rgb[0] === 11)).toBe(false);
    expect(frames.at(-1)).toMatchObject({frame: {rgb: frame(22)}});
    expect(player.getState()).toMatchObject({generation: before.generation, intent: 'paused', lastError: null});
    expect(monitor.status().participating).toBe(true);
  } finally {await monitor.close(); await player.close();}
});

it('artwork at four seconds keeps the original Monitor deadline and cannot reopen the expired popup', async () => {
  const clock = new ManualClock(), device = new FakeDeviceAdapter({clock});
  const player = await Player.open({device, clock, store: new MemoryPlaybackStore()});
  const monitor = new MonitorPresentation(player, {save: async () => {}, clock: () => clock.now(),
    renderCard: (_view, input) => frame(input?.artwork?.status === 'ready' ? 22 : 11)});
  try {
    await monitorMode(clock, monitor);
    const started = clock.now();
    monitor.submitPlayback(playing, context('A')); await run(clock, monitor, 4000);
    monitor.submitPlayback(playing, await artworkContext('A')); await run(clock, monitor, 1100);
    expect(monitor.nowPlayingSummary().showing).toBe('card');
    expect(device.effects.filter(e => e.kind === 'frame').at(-1)).toMatchObject({frame: {rgb: frame(22)}});
    await run(clock, monitor, 10000 - (clock.now() - started));
    expect(monitor.nowPlayingSummary().showing).toBe('dashboard');
    const cut = device.effects.length;
    monitor.submitPlayback(playing, await artworkContext('B')); await run(clock, monitor, 2000);
    expect(monitor.nowPlayingSummary().showing).toBe('dashboard');
    expect(device.effects.slice(cut).some(e => e.kind === 'frame' && e.frame.rgb[0] === 22)).toBe(false);
    expect(JSON.stringify(monitor.nowPlayingSummary())).not.toContain('generation');
    expect(JSON.stringify(monitor.nowPlayingSummary())).not.toContain('base64');
  } finally {await monitor.close(); await player.close();}
});

it.each(['off', 'popup', 'whole'] as const)('artwork respects Media %s and preserves the current playlist', async media => {
  const clock = new ManualClock(), device = new FakeDeviceAdapter({clock}), store = new MemoryPlaybackStore();
  store.playlist.repeat = true;
  const player = await Player.open({device, clock, store});
  const monitor = new MonitorPresentation(player, {save: async () => {}, clock: () => clock.now(),
    nowPlaying: {version: 1, media}, renderCard: (_view, input) => frame(input?.artwork?.status === 'ready' ? 22 : 11)});
  try {
    await player.start(store.playlist.id); await flush(clock);
    const playlist = player.getSession()?.playlist.id, started = clock.now();
    monitor.submitPlayback(playing, context('A')); await run(clock, monitor, 4000);
    monitor.submitPlayback(playing, await artworkContext('A')); await run(clock, monitor, 1100);
    const cards = () => device.effects.filter(e => e.kind === 'frame' && e.frame.rgb[0] === 22);
    if (media === 'off') {
      expect(cards()).toHaveLength(0);
      expect(player.getState().intent).toBe('active');
      expect(monitor.nowPlayingSummary()).toMatchObject({takeover: null, showing: 'none'});
    } else {
      expect(cards()).toHaveLength(1);
      expect(player.getState().intent).toBe('paused');
      expect(monitor.nowPlayingSummary()).toMatchObject({takeover: media, showing: 'card'});
    }
    // Identical bytes from a new private association update eligibility without another image upload.
    const sameBytes = await artworkContext('A');
    monitor.submitPlayback(playing, {...sameBytes, observation: 'B'}); await run(clock, monitor, 1000);
    expect(cards()).toHaveLength(media === 'off' ? 0 : 1);
    await run(clock, monitor, 11_000 - (clock.now() - started));
    if (media === 'whole') {
      expect(monitor.nowPlayingSummary().takeover).toBe('whole');
      monitor.submitPlayback({source: 'current', view: {card: false}}); await run(clock, monitor, 1000);
    } else {
      expect(monitor.nowPlayingSummary().takeover).toBeNull();
      monitor.submitPlayback(playing, await artworkContext('B')); await run(clock, monitor, 2000);
      expect(cards()).toHaveLength(media === 'off' ? 0 : 1);
    }
    expect(player.getState().intent).toBe('active');
    expect(player.getSession()?.playlist.id).toBe(playlist);
  } finally {await monitor.close(); await player.close();}
});

it('attention cancels a queued artwork card and clearing attention does not replay it', async () => {
  const clock = new ManualClock(), device = new FakeDeviceAdapter({clock, latencyMs: 1000});
  const player = await Player.open({device, clock, store: new MemoryPlaybackStore()});
  const monitor = new MonitorPresentation(player, {save: async () => {}, clock: () => clock.now(), renderCard: () => frame(22)});
  try {
    await monitorMode(clock, monitor); await run(clock, monitor, 1100);
    const brightness = player.setBrightness(60); await flush(clock);
    monitor.submitPlayback(playing, await artworkContext('A')); await run(clock, monitor, 100);
    expect(monitor.status().inFlight).toBe(1);
    const cut = device.effects.length;
    monitor.submit(present(syntheticDashboardViews()[0]).view); await flush(clock);
    expect(device.operations.find(e => e.kind === 'uploadAnimation' && e.outcome === 'cancelled')).toMatchObject({priorEffects: 'none'});
    await run(clock, monitor, 3500); expect(await brightness).toMatchObject({ok: true});
    monitor.submit(present(syntheticDashboardViews()[3]).view);
    monitor.submitPlayback(playing, await artworkContext('B')); await run(clock, monitor, 12_000);
    expect(device.effects.slice(cut).some(e => e.kind === 'frame' && e.frame.rgb[0] === 22)).toBe(false);
    expect(monitor.nowPlayingSummary()).toMatchObject({showing: 'dashboard', takeover: null});
    expect(monitor.status().participating).toBe(true);
  } finally {await monitor.close(); await player.close();}
});


it('rejects a queued artwork upload released after popup expiry before the next presentation tick', async () => {
  const clock = new ManualClock(), calls: {atMs: number; command: unknown; pixel?: number}[] = [];
  let hold = false, release: (() => void) | undefined;
  const device = new HttpDeviceAdapter({ip: '10.0.0.1', profile: SPIKE_PROFILE, clock}, async body => {
    calls.push({atMs: clock.now(), command: body.Command,
      ...(typeof body.PicData === 'string' ? {pixel: Buffer.from(body.PicData, 'base64')[0]} : {})});
    if (body.Command === 'Channel/SetBrightness' && hold) return new Promise(resolve => {release = () => {resolve({});};});
    return {PicId: 1, SelectIndex: 0};
  });
  const player = await Player.open({device, clock, store: new MemoryPlaybackStore()});
  const monitor = new MonitorPresentation(player, {save: async () => {}, clock: () => clock.now(),
    renderCard: (_view, input) => frame(input?.artwork?.status === 'ready' ? 22 : 11)});
  try {
    await monitorMode(clock, monitor);
    const deadline = clock.now() + 10_000;
    monitor.submitPlayback(playing, context('A')); await run(clock, monitor, 9000);
    hold = true; const brightness = player.setBrightness(60); await flush(clock);
    expect(release).toBeTypeOf('function');
    const before = monitor.status().lastOutcome;
    monitor.submitPlayback(playing, await artworkContext('A')); monitor.tick(); await flush(clock);
    expect(monitor.status().inFlight).toBe(1);
    clock.advance(950); monitor.tick(); await flush(clock);
    expect(clock.now()).toBe(deadline - 50);
    const cut = calls.length;
    clock.advance(70); present(release)(); await flush(clock);
    expect(await brightness).toMatchObject({ok: true});
    expect(calls.slice(cut).filter(call => call.command === 'Draw/SendHttpGif' && call.pixel === 22)).toEqual([]);
    expect(monitor.status()).toMatchObject({participating: true, lastOutcome: before});
    expect(player.getState().lastError).toBeNull();
  } finally {await monitor.close(); await player.close();}
});

it('keeps possible partial effects when card eligibility expires between fake-device frames', async () => {
  const clock = new ManualClock(), device = new FakeDeviceAdapter({clock, latencyMs: 1000});
  const player = await Player.open({device, clock, store: new MemoryPlaybackStore(), pauseOnUncertain: true});
  let eligible = true;
  try {
    await player.pause();
    const upload = player.uploadDashboard([frame(11), frame(22)], player.getState().generation, {current: () => eligible});
    await flush(clock); clock.advance(1000); await flush(clock);
    expect(device.effects.filter(effect => effect.kind === 'frame')).toHaveLength(1);
    eligible = false; clock.advance(1000); await flush(clock);
    expect(await upload).toMatchObject({ok: false, code: 'cancelled', priorEffects: 'possible'});
    expect(device.effects.filter(effect => effect.kind === 'frame')).toHaveLength(1);
    expect(player.getState()).toMatchObject({lastError: {code: 'cancelled', priorEffects: 'possible'}});
  } finally {await player.close();}
});
