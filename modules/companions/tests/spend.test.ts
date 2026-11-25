// The shared spend ledger (Hub #2024): a model call's spend is its reservation until the provider reports usage, then the
// reported usage priced by the configured table. Days and months are the runtime host's local ones, fixed here to one zone
// so the boundaries are exact. The clock is a plain variable; nothing waits for time.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {LIMITS, SPEND_LIMITS} from '../src/assistant/limits.js';
import {BUILT_IN_PRICES, BUILT_IN_PRICES_AS_OF, dollars, reservationCost, SpendLedger, usageCost, type ModelPrices} from '../src/assistant/spend.js';

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
  assert.equal(refused, 'The daily spend limit of $20.00 would be passed: $19.00 is counted today and this model call could cost up to $2.00. The next model call was not sent.');
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
  assert.equal(spend.reserve(big('g', 2)), 'The local estimate of this month\'s spend would pass its $150.00 guard: an estimated $149.00 is counted this month and this model call could cost up to $2.00. The next model call was not sent.');
  spend.settle('f', {input: 4_000_000, output: 0, cacheWrite: 0, cacheRead: 0});
  set('2026-11-29T18:00:00Z');
  assert.match(spend.reached() ?? '', /^The local estimate of this month's spend has reached its \$150\.00 guard: an estimated \$150\.00 is counted this month\. A new message can start when the next month begins\. The Anthropic Console holds the real monthly limit and spend\.$/);
});

