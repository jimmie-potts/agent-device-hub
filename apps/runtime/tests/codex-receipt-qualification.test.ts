import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, sessionEntityId, type Identity} from '@jimmie-potts/event-contracts/v2/families';
import {READ_RECEIPT_SCHEMA, registerReadReceiptFamily, type ReadReceiptObservation} from '@jimmie-potts/event-contracts/v2/read-receipts';
import {prepareMessage} from '@jimmie-potts/sdk';
import {checkReadReceiptIdentity} from '../src/gateway/producer-admission.js';
import {producerSource} from '../src/hook/producer.js';
import {receiptQualification, receiptSource} from '../src/read-receipts/qualification.js';

const lifecycleFeed = {provider: 'codex', client: 'local', hostId: 'synthetic-mac', sourceId: 'codex-hooks'} as const;
const identity: Identity = {...lifecycleFeed, sessionId: 'synthetic-session'};
const feed = 'codex-desktop-read-26.1027.30824-22943-0.166.0-alpha.5.1';
const source = producerSource({...lifecycleFeed, feed}).replace('/hub-', '/codex-read-');
const data: ReadReceiptObservation = {identity, turn: {status: 'known', id: 'completed-turn'}, parent: {status: 'unknown'},
  observedAtMs: 1000, ordering: {status: 'unknown'}, event: {kind: 'read-receipt-observed', generation: 1, noticeId: 'a'.repeat(64),
    receipt: {kind: 'provider-client', client: 'desktop', seenRevision: '11111111-1111-4111-8111-111111111111',
      acceptedRevision: '22222222-2222-4222-8222-222222222222'}}};
const message = prepareMessage(source, {kind: 'occurrence', type: 'org.bunny.lifecycle.observed',
  subject: sessionEntityId(identity), dataschema: READ_RECEIPT_SCHEMA, data});

void test('the enrolled Codex Desktop source admits its existing provider-client receipt contract', () => {
  const validator = new MessageValidator();
  registerCoreFamilies(validator); registerReadReceiptFamily(validator);
  assert.equal(validator.validate(message).ok, true, 'the test exercises an already valid wire message');
  assert.deepEqual(receiptQualification(message), {source,
    feed: {provider: 'codex', client: 'local', hostId: identity.hostId, sourceId: identity.sourceId}, kind: 'provider-client'});
  assert.equal(checkReadReceiptIdentity(message), undefined);
});

void test('a dedicated Codex receipt credential cannot publish ordinary lifecycle activity', () => {
  const activity = {...message, dataschema: 'https://bunny.invalid/events/lifecycle/2.0',
    data: {...data, event: {kind: 'turn-started'}}};
  assert.equal(checkReadReceiptIdentity(activity)?.error.code, 'forbidden');
});

void test('ordinary hooks, Claude credentials, other feeds and other receipt kinds cannot qualify Codex', () => {
  for (const candidate of [
    {...message, source: producerSource(lifecycleFeed)},
    {...message, source: receiptSource({...identity, provider: 'claude', client: 'code'})},
    {...message, data: {...data, identity: {...identity, hostId: 'another-host'}}},
    {...message, data: {...data, identity: {...identity, client: 'cli' as const}}},
    {...message, data: {...data, event: {...data.event, receipt: {kind: 'owned-ui' as const, viewRevision: 'session-1'}}}},
  ]) {
    assert.equal(receiptQualification(candidate), undefined);
    assert.equal(checkReadReceiptIdentity(candidate)?.error.code, 'forbidden');
  }
});
