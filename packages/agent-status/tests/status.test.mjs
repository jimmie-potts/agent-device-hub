import assert from 'node:assert/strict';
import test from 'node:test';
import { highestStatus, sessionState, STATUS_COLORS } from '../dist/index.js';

let next = 0;
/** A shared agent-state session snapshot with nothing outstanding unless overridden. */
function session(overrides = {}) {
  next++;
  return {
    identity: { provider: 'claude', client: 'code', hostId: 'host-private', sourceId: 'source-private', sessionId: `session-private-${next}` },
    turn: { status: 'known', id: `turn-${next}` }, parent: { status: 'top-level' },
    activity: 'idle', attention: [], notices: [], read: 'unknown', unavailable: [], ordering: 'unknown',
    lastEvidenceAtMs: 1000 + next, observedAtMs: 1000 + next, observationAgeMs: 0, freshness: 'current',
    restartUncertain: false, children: { active: 0, uncertain: 0 }, ...overrides,
  };
}
function snapshot(sessions, overrides = {}) {
  return { apiVersion: '1.0', revision: 1, asOfMs: 5000, collector: 'running', lossCount: 0, sessions, ...overrides };
}
const asking = extra => session({ activity: 'active', attention: [{ id: { status: 'known', id: 'a1' }, kind: 'approval', turn: { status: 'known', id: 't' } }], ...extra });
const working = extra => session({ activity: 'active', ...extra });
const notice = (acknowledgedBy = []) => ({ id: 'n1', kind: 'turn-ended', turn: { status: 'known', id: 't' }, acknowledgedBy });
const done = extra => session({ notices: [notice()], ...extra });

test('sessionState ranks attention over working over done, and reports nothing outstanding as undefined', () => {
  assert.equal(sessionState(asking()), 'attention');
  assert.equal(sessionState(working()), 'working');
  assert.equal(sessionState(done()), 'done');
  assert.equal(sessionState(session()), undefined);
  assert.equal(sessionState(session({ children: { active: 1, uncertain: 0 } })), 'working');
});

test('sessionState never retires done from read evidence, only from a matching consumer ack', () => {
  const readOnly = done({ read: 'read' });
  assert.equal(sessionState(readOnly), 'done');
  const acked = session({ notices: [notice(['pixoo'])] });
  assert.equal(sessionState(acked), undefined);
  assert.equal(sessionState(acked, ['nanoleaf']), 'done');
  assert.equal(sessionState(acked, ['pixoo']), undefined);
});

test('highestStatus picks the single highest state across root sessions', () => {
  assert.equal(highestStatus(snapshot([done(), working(), asking()])), 'attention');
  assert.equal(highestStatus(snapshot([done(), working()])), 'working');
  assert.equal(highestStatus(snapshot([done()])), 'done');
});

test('highestStatus is idle only when the feed is healthy and nothing is outstanding', () => {
  assert.equal(highestStatus(snapshot([])), 'idle');
  assert.equal(highestStatus(snapshot([session()])), 'idle');
});

test('highestStatus is unknown for an unavailable feed, a non-running collector, or missing snapshot', () => {
  assert.equal(highestStatus(undefined), 'unknown');
  assert.equal(highestStatus(snapshot([working()]), { feedAvailable: false }), 'unknown');
  assert.equal(highestStatus(snapshot([working()], { collector: 'quiesced' })), 'unknown');
  assert.equal(highestStatus(snapshot([working()], { collector: 'faulted' })), 'unknown');
});

test('an uncertain shown session makes the whole result unknown, even alongside a current one', () => {
  const uncertain = working({ freshness: 'uncertain' });
  assert.equal(highestStatus(snapshot([uncertain])), 'unknown');
  assert.equal(highestStatus(snapshot([uncertain, asking()])), 'unknown');
  // A session with nothing outstanding never poisons the result even if its freshness is uncertain.
  assert.equal(highestStatus(snapshot([session({ freshness: 'uncertain' }), working()])), 'working');
});

test('a child session never gets its own state, but makes its active root working', () => {
  const parent = session({ children: { active: 1, uncertain: 0 } });
  const child = working({ parent: { status: 'known', identity: parent.identity } });
  assert.equal(highestStatus(snapshot([parent, child])), 'working');
});

test('STATUS_COLORS carries one RGB triple per attention/working/done state', () => {
  assert.deepEqual(Object.keys(STATUS_COLORS).sort(), ['attention', 'done', 'working']);
  for (const rgb of Object.values(STATUS_COLORS)) {
    assert.equal(rgb.length, 3);
    for (const channel of rgb) assert.equal(Number.isInteger(channel) && channel >= 0 && channel <= 255, true);
  }
});
