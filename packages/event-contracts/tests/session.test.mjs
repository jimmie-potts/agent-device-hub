// The session/3.0 status function and the shared session read function (Hub #1865, design decisions 3, 4 and 10).
// Every record here is synthetic and passes the session family's validator first.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {coreValidator, sessionEntityId} from '../dist/v2/families.js';
import {
  forConsumer, highestStatus, knownDetail, opportunityMatches, READABLE_SESSION_SCHEMAS, readSession, sessionState, sessionView, statusOf,
  STATUS_DETAILS,
} from '../dist/v2/session.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8')).valid;
const TIME = '2026-10-06T12:00:00.000Z', AT = Date.parse(TIME), STALE = 300_000;
const SCHEMA = 'https://bunny.invalid/events/session/';
const hash = text => createHash('sha256').update(text).digest('hex');
const known = id => ({status: 'known', id});
const identity = (sessionId, provider = 'claude') =>
  ({provider, client: provider === 'claude' ? 'code' : 'cli', hostId: 'synthetic-host', sourceId: `${provider}-hooks`, sessionId});

/** A session/2.0 state message with nothing outstanding unless overridden, checked against the session family. */
function message(overrides = {}, {time = TIME, version = '2.0'} = {}) {
  const who = overrides.identity ?? identity('session-a');
  const data = {
    id: sessionEntityId(who), revision: 4, generation: 2, identity: who, parent: {status: 'top-level'}, turn: known('turn-1'),
    activity: 'idle', attention: [], notices: [], read: 'unknown', unavailable: [], ordering: {status: 'unknown'},
    observedAtMs: AT - 1000, lastEvidenceAtMs: AT - 1000, freshness: 'current', restartUncertain: false, children: {active: 0, uncertain: 0},
    ...overrides,
  };
  const value = {
    specversion: '1.0', bunnyprofile: '2.0', id: `msg-${data.revision}`, source: 'bunny/core', type: 'org.bunny.session.updated', subject: data.id,
    time, kind: 'state', datacontenttype: 'application/json', dataschema: `${SCHEMA}${version}`,
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data,
  };
  const result = coreValidator().validate(value);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return value;
}
const notice = (turn = 'turn-1', acknowledgedBy = []) => ({id: hash(`notice-${turn}-${acknowledgedBy.join()}`), kind: 'turn-ended', turn: known(turn), acknowledgedBy});
const approval = (turn = 'turn-1') => ({id: known('approval-1'), kind: 'approval', turn: known(turn)});
const question = (turn = 'turn-1') => ({id: known('question-1'), kind: 'question', turn: known(turn)});
// Five minutes without evidence: session/2.0 freshness is uncertain at the envelope time.
const silent = {lastEvidenceAtMs: AT - STALE - 60_000, observedAtMs: AT - STALE - 60_000, freshness: 'uncertain'};
const read = overrides => {
  const view = readSession(message(overrides));
  assert.ok(view);
  return view;
};
const status = view => `${view.status.class}/${view.status.detail}`;

/** Claims with nothing outstanding unless overridden. */
const claims = (overrides = {}) => ({
  turn: known('turn-1'), work: {state: 'idle', confidence: 'confirmed', evidenceAtMs: AT, reasons: []},
  attention: {items: [], confidence: 'confirmed', evidenceAtMs: AT}, outcome: {notices: [], read: 'unknown', confidence: 'confirmed', evidenceAtMs: AT},
  relationships: {children: {working: 0, unconfirmed: 0}, confidence: 'confirmed'}, unavailable: [], ...overrides,
});
const unconfirmed = reason => ({state: 'active', confidence: 'unconfirmed', evidenceAtMs: AT, reasons: [reason]});

