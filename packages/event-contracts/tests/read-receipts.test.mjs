import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies, sessionEntityId} from '../dist/v2/families.js';
import {decideReadReceipt, READ_RECEIPT_SCHEMA, readReceiptValidator, registerReadReceiptFamily} from '@jimmie-potts/event-contracts/v2/read-receipts';
import {buildSession, readSession as viewOf} from '../dist/v2/session.js';
import {loadSessionCases} from '../dist/v2/session-cases.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8')).valid;
function validator(optIn = true) {
  const v = new MessageValidator();
  registerCoreFamilies(v);
  if (optIn) registerReadReceiptFamily(v);
  return v;
}
/** The session/3.0 record a receipt targets, with the claims of a retained session/2.0 record's members. */
function view(record, work = record.activity) {
  return buildSession({
    id: record.id, revision: record.revision, generation: record.generation, identity: record.identity, parent: record.parent, turn: record.turn, work,
    attention: record.attention, notices: record.notices, read: record.read, ...(record.readReceipt === undefined ? {} : {readReceipt: record.readReceipt}),
    unavailable: record.unavailable, ordering: record.ordering, observedAtMs: record.observedAtMs, lastEvidenceAtMs: record.lastEvidenceAtMs,
    children: {working: record.children.active, unconfirmed: record.children.uncertain},
  });
}
/**
 * A receipt for a finished synthetic session: `record` is its retained session/2.0 form, which the 2.1 schema tests
 * extend, and `session` its session/3.0 record, which receipts are decided on.
 */
function example(provider = 'codex', kind = 'provider-client') {
  const identity = {provider, client: provider === 'codex' ? 'local' : 'code',
    hostId: 'synthetic-host', sourceId: `${provider}-local`, sessionId: 'synthetic-session'};
  const record = {...structuredClone(fixtures.session.data), identity, read: 'unknown', ordering: {status: 'unknown'}};
  record.id = sessionEntityId(identity);
  const session = view(record);
  const receipt = kind === 'provider-client' ? {kind, client: 'desktop', seenRevision: 'rev-z', acceptedRevision: 'rev-a'} :
    {kind, viewRevision: 'view-1'};
  const message = {...structuredClone(fixtures.lifecycle), source: 'bunny/observer/read-receipts', subject: session.id,
    dataschema: READ_RECEIPT_SCHEMA, data: {
      identity, turn: session.turn, parent: {status: 'unknown'}, observedAtMs: 1791288000000, ordering: {status: 'unknown'},
      event: {kind: 'read-receipt-observed', generation: session.generation, noticeId: record.notices[0].id, receipt},
    }};
  const {sessionId: _sessionId, ...feed} = identity;
  return {message, record, session, qualification: {source: message.source, feed, kind}};
}
const ineligible = reason => ({status: 'ineligible', reason});

/** A retained session/2.1 message holding a receipt's provenance. */
function readSession() {
  const {message, record} = example('claude', 'owned-ui');
  record.read = 'read';
  record.readReceipt = {noticeId: message.data.event.noticeId, observedAtMs: message.data.observedAtMs,
    source: message.source, receipt: message.data.event.receipt};
  return {...structuredClone(fixtures.session), subject: record.id, dataschema: 'https://bunny.invalid/events/session/2.1', data: record};
}

test('the shared receipt validator is one sealed validator that decides as an opted-in validator of its own does (Hub #1534)', () => {
  const shared = readReceiptValidator();
  assert.equal(readReceiptValidator(), shared, 'compiled once per process');
  const own = validator();
  const {message} = example();
  const unknownKind = structuredClone(message);
  unknownKind.data.event.receipt.kind = 'guessed';
  for (const [name, input] of Object.entries({...fixtures, receipt: message, 'owned-ui receipt': example('claude', 'owned-ui').message, 'read session': readSession(), unknownKind})) {
    assert.deepEqual(shared.validate(input, {nowMs: Date.parse(input.time)}), own.validate(input, {nowMs: Date.parse(input.time)}), name);
  }
  assert.equal(shared.validate(message, {nowMs: Date.parse(message.time)}).ok, true, 'it takes the opt-in family');
  assert.equal(shared.validate(unknownKind, {nowMs: Date.parse(message.time)}).ok, false);
  assert.throws(() => shared.register('https://bunny.invalid/events/example-extra/2.0', {type: 'object'}), /sealed validator/);
  assert.throws(() => registerReadReceiptFamily(shared), /sealed validator/);
  assert.equal(shared.validate(message, {nowMs: Date.parse(message.time)}).ok, true, 'a refused registration changes nothing');
});

