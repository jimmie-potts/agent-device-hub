// The now-playing tile's view and card (Hub #930). Copied from controllers/tidbyt/tests/nowplaying.test.mjs at main
// 627e3fe3 and converted to the `playback/2.0` record. The snapshot envelope's check is not copied: the record comes from
// the playback module on the bus. Freshness is the record's `availability`, never the age of `observedAtMs`, and a copy
// that stopped following the playback module stands in for the runner's failed read.
import assert from 'node:assert/strict';
import test from 'node:test';
import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {CARD_COLUMNS, NOW_PLAYING_COLORS, PLAYBACK_LOST_MS, cardLines, nowPlayingFrame, nowPlayingView, type CardView, type NowPlayingView} from '../src/nowplaying.js';
import {FRAME_BYTES, renderFrame} from '../src/render.js';
import {playback, unavailablePlayback} from './support.js';

const record = (player: Parameters<typeof playback>[0] = 'playing', extra: Partial<PlaybackState> = {}, track: {title?: string; artist?: string} = {title: 'Harvest Moon', artist: 'Neil Young'}): PlaybackState =>
  playback(player, extra, track);
const fresh = (value: PlaybackState | undefined): NowPlayingView => nowPlayingView({record: value, following: true, lostForMs: 0});
const card = (view: NowPlayingView): CardView => {
  assert.ok(view.card, 'a card');
  return view;
};

void test('a playing or paused track is a card with its title and artist', () => {
  assert.deepEqual(fresh(record()), {card: true, status: 'playing', title: 'HARVEST MOON', artist: 'NEIL YOUNG', stale: false});
  assert.deepEqual(fresh(record('paused')), {card: true, status: 'paused', title: 'HARVEST MOON', artist: 'NEIL YOUNG', stale: false});
});

void test('a stale record or a lost copy keeps the card, marked stale; a copy lost for 30 seconds shows nothing', () => {
  assert.equal(card(fresh(record('playing', {availability: 'stale'}))).stale, true);
  assert.equal(card(nowPlayingView({record: record(), following: false, lostForMs: 4000})).stale, true, 'a lost copy is stale even while its record is fresh');
  assert.deepEqual(nowPlayingView({record: record(), following: false, lostForMs: PLAYBACK_LOST_MS}), {card: false});
  assert.equal(card(nowPlayingView({record: record(), following: true, lostForMs: PLAYBACK_LOST_MS})).stale, false, 'a following copy never ages out by itself');
  assert.equal(card(fresh(record('playing', {observedAtMs: 0}))).stale, false, 'the age of observedAtMs is never judged');
});

void test('unavailable, stopped, inactive and unknown playback show nothing, and nothing never becomes paused', () => {
  assert.deepEqual(fresh(undefined), {card: false});
  assert.deepEqual(fresh(unavailablePlayback()), {card: false});
  for (const player of ['stopped', 'inactive', 'unknown'] as const) assert.deepEqual(fresh(record(player)), {card: false}, player);
  assert.deepEqual(fresh({...record(), playback: {status: 'unknown'}}), {card: false});
});

void test('text folds accents, keeps common punctuation and draws the rest as -', () => {
  const view = card(fresh(record('playing', {}, {title: 'Don\'t Stop (Live!)', artist: 'Beyoncé & JAY-Z'})));
  assert.equal(view.title, 'DON\'T STOP (LIVE!)');
  assert.equal(view.artist, 'BEYONCE & JAY-Z');
  assert.equal(card(fresh(record('playing', {}, {title: 'AC/DC: Live, 1991', artist: 'Motörhead 東京'}))).artist, 'MOTORHEAD --');
  assert.equal(card(fresh(record('playing', {}, {title: 'a/b: c, d\'e & (f)!'}))).title, 'A/B: C, D\'E & (F)!');
});