test('the status function takes the first rule that matches, in the design\'s order', () => {
  const asked = {items: [question(), approval(), {id: known('input-1'), kind: 'input', turn: known('turn-1')}], confidence: 'confirmed', evidenceAtMs: AT};
  assert.deepEqual(statusOf(claims({attention: asked, work: unconfirmed('deadline')})), {class: 'needs-owner', detail: 'approval'});
  assert.deepEqual(statusOf(claims({attention: {...asked, items: [question(), {id: known('input-1'), kind: 'input', turn: known('turn-1')}]}})), {class: 'needs-owner', detail: 'input'});
  assert.deepEqual(statusOf(claims({attention: {...asked, items: [question()]}})), {class: 'needs-owner', detail: 'question'});
  assert.deepEqual(statusOf(claims({work: {state: 'active', confidence: 'confirmed', evidenceAtMs: AT, reasons: []}})), {class: 'working', detail: 'confirmed'});
  assert.deepEqual(statusOf(claims({work: unconfirmed('restart')})), {class: 'working', detail: 'unconfirmed'});
  const child = {children: {working: 1, unconfirmed: 0}, confidence: 'confirmed'};
  assert.deepEqual(statusOf(claims({relationships: child, outcome: {notices: [notice()], read: 'unknown', confidence: 'confirmed', evidenceAtMs: AT}})),
    {class: 'working', detail: 'subagent'});
  assert.deepEqual(statusOf(claims({relationships: {children: {working: 0, unconfirmed: 3}, confidence: 'confirmed'}})), {class: 'quiet', detail: 'idle'},
    'an unconfirmed child never makes its root working');
});

test('a finished turn is the latest notice on the current turn, whatever its acknowledgments and read evidence', () => {
  const outcome = notices => ({notices, read: 'read', confidence: 'confirmed', evidenceAtMs: AT});
  assert.deepEqual(statusOf(claims({outcome: outcome([notice('turn-1', ['pixoo', 'nanoleaf', 'dashboard'])])})), {class: 'finished', detail: 'turn-ended'});
  assert.deepEqual(statusOf(claims({work: {state: 'unknown', confidence: 'confirmed', evidenceAtMs: AT, reasons: []}, outcome: outcome([notice()])})),
    {class: 'finished', detail: 'turn-ended'});
  // A notice of an earlier turn: the session moved on, and its new turn was interrupted.
  assert.deepEqual(statusOf(claims({turn: known('turn-2'), work: {state: 'interrupted', confidence: 'confirmed', evidenceAtMs: AT, reasons: []},
    outcome: outcome([notice('turn-1')])})), {class: 'quiet', detail: 'interrupted'});
  assert.deepEqual(statusOf(claims({turn: known('turn-2'), outcome: outcome([notice('turn-2'), notice('turn-1')])})), {class: 'quiet', detail: 'idle'},
    'only the latest notice counts');
  assert.deepEqual(statusOf(claims({turn: {status: 'unknown'}, outcome: outcome([{...notice(), turn: {status: 'unknown'}}])})), {class: 'finished', detail: 'turn-ended'});
});

test('unknown work without another claim is unknown, detailed by the activity\'s unavailable reason', () => {
  const work = {state: 'unknown', confidence: 'confirmed', evidenceAtMs: AT, reasons: []};
  assert.deepEqual(statusOf(claims({work})), {class: 'unknown', detail: 'unknown'});
  assert.deepEqual(statusOf(claims({work, unavailable: [{dimension: 'read', reason: 'unsupported'}, {dimension: 'activity', reason: 'ambiguous'}]})),
    {class: 'unknown', detail: 'ambiguous'});
  for (const [klass, details] of Object.entries(STATUS_DETAILS)) {
    for (const detail of details) assert.equal(knownDetail({class: klass, detail}), true, `${klass}/${detail}`);
  }
  assert.equal(knownDetail({class: 'finished', detail: 'failed'}), false);
  assert.equal(knownDetail({class: 'finished', detail: 'approval'}), false, 'a detail is known only for its own class');
});

test('a session/3.0 record that needs the owner stays valid an hour after its last evidence, and one with freshness is refused', () => {
  const waiting = fixtures['session-3'];
  assert.equal(Date.parse(waiting.time) - waiting.data.lastEvidenceAtMs, 3_600_000);
  assert.equal(coreValidator().validate(waiting).ok, true);
  for (const extra of [{freshness: 'uncertain'}, {restartUncertain: true}]) {
    const result = coreValidator().validate({...waiting, data: {...waiting.data, ...extra}});
    assert.equal(result.ok, false, JSON.stringify(extra));
  }
  for (const name of ['session-3', 'session-3-child', 'session-3-read']) {
    assert.deepEqual(statusOf(fixtures[name].data), fixtures[name].data.status, name);
  }
});