test('session/2.1 exposes a qualified Claude receipt without weakening session/2.0', () => {
  const v = validator(false), message = readSession();
  assert.equal(v.validate(message).ok, true, 'current consumers understand the receipt-bearing output');
  assert.equal(v.validate({...message, dataschema: 'https://bunny.invalid/events/session/2.0'}).ok, false);
});

test('session/2.1 refuses positive read without matching, closed root provenance', () => {
  const v = validator(false);
  for (const change of [
    m => {delete m.data.readReceipt;},
    m => {m.data.readReceipt.noticeId = 'f'.repeat(64);},
    m => {m.data.readReceipt.source = 'not-authenticated-source';},
    m => {m.data.readReceipt.receipt.prompt = 'synthetic private content';},
    m => {m.data.turn = {status: 'unknown'};},
    m => {m.data.turn.id = 'different-turn';},
    m => {m.data.activity = 'active';},
    m => {m.data.read = 'unknown';},
    m => {m.data.parent = {status: 'known', identity: {...m.data.identity, sessionId: 'parent'}};},
  ]) {
    const message = readSession(); change(message);
    assert.equal(v.validate(message).ok, false, change.toString());
  }
});

test('Codex local and Claude code receipts require explicit registration and retain their identity', () => {
  const optedIn = validator(), ordinary = validator(false);
  for (const provider of ['codex', 'claude']) for (const kind of ['provider-client', 'owned-ui']) {
    const {message, record} = example(provider, kind);
    assert.equal(optedIn.validate(message).ok, true, `${provider}/${kind}`);
    assert.deepEqual(message.data.identity, record.identity);
    assert.equal(ordinary.validate(message).error.code, 'unsupported-version');
    message.dataschema = 'https://bunny.invalid/events/lifecycle/2.0';
    assert.equal(optedIn.validate(message).ok, false);
    const projection = {...structuredClone(fixtures.session), subject: record.id, data: record};
    assert.equal(ordinary.validate(projection).ok, true);
    projection.data.read = 'read';
    assert.equal(ordinary.validate(projection).ok, false, 'session/2.0 still refuses positive read evidence here');
  }
});

test('the extension preserves existing lifecycle observations and their semantic checks', () => {
  const v = validator();
  for (const original of Object.values(fixtures).filter(m => m.dataschema === 'https://bunny.invalid/events/lifecycle/2.0')) {
    assert.equal(v.validate({...original, dataschema: READ_RECEIPT_SCHEMA}).ok, true);
  }
  const message = {...structuredClone(fixtures.lifecycle), dataschema: READ_RECEIPT_SCHEMA};
  message.data.ordering.authority = 'another-source';
  assert.equal(v.validate(message).ok, false);
  message.data.ordering = {status: 'unknown'};
  message.data.parent = {status: 'known', identity: {...message.data.identity, hostId: 'another-host'}};
  assert.equal(v.validate(message).ok, false);
  message.data.parent = {status: 'unknown'};
  message.data.identity.client = 'local';
  message.subject = sessionEntityId(message.data.identity);
  message.data.event = {kind: 'read-observed', state: 'read'};
  assert.equal(v.validate(message).ok, false, 'old marker privilege is not widened');
});

test('opaque native initial revisions survive a qualified explicit read action', () => {
  for (const provider of ['codex', 'claude']) {
    const {message, session, qualification} = example(provider);
    message.data.event.receipt.seenRevision = 'initial:synthetic-session';
    message.data.event.receipt.acceptedRevision = '00000000-0000-4000-8000-000000000001';
    assert.equal(validator().validate(message).ok, true);
    assert.deepEqual(decideReadReceipt(message, session, qualification), {status: 'eligible', noticeId: session.outcome.notices[0].id});
    assert.equal(message.data.event.receipt.seenRevision, 'initial:synthetic-session');
  }
  const {message} = example('codex', 'owned-ui');
  message.data.event.receipt.viewRevision = 'initial:synthetic-view';
  assert.equal(validator().validate(message).ok, false, 'owned UI revisions keep the identifier contract');
});

