// The spending ledger's rules (docs/art-generation-qualification.md, "Spending limits"), with a fixed clock. The module's
// own tests run the traces end to end; these pin the arithmetic behind them.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {ArtStore} from '../src/store.js';
import {Ledger, dayKey, monthKey, type CallSpec, type Limits} from '../src/ledger.js';
import {IDEA_MAX_TOKENS, PROMPT_LIMIT, costOf, priceOf, reservationOf, type PriceKey} from '../src/prices.js';

const low: PriceKey = {provider: 'openai', model: 'gpt-image-2.6-flare', quality: 'low', size: '512x256', frames: 8};
const idea: PriceKey = {provider: 'anthropic', model: 'claude-opus-5-5', maxTokens: IDEA_MAX_TOKENS};
const usd = (value: number) => value * 1_000_000;
const LOW = reservationOf(low) ?? assert.fail('no entry');
const limits = (ceiling = 150, pace = 5): Limits => ({openai: {ceilingMicros: usd(ceiling), paceMicros: usd(pace)}, anthropic: {ceilingMicros: usd(ceiling), paceMicros: usd(pace)}});
const noon = new Date(2026, 10, 3, 12).getTime();
function ledger(given = limits()) {
  const db = new DatabaseSync(':memory:'), store = new ArtStore(db);
  let id = 0;
  const spec = (key: PriceKey, admittedBy: CallSpec['admittedBy'] = 'owner', atMs = noon): CallSpec => ({callId: `call-${++id}`, requestId: 'req', target: 'tidbyt', key, admittedBy, atMs});
  return {db, store, spec, book: new Ledger(store, given)};
}
const ok = <T extends {ok: boolean}>(value: T): T & {ok: true} => {assert.equal(value.ok, true, JSON.stringify(value)); return value as T & {ok: true};};

void test('reservations come from the table: twice the largest observed output plus the bounded input', () => {
  // $0.025 observed buys 834 output tokens at $30 per million; doubled, and 4,000 input tokens at $5 per million.
  assert.equal(LOW, 2 * 834 * 30 + PROMPT_LIMIT * 5);
  assert.ok(priceOf({provider: 'openai', model: 'gpt-image-2.6-sunburst', quality: 'medium', size: '512x512', frames: 8}));
  assert.equal(reservationOf({provider: 'openai', model: 'gpt-image-2', quality: 'medium', size: '1536x1024'}), 2 * 1372 * 30 + PROMPT_LIMIT * 5);
  // Text needs no observation: its max_tokens at the listed $20 per million and its bounded input at $4.
  assert.equal(reservationOf(idea), IDEA_MAX_TOKENS * 20 + PROMPT_LIMIT * 4);
  assert.equal(costOf(low, {inputTokens: 120, outputTokens: 102}), 120 * 5 + 102 * 30);
  assert.equal(priceOf({...low, frames: 16}), undefined, 'an unobserved frame count has no entry');
  assert.equal(priceOf({provider: 'openai', model: 'gpt-image-2.6-sunburst', quality: 'low', size: '512x256', frames: 8}), undefined, 'nor an unobserved model and size');
  assert.equal(priceOf({provider: 'openai', model: 'gpt-image-2', quality: 'high', size: '1024x1024'}), undefined, 'an unobserved quality has no entry');
  assert.equal(priceOf({provider: 'openai', model: 'gpt-image-2', quality: 'low', size: '1536x1024'}), undefined, 'an unobserved size has no entry');
  assert.equal(priceOf({provider: 'anthropic', model: 'claude-opus-5-5', maxTokens: 64_000}), undefined, 'an unbounded text call has no entry');
});

void test('an unknown entry refuses the call before anything is reserved', () => {
  const {book, spec} = ledger();
  const refused = book.reserve(spec({provider: 'openai', model: 'gpt-image-2', quality: 'high', size: '1024x1024'}));
  assert.deepEqual(refused, {ok: false, reason: 'unknown-price'});
  assert.equal(book.totals('openai', noon).reservedMicros, 0);
});

void test('each provider has its own ceiling: one provider at its ceiling leaves the other available', () => {
  const reservation = LOW, {book, spec} = ledger({openai: {ceilingMicros: reservation, paceMicros: usd(5)}, anthropic: {ceilingMicros: usd(150), paceMicros: usd(5)}});
  ok(book.reserve(spec(low)));
  assert.deepEqual(book.reserve(spec(low)), {ok: false, reason: 'monthly-ceiling'}, 'OpenAI has no room');
  ok(book.reserve(spec(idea)));
});

void test('each provider has its own pace: automatic work stops there, and owner requests continue', () => {
  const reservation = LOW, {book, spec} = ledger({openai: {ceilingMicros: usd(150), paceMicros: reservation}, anthropic: {ceilingMicros: usd(150), paceMicros: usd(5)}});
  ok(book.reserve(spec(low, 'automatic')));
  assert.deepEqual(book.reserve(spec(low, 'automatic')), {ok: false, reason: 'daily-pace'});
  ok(book.reserve(spec(idea, 'automatic')));
  ok(book.reserve(spec(low, 'owner')));
  const tomorrow = new Date(2026, 10, 4, 0, 1).getTime();
  // Today's reservation is still held, but it is yesterday's: tomorrow's automatic pace is fresh.
  ok(book.reserve(spec(low, 'automatic', tomorrow)));
});

