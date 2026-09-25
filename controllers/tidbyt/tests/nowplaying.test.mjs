import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cardLines, nowPlayingFrame, nowPlayingView, parsePlaybackSnapshot, renderFrame, FRAME_BYTES, NOW_PLAYING_COLORS,
} from '../dist/index.js';

const snapshot = (playback = {}, extra = {}) => ({
  apiVersion: '1.0', sourceId: 'ht-a9', availability: 'available', observedAtMs: 1_790_000_000_000, ageMs: 800,
  playback: { status: 'playing', title: 'Harvest Moon', artist: 'Neil Young', album: 'Harvest Moon', controls: ['pause', 'next', 'previous'], ...playback },
  ...extra,
});
const fresh = { readOk: true, ageMs: 800 };

test('a playing or paused track is a card with its title and artist', () => {
  assert.deepEqual(nowPlayingView(snapshot(), fresh),
    { card: true, status: 'playing', title: 'HARVEST MOON', artist: 'NEIL YOUNG', stale: false });
  assert.deepEqual(nowPlayingView(snapshot({ status: 'paused', controls: [] }), fresh),
    { card: true, status: 'paused', title: 'HARVEST MOON', artist: 'NEIL YOUNG', stale: false });
});

test('a stale snapshot or a failed read keeps the card, marked stale, until 30 seconds', () => {
  const stale = nowPlayingView(snapshot({}, { availability: 'stale', ageMs: 6000 }), { readOk: true, ageMs: 6000 });
  assert.equal(stale.card && stale.stale, true);
  const failed = nowPlayingView(snapshot(), { readOk: false, ageMs: 4000 });
  assert.equal(failed.card && failed.stale, true, 'a failed read is stale even while the last observation is young');
  assert.deepEqual(nowPlayingView(snapshot(), { readOk: false, ageMs: 30_000 }), { card: false });
  assert.deepEqual(nowPlayingView(snapshot({}, { availability: 'stale', ageMs: 29_000 }), { readOk: true, ageMs: 30_500 }), { card: false });
});

test('unavailable, stopped, inactive and unknown playback show nothing, and nothing never becomes paused', () => {
  assert.deepEqual(nowPlayingView(undefined, { readOk: false, ageMs: 0 }), { card: false });
  assert.deepEqual(nowPlayingView({ ...snapshot(), availability: 'unavailable', ageMs: null, playback: null }, { readOk: true, ageMs: 0 }), { card: false });
  for (const status of ['stopped', 'inactive', 'unknown']) {
    assert.deepEqual(nowPlayingView(snapshot({ status, controls: [] }), fresh), { card: false }, status);
  }
});

test('snapshots are validated strictly against the configured source', () => {
  const good = snapshot();
  assert.deepEqual(parsePlaybackSnapshot(good, 'ht-a9'), good);
  const unavailable = { ...good, availability: 'unavailable', observedAtMs: null, ageMs: null, playback: null };
  assert.deepEqual(parsePlaybackSnapshot(unavailable, 'ht-a9'), unavailable);
  const { title: _t, artist: _a, album: _b, ...bare } = good.playback;
  assert.deepEqual(parsePlaybackSnapshot({ ...good, playback: bare }, 'ht-a9'), { ...good, playback: bare });
  const bad = [
    { ...good, sourceId: 'other' },
    { ...good, apiVersion: '2.0' },
    { ...good, availability: 'fresh' },
    { ...good, ageMs: -1 },
    { ...good, ageMs: '5' },
    { ...good, ageMs: null },
    { ...good, observedAtMs: null },
    { ...good, extra: true },
    { ...good, playback: null },
    { ...unavailable, playback: good.playback },
    { ...good, playback: { ...good.playback, status: 'buffering' } },
    { ...good, playback: { ...good.playback, title: '' } },
    { ...good, playback: { ...good.playback, title: 'x'.repeat(257) } },
    { ...good, playback: { ...good.playback, controls: 'pause' } },
    { ...good, playback: { ...good.playback, controls: [1] } },
    { ...good, playback: { ...good.playback, artwork: 'http://192.168.1.20/art' } },
    null, [], 'text',
  ];
  for (const value of bad) assert.equal(parsePlaybackSnapshot(value, 'ht-a9'), undefined, JSON.stringify(value)?.slice(0, 80));
  assert.deepEqual(parsePlaybackSnapshot({ ...good, playback: { ...good.playback, title: '𝄞'.repeat(256) } }, 'ht-a9')?.playback.title, '𝄞'.repeat(256));
});

