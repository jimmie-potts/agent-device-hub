import assert from 'node:assert/strict';
import {it} from 'node:test';
import sharp from 'sharp';
import type {ModuleContent} from '@jimmie-potts/sdk';
import type {ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {Player} from '../../src/playback/index.js';
import {FakeDeviceAdapter} from '../../src/device/index.js';
import {MonitorPresentation} from '../../src/presentation/monitor-presentation.js';
import {syntheticDashboardViews} from '../../src/presentation/dashboard-examples.js';
import {monitorView, type PlaybackSourceStatus} from '../../src/presentation/sources.js';
import {readMonitorContent} from '../../src/module/monitor-content.js';
import {ManualClock} from '../helpers/manual-clock.js';
import {MemoryPlaybackStore} from '../helpers/playback-store.js';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';

const request = (query: Readonly<Record<string, string>> = {}) => ({query, signal: new AbortController().signal});
function json<T>(value: ModuleContent | ErrorBody): T {
  assert.ok(!('error' in value)); assert.equal(value.type, 'application/json'); assert.ok(value.bytes.byteLength <= 256 * 1024);
  return JSON.parse(Buffer.from(value.bytes).toString()) as T;
}
void it('reads pending Monitor without rendering, pages projected entity IDs and refuses invalid reads', async () => {
  const clock = new ManualClock(), device = new FakeDeviceAdapter({clock});
  const player = await Player.open({store: new MemoryPlaybackStore(), device, clock});
  let renders = 0;
  const monitor = new MonitorPresentation(player, {save: async () => {}, clock: () => clock.now(),
    renderDashboard: () => { renders++; return [new Uint8Array(12288).fill(23)]; },
    renderCard: () => { renders++; return new Uint8Array(12288).fill(42); }});
  const synthetic = syntheticDashboardViews()[0]?.view.snapshot?.sessions[0]; assert.ok(synthetic);
  const sessions: SessionRecord[] = Array.from({length: 140}, (_, index) => ({...structuredClone(synthetic), activity: 'active',
    id: index.toString(16).padStart(64, '0'), generation: 1,
    label: {value: `界${index}`, origin: 'user'}, revision: 1}));
  const playback: PlaybackSourceStatus = {source: 'current', view: {card: true, status: 'playing', title: 'SYNTHETIC', artist: 'FIXTURE', stale: false}};
  const input = {monitor, sessions, playback};
  try {
    monitor.submit(monitorView({state: 'current', revision: 1, sessions})); monitor.submitPlayback(playback);
    const summary = json<{playback: {frame: string | null}; rendition: {state: string}}>(await readMonitorContent(input, 'monitor', request()));
    assert.equal(summary.playback.frame, null); assert.equal(summary.rendition.state, 'pending'); assert.equal(renders, 0); assert.equal(device.effects.length, 0);
    const ids: string[] = [];
    for (const offset of [0, 100]) {
      const page = json<{items: {id: string; label: string}[]; total: number}>(await readMonitorContent(input, 'monitor-sessions', request({offset: String(offset), limit: '100'})));
      assert.equal(page.total, 140); ids.push(...page.items.map(item => item.id)); assert.ok(page.items.every(item => item.label.startsWith('界')));
    }
    assert.deepEqual(ids, sessions.map(item => item.id)); assert.equal(renders, 0);
    assert.ok('error' in await readMonitorContent(input, 'monitor', request({q: 'extra'})));
    assert.deepEqual((await readMonitorContent(input, 'monitor-frame.1.0', request()) as ErrorBody).error.code, 'not-found');
    const aborted = new AbortController(); aborted.abort();
    assert.equal((await readMonitorContent(input, 'monitor', {query: {}, signal: aborted.signal}) as ErrorBody).error.code, 'cancelled');
    await monitor.configure({operation: 'mode', mode: 'monitor'});
    for (let index = 0; index < 20; index++) await Promise.resolve();
    const rendered = json<{rendition: {frames: string[]}}>(await readMonitorContent(input, 'monitor', request()));
    const ref = rendered.rendition.frames[0]; assert.ok(ref !== undefined);
    const before = renders, effects = device.effects.length;
    const png = await readMonitorContent(input, ref, request()); assert.ok(!('error' in png)); assert.equal(png.type, 'image/png'); assert.ok(png.bytes.byteLength <= 65536);
    const decoded = await sharp(png.bytes).raw().toBuffer(); assert.equal(decoded[0], 23);
    assert.equal(renders, before); assert.equal(device.effects.length, effects, 'GET only encodes cached pixels');
    monitor.nowPlayingStatus(); // Existing presentation setup renders the card; the content read never does.
    const card = monitor.cachedCard(); assert.ok(card); card.fill(0); assert.equal(monitor.cachedCard()?.[0], 42, 'cached card getter returns its own bytes');
    monitor.submitPlayback({...playback, view: {...playback.view, card: false}});
    assert.equal(monitor.cachedCard(), null, 'a previous card is not relabeled as current');
  } finally { await monitor.close(); await player.close(); }
});
