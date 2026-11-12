// The Pixoo card reads its player again for a display change, never for the Monitor's paging (#1672 PR B round 2).
import {expect, it} from 'vitest';
import {playerKey} from '../../src/frontend/player-key.js';
import type {DisplayRecord} from '../../src/module/schemas.js';

const display: DisplayRecord = {
  id: 'pixoo-1', revision: 10, mode: 'free', pendingMode: null, base: 'status', participating: false, showing: 'none',
  monitor: {filter: {}, cadenceMs: 1000, connection: 'current', sessions: 6, matched: 6, attention: 1, page: 0, pages: 6},
  nowPlaying: {media: 'off', card: false, stale: false, takeover: null},
  player: {state: 'idle', intent: 'stopped', playlistId: null, itemId: null, renditionId: null, lastError: null},
  moments: {overStatus: false, playing: null},
};

it('a Monitor page turn does not read the player again; a player or display change does', () => {
  expect(playerKey(undefined)).toBeUndefined();
  expect(playerKey({...display, revision: 11, monitor: {...display.monitor, page: 1}})).toBe(playerKey(display));
  expect(playerKey({...display, revision: 11, player: {...display.player, state: 'playing'}})).not.toBe(playerKey(display));
  expect(playerKey({...display, revision: 11, showing: 'moment'})).not.toBe(playerKey(display));
  expect(playerKey({...display, revision: 11, base: 'playback'})).not.toBe(playerKey(display));
});
