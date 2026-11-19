// The shared agent-status helper for profile 2.0 (Hub #918). Copied from packages/agent-status/tests/status.test.mjs
// at main 9d609c8 and rewritten for session/2.0 records: every record below passes the session family's validator
// first. The 1.x package and its tests stay for the old controllers until #839. Since Hub #1865 every case runs twice:
// against the helper over records in status.ts and against the helper over the shared read function's views, which the
// device readers use. Each notice describes its session's own turn; the one case where the two differ, a notice a known
// later turn superseded, has its own test below.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import * as legacy from '@jimmie-potts/agent-status';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies, sessionEntityId} from '../dist/v2/families.js';
import * as views from '../dist/v2/session-view.js';
import * as status from '../dist/v2/status.js';

const {STATUS_COLORS} = status;
/** The two helpers, each judging session/2.0 records: directly, or through each record's view. */
const HELPERS = {
  records: {sessionState: status.sessionState, highestStatus: status.highestStatus},
  view: {
    sessionState: (record, consumers) => views.sessionState(views.sessionView(record), consumers),
    highestStatus: (copy, options) => views.highestStatus(copy === undefined ? undefined : {synced: copy.synced, sessions: copy.sessions.map(views.sessionView)}, options),
  },
};
/** Runs one copied case against both helpers. */
const both = (name, body) => {
  for (const [helper, judge] of Object.entries(HELPERS)) test(`${name} (${helper})`, () => body(judge));
};
const TIME = '2026-10-06T12:00:00.000Z', AT = Date.parse(TIME);
const validator = new MessageValidator();
registerCoreFamilies(validator);

let next = 0;
/** A session/2.0 record with nothing outstanding unless overridden, checked against the session family. */
function session(overrides = {}) {
  next++;
  const identity = overrides.identity ??
    {provider: 'claude', client: 'code', hostId: 'host-private', sourceId: 'source-private', sessionId: `session-private-${next}`};
  const record = {
    id: sessionEntityId(identity), revision: next, generation: 0, identity, parent: {status: 'top-level'},
    turn: {status: 'known', id: 't'}, activity: 'idle', attention: [], notices: [], read: 'unknown', unavailable: [],
    ordering: {status: 'unknown'}, observedAtMs: AT - 1000, lastEvidenceAtMs: AT - 1000, freshness: 'current', restartUncertain: false,
    children: {active: 0, uncertain: 0}, ...overrides,
  };
  const result = validator.validate({
    specversion: '1.0', bunnyprofile: '2.0', id: `msg-${next}`, source: 'bunny/core', type: 'org.bunny.session.updated', subject: record.id,
    time: TIME, kind: 'state', datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/session/2.0',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data: record,
  });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return record;
}
/** A consumer's copy of the session family: synced once its first sync completed and while it follows the owner. */
const copy = (sessions, synced = true) => ({synced, sessions});
const asking = extra => session({activity: 'active', attention: [{id: {status: 'known', id: 'a1'}, kind: 'approval', turn: {status: 'known', id: 't'}}], ...extra});
const working = extra => session({activity: 'active', ...extra});
const notice = (acknowledgedBy = []) => ({id: createHash('sha256').update(`notice-${next}`).digest('hex'), kind: 'turn-ended', turn: {status: 'known', id: 't'}, acknowledgedBy});
const done = extra => session({notices: [notice()], ...extra});
const desktop = () => ({provider: 'codex', client: 'desktop', hostId: 'host-private', sourceId: 'codex-desktop', sessionId: `session-private-${next + 1}`});
// Five minutes without evidence: freshness must be uncertain at the envelope time.
const stale = {freshness: 'uncertain', lastEvidenceAtMs: AT - 300_000, observedAtMs: AT - 300_000};

both('sessionState ranks attention over working over done, and reports nothing outstanding as undefined', h => {
  assert.equal(h.sessionState(asking()), 'attention');
  assert.equal(h.sessionState(working()), 'working');
  assert.equal(h.sessionState(done()), 'done');
  assert.equal(h.sessionState(session()), undefined);
  assert.equal(h.sessionState(session({children: {active: 1, uncertain: 0}})), 'working');
});

