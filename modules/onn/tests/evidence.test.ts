// The attempt's transmission claim changes only through merge (Hub #1140). The #1126 F1 shape, where a later
// failure rebuilt the claim and erased an acknowledged transmission, no longer compiles.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {absent, transmitted} from '@jimmie-potts/sdk';
import {deliveryEvidence} from '../src/transport.js';

void test('an acknowledged transmission survives a later failure and cannot be replaced', () => {
  const delivery = deliveryEvidence();
  delivery.merge(transmitted());
  // #1126 F1: the refused Stop's catch rebuilt the claim as nothing sent.
  // Never called: these lines only have to fail tsc.
  const forbidden = (): void => {
    // @ts-expect-error a held claim is bound once; it cannot be replaced by assignment.
    delivery = deliveryEvidence();
    // @ts-expect-error the held claim is read-only; only merge changes it.
    delivery.claim = absent();
  };
  assert.equal(typeof forbidden, 'function');
  delivery.merge(absent());
  assert.equal(delivery.claim.level, 'transmitted');
});
