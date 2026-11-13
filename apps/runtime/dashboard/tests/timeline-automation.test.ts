import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {History} from '../../dist/src/core/history.js';
import {selectedHistory} from '../src/timeline-model.ts';

void test('Automation includes all retained definition changes and removals', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../../packages/event-contracts/fixtures/v2/families.json', import.meta.url), 'utf8')) as {valid: Record<string, Message>};
  const names = ['automation-rule', 'automation-routine', 'automation-settings', 'automation-interrupt-set',
    'automation-rule-removed', 'automation-routine-removed'];
  const db = new DatabaseSync(':memory:');
  try {
    const history = new History(db);
    for (const [index, name] of names.entries()) {
      const message = fixture.valid[name];
      assert.ok(message);
      history.write([{kind: 'message', message}], index + 1, index + 1);
    }
    const rows = history.read({});
    assert.equal(rows.length, names.length);
    assert.deepEqual(selectedHistory(rows, 'Automation').map(entry => entry.type), rows.toReversed().map(entry => entry.type));
  } finally { db.close(); }
});