test('closed receipts reject undeclared content, missing target and malformed provenance', () => {
  const v = validator();
  const changes = [
    m => {m.data.prompt = 'synthetic content';},
    m => {m.data.title = {value: 'synthetic title', source: 'provider'};},
    m => {m.data.event.receipt.token = 'synthetic-secret';},
    m => {m.data.event.receipt.kind = 'rendered';},
    m => {m.data.event.receipt.client = 'cli';},
    m => {delete m.data.event.receipt.acceptedRevision;},
    m => {m.data.event.receipt.seenRevision = 'x'.repeat(129);},
    m => {m.data.event.receipt.seenRevision = 'initial:has whitespace';},
    m => {m.data.event.receipt.seenRevision = '';},
    m => {m.data.event.receipt.acceptedRevision = 'x'.repeat(129);},
    m => {m.data.event.receipt.acceptedRevision = 'has\nnewline';},
    m => {m.data.event.receipt.acceptedRevision = 'has whitespace';},
    m => {m.data.event.receipt.viewRevision = 'wrong-variant';},
    m => {m.data.event.generation = -1;},
    m => {m.data.event.generation = Number.MAX_SAFE_INTEGER + 1;},
    m => {m.data.event.noticeId = 'not-an-owner-notice';},
    m => {delete m.data.event.noticeId;},
    m => {m.data.turn = {status: 'unknown'};},
    m => {m.data.parent = {status: 'top-level'};},
    m => {m.data.identity.provider = 'unknown-provider';},
    m => {m.data.identity.provider = 'claude';},
    m => {m.subject = 'wrong-session';},
    m => {m.type = 'org.bunny.session.updated';},
    m => {m.kind = 'state';},
    m => {m.data.ordering = {status: 'known', authority: 'another-source', epoch: 'e1', sequence: 1};},
  ];
  for (const change of changes) {
    const {message} = example(); change(message);
    assert.equal(v.validate(message).ok, false, change.toString());
    assert.equal(decideReadReceipt(message, undefined, undefined).status, 'invalid');
  }
});

test('untrusted input and other valid events cannot become receipts', () => {
  for (const input of [null, {}, {get data() {throw new Error('must not read accessor');}}, 'receipt']) {
    assert.equal(decideReadReceipt(input, undefined, undefined).status, 'invalid');
  }
  for (const input of [fixtures.session, fixtures.lifecycle, {...fixtures.lifecycle, dataschema: READ_RECEIPT_SCHEMA}]) {
    assert.deepEqual(decideReadReceipt(input, undefined, undefined), ineligible('not-receipt'));
  }
});

test('qualification must match the authenticated source, whole feed and receipt kind', () => {
  const {message, session, qualification} = example();
  assert.deepEqual(decideReadReceipt(message, session, undefined), ineligible('unqualified-source'));
  for (const key of ['source', 'kind']) {
    assert.deepEqual(decideReadReceipt(message, session, {...qualification, [key]: 'another'}), ineligible('unqualified-source'));
  }
  for (const key of ['provider', 'client', 'hostId', 'sourceId']) {
    const changed = {...qualification, feed: {...qualification.feed, [key]: 'another'}};
    assert.deepEqual(decideReadReceipt(message, session, changed), ineligible('unqualified-source'));
  }
});

test('delayed receipts cannot apply after a replacement session, turn or finished notice', () => {
  const {message, session, qualification} = example();
  assert.deepEqual(decideReadReceipt(message, undefined, qualification), ineligible('unknown-session'));
  const changes = [
    s => {s.generation++;},
    s => {s.turn = {status: 'unknown'};},
    s => {s.turn = {status: 'known', id: 'next-turn'};},
    s => {s.outcome.notices = [];},
    s => {s.outcome.notices[0].id = 'a'.repeat(64);},
    s => {s.outcome.notices[0].turn = {status: 'known', id: 'other-turn'};},
    s => {s.outcome.notices[0].turn = {status: 'unknown'};},
    ...['provider', 'client', 'hostId', 'sourceId', 'sessionId'].map(key => s => {s.identity[key] = 'other';}),
  ];
  for (const change of changes) {
    const current = structuredClone(session); change(current);
    assert.deepEqual(decideReadReceipt(message, current, qualification), ineligible('stale-target'), change.toString());
  }
});

test('a session in another shape, such as a session/2.x record, is no session the receipt can target, and nothing throws', () => {
  const {message, record, qualification} = example();
  for (const session of [record, {...record, outcome: {}}, {identity: record.identity}, null, 'session', 7]) {
    assert.deepEqual(decideReadReceipt(message, session, qualification), ineligible('unknown-session'), JSON.stringify(session).slice(0, 60));
  }
});