void test('title and artist wrap at spaces into four 14-character rows and truncate with a period', () => {
  const lines = (track: {title?: string; artist?: string}): ReturnType<typeof cardLines> => cardLines(fresh(record('playing', {}, track)));
  assert.deepEqual(lines({title: 'Harvest Moon', artist: 'Neil Young'}), [{text: 'HARVEST MOON', role: 'title'}, {text: 'NEIL YOUNG', role: 'artist'}]);
  assert.deepEqual(lines({title: 'The Ballad of John and Yoko Ono Band', artist: 'The Beatles With Billy Preston and Friends'}), [
    {text: 'THE BALLAD OF', role: 'title'}, {text: 'JOHN AND YOKO.', role: 'title'},
    {text: 'THE BEATLES', role: 'artist'}, {text: 'WITH BILLY.', role: 'artist'},
  ]);
  assert.deepEqual(lines({title: 'Supercalifragilisticexpialidocious'}), [
    {text: 'SUPERCALIFRAGI', role: 'title'}, {text: 'LISTICEXPIALID', role: 'title'}, {text: 'OCIOUS', role: 'title'},
  ]);
  assert.deepEqual(lines({artist: 'Neil Young'}), [{text: 'NEIL YOUNG', role: 'artist'}]);
  assert.deepEqual(lines({title: 'Short', artist: 'An Artist Whose Name Runs Over Three Lines Of Text'}), [
    {text: 'SHORT', role: 'title'},
    {text: 'AN ARTIST', role: 'artist'}, {text: 'WHOSE NAME', role: 'artist'}, {text: 'RUNS OVER.', role: 'artist'},
  ]);
  for (const line of lines({title: 'x'.repeat(200), artist: 'y '.repeat(100)})) assert.ok(line.text.length <= CARD_COLUMNS, line.text);
});

function pixel(rgb: Uint8Array, x: number, y: number): number[] {
  const at = (y * 64 + x) * 3;
  return [rgb[at] ?? -1, rgb[at + 1] ?? -1, rgb[at + 2] ?? -1];
}

void test('the card is a valid renderer frame with a play or pause marker and colored rows', () => {
  const playing = nowPlayingFrame(card(fresh(record())));
  assert.equal(playing.rgb.length, FRAME_BYTES);
  assert.equal(renderFrame(playing).ok, true);
  assert.deepEqual(pixel(playing.rgb, 0, 1), NOW_PLAYING_COLORS.PLAYING, 'the play triangle\'s apex column');
  assert.deepEqual(pixel(playing.rgb, 2, 1), [0, 0, 0], 'the triangle\'s point is not filled on its first row');
  const paused = nowPlayingFrame(card(fresh(record('paused'))));
  assert.deepEqual(pixel(paused.rgb, 0, 1), NOW_PLAYING_COLORS.PAUSED);
  assert.deepEqual(pixel(paused.rgb, 2, 1), NOW_PLAYING_COLORS.PAUSED);
  assert.deepEqual(pixel(paused.rgb, 1, 1), [0, 0, 0], 'the pause bars have a gap');
  // H in row 0 at x = 5 and N in row 1 at x = 5 both light their top-left pixel.
  assert.deepEqual(pixel(playing.rgb, 5, 1), NOW_PLAYING_COLORS.TITLE);
  assert.deepEqual(pixel(playing.rgb, 5, 9), NOW_PLAYING_COLORS.ARTIST);
  assert.notDeepEqual(playing.rgb, paused.rgb);
});

void test('a stale card is dimmed with a ? marker', () => {
  const {rgb} = nowPlayingFrame(card(fresh(record('playing', {availability: 'stale'}))));
  const dim = (color: readonly number[]): number[] => color.map(value => Math.floor(value / 3));
  assert.deepEqual(pixel(rgb, 0, 1), dim(NOW_PLAYING_COLORS.PLAYING), 'the ? glyph\'s top-left');
  assert.deepEqual(pixel(rgb, 2, 2), dim(NOW_PLAYING_COLORS.PLAYING), 'the ? glyph\'s right edge');
  assert.deepEqual(pixel(rgb, 5, 1), dim(NOW_PLAYING_COLORS.TITLE));
  assert.deepEqual(pixel(rgb, 5, 9), dim(NOW_PLAYING_COLORS.ARTIST));
});
