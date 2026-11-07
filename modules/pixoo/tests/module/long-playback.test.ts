import assert from 'node:assert/strict';
import {it} from 'node:test';
import {setTimeout as sleep} from 'node:timers/promises';
import {z} from 'zod';
import {gifFixture} from '../helpers/media-fixtures.js';
import {FAMILIES} from '../../src/module/schemas.js';
import {World, bytesOf, waitFor} from './support.js';

const maxDelay = 2 ** 31 - 1;
const duration = 59 * 60_000 * 620;
const playerState = z.object({state: z.object({state: z.string(), dwellDeadlineMs: z.number().nullable()})});

for (const ending of ['repeat', 'pause', 'replace'] as const) {
  void it(`the native Pixoo timer preserves a long playback until its final slice (${ending})`, async t => {
    const world = await World.open();
    const nativeTimer = globalThis.setTimeout;
    const long: {delay: number; fire: () => void}[] = [];
    t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number, ...args: unknown[]) => {
      if (delay < 1_000_000) return nativeTimer(callback, delay, ...args);
      const timer = nativeTimer(() => {}, delay); timer.unref();
      long.push({delay, fire: () => { clearTimeout(timer); callback(); }});
      return timer;
    });
    const now = Date.now;
    let elapsed = 0;
    t.mock.method(Date, 'now', () => now() + elapsed);
    const state = async () => {
      const result = await world.module.manifest.content?.('player');
      assert.ok(result !== undefined && !('error' in result));
      return playerState.parse(JSON.parse(Buffer.from(result.bytes).toString())).state;
    };
    try {
      let renditionId = '';
      await world.populate(async library => {
        const bytes = gifFixture(64, 64, Array.from({length: 59}, () => ({width: 1, height: 1, delay: 6000, pixels: [1]})));
        renditionId = (await library.importMedia(bytesOf(bytes), 'Long direct animation')).rendition.id;
      });
      await world.start();
      const shown = await world.request(FAMILIES.show, 'org.bunny.pixoo-media.show.requested', {renditionId, playback: {mode: 'plays', totalPlays: 620}});
      assert.ok(shown.status === 'accepted'); assert.equal((await world.outcome(shown.requestId)).data.result, 'succeeded');
      const first = await waitFor(() => long.shift(), 'first native slice');
      assert.equal(first.delay, maxDelay);
      const playing = await state();
      assert.equal(playing.state, 'playing');
      const writes = world.device.state().sent;
      elapsed += maxDelay; first.fire(); await sleep(15);
      assert.deepEqual(await state(), playing);
      const last = long.shift();
      assert.ok(last !== undefined);
      assert.ok(Math.abs(last.delay - (duration - maxDelay)) < 100);
      if (ending === 'pause') {
        const paused = await world.request('media-control', 'org.bunny.media.control.requested', {action: 'pause'});
        assert.ok(paused.status === 'accepted'); await world.outcome(paused.requestId);
      } else if (ending === 'replace') {
        const replacement = await world.request(FAMILIES.show, 'org.bunny.pixoo-media.show.requested', {renditionId,
          playback: {mode: 'duration', durationMs: 180_000}});
        assert.ok(replacement.status === 'accepted'); await world.outcome(replacement.requestId);
        await waitFor(() => world.device.state().sent === writes + 1 ? true : undefined, 'replacement playback');
      }
      elapsed += last.delay; last.fire(); await sleep(15);
      if (ending === 'repeat') {
        await waitFor(() => world.device.state().sent === writes + 1 && long.length === 1 ? true : undefined, 'one next playback');
        assert.equal((await state()).state, 'playing');
      } else {
        assert.equal((await state()).state, ending === 'pause' ? 'paused' : 'playing');
        assert.equal(world.device.state().sent, ending === 'pause' ? writes : writes + 1);
        assert.equal(long.length, 0);
      }
    } finally { await world.close(); }
  });
}
