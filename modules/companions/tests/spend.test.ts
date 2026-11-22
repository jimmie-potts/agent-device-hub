// The shared spend ledger (Hub #2024): a model call's spend is its reservation until the provider reports usage, then the
// reported usage priced by the configured table. Days and months are the runtime host's local ones, fixed here to one zone
// so the boundaries are exact. The clock is a plain variable; nothing waits for time.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {SPEND_LIMITS} from '../src/assistant/limits.js';
import {dollars, reservationCost, SpendLedger, usageCost, type ModelPrices} from '../src/assistant/spend.js';

// Synthetic prices in USD per million tokens, chosen so the arithmetic is easy to read.
const PRICES: Record<string, ModelPrices> = {'model-a': {input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2}};
const A = PRICES['model-a'] ?? assert.fail();
const ZONE = 'America/Chicago';
const at = (iso: string): number => Date.parse(iso);
function ledger(database = new DatabaseSync(':memory:'), start = at('2026-11-21T18:00:00Z')) {
  let now = start;
  const spend = new SpendLedger(database, PRICES, () => now, ZONE);
  return {spend, database, set: (iso: string) => {now = at(iso);}};
}
const call = (id: string, inputUnits = 1000, outputUnits = 100) => ({id, purpose: 'task' as const, owner: 'task-1', model: 'model-a', inputUnits, outputUnits});

void test('usage and reservations are priced in millionths of a dollar, rounding up, at the dearest input class for a reservation', () => {
  assert.equal(usageCost(A, {input: 1000, output: 500, cacheWrite: 2000, cacheRead: 10_000}), 4000 + 10_000 + 10_000 + 2000);
  assert.equal(usageCost({input: 0.1, output: 0, cacheWrite: 0, cacheRead: 0}, {input: 3, output: 0, cacheWrite: 0, cacheRead: 0}), 1, 'a fraction of a millionth counts as one');
  assert.equal(reservationCost(A, 1000, 100), 1000 * 5 + 100 * 20);
  assert.equal(dollars(19_995_001), '$20.00'); assert.equal(dollars(0), '$0.00'); assert.equal(dollars(1_234_567), '$1.23');
});

void test('a reservation counts until usage is reported, and unreported usage keeps counting its reservation', () => {
  const {spend} = ledger();
  assert.equal(spend.reserve(call('c1')), undefined);
  assert.equal(spend.reserve(call('c2')), undefined);
  const reserved = reservationCost(A, 1000, 100);
  assert.deepEqual(spend.totals().day, {period: '2026-11-21', spentMicros: 2 * reserved, limitMicros: SPEND_LIMITS.dayMicros, unreported: 2, unreportedMicros: 2 * reserved});
  spend.settle('c1', {input: 10, output: 5, cacheWrite: 0, cacheRead: 100});
  spend.settle('c2', null);
  const reported = 10 * 4 + 5 * 20 + 100 * 0.2;
  assert.deepEqual(spend.totals().day, {period: '2026-11-21', spentMicros: reported + reserved, limitMicros: SPEND_LIMITS.dayMicros, unreported: 1, unreportedMicros: reserved});
  assert.deepEqual(spend.totals().month, {period: '2026-11', spentMicros: reported + reserved, limitMicros: SPEND_LIMITS.monthMicros, unreported: 1, unreportedMicros: reserved});
  assert.throws(() => spend.reserve(call('c1')), 'an identifier is reserved once');
});

void test('the day and the month turn over at the host zone\'s local midnight, and a call counts on the day it was reserved', () => {
  const {spend, set} = ledger(undefined, at('2026-11-22T05:59:59Z'));
  assert.equal(spend.totals().day.period, '2026-11-21', '23:59:59 local');
  spend.reserve(call('late'));
  set('2026-11-22T06:00:00Z');
  spend.settle('late', {input: 1000, output: 0, cacheWrite: 0, cacheRead: 0});
  assert.deepEqual([spend.totals().day.period, spend.totals().day.spentMicros, spend.totals().month.spentMicros], ['2026-11-22', 0, 4000],
    'the new day starts at zero; the month keeps the earlier day\'s call');
  set('2026-12-01T05:59:59Z'); assert.equal(spend.totals().month.spentMicros, 4000);
  set('2026-12-01T06:00:00Z'); assert.deepEqual([spend.totals().month.period, spend.totals().month.spentMicros], ['2026-12', 0]);
});

void test('a reservation that could pass the daily or monthly limit is refused with a message naming it and records nothing', () => {
  const {spend, set} = ledger();
  // At $5 per million input tokens, 200,000 input units reserve one dollar.
  const big = (id: string, worth: number) => call(id, worth * 200_000, 0);
  assert.equal(spend.reserve(big('a', 19)), undefined);
  const refused = spend.reserve(big('b', 2));
  assert.equal(refused, 'The daily spend limit of $20.00 would be passed: $19.00 is counted today and this model call could cost up to $2.00. Nothing was sent.');
  assert.equal(spend.totals().day.unreported, 1, 'the refused call left no row');
  assert.equal(spend.reached(), undefined, 'below the limit a new turn may start');
  spend.settle('a', {input: 5_000_000, output: 0, cacheWrite: 0, cacheRead: 0});
  assert.match(spend.reached() ?? '', /^The daily spend limit of \$20\.00 is reached: \$20\.00 is counted today\./);
  // Six more days at $19 bring the month to $134; a $15 call on the next day reaches $149, and a $2 one would pass $150.
  for (const [index, day] of ['22', '23', '24', '25', '26', '27'].entries()) {
    set(`2026-11-${day}T18:00:00Z`);
    assert.equal(spend.reserve(big(`d${String(index)}`, 19)), undefined);
  }
  set('2026-11-28T18:00:00Z');
  assert.equal(spend.reserve(big('f', 15)), undefined);
  assert.equal(spend.reserve(big('g', 2)), 'The monthly spend limit of $150.00 would be passed: $149.00 is counted this month and this model call could cost up to $2.00. Nothing was sent.');
  spend.settle('f', {input: 4_000_000, output: 0, cacheWrite: 0, cacheRead: 0});
  set('2026-11-29T18:00:00Z');
  assert.match(spend.reached() ?? '', /^The monthly spend limit of \$150\.00 is reached: \$150\.00 is counted this month\./);
});

void test('a model without a configured price is refused before anything is recorded', () => {
  const {spend} = ledger();
  assert.equal(spend.reserve({...call('x'), model: 'model-b'}), 'No price is configured for the model model-b, so its spend cannot be counted. Nothing was sent.');
  assert.equal(spend.totals().day.spentMicros, 0);
});

void test('the ledger survives a restart on the same database', () => {
  const database = new DatabaseSync(':memory:');
  const first = ledger(database);
  first.spend.reserve(call('kept'));
  const second = ledger(database);
  assert.equal(second.spend.totals().day.unreported, 1);
  second.spend.settle('kept', {input: 1, output: 1, cacheWrite: 1, cacheRead: 1});
  assert.equal(first.spend.totals().day.spentMicros, Math.ceil(4 + 20 + 5 + 0.2));
});