both('sessionState never retires done from read evidence, only from a matching consumer ack', h => {
  // Only Codex Desktop reports read evidence in session/2.0, so this record is a Desktop session.
  const readOnly = done({identity: desktop(), read: 'read'});
  assert.equal(h.sessionState(readOnly), 'done');
  const acked = session({notices: [notice(['pixoo'])]});
  assert.equal(h.sessionState(acked), undefined);
  assert.equal(h.sessionState(acked, ['nanoleaf']), 'done');
  assert.equal(h.sessionState(acked, ['pixoo']), undefined);
});

both('highestStatus picks the single highest state across root sessions', h => {
  assert.equal(h.highestStatus(copy([done(), working(), asking()])), 'attention');
  assert.equal(h.highestStatus(copy([done(), working()])), 'working');
  assert.equal(h.highestStatus(copy([done()])), 'done');
});

both('highestStatus is idle only when the copy is synced and nothing is outstanding', h => {
  assert.equal(h.highestStatus(copy([])), 'idle');
  assert.equal(h.highestStatus(copy([session()])), 'idle');
});

// 1.x: "unknown for an unavailable feed, a non-running collector, or missing snapshot". In 2.0 a consumer holds a
// synced copy instead of reading snapshots, and owner health is the runtime's module health, not a record field.
both('highestStatus is unknown for a copy that has not synced, one whose sync failed, or no copy', h => {
  assert.equal(h.highestStatus(undefined), 'unknown');
  assert.equal(h.highestStatus(copy([working()], false)), 'unknown');
  assert.equal(h.highestStatus(copy([], false)), 'unknown');
  assert.equal(h.highestStatus(copy([asking()], false), {acknowledgingConsumers: ['pixoo']}), 'unknown');
});

both('highestStatus restricts acknowledgment to the acknowledging consumers', h => {
  const acked = session({notices: [notice(['pixoo'])]});
  assert.equal(h.highestStatus(copy([acked])), 'idle', 'any consumer by default');
  assert.equal(h.highestStatus(copy([acked]), {acknowledgingConsumers: ['nanoleaf']}), 'done');
  assert.equal(h.highestStatus(copy([acked]), {acknowledgingConsumers: ['pixoo', 'nanoleaf']}), 'idle');
});

both('uncertain freshness never hides the state the owner reports (#439)', h => {
  assert.equal(h.highestStatus(copy([working(stale)])), 'working');
  assert.equal(h.highestStatus(copy([working(stale), asking(stale)])), 'attention');
  assert.equal(h.highestStatus(copy([working(stale), asking()])), 'attention');
  // A finished turn waiting to be read is idle by nature, so it is usually uncertain; it still shows as done.
  assert.equal(h.highestStatus(copy([done(stale)])), 'done');
  // Restored after a restart, a session keeps its reported state until fresh evidence arrives.
  assert.equal(h.highestStatus(copy([working({freshness: 'uncertain', restartUncertain: true})])), 'working');
  // A session with nothing outstanding stays idle whatever its freshness.
  assert.equal(h.highestStatus(copy([session(stale)])), 'idle');
});

both('a child session never gets its own state, but makes its active root working', h => {
  const parent = session({children: {active: 1, uncertain: 0}});
  const child = working({identity: {...parent.identity, sessionId: `${parent.identity.sessionId}-child`}, parent: {status: 'known', identity: parent.identity}});
  assert.equal(h.highestStatus(copy([parent, child])), 'working');
  assert.equal(h.highestStatus(copy([child])), 'idle', 'a child alone shows nothing');
});

test('STATUS_COLORS carries one RGB triple per attention/working/done state', () => {
  assert.deepEqual(Object.keys(STATUS_COLORS).sort(), ['attention', 'done', 'working']);
  for (const rgb of Object.values(STATUS_COLORS)) {
    assert.equal(rgb.length, 3);
    for (const channel of rgb) assert.equal(Number.isInteger(channel) && channel >= 0 && channel <= 255, true);
  }
  assert.ok(Object.isFrozen(STATUS_COLORS));
});