void test('the loop guard counts dispatched automatic calls of both providers, failed and uncertain ones too, in a rolling hour', () => {
  const {book, spec} = ledger();
  const hour = 3_600_000;
  for (let index = 0; index < 30; index++) {
    const call = spec(index % 2 === 0 ? low : idea, 'automatic', noon + index), reserved = ok(book.reserve(call));
    book.dispatched(call.callId, call.atMs);
    if (index % 3 === 0) book.keep(call.callId); else if (index % 3 === 1) book.settle(call.callId, null, reserved.reservedMicros); else book.settle(call.callId, {inputTokens: 1, outputTokens: 1}, reserved.reservedMicros);
  }
  assert.equal(book.guardCalls(noon + 30), 30);
  assert.deepEqual(book.reserve(spec(low, 'automatic', noon + 31)), {ok: false, reason: 'loop-guard'}, 'the thirty-first');
  ok(book.reserve(spec(low, 'owner', noon + 31)));
  assert.deepEqual(book.reserve(spec(low, 'automatic', noon + hour - 1)), {ok: false, reason: 'loop-guard'});
  // The window has room once the first call leaves it.
  const later = spec(low, 'automatic', noon + hour + 1);
  ok(book.reserve(later));
});

void test('settling replaces the reservation with the reported cost; a kept one stays uncertain and is not refunded', () => {
  const {book, spec} = ledger();
  const settled = spec(low), kept = spec(low), released = spec(low), reservation = LOW;
  ok(book.reserve(settled)); ok(book.reserve(kept)); ok(book.reserve(released));
  assert.equal(book.totals('openai', noon).reservedMicros, 3 * reservation);
  book.dispatched(settled.callId, noon); book.dispatched(kept.callId, noon);
  const excess = book.settle(settled.callId, {inputTokens: 100, outputTokens: 100}, reservation);
  assert.equal(excess, 0);
  book.keep(kept.callId); book.release(released.callId);
  const totals = book.totals('openai', noon);
  assert.equal(totals.spentMicros, 100 * 5 + 100 * 30);
  assert.equal(totals.reservedMicros, 0);
  assert.equal(totals.uncertainMicros, reservation);
  assert.equal(totals.remainingMicros, usd(150) - totals.spentMicros - reservation);
  assert.equal(totals.todayMicros, totals.spentMicros + reservation);
});

void test('a settlement above its reservation records the true cost and its excess, and refuses later calls at the ceiling', () => {
  const reservation = LOW, {book, spec} = ledger({openai: {ceilingMicros: reservation, paceMicros: usd(5)}, anthropic: {ceilingMicros: usd(150), paceMicros: usd(5)}});
  const call = spec(low);
  ok(book.reserve(call)); book.dispatched(call.callId, noon);
  const usage = {inputTokens: 0, outputTokens: 4000}, cost = 4000 * 30;
  assert.ok(cost > reservation);
  assert.equal(book.settle(call.callId, usage, reservation), cost - reservation);
  const totals = book.totals('openai', noon);
  assert.equal(totals.spentMicros, cost);
  assert.equal(totals.excessMicros, cost - reservation);
  assert.equal(totals.remainingMicros, 0);
  assert.deepEqual(book.reserve(spec(low)), {ok: false, reason: 'monthly-ceiling'});
});

void test('a new local month restarts the limits and earlier uncertain rows stay visible', () => {
  const reservation = LOW, {book, spec} = ledger({openai: {ceilingMicros: reservation, paceMicros: usd(5)}, anthropic: {ceilingMicros: usd(150), paceMicros: usd(5)}});
  const call = spec(low); ok(book.reserve(call)); book.dispatched(call.callId, noon); book.keep(call.callId);
  assert.deepEqual(book.reserve(spec(low)), {ok: false, reason: 'monthly-ceiling'});
  const next = new Date(2026, 11, 1, 0, 0, 1).getTime();
  assert.equal(monthKey(next), '2026-12');
  assert.equal(dayKey(next), '2026-12-01');
  ok(book.reserve(spec(low, 'owner', next)));
  const totals = book.totals('openai', next);
  assert.equal(totals.uncertainMicros, 0);
  assert.equal(totals.earlierUncertainMicros, reservation);
  assert.equal(book.page(0, 100).calls.filter(row => row.status === 'uncertain').length, 1);
});

void test('a restart keeps what was dispatched and releases what provably was not', () => {
  const {book, spec} = ledger();
  const sent = spec(low), unsent = spec(low);
  ok(book.reserve(sent)); ok(book.reserve(unsent));
  book.dispatched(sent.callId, noon);
  assert.deepEqual(book.recover(), {uncertain: [sent.callId], released: [unsent.callId]});
  const totals = book.totals('openai', noon);
  assert.equal(totals.reservedMicros, 0);
  assert.equal(totals.uncertainMicros, LOW);
});
