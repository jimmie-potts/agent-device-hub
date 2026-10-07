// The status tile's view and frame (Hub #930). Copied from controllers/tidbyt/tests/status.test.mjs at main 627e3fe3 and
// converted to `session/2.0` records and a synced copy instead of a 1.x snapshot. A faulted collector has no 2.0 home: a
// copy that has not synced, or whose later sync failed, is the unavailable feed (MAPPING.md, "Agent status").
import assert from 'node:assert/strict';
import test from 'node:test';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {FRAME_BYTES, renderFrame, type Frame} from '../src/render.js';
import {STATUS_COLORS, statusFrame, statusView, type StatusView} from '../src/status.js';
import {titleSessions} from './frames.js';
import {asking, finished, identity, notice, session, working} from './support.js';

const label = (value: string): NonNullable<SessionRecord['label']> => ({value, origin: 'user'});
const copy = (sessions: readonly SessionRecord[], synced = true): {synced: boolean; sessions: readonly SessionRecord[]} => ({synced, sessions});
const rowSummary = (view: StatusView): string[] => view.rows.map(row => {
  switch (row.kind) {
    case 'session':
      return `${row.label} ${row.state}${row.uncertain ? '?' : ''}`;
    case 'more':
      return `+${row.count}`;
    case 'feed':
      return 'FEED?';
  }
});

void test('multiple sessions show ASK, RUN and DONE in order and omit idle, unknown and child sessions', () => {
  const parent = working({label: label('hub-work')});
  const view = statusView(copy([
    finished({label: label('docs')}),
    session({label: label('idle')}),
    session({label: label('unknown'), activity: 'unknown'}),
    working({label: label('child'), parent: {status: 'known', identity: {...parent.identity, sessionId: 'child-1'}}}),
    parent,
    asking({label: label('review-bot')}),
  ]));
  assert.deepEqual(rowSummary(view), ['REVIEW-BOT ASK', 'HUB-WORK RUN', 'DOCS DONE']);
  assert.equal(view.feed, 'available');
  assert.equal(view.idle, false);
});

void test('a root session whose child is active counts as working', () => {
  const view = statusView(copy([session({label: label('parent'), children: {active: 1, uncertain: 0}})]));
  assert.deepEqual(rowSummary(view), ['PARENT RUN']);
  assert.equal(view.idle, false);
});

void test('newer evidence comes first within a state', () => {
  const view = statusView(copy([working({label: label('old'), lastEvidenceAtMs: 10}), working({label: label('new'), lastEvidenceAtMs: 20})]));
  assert.deepEqual(rowSummary(view), ['NEW RUN', 'OLD RUN']);
});

void test('more than four sessions draw three rows and a +N MORE row', () => {
  const view = statusView(copy(Array.from({length: 6}, (_, i) => working({identity: identity(), label: label(`s${i}`), lastEvidenceAtMs: 100 - i}))));
  assert.deepEqual(rowSummary(view), ['S0 RUN', 'S1 RUN', 'S2 RUN', '+3']);
  const four = statusView(copy(Array.from({length: 4}, (_, i) => working({identity: identity(), label: label(`s${i}`)}))));
  assert.equal(four.rows.length, 4);
  assert.ok(four.rows.every(row => row.kind === 'session'));
});

void test('read evidence does not retire DONE; acknowledgment by a configured consumer does', () => {
  const read = finished({label: label('read'), read: 'read', lastEvidenceAtMs: 20});
  const acked = session({label: label('acked'), notices: [notice(['pixoo'])], lastEvidenceAtMs: 10});
  assert.deepEqual(rowSummary(statusView(copy([read, acked]))), ['READ DONE']);
  assert.deepEqual(rowSummary(statusView(copy([read, acked]), {acknowledgingConsumers: ['nanoleaf']})), ['READ DONE', 'ACKED DONE']);
  assert.deepEqual(rowSummary(statusView(copy([read, acked]), {acknowledgingConsumers: ['pixoo']})), ['READ DONE']);
});

void test('a session with no evidence of work is never shown as done, and an empty synced copy is idle', () => {
  const view = statusView(copy([session({activity: 'unknown'}), session({activity: 'idle'}), session({activity: 'interrupted'})]));
  assert.deepEqual(view.rows, []);
  assert.equal(view.idle, true);
});

void test('labels prefer the user label, then the project ID, then a neutral hashed ID', () => {
  const plain = working();
  const view = statusView(copy([
    working({label: label('a very long user label'), lastEvidenceAtMs: 30}),
    working({projectId: 'proj_1', lastEvidenceAtMs: 20}),
    {...plain, lastEvidenceAtMs: 10},
  ]));
  const labels = view.rows.map(row => row.kind === 'session' ? row.label : '');
  assert.equal(labels[0], 'A VERY LON');
  assert.equal(labels[1], 'PROJ-1');
  assert.match(labels[2] ?? '', /^C-[0-9A-F]{4}$/);
  const [alone] = statusView(copy([plain])).rows;
  assert.equal(alone?.kind === 'session' ? alone.label : '', labels[2], 'the neutral ID is stable');
  const codex = working({identity: {...plain.identity, provider: 'codex', client: 'cli'}});
  const [shown] = statusView(copy([codex])).rows;
  assert.match(shown?.kind === 'session' ? shown.label : '', /^X-[0-9A-F]{4}$/);
  const text = JSON.stringify(view);
  for (const value of Object.values(plain.identity)) assert.ok(!text.toUpperCase().includes(value.toUpperCase()), `identity field ${value} leaked`);
});

