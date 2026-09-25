import { bits, dim, text, type Rgb } from './draw.js';
import { fontText, glyph, GLYPH_ADVANCE, GLYPH_HEIGHT } from './font.js';
import { FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH, type Frame } from './render.js';

/**
 * Pure now-playing view of the hub's shared playback snapshot
 * (`GET /api/playback/v1/snapshot`), and its 64×32 card.
 */
export type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'inactive' | 'unknown';
export type PlaybackSnapshot = {
  apiVersion: '1.0';
  sourceId: string;
  availability: 'available' | 'stale' | 'unavailable';
  observedAtMs: number | null;
  ageMs: number | null;
  playback: null | { status: PlaybackStatus; title?: string; artist?: string; album?: string; controls: string[] };
};
export type NowPlayingView =
  | { card: false }
  | { card: true; status: 'playing' | 'paused'; title: string; artist: string; stale: boolean };
export type NowPlayingViewOptions = {
  /** False when the latest read failed and `snapshot` is the last good one. */
  readOk: boolean;
  /** The snapshot's `ageMs` plus the time since it was received. */
  ageMs: number;
};

/** The hub stops serving metadata at this age; the card goes with it. */
export const PLAYBACK_UNAVAILABLE_MS = 30_000;
const STALE_MS = 5_000;
const TEXT_LIMIT = 256;
const STATUSES: readonly string[] = ['playing', 'paused', 'stopped', 'inactive', 'unknown'];
const AVAILABILITY: readonly string[] = ['available', 'stale', 'unavailable'];

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

const keysWithin = (value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
const age = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const metadata = (value: unknown) => value === undefined
  || (typeof value === 'string' && value.length > 0 && Array.from(value).length <= TEXT_LIMIT);

/** The snapshot when it is a valid version 1.0 envelope for `sourceId`, otherwise undefined. */
export function parsePlaybackSnapshot(value: unknown, sourceId: string): PlaybackSnapshot | undefined {
  const envelope = ['apiVersion', 'sourceId', 'availability', 'observedAtMs', 'ageMs', 'playback'];
  if (!plain(value) || !keysWithin(value, envelope, envelope) || value.apiVersion !== '1.0' || value.sourceId !== sourceId
      || !AVAILABILITY.includes(value.availability as string) || !age(value.observedAtMs) || !age(value.ageMs)) return undefined;
  const playback = value.playback;
  if (value.availability === 'unavailable') return playback === null ? structuredClone(value) as PlaybackSnapshot : undefined;
  // Only a source that was never read has no observation time or age.
  if (value.observedAtMs === null || value.ageMs === null || !plain(playback) || !keysWithin(playback, ['status', 'title', 'artist', 'album', 'controls'], ['status', 'controls'])
      || !STATUSES.includes(playback.status as string) || !metadata(playback.title) || !metadata(playback.artist) || !metadata(playback.album)
      || !Array.isArray(playback.controls) || playback.controls.length > 4 || !playback.controls.every(action => typeof action === 'string')) {
    return undefined;
  }
  return structuredClone(value) as PlaybackSnapshot;
}

/** Uppercase for the font, fold accents to their base letters and collapse whitespace. */
function cardText(value: string | undefined): string {
  return fontText((value ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim());
}

export function nowPlayingView(snapshot: PlaybackSnapshot | undefined, options: NowPlayingViewOptions): NowPlayingView {
  const playback = snapshot?.playback;
  if (!snapshot || snapshot.availability === 'unavailable' || !playback || options.ageMs >= PLAYBACK_UNAVAILABLE_MS
      || (playback.status !== 'playing' && playback.status !== 'paused')) return { card: false };
  return {
    card: true, status: playback.status, title: cardText(playback.title), artist: cardText(playback.artist),
    stale: !options.readOk || snapshot.availability === 'stale' || options.ageMs >= STALE_MS,
  };
}

export const CARD_ROWS = 4;
export const CARD_COLUMNS = 14;
const TEXT_X = GLYPH_ADVANCE + 1;
const PLAY = [0b100, 0b110, 0b111, 0b110, 0b100];
const PAUSE = [0b101, 0b101, 0b101, 0b101, 0b101];

/** Wrap at spaces, split words longer than a line, and end cut-off text with `.`. */
function wrap(value: string, lines: number): string[] {
  const out: string[] = [];
  let current = '';
  for (let word of value.split(' ').filter(Boolean)) {
    while (word.length > CARD_COLUMNS) {
      if (current) { out.push(current); current = ''; }
      out.push(word.slice(0, CARD_COLUMNS));
      word = word.slice(CARD_COLUMNS);
    }
    if (!word) continue;
    if (!current) current = word;
    else if (current.length + 1 + word.length <= CARD_COLUMNS) current += ` ${word}`;
    else { out.push(current); current = word; }
  }
  if (current) out.push(current);
  if (out.length <= lines) return out;
  if (lines < 1) return [];
  const kept = out.slice(0, lines);
  const last = kept[lines - 1];
  kept[lines - 1] = (last.length < CARD_COLUMNS ? last : last.slice(0, CARD_COLUMNS - 1)) + '.';
  return kept;
}

export type CardLine = { text: string; role: 'title' | 'artist' };

/** The card's text rows: the title first, with up to two rows when there is an artist, then the artist. */
export function cardLines(view: NowPlayingView): CardLine[] {
  if (!view.card) return [];
  const title = wrap(view.title, view.artist ? 2 : CARD_ROWS);
  const artist = wrap(view.artist, CARD_ROWS - title.length);
  return [...title.map(line => ({ text: line, role: 'title' as const })), ...artist.map(line => ({ text: line, role: 'artist' as const }))];
}

export const NOW_PLAYING_COLORS: Readonly<Record<'PLAYING' | 'PAUSED' | 'TITLE' | 'ARTIST', Rgb>> = Object.freeze({
  PLAYING: [40, 200, 80], PAUSED: [255, 160, 0], TITLE: [220, 220, 220], ARTIST: [90, 170, 230],
});

/** Draw a card as the renderer's 64×32 RGB frame: a marker, then up to four 8-pixel text rows. */
export function nowPlayingFrame(view: NowPlayingView): Frame {
  if (!view.card) throw new Error('now-playing-frame-needs-a-card');
  const rgb = new Uint8Array(FRAME_BYTES);
  const shade = (color: Rgb) => view.stale ? dim(color) : color;
  const baseline = (row: number) => row * 8 + Math.floor((8 - GLYPH_HEIGHT) / 2);
  const marker = shade(view.status === 'playing' ? NOW_PLAYING_COLORS.PLAYING : NOW_PLAYING_COLORS.PAUSED);
  bits(rgb, 0, baseline(0), view.stale ? glyph('?') : view.status === 'playing' ? PLAY : PAUSE, marker);
  cardLines(view).forEach((line, row) => {
    text(rgb, TEXT_X, baseline(row), line.text, shade(line.role === 'title' ? NOW_PLAYING_COLORS.TITLE : NOW_PLAYING_COLORS.ARTIST));
  });
  return { width: FRAME_WIDTH, height: FRAME_HEIGHT, rgb };
}