void test('a configured monthly guard replaces the $150 default in the totals, the refusal and the new-turn check, and the day stays at $20 (Hub #2102)', () => {
  assert.equal(new SpendLedger(new DatabaseSync(':memory:'), PRICES, () => at('2026-11-21T18:00:00Z'), ZONE).totals().month.limitMicros, 150_000_000, 'the default guard');
  let now = at('2026-11-11T18:00:00Z');
  const spend = new SpendLedger(new DatabaseSync(':memory:'), PRICES, () => now, ZONE, 200_000_000);
  assert.deepEqual([spend.totals().day.limitMicros, spend.totals().month.limitMicros], [SPEND_LIMITS.dayMicros, 200_000_000]);
  // At $5 per million input units, 200,000 input units reserve one dollar. Ten days at $19 count $190, past the default $150.
  const big = (id: string, worth: number) => call(id, worth * 200_000, 0);
  for (let day = 11; day <= 20; day += 1) {
    now = at(`2026-11-${String(day)}T18:00:00Z`);
    assert.equal(spend.reserve(big(`d${String(day)}`, 19)), undefined, `day ${String(day)}`);
    if (day === 18) assert.equal(spend.reached(), undefined, 'an estimated $152 does not reach the configured guard');
  }
  assert.match(spend.reserve(big('over-day', 2)) ?? '', /^The daily spend limit of \$20\.00 would be passed: /, 'the daily pacing is unchanged');
  now = at('2026-11-21T18:00:00Z');
  assert.equal(spend.reserve(big('e', 9)), undefined);
  assert.equal(spend.reserve(big('f', 2)), 'The local estimate of this month\'s spend would pass its $200.00 guard: an estimated $199.00 is counted this month and this model call could cost up to $2.00. The next model call was not sent.');
  spend.settle('e', {input: 2_500_000, output: 0, cacheWrite: 0, cacheRead: 0});
  now = at('2026-11-22T18:00:00Z');
  assert.match(spend.reached() ?? '', /^The local estimate of this month's spend has reached its \$200\.00 guard: an estimated \$200\.00 is counted this month\./);
});

void test('the dated built-in table prices the models in use, a configured price overrides it, and an unknown model takes the dearest known rate', () => {
  // Anthropic's price list read on 2026-11-22: Claude Opus 5.5, and Claude Haiku 5.5 with its dearer tier over 100,000 prompt tokens.
  assert.equal(BUILT_IN_PRICES_AS_OF, '2026-11-22');
  assert.deepEqual(BUILT_IN_PRICES['claude-opus-5-5'], {base: {input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2}});
  assert.deepEqual(BUILT_IN_PRICES['claude-haiku-5-5'], {base: {input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01},
    above: {promptTokens: 100_000, prices: {input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05}}});
  const database = new DatabaseSync(':memory:');
  const none = new SpendLedger(database, {}, () => at('2026-11-21T18:00:00Z'), ZONE);
  assert.deepEqual(['claude-opus-5-5', 'claude-haiku-5-5', 'model-b', 'constructor'].map(model => none.source(model)), ['built-in', 'built-in', 'dearest', 'dearest'],
    'a name such as constructor finds no inherited member');
  const opus = BUILT_IN_PRICES['claude-opus-5-5']?.base ?? assert.fail();
  assert.equal(none.minimum('claude-opus-5-5'), reservationCost(opus, LIMITS.overheadUnits, LIMITS.outputUnits));
  // The dearest known rate takes each class's highest price across the tables: here Opus's for every class.
  assert.equal(none.minimum('model-b'), none.minimum('claude-opus-5-5'));
  assert.equal(none.minimum('constructor'), none.minimum('claude-opus-5-5'));
  assert.equal(none.reserve({...call('x'), model: 'model-b'}), undefined, 'nothing needs configuring');
  // A configured price overrides the table, and a dearer configured price raises an unknown model's rate.
  const dear = {input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1};
  const configured = new SpendLedger(database, {'claude-opus-5-5': {input: 1, output: 2, cacheWrite: 1, cacheRead: 0.1}, 'model-c': dear}, () => at('2026-11-21T18:00:00Z'), ZONE);
  assert.equal(configured.source('claude-opus-5-5'), 'configured');
  assert.equal(configured.minimum('claude-opus-5-5'), reservationCost({input: 1, output: 2, cacheWrite: 1, cacheRead: 0.1}, LIMITS.overheadUnits, LIMITS.outputUnits));
  assert.equal(configured.minimum('model-b'), reservationCost(dear, LIMITS.overheadUnits, LIMITS.outputUnits));
});

void test('Claude Haiku 5.5 reserves at the tier of its input bound and settles at the tier its reported prompt falls in', () => {
  const {database} = ledger();
  const spend = new SpendLedger(database, {}, () => at('2026-11-21T18:00:00Z'), ZONE);
  const haiku = BUILT_IN_PRICES['claude-haiku-5-5'] ?? assert.fail(), low = haiku.base, high = haiku.above?.prices ?? assert.fail();
  const day = () => spend.totals().day.spentMicros;
  spend.reserve({...call('small', 100_000, 1000), model: 'claude-haiku-5-5'});
  assert.equal(day(), reservationCost(low, 100_000, 1000), 'a bound of 100,000 input units stays on the lower tier');
  spend.reserve({...call('large', 100_001, 1000), model: 'claude-haiku-5-5'});
  assert.equal(day(), reservationCost(low, 100_000, 1000) + reservationCost(high, 100_001, 1000));
  // A prompt counts its cache reads and writes: 60,000 + 30,000 + 10,000 is not over 100,000, one more token is.
  spend.settle('small', {input: 60_000, output: 900, cacheWrite: 30_000, cacheRead: 10_000});
  spend.settle('large', {input: 60_001, output: 900, cacheWrite: 30_000, cacheRead: 10_000});
  assert.equal(day(), usageCost(low, {input: 60_000, output: 900, cacheWrite: 30_000, cacheRead: 10_000}) + usageCost(high, {input: 60_001, output: 900, cacheWrite: 30_000, cacheRead: 10_000}));
});

void test('a new turn is refused when what remains of a limit is below the smallest first call', () => {
  const {spend} = ledger();
  const least = spend.minimum('model-a') ?? assert.fail();
  assert.equal(least, reservationCost(A, LIMITS.overheadUnits, LIMITS.outputUnits));
  // Fill the day to one millionth more than the limit minus the smallest call, through a reservation settled by usage.
  assert.equal(spend.reserve(call('fill', 1, 0)), undefined);
  const fill = SPEND_LIMITS.dayMicros - least + 1;
  // Input at $4 per million tokens, and five cache reads at $0.20 for the last millionth.
  spend.settle('fill', {input: (fill - 1) / 4, output: 0, cacheWrite: 0, cacheRead: 5});
  assert.equal(spend.totals().day.spentMicros, fill);
  assert.equal(spend.reached(), undefined, 'without a model only a reached limit refuses');
  assert.equal(spend.reached('model-a'), `The daily spend limit of $20.00 leaves too little for a model call: ${dollars(fill)} is counted today and the smallest call could cost ${dollars(least)}. A new message can start after midnight, the runtime host's local time.`);
  spend.settle('fill', {input: (fill - 1) / 4, output: 0, cacheWrite: 0, cacheRead: 0});
  assert.equal(spend.reached('model-a'), undefined, 'exactly the smallest call still fits');
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
