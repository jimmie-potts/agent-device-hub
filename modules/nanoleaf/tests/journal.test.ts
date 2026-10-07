// The control journal's outcomes (Hub #844): each error is the 2.0 registry's error detail, with the code's fixed
// `retryable` flag, so the module publishes it through its outbox unchanged (ADR 0012, "Safe errors").
import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {outcomeOf, type End} from '../src/journal.js';
import {suite, test} from './support.js';

suite('journal outcomes', () => {
  test('every failed or uncertain outcome carries the registry\'s error detail', () => {
    const queued = {device: 'wall', id: 'request-1', completed: 0, uncertain: 0};
    const ends: [End, string][] = [[{kind: 'uncertain'}, 'uncertain-result'], [{kind: 'retired'}, 'cancelled'], [{kind: 'expired'}, 'expired'],
      [{kind: 'refused', code: 'unsupported-capability'}, 'unsupported-capability']];
    for (const [end, code] of ends) {
      const outcome = outcomeOf(queued, end);
      assert.deepEqual(outcome.error, errorBody(code as Parameters<typeof errorBody>[0]).error, end.kind);
    }
    assert.deepEqual(outcomeOf({...queued, uncertain: 1}, {kind: 'retired'}).error, errorBody('uncertain-result').error);
    assert.equal(outcomeOf(queued, {kind: 'sent'}).error, undefined);
  });
});
