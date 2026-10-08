import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import type {ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {ModePart} from '../src/core/mode.js';

void test('first start durably serves Free without applying it to a device', () => {
  const database = new DatabaseSync(':memory:');
  try {
    const mode = new ModePart();
    mode.open(database);
    assert.deepEqual(mode.states(['mode']).map(state => (state.data as ModeState).mode), ['free']);
    const reopened = new ModePart();
    reopened.open(database);
    assert.deepEqual(reopened.states(['mode']).map(state => (state.data as ModeState).mode), ['free']);
  } finally {database.close();}
});