test('readSession reads session/2.0 and 2.1 state messages and nothing else until the switch', () => {
  assert.deepEqual(READABLE_SESSION_SCHEMAS, [`${SCHEMA}2.0`, `${SCHEMA}2.1`]);
  const root = readSession(fixtures.session);
  assert.equal(root?.id, fixtures.session.data.id);
  assert.equal(root?.revision, 7);
  assert.equal(root?.generation, 1);
  assert.deepEqual(root?.identity, fixtures.session.data.identity);
  assert.equal(status(root), 'needs-owner/approval');
  assert.deepEqual(root?.relationships, {children: {working: 1, unconfirmed: 0}, confidence: 'confirmed'});
  assert.deepEqual([root?.label, root?.title, root?.project, root?.projectId], [fixtures.session.data.label, fixtures.session.data.title, 'agent-device-hub', 'hub']);
  assert.equal(readSession(fixtures['session-3']), undefined, 'session/3.0 is read only from the switch step');
  assert.equal(readSession({...fixtures.session, data: {...fixtures.session.data, revision: 'seven'}}), undefined, 'an invalid record');
  assert.equal(readSession(fixtures.mode), undefined, 'another family');
  for (const value of [undefined, null, 'session', [], {}]) assert.equal(readSession(value), undefined);
});

test('a session/2.1 record keeps its read provenance in the view', () => {
  const finished = notice('turn-1');
  const receipt = {noticeId: finished.id, observedAtMs: AT - 500, source: 'bunny/observer/read-receipts', receipt: {kind: 'owned-ui', viewRevision: 'view-1'}};
  const view = readSession(message({notices: [finished], read: 'read', readReceipt: receipt}, {version: '2.1'}));
  assert.ok(view);
  assert.equal(status(view), 'finished/turn-ended', 'the class ignores read evidence');
  assert.deepEqual(view.outcome, {notices: [finished], read: 'read', readReceipt: receipt, confidence: 'confirmed', evidenceAtMs: AT - 1000});
});

// Design decision 4: the read function maps session/2.x to the same claims. Active work is unconfirmed while freshness
// is uncertain or the record is restart-uncertain; attention and outcomes never become uncertain from silence.
test('2.x waiting records need the owner however long they are silent', () => {
  const asking = read({activity: 'active', attention: [approval()], ...silent});
  assert.equal(status(asking), 'needs-owner/approval');
  assert.deepEqual(asking.attention, {items: [approval()], confidence: 'confirmed', evidenceAtMs: silent.lastEvidenceAtMs});
  assert.deepEqual(asking.work, {state: 'active', confidence: 'unconfirmed', evidenceAtMs: silent.lastEvidenceAtMs, reasons: ['deadline']},
    'the turn still running under the question is the only claim silence makes unconfirmed');
  const continuing = read({activity: 'idle', attention: [question()], ...silent});
  assert.equal(status(continuing), 'needs-owner/question');
  assert.deepEqual(continuing.work.reasons, []);
  assert.equal(continuing.work.confidence, 'confirmed');
});

test('2.x working records are working, unconfirmed after five minutes of silence', () => {
  const current = read({activity: 'active'});
  assert.equal(status(current), 'working/confirmed');
  assert.deepEqual(current.work, {state: 'active', confidence: 'confirmed', evidenceAtMs: AT - 1000, reasons: []});
  const quiet = read({activity: 'active', ...silent});
  assert.equal(status(quiet), 'working/unconfirmed');
  assert.deepEqual(quiet.work.reasons, ['deadline']);
});

