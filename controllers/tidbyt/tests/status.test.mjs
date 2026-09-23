import assert from 'node:assert/strict';
import test from 'node:test';
import { statusView, statusFrame, renderFrame, FRAME_BYTES, STATUS_COLORS } from '../dist/index.js';

let next = 0;
/** A shared agent-state session snapshot with nothing outstanding unless overridden. */
export function session(overrides = {}) {
  next++;
  return {
    identity: { provider: 'claude', client: 'code', hostId: 'host-private', sourceId: 'source-private', sessionId: `session-private-${next}` },
    turn: { status: 'known', id: `turn-${next}` }, parent: { status: 'top-level' },
    activity: 'idle', attention: [], notices: [], read: 'unknown', unavailable: [], ordering: 'unknown',
    lastEvidenceAtMs: 1000 + next, observedAtMs: 1000 + next, observationAgeMs: 0, freshness: 'current',
    restartUncertain: false, children: { active: 0, uncertain: 0 }, ...overrides,
  };
}

export function snapshot(sessions, overrides = {}) {
  return { apiVersion: '1.0', revision: 1, asOfMs: 5000, collector: 'running', lossCount: 0, sessions, ...overrides };
}

const asking = extra => session({ activity: 'active', attention: [{ id: { status: 'known', id: 'a1' }, kind: 'approval', turn: { status: 'known', id: 't' } }], ...extra });
const working = extra => session({ activity: 'active', ...extra });
const notice = (acknowledgedBy = []) => ({ id: 'n1', kind: 'turn-ended', turn: { status: 'known', id: 't' }, acknowledgedBy });
const done = extra => session({ notices: [notice()], ...extra });
const rowSummary = view => view.rows.map(row => row.kind === 'session' ? `${row.label} ${row.state}${row.uncertain ? '?' : ''}` : row.kind === 'more' ? `+${row.count}` : 'FEED?');

test('multiple sessions show ASK, RUN and DONE in order and omit idle, unknown and child sessions', () => {
  const parent = working({ label: 'hub-work' });
  const view = statusView(snapshot([
    done({ label: 'docs' }),
    session({ label: 'idle' }),
    session({ label: 'unknown', activity: 'unknown' }),
    working({ label: 'child', parent: { status: 'known', identity: parent.identity } }),
    parent,
    asking({ label: 'review-bot' }),
  ]));
  assert.deepEqual(rowSummary(view), ['REVIEW-BOT ASK', 'HUB-WORK RUN', 'DOCS DONE']);
  assert.equal(view.feed, 'available');
  assert.equal(view.idle, false);
});

test('newer evidence comes first within a state', () => {
  const view = statusView(snapshot([working({ label: 'old', lastEvidenceAtMs: 10 }), working({ label: 'new', lastEvidenceAtMs: 20 })]));
  assert.deepEqual(rowSummary(view), ['NEW RUN', 'OLD RUN']);
});

test('more than four sessions draw three rows and a +N MORE row', () => {
  const view = statusView(snapshot(Array.from({ length: 6 }, (_, i) => working({ label: `s${i}`, lastEvidenceAtMs: 100 - i }))));
  assert.deepEqual(rowSummary(view), ['S0 RUN', 'S1 RUN', 'S2 RUN', '+3']);
  const four = statusView(snapshot(Array.from({ length: 4 }, (_, i) => working({ label: `s${i}` }))));
  assert.equal(four.rows.length, 4);
  assert(four.rows.every(row => row.kind === 'session'));
});

test('read evidence does not retire DONE; acknowledgment by a configured consumer does', () => {
  const read = done({ label: 'read', read: 'read', lastEvidenceAtMs: 20 });
  const acked = session({ label: 'acked', notices: [notice(['pixoo'])], lastEvidenceAtMs: 10 });
  assert.deepEqual(rowSummary(statusView(snapshot([read, acked]))), ['READ DONE']);
  assert.deepEqual(rowSummary(statusView(snapshot([read, acked]), { acknowledgingConsumers: ['nanoleaf'] })), ['READ DONE', 'ACKED DONE']);
  assert.deepEqual(rowSummary(statusView(snapshot([read, acked]), { acknowledgingConsumers: ['pixoo'] })), ['READ DONE']);
});

test('a session with no evidence of work is never shown as done, and an empty healthy feed is idle', () => {
  const view = statusView(snapshot([session({ activity: 'unknown' }), session({ activity: 'ended' }), session({ activity: 'interrupted' })]));
  assert.deepEqual(view.rows, []);
  assert.equal(view.idle, true);
});

