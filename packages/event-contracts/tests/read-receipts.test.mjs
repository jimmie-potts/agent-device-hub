import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies, sessionEntityId} from '../dist/v2/families.js';
import {decideReadReceipt, READ_RECEIPT_SCHEMA, registerReadReceiptFamily} from '@jimmie-potts/event-contracts/v2/read-receipts';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8')).valid;
function validator(optIn = true) {
  const v = new MessageValidator();
  registerCoreFamilies(v);
  if (optIn) registerReadReceiptFamily(v);
  return v;
}
function example(provider = 'codex', kind = 'provider-client') {
  const identity = {provider, client: provider === 'codex' ? 'local' : 'code',
    hostId: 'synthetic-host', sourceId: `${provider}-local`, sessionId: 'synthetic-session'};
  const session = {...structuredClone(fixtures.session.data), identity, read: 'unknown', ordering: {status: 'unknown'}};
  session.id = sessionEntityId(identity);
  const receipt = kind === 'provider-client' ? {kind, client: 'desktop', seenRevision: 'rev-z', acceptedRevision: 'rev-a'} :
    {kind, viewRevision: 'view-1'};
  const message = {...structuredClone(fixtures.lifecycle), source: 'bunny/observer/read-receipts', subject: session.id,
    dataschema: READ_RECEIPT_SCHEMA, data: {
      identity, turn: session.turn, parent: {status: 'unknown'}, observedAtMs: 1791288000000, ordering: {status: 'unknown'},
      event: {kind: 'read-receipt-observed', generation: session.generation, noticeId: session.notices[0].id, receipt},
    }};
  const {sessionId: _sessionId, ...feed} = identity;
  return {message, session, qualification: {source: message.source, feed, kind}};
}
const ineligible = reason => ({status: 'ineligible', reason});

test('Codex local and Claude code receipts require explicit registration and retain their identity', () => {
  const optedIn = validator(), ordinary = validator(false);
  for (const provider of ['codex', 'claude']) for (const kind of ['provider-client', 'owned-ui']) {
    const {message, session} = example(provider, kind);
    assert.equal(optedIn.validate(message).ok, true, `${provider}/${kind}`);
    assert.deepEqual(message.data.identity, session.identity);
    assert.equal(ordinary.validate(message).error.code, 'unsupported-version');
    message.dataschema = 'https://bunny.invalid/events/lifecycle/2.0';
    assert.equal(optedIn.validate(message).ok, false);
    const projection = {...structuredClone(fixtures.session), subject: session.id, data: session};
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
    s => {s.notices = [];},
    s => {s.notices[0].id = 'a'.repeat(64);},
    s => {s.notices[0].turn = {status: 'known', id: 'other-turn'};},
    s => {s.notices[0].turn = {status: 'unknown'};},
    ...['provider', 'client', 'hostId', 'sourceId', 'sessionId'].map(key => s => {s.identity[key] = 'other';}),
  ];
  for (const change of changes) {
    const current = structuredClone(session); change(current);
    assert.deepEqual(decideReadReceipt(message, current, qualification), ineligible('stale-target'), change.toString());
  }
});

test('known children and unfinished sessions remain ineligible', () => {
  const {message, session, qualification} = example();
  for (const activity of ['active', 'unknown']) {
    assert.deepEqual(decideReadReceipt(message, {...session, activity}, qualification), ineligible('unfinished'));
  }
  const child = {...session, parent: {status: 'known', identity: {...session.identity, sessionId: 'parent'}}};
  assert.deepEqual(decideReadReceipt(message, child, qualification), ineligible('child'));
});

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
test('qualified finished receipts leave freshness, attention, parentage and acknowledgments untouched', () => {
  for (const provider of ['codex', 'claude']) for (const kind of ['provider-client', 'owned-ui']) {
    for (const activity of ['idle', 'interrupted']) {
      const input = example(provider, kind);
      input.session.activity = activity;
      input.session.freshness = 'uncertain';
      input.session.restartUncertain = true;
      const before = structuredClone(input);
      freeze(input);
      assert.deepEqual(decideReadReceipt(input.message, input.session, input.qualification),
        {status: 'eligible', noticeId: input.session.notices[0].id});
      assert.deepEqual(input, before);
    }
  }
});