test('2.x restart uncertainty makes only running work unconfirmed', () => {
  const restart = {freshness: 'uncertain', restartUncertain: true};
  const running = read({activity: 'active', ...restart});
  assert.equal(status(running), 'working/unconfirmed');
  assert.deepEqual(running.work.reasons, ['restart']);
  const finished = read({activity: 'idle', notices: [notice()], ...restart});
  assert.equal(status(finished), 'finished/turn-ended', 'a recorded outcome stays');
  assert.deepEqual([finished.work.confidence, finished.outcome.confidence], ['confirmed', 'confirmed']);
  const asking = read({activity: 'idle', attention: [question()], ...restart});
  assert.equal(status(asking), 'needs-owner/question', 'a question stays');
  assert.equal(asking.attention.confidence, 'confirmed');
});

test('2.x child counts map to working and unconfirmed children', () => {
  const parent = read({children: {active: 1, uncertain: 2}});
  assert.deepEqual(parent.relationships, {children: {working: 1, unconfirmed: 2}, confidence: 'confirmed'});
  assert.equal(status(parent), 'working/subagent');
  assert.equal(status(read({children: {active: 0, uncertain: 2}})), 'quiet/idle');
  const child = read({identity: identity('session-a-child'), parent: {status: 'known', identity: identity('session-a')}, activity: 'active', ...silent});
  assert.equal(status(child), 'working/unconfirmed');
});

test('ambiguous or lost evidence makes the claim of its dimension unconfirmed', () => {
  const view = read({activity: 'unknown', unavailable: [{dimension: 'activity', reason: 'lost'}, {dimension: 'attention', reason: 'ambiguous'},
    {dimension: 'parent', reason: 'lost'}, {dimension: 'turn', reason: 'missing'}]});
  assert.equal(status(view), 'unknown/lost');
  assert.deepEqual([view.attention.confidence, view.outcome.confidence, view.relationships.confidence], ['unconfirmed', 'confirmed', 'unconfirmed']);
  assert.equal(read({unavailable: [{dimension: 'attention', reason: 'missing'}]}).attention.confidence, 'confirmed');
});

test('each consumer\'s policy retires finished to quiet: by acknowledgment, then by read evidence where it counts', () => {
  const desktop = {provider: 'codex', client: 'desktop', hostId: 'synthetic-host', sourceId: 'codex-desktop', sessionId: 'session-d'};
  const pixoo = read({identity: desktop, notices: [notice('turn-1', ['pixoo'])], read: 'read'});
  assert.equal(status(pixoo), 'finished/turn-ended');
  assert.equal(status(forConsumer(pixoo)), 'quiet/acknowledged', 'any consumer by default');
  assert.equal(status(forConsumer(pixoo, {acknowledgingConsumers: ['nanoleaf']})), 'finished/turn-ended');
  assert.equal(status(forConsumer(pixoo, {acknowledgingConsumers: ['nanoleaf'], read: true})), 'quiet/read');
  assert.equal(status(forConsumer(pixoo, {acknowledgingConsumers: []})), 'finished/turn-ended', 'no named consumer counts');
  assert.equal(pixoo.status.class, 'finished', 'the policy never changes the hub\'s view');
  const unread = read({identity: desktop, notices: [notice()], read: 'unread'});
  assert.equal(status(forConsumer(unread, {read: true})), 'finished/turn-ended');
  // Two notices of the current turn: both must be acknowledged.
  const twice = read({notices: [notice('turn-1', ['pixoo']), notice('turn-1')]});
  assert.equal(status(forConsumer(twice)), 'finished/turn-ended');
  const working = read({activity: 'active', notices: [notice()]});
  assert.equal(forConsumer(working, {read: true}), working, 'only finished retires');
});

test('sessionState and highestStatus read views and records alike', () => {
  const records = [message({activity: 'active'}).data, message({identity: identity('session-b'), notices: [notice()]}).data];
  const views = records.map(sessionView);
  assert.deepEqual(views.map(view => sessionState(view)), ['working', 'done']);
  assert.deepEqual(records.map(record => sessionState(record)), ['working', 'done']);
  assert.equal(highestStatus({synced: true, sessions: views}), 'working');
  assert.equal(highestStatus({synced: true, sessions: [views[1]]}), 'done');
  assert.equal(highestStatus({synced: false, sessions: views}), 'unknown');
  // An unknown detail falls back to its class: a finished status the reader does not know is still done.
  const unknownDetail = {...views[1], status: {class: 'finished', detail: 'failed-remotely'}};
  assert.equal(sessionState(unknownDetail), 'done');
  assert.equal(status(forConsumer(unknownDetail)), 'finished/failed-remotely');
});