test('labels prefer the user label, then the project ID, then a neutral hashed ID', () => {
  const plain = working();
  const view = statusView(snapshot([
    working({ label: 'a very long user label', lastEvidenceAtMs: 30 }),
    working({ projectId: 'proj_1', lastEvidenceAtMs: 20 }),
    { ...plain, lastEvidenceAtMs: 10 },
  ]));
  const labels = view.rows.map(row => row.label);
  assert.equal(labels[0], 'A VERY LON');
  assert.equal(labels[1], 'PROJ-1');
  assert.match(labels[2], /^C-[0-9A-F]{4}$/);
  assert.equal(statusView(snapshot([plain])).rows[0].label, labels[2], 'neutral ID is stable');
  const text = JSON.stringify(view);
  for (const value of Object.values(plain.identity)) assert(!text.toUpperCase().includes(value.toUpperCase()), `identity field ${value} leaked`);
});

test('uncertain freshness marks one row; an unavailable feed marks every row and never reports idle', () => {
  const view = statusView(snapshot([working({ label: 'stale', freshness: 'uncertain' }), asking({ label: 'fresh' })]));
  assert.deepEqual(rowSummary(view), ['FRESH ASK', 'STALE RUN?']);

  const faulted = statusView(snapshot([working({ label: 'x' })], { collector: 'faulted' }));
  assert.equal(faulted.feed, 'unavailable');
  assert.deepEqual(rowSummary(faulted), ['X RUN?']);

  const lost = statusView(snapshot([working({ label: 'x' })]), { feedAvailable: false });
  assert.deepEqual(rowSummary(lost), ['X RUN?']);
  assert.equal(lost.idle, false);

  for (const empty of [statusView(undefined), statusView(snapshot([]), { feedAvailable: false })]) {
    assert.deepEqual(rowSummary(empty), ['FEED?']);
    assert.equal(empty.idle, false);
  }
});

const pixel = (frame, x, y) => Array.from(frame.rgb.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3));
const rowPixels = (frame, row) => {
  const values = [];
  for (let y = row * 8; y < row * 8 + 8; y++) for (let x = 0; x < 64; x++) values.push(pixel(frame, x, y));
  return values;
};
const lit = pixels => pixels.filter(p => p.some(v => v > 0));
const brightest = pixels => Math.max(...pixels.flat());

test('the status frame is a valid renderer frame with a state-colored marker per row', () => {
  const view = statusView(snapshot([asking({ label: 'a' }), working({ label: 'b' }), done({ label: 'c' })]));
  const frame = statusFrame(view);
  assert.equal(frame.width, 64);
  assert.equal(frame.height, 32);
  assert.equal(frame.rgb.length, FRAME_BYTES);
  assert.equal(renderFrame(frame).ok, true);
  assert.deepEqual(pixel(frame, 1, 3), STATUS_COLORS.ASK);
  assert.deepEqual(pixel(frame, 1, 11), STATUS_COLORS.RUN);
  assert.deepEqual(pixel(frame, 1, 19), STATUS_COLORS.DONE);
  assert.equal(lit(rowPixels(frame, 3)).length, 0, 'unused row stays dark');
  assert.deepEqual(statusFrame(view).rgb, frame.rgb, 'drawing is deterministic');
});

test('uncertain rows are dimmed and use a ? marker; overflow and feed rows are drawn', () => {
  const fresh = statusFrame(statusView(snapshot([working({ label: 'same' })])));
  const stale = statusFrame(statusView(snapshot([working({ label: 'same', freshness: 'uncertain' })])));
  assert(brightest(rowPixels(stale, 0)) < brightest(rowPixels(fresh, 0)) / 2, 'stale row is dimmed');
  const marker = frame => rowPixels(frame, 0).filter((_, i) => i % 64 < 3).map(p => p.some(v => v > 0));
  assert.notDeepEqual(marker(stale), marker(fresh), 'marker shape changes');

  const many = statusFrame(statusView(snapshot(Array.from({ length: 6 }, () => working()))));
  assert(lit(rowPixels(many, 3)).length > 0, '+N MORE row is drawn');
  const feed = statusFrame(statusView(undefined));
  assert(lit(rowPixels(feed, 0)).length > 0, 'FEED ? row is drawn');
  assert.notDeepEqual(feed.rgb, statusFrame(statusView(snapshot([]))).rgb);
});