test('known children and unfinished sessions remain ineligible', () => {
  const {message, session, qualification} = example();
  for (const state of ['active', 'unknown']) {
    assert.deepEqual(decideReadReceipt(message, {...session, work: {...session.work, state}}, qualification), ineligible('unfinished'));
  }
  const child = {...session, parent: {status: 'known', identity: {...session.identity, sessionId: 'parent'}}};
  assert.deepEqual(decideReadReceipt(message, child, qualification), ineligible('child'));
});

test('eligibility reads the record\'s work state and outcome, which session/3.0 carries instead of activity and notices (Hub #1865)', () => {
  for (const provider of ['codex', 'claude']) {
    const {message, record, qualification} = example(provider, provider === 'claude' ? 'owned-ui' : 'provider-client');
    for (const state of ['idle', 'interrupted', 'active', 'unknown']) {
      const target = view(record, state);
      assert.equal(target.work.state, state);
      assert.equal('activity' in target || 'notices' in target, false, 'the record has only the claims');
      assert.deepEqual(decideReadReceipt(message, target, qualification),
        state === 'idle' || state === 'interrupted' ? {status: 'eligible', noticeId: record.notices[0].id} : ineligible('unfinished'), state);
    }
    const finished = view(record, 'idle');
    for (const change of [
      v => {v.generation++;},
      v => {v.turn = {status: 'known', id: 'next-turn'};},
      v => {v.outcome.notices = [];},
      v => {v.outcome.notices[0].turn = {status: 'known', id: 'other-turn'};},
    ]) {
      const current = structuredClone(finished); change(current);
      assert.deepEqual(decideReadReceipt(message, current, qualification), ineligible('stale-target'), change.toString());
    }
    const child = {...finished, parent: {status: 'known', identity: {...finished.identity, sessionId: 'parent'}}};
    assert.deepEqual(decideReadReceipt(message, child, qualification), ineligible('child'));
  }
});

test('over the shared case set, receipts are decided on each session/3.0 record as readSession reads it (Hub #1865)', () => {
  const decisions = {};
  for (const sessionCase of loadSessionCases().cases) for (const check of sessionCase.checks) for (const state of check.messages) {
    const record = state.data, {identity} = record;
    const kind = identity.provider === 'claude' && identity.client === 'code' ? 'owned-ui'
      : identity.provider === 'codex' && identity.client === 'local' ? 'provider-client' : undefined;
    if (kind === undefined || record.turn.status !== 'known') continue;
    const {message, qualification} = example(identity.provider, kind);
    const {sessionId: _sessionId, ...feed} = identity;
    const target = viewOf(state);
    assert.deepEqual(target, record, `${sessionCase.id} ${record.id}`);
    for (const notice of record.outcome.notices.filter(item => item.id !== '')) {
      const receipt = structuredClone(message);
      receipt.subject = record.id;
      Object.assign(receipt.data, {identity, turn: record.turn});
      Object.assign(receipt.data.event, {generation: record.generation, noticeId: notice.id});
      const decision = decideReadReceipt(receipt, target, {...qualification, feed});
      const outcome = decision.status === 'ineligible' ? decision.reason : decision.status;
      decisions[outcome] = (decisions[outcome] ?? 0) + 1;
    }
  }
  // The cases reach eligible finished roots and targets a later turn made stale; the test above covers unfinished work.
  assert.ok(decisions.eligible > 0 && decisions['stale-target'] > 0, JSON.stringify(decisions));
});

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
test('qualified finished receipts leave work confirmation, attention, parentage and acknowledgments untouched', () => {
  for (const provider of ['codex', 'claude']) for (const kind of ['provider-client', 'owned-ui']) {
    for (const state of ['idle', 'interrupted']) {
      const input = example(provider, kind);
      input.session = {...input.session, work: {state, confidence: 'unconfirmed', evidenceAtMs: input.session.work.evidenceAtMs, reasons: ['lost']}};
      const before = structuredClone(input);
      freeze(input);
      assert.deepEqual(decideReadReceipt(input.message, input.session, input.qualification),
        {status: 'eligible', noticeId: input.session.outcome.notices[0].id});
      assert.deepEqual(input, before);
    }
  }
});