test('every device keeps the same colors and ranking as the 1.x helper', () => {
  assert.deepEqual(STATUS_COLORS, legacy.STATUS_COLORS);
  assert.deepEqual(views.STATUS_COLORS, legacy.STATUS_COLORS);
  assert.deepEqual(STATUS_COLORS, {attention: [255, 160, 0], working: [40, 120, 255], done: [40, 200, 80]});
  assert.deepEqual(Object.keys(status).sort(), ['STATUS_COLORS', 'highestStatus', 'sessionState']);
  // The same session judged by each helper: 1.x reads a snapshot session, 2.0 the session record or its view.
  const cases = [asking(), working(), done(), session(), session({children: {active: 1, uncertain: 0}}), session({notices: [notice(['pixoo'])]}),
    working(stale), done(stale), done({identity: desktop(), read: 'read'})];
  for (const record of cases) {
    const {id: _id, revision: _revision, ...snapshotSession} = record;
    for (const consumers of [undefined, ['pixoo'], ['nanoleaf']]) {
      const expected = legacy.sessionState({...snapshotSession, observationAgeMs: 0}, consumers);
      for (const [helper, judge] of Object.entries(HELPERS)) assert.equal(judge.sessionState(record, consumers), expected, `${helper} ${JSON.stringify(consumers)}`);
    }
  }
});

// The owner's finished rule (Hub #1865, 2026-11-18, option 1): a notice counts until a known later turn supersedes it.
// The view applies it, so a notice from an earlier turn, still unread after a later turn is known, is not done there;
// the 1.x helper and the helper over records count it. This is the only case where they differ.
test('the view differs from the 1.x helper only for a notice a known later turn superseded', () => {
  const superseded = session({turn: {status: 'known', id: 'later'}, notices: [notice()]});
  const {id: _id, revision: _revision, ...snapshotSession} = superseded;
  assert.equal(legacy.sessionState({...snapshotSession, observationAgeMs: 0}), 'done');
  assert.equal(HELPERS.records.sessionState(superseded), 'done');
  assert.equal(HELPERS.view.sessionState(superseded), undefined);
  assert.equal(HELPERS.view.highestStatus(copy([superseded])), 'idle');
  assert.equal(HELPERS.view.highestStatus(copy([superseded, done()])), 'done', 'a notice of the current turn still counts');
  // Missing turn evidence never hides a recorded outcome.
  assert.equal(HELPERS.view.sessionState(session({turn: {status: 'unknown'}, notices: [notice()]})), 'done');
  assert.equal(HELPERS.view.sessionState(session({notices: [{...notice(), turn: {status: 'unknown'}}]})), 'done');
});

// Owner decision, 2026-10-06 (#918 review): acknowledgment scope stays as today. Acknowledgments are recorded per
// consumer, and each consumer's policy decides which ones clear what it shows. LIFX and Tidbyt name no consumers, so
// any consumer's acknowledgment, such as Pixoo's dismissal, retires done for them.
both('by default any consumer\'s acknowledgment retires done; a caller that names consumers counts only theirs', h => {
  const pixooAcknowledged = session({notices: [notice(['pixoo'])]});
  assert.equal(h.sessionState(pixooAcknowledged), undefined, 'Pixoo\'s acknowledgment retires done for a caller that names no consumers');
  assert.equal(h.highestStatus(copy([pixooAcknowledged])), 'idle');
  assert.equal(h.highestStatus(copy([pixooAcknowledged]), {}), 'idle', 'an empty options object keeps the default');
  assert.equal(h.sessionState(pixooAcknowledged, ['nanoleaf']), 'done', 'a caller that names Nanoleaf still shows done');
  assert.equal(h.highestStatus(copy([pixooAcknowledged]), {acknowledgingConsumers: ['nanoleaf']}), 'done');
  assert.equal(h.highestStatus(copy([pixooAcknowledged]), {acknowledgingConsumers: ['pixoo']}), 'idle');
  assert.equal(h.sessionState(session({notices: [notice()]})), 'done', 'no acknowledgment at all is still done');
});