void test('titles follow explicit labels and precede project display names and legacy IDs', () => {
  const title = {value: 'Review the launch plan', source: 'provider'} as const;
  const first = (extra: Partial<SessionRecord>): string => {
    const [row] = statusView(copy([working(extra)])).rows;
    return row?.kind === 'session' ? row.label : '';
  };
  assert.equal(first({label: label('My label'), title, project: 'Hub project'}), 'MY LABEL');
  assert.equal(first({title, project: 'Hub project', projectId: 'legacy'}), 'REVIEW THE');
  assert.equal(first({title: {value: 'Café 東京', source: 'user'}}), 'CAF- --');
  assert.equal(first({project: 'Hub project', projectId: 'legacy'}), 'HUB PROJEC');
  assert.equal(first({projectId: 'legacy'}), 'LEGACY');
});

void test('uncertain freshness marks one row; an unavailable copy marks every row and never reports idle', () => {
  const view = statusView(copy([working({label: label('stale'), freshness: 'uncertain'}), asking({label: label('fresh')})]));
  assert.deepEqual(rowSummary(view), ['FRESH ASK', 'STALE RUN?']);
  const lost = statusView(copy([working({label: label('x')})], false));
  assert.equal(lost.feed, 'unavailable');
  assert.deepEqual(rowSummary(lost), ['X RUN?']);
  assert.equal(lost.idle, false);
  for (const empty of [statusView(undefined), statusView(copy([], false))]) {
    assert.deepEqual(rowSummary(empty), ['FEED?']);
    assert.equal(empty.idle, false);
  }
});

const pixel = (frame: Frame, x: number, y: number): number[] => Array.from(frame.rgb.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3));
const rowPixels = (frame: Frame, row: number): number[][] => {
  const values: number[][] = [];
  for (let y = row * 8; y < row * 8 + 8; y += 1) for (let x = 0; x < 64; x += 1) values.push(pixel(frame, x, y));
  return values;
};
const lit = (pixels: number[][]): number[][] => pixels.filter(p => p.some(v => v > 0));
const brightest = (pixels: number[][]): number => Math.max(...pixels.flat());

void test('the status frame is a valid renderer frame with a state-colored marker per row', () => {
  const view = statusView(copy([asking({label: label('a')}), working({label: label('b')}), finished({label: label('c')})]));
  const frame = statusFrame(view);
  assert.equal(frame.width, 64);
  assert.equal(frame.height, 32);
  assert.equal(frame.rgb.length, FRAME_BYTES);
  assert.equal(renderFrame(frame).ok, true);
  assert.deepEqual(pixel(frame, 1, 3), STATUS_COLORS.ASK);
  assert.deepEqual(pixel(frame, 1, 11), STATUS_COLORS.RUN);
  assert.deepEqual(pixel(frame, 1, 19), STATUS_COLORS.DONE);
  assert.equal(lit(rowPixels(frame, 3)).length, 0, 'an unused row stays dark');
  assert.deepEqual(statusFrame(view).rgb, frame.rgb, 'drawing is deterministic');
});

void test('uncertain rows are dimmed and use a ? marker; overflow and feed rows are drawn', () => {
  const same = identity();
  const fresh = statusFrame(statusView(copy([working({identity: same, label: label('same')})])));
  const stale = statusFrame(statusView(copy([working({identity: same, label: label('same'), freshness: 'uncertain'})])));
  assert.ok(brightest(rowPixels(stale, 0)) < brightest(rowPixels(fresh, 0)) / 2, 'a stale row is dimmed');
  const marker = (frame: Frame): boolean[] => rowPixels(frame, 0).filter((_, i) => i % 64 < 3).map(p => p.some(v => v > 0));
  assert.notDeepEqual(marker(stale), marker(fresh), 'the marker\'s shape changes');
  const many = statusFrame(statusView(copy(Array.from({length: 6}, () => working({identity: identity()})))));
  assert.ok(lit(rowPixels(many, 3)).length > 0, 'the +N MORE row is drawn');
  const feed = statusFrame(statusView(undefined));
  assert.ok(lit(rowPixels(feed, 0)).length > 0, 'the FEED ? row is drawn');
  assert.notDeepEqual(feed.rgb, statusFrame(statusView(copy([]))).rgb);
});

void test('the title preview shows label, title, project and neutral rows', () => {
  const view = statusView(copy(titleSessions()));
  assert.deepEqual(view.rows.slice(0, 3).map(row => row.kind === 'session' ? row.label : ''), ['MY CHOICE', 'LAUNCH REV', 'DEVICE HUB']);
  const [, , , last] = view.rows;
  assert.match(last?.kind === 'session' ? last.label : '', /^X-[0-9A-F]{4}$/);
  assert.ok(view.rows.every(row => row.kind === 'session' && row.state === 'RUN'));
});