/** A live coding opportunity for a view, as the core's companion part raises it. */
function opportunity(view, overrides = {}) {
  const attention = view.attention.items[0] ?? null;
  const noticeId = view.outcome.notices.at(-1)?.id ?? null;
  const cue = attention?.kind ?? 'turn-ended';
  return {
    origin: {id: 'msg-occurrence', source: 'bunny/core', type: 'org.bunny.attention.raised'}, sourceKind: 'coding', context: 'live',
    category: cue === 'turn-ended' ? 'coding-notice' : 'coding-attention', cue, revision: view.revision, generation: view.generation,
    session: view.id, identity: view.identity, turn: view.turn, attention: cue === 'turn-ended' ? null : attention, noticeId: cue === 'turn-ended' ? noticeId : null,
    evidence: 'lifecycle-metadata', occurredAtMs: null, observedAtMs: AT, validUntilMs: AT + 30_000, busy: null, media: null, visitor: null, location: null,
    ...overrides,
  };
}

test('an opportunity matches while its generation, identity, turn and item are still the session\'s', () => {
  const asking = read({activity: 'active', attention: [approval()], ...silent});
  const raised = opportunity(asking);
  assert.equal(opportunityMatches(asking, raised, 'microduck'), true, 'unconfirmed work does not abandon an approval');
  assert.equal(opportunityMatches(asking, {...raised, generation: asking.generation + 1}, 'microduck'), false, 'another generation');
  assert.equal(opportunityMatches(asking, {...raised, identity: identity('session-b')}, 'microduck'), false, 'another identity');
  assert.equal(opportunityMatches(asking, {...raised, session: hash('another')}, 'microduck'), false, 'another session');
  assert.equal(opportunityMatches(asking, {...raised, turn: known('turn-0')}, 'microduck'), false, 'another turn');
  assert.equal(opportunityMatches(asking, {...raised, session: null, identity: null, context: 'scenario'}, 'microduck'), false);
  const cleared = read({activity: 'active'});
  assert.equal(opportunityMatches(cleared, opportunity(asking), 'microduck'), false, 'a cleared attention item');
  assert.equal(opportunityMatches(asking, {...raised, attention: {...approval(), id: known('approval-2')}}, 'microduck'), false, 'another item');
  assert.equal(opportunityMatches(asking, {...raised, category: 'simulated-social', cue: 'arrival', sourceKind: 'simulated-apartment'}, 'microduck'), false);
});

test('a notice opportunity matches until the consumer itself acknowledges the notice', () => {
  const finished = read({notices: [notice()]});
  const raised = opportunity(finished);
  assert.equal(opportunityMatches(finished, raised, 'reachy-mini'), true);
  const others = read({notices: [notice('turn-1', ['pixoo'])]});
  assert.equal(opportunityMatches(others, opportunity(others), 'reachy-mini'), true, 'another consumer\'s acknowledgment');
  const own = read({notices: [notice('turn-1', ['reachy-mini'])]});
  assert.equal(opportunityMatches(own, opportunity(own), 'reachy-mini'), false);
  assert.equal(opportunityMatches(finished, {...raised, noticeId: hash('another notice')}, 'reachy-mini'), false);
  assert.equal(opportunityMatches(finished, {...raised, noticeId: null}, 'reachy-mini'), false);
});

test('an unknown status detail never makes an opportunity match', () => {
  const finished = read({notices: [notice()]});
  const raised = opportunity(finished);
  const unknownDetail = {...finished, status: {class: 'finished', detail: 'failed-remotely'}};
  assert.equal(sessionState(unknownDetail), 'done', 'the view shows finished');
  assert.equal(opportunityMatches(unknownDetail, raised, 'reachy-mini'), false);
});
