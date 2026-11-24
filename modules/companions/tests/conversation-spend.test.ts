// The page's reading of the shared spend route (Hub #2024): a well-formed answer only, dollars and cents, the reservations
// still counted for unreported usage, and the notice at a limit. Synthetic amounts only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decodeSpend, priceText, spendNotice, spendText} from '../src/frontend/conversation-spend.js';

const day = {period: '2026-11-21', spentMicros: 1_234_567, limitMicros: 20_000_000, unreported: 0, unreportedMicros: 0};
const month = {period: '2026-11', spentMicros: 12_500_000, limitMicros: 150_000_000, unreported: 0, unreportedMicros: 0};
const paid = {model: 'model-a', minimumMicros: 368_640, prices: 'built-in' as const, pricesAsOf: '2026-11-22'};

void test('only a well-formed spend answer is read, and anything else reads as unknown', () => {
  assert.deepEqual(decodeSpend({version: 1, day, month, paid}), {version: 1, day, month, paid});
  for (const value of [undefined, null, [], {version: 2, day, month, paid}, {version: 1, day}, {version: 1, day, month}, {version: 1, day, month, paid: {model: 'Bad Model', minimumMicros: 1}}, {version: 1, day, month, paid: {model: 'model-a', minimumMicros: -1}}, {version: 1, day: {...day, period: '2026-11'}, month, paid},
    {version: 1, day: {...day, spentMicros: -1}, month, paid}, {version: 1, day: {...day, unreported: 0.5}, month, paid}, {version: 1, day, month: {...month, period: '2026-11-21'}, paid},
    {version: 2, profile: 'bunny', conversationId: null, messages: [], currentTask: null, older: null}]) {
    assert.equal(decodeSpend(value), undefined, JSON.stringify(value));
  }
});

void test('spend reads as dollars of the limit, naming reservations still counted, and a reached limit is a notice', () => {
  assert.equal(spendText(day), '$1.23 of $20.00');
  assert.equal(spendText({...day, unreported: 2, unreportedMicros: 680_000}), '$1.23 of $20.00, including $0.68 reserved for 2 calls without reported usage');
  assert.equal(spendNotice(undefined), undefined); assert.equal(spendNotice({version: 1, day, month, paid}), undefined);
  assert.equal(spendNotice({version: 1, day: {...day, spentMicros: 20_000_000}, month, paid}), 'The daily spend limit of $20.00 is reached. New messages can start after midnight, the runtime host\'s local time.');
  assert.equal(spendNotice({version: 1, day, month: {...month, spentMicros: 150_000_001}, paid}), 'This month\'s local spend estimate has reached its $150.00 guard. New messages can start when the next month begins.');
});

void test('the prices fact names configured, built-in and dearest prices, and the notice a remainder below the smallest call', () => {
  const view = (patch: object) => ({version: 1 as const, day, month, paid, ...patch});
  assert.equal(decodeSpend(view({paid: null}))?.paid, null);
  for (const bad of [{...paid, minimumMicros: null}, {...paid, prices: 'missing'}, {...paid, pricesAsOf: 'today'}, {model: 'model-a', minimumMicros: 1}]) {
    assert.equal(decodeSpend(view({paid: bad})), undefined, JSON.stringify(bad));
  }
  assert.equal(priceText(undefined), 'Unknown'); assert.equal(priceText(view({paid: null})), 'Not needed (synthetic calls)');
  assert.equal(priceText(view({})), 'Built-in prices of 2026-11-22 for model-a');
  assert.equal(priceText(view({paid: {...paid, prices: 'configured'}})), 'Configured for model-a');
  assert.equal(priceText(view({paid: {...paid, prices: 'dearest'}})), 'model-a is not in the built-in prices of 2026-11-22; priced at the dearest known rate');
  assert.equal(spendNotice(view({paid: null, day: {...day, spentMicros: 20_000_000}})), undefined, 'the synthetic provider meets no limit');
  assert.match(spendNotice(view({day: {...day, spentMicros: 20_000_000 - 368_639}})) ?? '', /^The daily spend limit of \$20\.00 is reached\./, 'less than the smallest call remains');
  assert.equal(spendNotice(view({day: {...day, spentMicros: 20_000_000 - 368_640}})), undefined, 'exactly the smallest call remains');
  assert.equal(spendNotice(view({month: {...month, spentMicros: 150_000_000}})), 'This month\'s local spend estimate has reached its $150.00 guard. New messages can start when the next month begins.');
});

void test('Details and the notice name the configured monthly guard the route reports (Hub #2102)', () => {
  const owner = {...month, limitMicros: 200_000_000};
  assert.equal(spendText(owner), '$12.50 of $200.00');
  assert.equal(spendNotice({version: 1, day, month: {...owner, spentMicros: 150_000_000}, paid}), undefined, 'the default $150 no longer refuses');
  assert.equal(spendNotice({version: 1, day, month: {...owner, spentMicros: 200_000_000}, paid}), 'This month\'s local spend estimate has reached its $200.00 guard. New messages can start when the next month begins.');
});
