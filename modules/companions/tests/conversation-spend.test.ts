// The page's reading of the shared spend route (Hub #2024): a well-formed answer only, dollars and cents, the reservations
// still counted for unreported usage, and the notice at a limit. Synthetic amounts only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decodeSpend, spendNotice, spendText} from '../src/frontend/conversation-spend.js';

const day = {period: '2026-11-21', spentMicros: 1_234_567, limitMicros: 20_000_000, unreported: 0, unreportedMicros: 0};
const month = {period: '2026-11', spentMicros: 12_500_000, limitMicros: 150_000_000, unreported: 0, unreportedMicros: 0};

void test('only a well-formed spend answer is read, and anything else reads as unknown', () => {
  assert.deepEqual(decodeSpend({version: 1, day, month}), {version: 1, day, month});
  for (const value of [undefined, null, [], {version: 2, day, month}, {version: 1, day}, {version: 1, day: {...day, period: '2026-11'}, month},
    {version: 1, day: {...day, spentMicros: -1}, month}, {version: 1, day: {...day, unreported: 0.5}, month}, {version: 1, day, month: {...month, period: '2026-11-21'}},
    {version: 2, profile: 'bunny', conversationId: null, messages: [], currentTask: null, older: null}]) {
    assert.equal(decodeSpend(value), undefined, JSON.stringify(value));
  }
});

void test('spend reads as dollars of the limit, naming reservations still counted, and a reached limit is a notice', () => {
  assert.equal(spendText(day), '$1.23 of $20.00');
  assert.equal(spendText({...day, unreported: 2, unreportedMicros: 680_000}), '$1.23 of $20.00, including $0.68 reserved for 2 calls without reported usage');
  assert.equal(spendNotice(undefined), undefined); assert.equal(spendNotice({version: 1, day, month}), undefined);
  assert.equal(spendNotice({version: 1, day: {...day, spentMicros: 20_000_000}, month}), 'The daily spend limit of $20.00 is reached. New messages can start after midnight, the runtime host\'s local time.');
  assert.equal(spendNotice({version: 1, day, month: {...month, spentMicros: 150_000_001}}), 'The monthly spend limit of $150.00 is reached. New messages can start when the next month begins.');
});
