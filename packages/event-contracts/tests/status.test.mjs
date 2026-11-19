// The shared agent-status helper for profile 2.0 (Hub #918). Copied from packages/agent-status/tests/status.test.mjs
// at main 9d609c8 and rewritten for the shared session view: since Hub #1865 step 9 every record below is a
// session/3.0 record built with `buildSession`, which passes the session family's validator first, and the helper reads
// it as its view. The 1.x package and its tests stay for the old controllers until #839, and the 1.x helper judges the
// same sessions as a reference. Each notice describes its session's own turn; the one case where the two differ, a
// notice a known later turn superseded, has its own test below.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import * as legacy from '@jimmie-potts/agent-status';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies, sessionEntityId} from '../dist/v2/families.js';
import * as views from '../dist/v2/session-view.js';
import * as status from '../dist/v2/status.js';

const {STATUS_COLORS} = status;
const h = {sessionState: views.sessionState, highestStatus: views.highestStatus};
const TIME = '2026-10-06T12:00:00.000Z', AT = Date.parse(TIME);
const validator = new MessageValidator();
registerCoreFamilies(validator);

let next = 0;
/** A session/3.0 record with nothing outstanding unless overridden, checked against the session family. */
function session(overrides = {}) {
  next++;
  const identity = overrides.identity ??
    {provider: 'claude', client: 'code', hostId: 'host-private', sourceId: 'source-private', sessionId: `session-private-${next}`};
  const record = views.buildSession({
    id: sessionEntityId(identity), revision: next, generation: 0, identity, parent: {status: 'top-level'},
    turn: {status: 'known', id: 't'}, work: 'idle', attention: [], notices: [], read: 'unknown', unavailable: [],
    ordering: {status: 'unknown'}, observedAtMs: AT - 1000, lastEvidenceAtMs: AT - 1000, children: {working: 0, unconfirmed: 0}, ...overrides,
  });
  const result = validator.validate({
    specversion: '1.0', bunnyprofile: '2.0', id: `msg-${next}`, source: 'bunny/core', type: 'org.bunny.session.updated', subject: record.id,
    time: TIME, kind: 'state', datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/session/3.0',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data: record,
  });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return record;
}
/** The 1.x helper's snapshot session for a view: its attention, work state, notices and working children. */
const snapshotOf = view => ({
  identity: view.identity, parent: view.parent, turn: view.turn, activity: view.work.state, attention: view.attention.items,
  notices: view.outcome.notices, read: view.outcome.read, children: {active: view.relationships.children.working, uncertain: view.relationships.children.unconfirmed},
  observationAgeMs: 0,
});
/** A consumer's copy of the session family: synced once its first sync completed and while it follows the owner. */
const copy = (sessions, synced = true) => ({synced, sessions});
const asking = extra => session({work: 'active', attention: [{id: {status: 'known', id: 'a1'}, kind: 'approval', turn: {status: 'known', id: 't'}}], ...extra});
const working = extra => session({work: 'active', ...extra});
const notice = (acknowledgedBy = []) => ({id: createHash('sha256').update(`notice-${next}`).digest('hex'), kind: 'turn-ended', turn: {status: 'known', id: 't'}, acknowledgedBy});
const done = extra => session({notices: [notice()], ...extra});
const desktop = () => ({provider: 'codex', client: 'desktop', hostId: 'host-private', sourceId: 'codex-desktop', sessionId: `session-private-${next + 1}`});
// Running work a restart left unconfirmed, five minutes after its last evidence. Silence alone changes no claim (Hub #1947).
const stale = {unconfirmed: 'restart', lastEvidenceAtMs: AT - 300_000, observedAtMs: AT - 300_000};

test('sessionState ranks attention over working over done, and reports nothing outstanding as undefined', () => {
  assert.equal(h.sessionState(asking()), 'attention');
  assert.equal(h.sessionState(working()), 'working');
  assert.equal(h.sessionState(done()), 'done');
  assert.equal(h.sessionState(session()), undefined);
  assert.equal(h.sessionState(session({children: {working: 1, unconfirmed: 0}})), 'working');
});

test('sessionState never retires done from read evidence, only from a matching consumer ack', () => {
  // Only Codex Desktop reports read evidence without receipt provenance, so this record is a Desktop session.
  const readOnly = done({identity: desktop(), read: 'read'});
  assert.equal(h.sessionState(readOnly), 'done');
  const acked = session({notices: [notice(['pixoo'])]});
  assert.equal(h.sessionState(acked), undefined);
  assert.equal(h.sessionState(acked, ['nanoleaf']), 'done');
  assert.equal(h.sessionState(acked, ['pixoo']), undefined);
});

test('highestStatus picks the single highest state across root sessions', () => {
  assert.equal(h.highestStatus(copy([done(), working(), asking()])), 'attention');
  assert.equal(h.highestStatus(copy([done(), working()])), 'working');
  assert.equal(h.highestStatus(copy([done()])), 'done');
});

test('highestStatus is idle only when the copy is synced and nothing is outstanding', () => {
  assert.equal(h.highestStatus(copy([])), 'idle');
  assert.equal(h.highestStatus(copy([session()])), 'idle');
});