test('text folds accents, keeps common punctuation and draws the rest as -', () => {
  const view = nowPlayingView(snapshot({ title: "Don't Stop (Live!)", artist: 'Beyoncé & JAY-Z' }), fresh);
  assert.equal(view.title, "DON'T STOP (LIVE!)");
  assert.equal(view.artist, 'BEYONCE & JAY-Z');
  assert.equal(nowPlayingView(snapshot({ title: 'AC/DC: Live, 1991', artist: 'Motörhead 東京' }), fresh).artist, 'MOTORHEAD --');
  assert.equal(nowPlayingView(snapshot({ title: "a/b: c, d'e & (f)!" }), fresh).title, "A/B: C, D'E & (F)!");
});

test('title and artist wrap at spaces into four 14-character rows and truncate with a period', () => {
  const lines = view => cardLines(nowPlayingView(snapshot(view), fresh));
  assert.deepEqual(lines({ title: 'Harvest Moon', artist: 'Neil Young' }), [
    { text: 'HARVEST MOON', role: 'title' }, { text: 'NEIL YOUNG', role: 'artist' },
  ]);
  assert.deepEqual(lines({ title: 'The Ballad of John and Yoko Ono Band', artist: 'The Beatles With Billy Preston and Friends' }), [
    { text: 'THE BALLAD OF', role: 'title' }, { text: 'JOHN AND YOKO.', role: 'title' },
    { text: 'THE BEATLES', role: 'artist' }, { text: 'WITH BILLY.', role: 'artist' },
  ]);
  assert.deepEqual(lines({ title: 'Supercalifragilisticexpialidocious', artist: undefined }), [
    { text: 'SUPERCALIFRAGI', role: 'title' }, { text: 'LISTICEXPIALID', role: 'title' }, { text: 'OCIOUS', role: 'title' },
  ]);
  assert.deepEqual(lines({ title: undefined, artist: 'Neil Young' }), [{ text: 'NEIL YOUNG', role: 'artist' }]);
  assert.deepEqual(lines({ title: 'Short', artist: 'An Artist Whose Name Runs Over Three Lines Of Text' }), [
    { text: 'SHORT', role: 'title' },
    { text: 'AN ARTIST', role: 'artist' }, { text: 'WHOSE NAME', role: 'artist' }, { text: 'RUNS OVER.', role: 'artist' },
  ]);
  for (const line of lines({ title: 'x'.repeat(200), artist: 'y '.repeat(100) })) assert(line.text.length <= 14, line.text);
});

function pixel(rgb, x, y) {
  const at = (y * 64 + x) * 3;
  return [rgb[at], rgb[at + 1], rgb[at + 2]];
}

test('the card is a valid renderer frame with a play or pause marker and colored rows', () => {
  const playing = nowPlayingFrame(nowPlayingView(snapshot(), fresh));
  assert.equal(playing.rgb.length, FRAME_BYTES);
  assert.equal(renderFrame(playing).ok, true);
  assert.deepEqual(pixel(playing.rgb, 0, 1), NOW_PLAYING_COLORS.PLAYING, 'play triangle apex column');
  assert.deepEqual(pixel(playing.rgb, 2, 1), [0, 0, 0], 'triangle point is not filled on its first row');
  const paused = nowPlayingFrame(nowPlayingView(snapshot({ status: 'paused', controls: [] }), fresh));
  assert.deepEqual(pixel(paused.rgb, 0, 1), NOW_PLAYING_COLORS.PAUSED);
  assert.deepEqual(pixel(paused.rgb, 2, 1), NOW_PLAYING_COLORS.PAUSED);
  assert.deepEqual(pixel(paused.rgb, 1, 1), [0, 0, 0], 'pause bars have a gap');
  // H in row 0 at x = 5 and N in row 1 at x = 5 both light their top-left pixel.
  assert.deepEqual(pixel(playing.rgb, 5, 1), NOW_PLAYING_COLORS.TITLE);
  assert.deepEqual(pixel(playing.rgb, 5, 9), NOW_PLAYING_COLORS.ARTIST);
  assert.notDeepEqual(playing.rgb, paused.rgb);
});

test('a stale card is dimmed with a ? marker', () => {
  const view = nowPlayingView(snapshot({}, { availability: 'stale', ageMs: 6000 }), { readOk: true, ageMs: 6000 });
  const { rgb } = nowPlayingFrame(view);
  const dim = color => color.map(value => Math.floor(value / 3));
  assert.deepEqual(pixel(rgb, 0, 1), dim(NOW_PLAYING_COLORS.PLAYING), '? glyph top-left');
  assert.deepEqual(pixel(rgb, 2, 2), dim(NOW_PLAYING_COLORS.PLAYING), '? glyph right edge');
  assert.deepEqual(pixel(rgb, 5, 1), dim(NOW_PLAYING_COLORS.TITLE));
  assert.deepEqual(pixel(rgb, 5, 9), dim(NOW_PLAYING_COLORS.ARTIST));
});

test('drawing requires a card', () => {
  assert.throws(() => nowPlayingFrame({ card: false }));
});
