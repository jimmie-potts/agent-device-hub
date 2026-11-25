// During a re-read a Pixoo card playback control sends only what the newer display record agrees with (#2124).
import {expect, it} from 'vitest';
import {liveDuringRefresh} from '../../src/frontend/refresh-gate.js';
import type {Reading} from '../../src/frontend/player.js';
import type {DisplayRecord} from '../../src/module/schemas.js';

const session = '11111111-1111-4111-8111-111111111111', playlist = '22222222-2222-4222-8222-222222222222';
const first = '33333333-3333-4333-8333-333333333333', second = '44444444-4444-4444-8444-444444444444';
const reading = (state: 'playing' | 'paused' | 'loading', lastError: string | null = null, itemId = first): Reading => ({
  state: {state, intent: state === 'paused' ? 'paused' : 'active', availability: 'available', requestedScreenOn: true, sessionId: session, itemId, dwellDeadlineMs: null,
    lastError: lastError === null ? null : {code: lastError}},
  session: {id: session, playlist: {id: playlist, name: 'Synthetic', revision: 1, repeat: true, shuffle: false,
    items: [{id: first, renditionId: 'rendition-1', playback: {mode: 'duration', durationMs: 1000}}, {id: second, renditionId: 'rendition-2', playback: {mode: 'duration', durationMs: 1000}}]}},
  sampledAtMs: 0, simulated: true,
});
const record = (state: DisplayRecord['player']['state'], intent: DisplayRecord['player']['intent'], change: Partial<DisplayRecord['player']> = {}): DisplayRecord['player'] => ({
  state, intent, playlistId: playlist, itemId: first, renditionId: 'rendition-1', lastError: null, ...change,
});

it('Pause stays live whatever the newer record says', () => {
  for (const player of [record('playing', 'active'), record('paused', 'paused'), record('loading', 'active', {itemId: second, renditionId: 'rendition-2'}), record('idle', 'stopped', {playlistId: null, itemId: null, renditionId: null})]) {
    expect(liveDuringRefresh('pause', reading('playing'), player)).toBe(true);
  }
});

it('Resume stays live only while the record agrees the player is stopped at the same item with the same error', () => {
  expect(liveDuringRefresh('resume', reading('paused'), record('paused', 'paused'))).toBe(true);
  expect(liveDuringRefresh('resume', reading('paused', 'external-control'), record('paused', 'paused', {lastError: 'external-control'}))).toBe(true);
  // Another surface resumed: the record is starting or playing.
  expect(liveDuringRefresh('resume', reading('paused'), record('loading', 'active'))).toBe(false);
  expect(liveDuringRefresh('resume', reading('paused'), record('playing', 'active'))).toBe(false);
  // The record carries an error the read does not show, or no longer carries the read's error.
  expect(liveDuringRefresh('resume', reading('paused'), record('paused', 'paused', {lastError: 'external-control'}))).toBe(false);
  expect(liveDuringRefresh('resume', reading('paused', 'upload-failed'), record('paused', 'paused'))).toBe(false);
  // The record moved to another item or session source.
  expect(liveDuringRefresh('resume', reading('paused'), record('paused', 'paused', {itemId: second, renditionId: 'rendition-2'}))).toBe(false);
  expect(liveDuringRefresh('resume', reading('paused'), record('paused', 'paused', {playlistId: null}))).toBe(false);
});

it('Next and Previous stay live only while the record shows the same playlist, item and rendition', () => {
  for (const action of ['next', 'previous'] as const) {
    expect(liveDuringRefresh(action, reading('playing'), record('playing', 'active'))).toBe(true);
    expect(liveDuringRefresh(action, reading('playing'), record('loading', 'active'))).toBe(true);
    expect(liveDuringRefresh(action, reading('paused'), record('paused', 'paused'))).toBe(true);
    expect(liveDuringRefresh(action, reading('playing'), record('loading', 'active', {itemId: second, renditionId: 'rendition-2'}))).toBe(false);
    expect(liveDuringRefresh(action, reading('playing'), record('playing', 'active', {renditionId: 'rendition-2'}))).toBe(false);
    expect(liveDuringRefresh(action, reading('playing'), record('playing', 'active', {playlistId: null}))).toBe(false);
    expect(liveDuringRefresh(action, reading('playing'), record('idle', 'stopped', {playlistId: null, itemId: null, renditionId: null}))).toBe(false);
  }
});

it('Restart with changes and every other media action wait for the read', () => {
  for (const action of ['restart-with-changes', 'stop', 'clear'] as const) expect(liveDuringRefresh(action, reading('playing'), record('playing', 'active'))).toBe(false);
});