// 1.x: "unknown for an unavailable feed, a non-running collector, or missing snapshot". In 2.0 a consumer holds a
// synced copy instead of reading snapshots, and owner health is the runtime's module health, not a record field.
test('highestStatus is unknown for a copy that has not synced, one whose sync failed, or no copy', () => {
  assert.equal(h.highestStatus(undefined), 'unknown');
  assert.equal(h.highestStatus(copy([working()], false)), 'unknown');
  assert.equal(h.highestStatus(copy([], false)), 'unknown');
  assert.equal(h.highestStatus(copy([asking()], false), {acknowledgingConsumers: ['pixoo']}), 'unknown');
});

test('highestStatus restricts acknowledgment to the acknowledging consumers', () => {
  const acked = session({notices: [notice(['pixoo'])]});
  assert.equal(h.highestStatus(copy([acked])), 'idle', 'any consumer by default');
  assert.equal(h.highestStatus(copy([acked]), {acknowledgingConsumers: ['nanoleaf']}), 'done');
  assert.equal(h.highestStatus(copy([acked]), {acknowledgingConsumers: ['pixoo', 'nanoleaf']}), 'idle');
});

test('unconfirmed work never hides the state the owner reports (#439)', () => {
  assert.equal(h.highestStatus(copy([working(stale)])), 'working');
  assert.equal(h.highestStatus(copy([working(stale), asking(stale)])), 'attention');
  assert.equal(h.highestStatus(copy([working(stale), asking()])), 'attention');
  // A finished turn waiting to be read is idle, so silence never makes it unconfirmed; it shows as done.
  assert.equal(h.highestStatus(copy([done(stale)])), 'done');
  // Restored after a restart, a session keeps its reported state until fresh evidence arrives.
  assert.equal(h.highestStatus(copy([working({unconfirmed: 'restart'})])), 'working');
  // A session with nothing outstanding stays idle whatever its silence.
  assert.equal(h.highestStatus(copy([session(stale)])), 'idle');
});

test('a child session never gets its own state, but makes its active root working', () => {
  const parent = session({children: {working: 1, unconfirmed: 0}});
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
  assert.deepEqual(Object.keys(status).sort(), ['STATUS_COLORS'], 'status.ts keeps the colors only; the helper reads views');
  // The same session judged by each helper: 1.x reads a snapshot session, the shared helper the session's view.
  const cases = [asking(), working(), done(), session(), session({children: {working: 1, unconfirmed: 0}}), session({notices: [notice(['pixoo'])]}),
    working(stale), done(stale), done({identity: desktop(), read: 'read'})];
  for (const record of cases) {
    for (const consumers of [undefined, ['pixoo'], ['nanoleaf']]) {
      assert.equal(h.sessionState(record, consumers), legacy.sessionState(snapshotOf(record), consumers), JSON.stringify(consumers));
    }
  }
});

// The owner's finished rule (Hub #1865, 2026-11-18, option 1): a notice counts until a known later turn supersedes it.
// The view applies it, so a notice from an earlier turn, still unread after a later turn is known, is not done there;
// the 1.x helper counts it. This is the only case where they differ.
test('the view differs from the 1.x helper only for a notice a known later turn superseded', () => {
  const superseded = session({turn: {status: 'known', id: 'later'}, notices: [notice()]});
  assert.equal(legacy.sessionState(snapshotOf(superseded)), 'done');
  assert.equal(h.sessionState(superseded), undefined);
  assert.equal(h.highestStatus(copy([superseded])), 'idle');
  assert.equal(h.highestStatus(copy([superseded, done()])), 'done', 'a notice of the current turn still counts');
  // Missing turn evidence never hides a recorded outcome.
  assert.equal(h.sessionState(session({turn: {status: 'unknown'}, notices: [notice()]})), 'done');
  assert.equal(h.sessionState(session({notices: [{...notice(), turn: {status: 'unknown'}}]})), 'done');
});

// Owner decision, 2026-10-06 (#918 review): acknowledgment scope stays as today. Acknowledgments are recorded per
// consumer, and each consumer's policy decides which ones clear what it shows. LIFX and Tidbyt name no consumers, so
// any consumer's acknowledgment, such as Pixoo's dismissal, retires done for them.
test('by default any consumer\'s acknowledgment retires done; a caller that names consumers counts only theirs', () => {
  const pixooAcknowledged = session({notices: [notice(['pixoo'])]});
  assert.equal(h.sessionState(pixooAcknowledged), undefined, 'Pixoo\'s acknowledgment retires done for a caller that names no consumers');
  assert.equal(h.highestStatus(copy([pixooAcknowledged])), 'idle');
  assert.equal(h.highestStatus(copy([pixooAcknowledged]), {}), 'idle', 'an empty options object keeps the default');
  assert.equal(h.sessionState(pixooAcknowledged, ['nanoleaf']), 'done', 'a caller that names Nanoleaf still shows done');
  assert.equal(h.highestStatus(copy([pixooAcknowledged]), {acknowledgingConsumers: ['nanoleaf']}), 'done');
  assert.equal(h.highestStatus(copy([pixooAcknowledged]), {acknowledgingConsumers: ['pixoo']}), 'idle');
  assert.equal(h.sessionState(session({notices: [notice()]})), 'done', 'no acknowledgment at all is still done');
});
