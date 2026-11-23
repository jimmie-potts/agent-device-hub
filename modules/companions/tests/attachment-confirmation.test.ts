import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {Outcome} from '@jimmie-potts/sdk';
import {confirmationEvidence, type Confirmation} from '../src/assistant/confirmation.js';

void test('owner attachment confirmation requires the exact display phase and preserves transmitted and uncertain evidence', () => {
  const watch: Confirmation = {artwork: {target: 'sideboard', prepareRequestId: 'prepare-1', momentRequestId: 'moment-1'}, label: 'Sideboard',
    requestId: 'show-1', taskId: 'turn-1', questionId: 'owner-message', acceptedAtMs: 1, expiresAtMs: 10,
    traceparent: '00-12345678901234567890123456789012-1234567890123456-01'};
  const requester = 'bunny/modules/companions';
  const show: OperationRecord = {id: 'show-1', requestId: 'show-1', kind: 'moment', family: 'art-show', command: 'art-show',
    target: 'hub', requestedBy: requester, status: 'completed', result: Outcome.succeeded, evidence: Outcome.observed,
    revision: 1, sentAtMs: 1, updatedAtMs: 2, deadlineAtMs: 10};
  const moment: OperationRecord = {...show, id: 'moment-1', requestId: 'moment-1', family: 'moment-play', command: 'moment-play',
    target: 'sideboard', requestedBy: 'bunny/core', evidence: Outcome.transmitted};

  assert.deepEqual(confirmationEvidence(watch, show, undefined, requester), {});
  assert.deepEqual(confirmationEvidence(watch, show, undefined, requester, {...moment, target: 'other'}), {});
  assert.deepEqual(confirmationEvidence(watch, show, undefined, requester, moment),
    {sent: true, result: 'Sent the artwork to Sideboard.'});
  assert.deepEqual(confirmationEvidence(watch, show, undefined, requester, {...moment, status: 'uncertain', result: Outcome.uncertain}),
    {result: 'The artwork was sent to Sideboard. I couldn’t confirm whether Sideboard presented the artwork.'});
});
