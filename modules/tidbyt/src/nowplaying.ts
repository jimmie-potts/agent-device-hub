// The now-playing tile's view and card (Hub #930). Copied from controllers/tidbyt/src/nowplaying.ts at main 627e3fe3 and
// rewritten for the module's synced copy of the 2.0 or 2.1 playback record, which the playback module owns (#929). The record
// replaces the Hub's playback snapshot, so its envelope check (`parsePlaybackSnapshot`) is not copied: the record comes
// from the runtime's bus, whose owners' messages the tests check against profile 2.0. Freshness comes from the record's
// `availability`, never from the age of `observedAtMs`, because the owner publishes no revision for a read that changes
// nothing (#929). While the copy does not follow its owner, the last record's card is dimmed, and it goes once the copy
// has not followed for `PLAYBACK_LOST_MS`.
import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {bits, dim, text, type Rgb} from './draw.js';
import {fontText, glyph, GLYPH_ADVANCE, GLYPH_HEIGHT} from './font.js';
import {FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH, type Frame} from './render.js';

export type NowPlayingView =
  | {card: false}
  | {card: true; status: 'playing' | 'paused'; title: string; artist: string; stale: boolean};
export type CardView = Extract<NowPlayingView, {card: true}>;
/** What the tile knows of the playback record. */
export type PlaybackFeed = {
  /** The configured record in the copy, or the last one it held. */
  record: PlaybackState | undefined;
  /** Whether the copy follows the playback module now. */
  following: boolean;
  /** How long the copy has not followed it, while it does not; 0 while it does. */
  lostForMs: number;
};

/**
 * How long the card outlives a copy that stopped following the playback module, as the Hub stopped serving metadata
 * 30 s after the last observation. The playback module itself turns its record `unavailable` at 30 s.
 */
export const PLAYBACK_LOST_MS = 30_000;

/** Uppercases for the font, folds accents to their base letters and collapses whitespace. */
function cardText(value: string | undefined): string {
  return fontText((value ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim());
}

/**
 * The card for what plays: a playing or paused track that is `available` or `stale`. A `stale` record, or a copy that
 * does not follow the playback module, dims the card. Nothing is shown for an `unavailable` record, unknown playback, a
 * stopped or other input, or a copy lost for `PLAYBACK_LOST_MS`; missing evidence never shows as paused.
 */
export function nowPlayingView({record, following, lostForMs}: PlaybackFeed): NowPlayingView {
  if (!following && lostForMs >= PLAYBACK_LOST_MS) return {card: false};
  if (record === undefined || record.availability === 'unavailable') return {card: false};
  const {playback} = record;
  if (playback.status !== 'known' || (playback.player !== 'playing' && playback.player !== 'paused')) return {card: false};
  return {card: true, status: playback.player, title: cardText(playback.title), artist: cardText(playback.artist), stale: !following || record.availability === 'stale'};
}

export const CARD_ROWS = 4;
export const CARD_COLUMNS = 14;
const TEXT_X = GLYPH_ADVANCE + 1;
const PLAY: readonly number[] = [0b100, 0b110, 0b111, 0b110, 0b100];
const PAUSE: readonly number[] = [0b101, 0b101, 0b101, 0b101, 0b101];

/** Wraps at spaces, splits words longer than a line, and ends cut-off text with `.`. */
function wrap(value: string, lines: number): string[] {
  const out: string[] = [];
  let current = '';
  for (let word of value.split(' ').filter(part => part !== '')) {
    while (word.length > CARD_COLUMNS) {
      if (current !== '') {
        out.push(current);
        current = '';
      }
      out.push(word.slice(0, CARD_COLUMNS));
      word = word.slice(CARD_COLUMNS);
    }
    if (word === '') continue;
    if (current === '') current = word;
    else if (current.length + 1 + word.length <= CARD_COLUMNS) current += ` ${word}`;
    else {
      out.push(current);
      current = word;
    }
  }
  if (current !== '') out.push(current);
  if (out.length <= lines) return out;
  if (lines < 1) return [];
  const kept = out.slice(0, lines);
  const last = kept[lines - 1] ?? '';
  kept[lines - 1] = (last.length < CARD_COLUMNS ? last : last.slice(0, CARD_COLUMNS - 1)) + '.';
  return kept;
}

export type CardLine = {text: string; role: 'title' | 'artist'};

/** The card's text rows: the title first, on up to two rows when there is an artist, then the artist. */
export function cardLines(view: NowPlayingView): CardLine[] {
  if (!view.card) return [];
  const title = wrap(view.title, view.artist === '' ? CARD_ROWS : 2);
  const artist = wrap(view.artist, CARD_ROWS - title.length);
  return [...title.map(line => ({text: line, role: 'title' as const})), ...artist.map(line => ({text: line, role: 'artist' as const}))];
}

export const NOW_PLAYING_COLORS: Readonly<Record<'PLAYING' | 'PAUSED' | 'TITLE' | 'ARTIST', Rgb>> = Object.freeze({
  PLAYING: [40, 200, 80], PAUSED: [255, 160, 0], TITLE: [220, 220, 220], ARTIST: [90, 170, 230],
});

/** Draws a card as a 64x32 RGB frame: a marker, then up to four 8-pixel text rows. */
export function nowPlayingFrame(view: CardView): Frame {
  const rgb = new Uint8Array(FRAME_BYTES);
  const shade = (color: Rgb): Rgb => view.stale ? dim(color) : color;
  const baseline = (row: number): number => row * 8 + Math.floor((8 - GLYPH_HEIGHT) / 2);
  const marker = shade(view.status === 'playing' ? NOW_PLAYING_COLORS.PLAYING : NOW_PLAYING_COLORS.PAUSED);
  bits(rgb, 0, baseline(0), view.stale ? glyph('?') : view.status === 'playing' ? PLAY : PAUSE, marker);
  cardLines(view).forEach((line, row) => {
    text(rgb, TEXT_X, baseline(row), line.text, shade(line.role === 'title' ? NOW_PLAYING_COLORS.TITLE : NOW_PLAYING_COLORS.ARTIST));
  });
  return {width: FRAME_WIDTH, height: FRAME_HEIGHT, rgb};
}
