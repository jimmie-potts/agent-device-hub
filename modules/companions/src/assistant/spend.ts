// The shared spend ledger (Hub #2024, #2047): it paces the assistant's paid model calls across all profiles at $20 a
// day, by the runtime host's local day, and keeps a local estimate of the month with a guard: $150 unless the section's
// `assistant.monthlyLimit` sets the owner's Console limit (Hub #2102). Anthropic enforces the real monthly ceiling: a
// dedicated Console workspace's spend limit, whose refusal the provider adapter maps. Each paid
// call reserves its most expensive possible cost before it is sent, in the same transaction as the call's receipt;
// reported usage replaces the reservation, and a call whose usage is never reported keeps counting its reservation, never
// zero. Prices come from the private section, else the dated built-in table, else the dearest known rate. A call counts on
// the day and month it was reserved. Coding-worker runs are not model calls here and are not counted.
//
// A call made outside a task, such as a conversation-level call, records its spend with the same two steps (Hub #2025):
// `reserve` before the request leaves, inside the caller's own transaction when it keeps a receipt, and `settle` with the
// reported usage, or null when the answer is lost. A refusal from `reserve` is the `capacity` message to show the owner.
import type {DatabaseSync} from 'node:sqlite';
import {localDay} from '../rules.js';
import {dollars, LIMITS, SPEND_LIMITS} from './limits.js';
import type {ModelPrices, PriceSource, PriceTable, SpendPeriod, SpendTotals, TokenUsage} from './spend-contract.js';

export type {ModelPrices, PriceSource, PriceTable, SpendPeriod, SpendTotals, SpendView, TokenUsage} from './spend-contract.js';
/**
 * One paid model call to reserve. `id` is unique for all time (a task call uses its effect id); `owner` is the task or
 * conversation it belongs to; `inputUnits` and `outputUnits` bound the tokens the request can use and the answer can report.
 */
export type SpendCall = {readonly id: string; readonly purpose: 'task' | 'conversation'; readonly owner: string; readonly model: string;
  readonly inputUnits: number; readonly outputUnits: number};

/**
 * Anthropic's published prices in US dollars per million tokens, read from
 * https://platform.claude.com/docs/en/about-claude/pricing on this date: base input, the five-minute cache write, the cache
 * read and output. Claude Haiku 5.5 is dearer for a prompt over 100,000 tokens, counting cache reads and writes; a call is
 * reserved at the tier of its input bound and settled at the tier of its reported prompt.
 */
export const BUILT_IN_PRICES_AS_OF = '2026-11-22';
type Tiered = {readonly base: ModelPrices; readonly above?: {readonly promptTokens: number; readonly prices: ModelPrices}};
export const BUILT_IN_PRICES: Readonly<Record<string, Tiered>> = Object.freeze({
  'claude-opus-5-5': {base: {input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2}},
  'claude-haiku-5-5': {base: {input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01},
    above: {promptTokens: 100_000, prices: {input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05}}},
});
const hostTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Tokens times dollars per million tokens is millionths of a dollar; a part of one counts as a whole one. */
export const usageCost = (prices: ModelPrices, usage: TokenUsage): number =>
  Math.ceil(usage.input * prices.input + usage.output * prices.output + usage.cacheWrite * prices.cacheWrite + usage.cacheRead * prices.cacheRead);
/** The most a call can cost: every input unit at the dearest input class, every output unit at the output price. */
export const reservationCost = (prices: ModelPrices, inputUnits: number, outputUnits: number): number =>
  Math.ceil(inputUnits * Math.max(prices.input, prices.cacheWrite, prices.cacheRead) + outputUnits * prices.output);
export {dollars};
/**
 * The input units a request can use: its UTF-8 bytes as JSON, since a token covers at least one byte of the text it
 * encodes, plus the provider's own framing. Pass the whole request the provider renders, such as a turn's `TurnInput`.
 */
export const inputBound = (request: unknown): number => Buffer.byteLength(JSON.stringify(request), 'utf8') + LIMITS.overheadUnits;
const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined => Object.hasOwn(table, key) ? table[key] : undefined;
const tierOf = (tiers: Tiered, promptTokens: number): ModelPrices => tiers.above !== undefined && promptTokens > tiers.above.promptTokens ? tiers.above.prices : tiers.base;
type Sum = {spent: number | null; unreported: number; unreportedMicros: number | null};
const SUMS = {
  day: 'SELECT SUM(COALESCE(cost_micros,reserved_micros)) AS spent, COUNT(*) FILTER (WHERE cost_micros IS NULL) AS unreported, SUM(reserved_micros) FILTER (WHERE cost_micros IS NULL) AS unreportedMicros FROM assistant_spend WHERE day=?',
  month: 'SELECT SUM(COALESCE(cost_micros,reserved_micros)) AS spent, COUNT(*) FILTER (WHERE cost_micros IS NULL) AS unreported, SUM(reserved_micros) FILTER (WHERE cost_micros IS NULL) AS unreportedMicros FROM assistant_spend WHERE month=?',
} as const;
const AFTER = {day: 'A new message can start after midnight, the runtime host\'s local time.',
  month: 'A new message can start when the next month begins. The Anthropic Console holds the real monthly limit and spend.'} as const;

export class SpendLedger {
  /** The dearest known rate for each price class, across the configured and built-in tables: an unknown model's prices. */
  readonly #dearest: ModelPrices;
  /** `monthMicros` is the local monthly guard in millionths of a dollar: the section's `assistant.monthlyLimit`, else $150 (Hub #2102). */
  constructor(readonly database: DatabaseSync, readonly prices: PriceTable, readonly now: () => number, readonly timeZone: string = hostTimeZone(),
    readonly monthMicros: number = SPEND_LIMITS.monthMicros) {
    database.exec(`CREATE TABLE IF NOT EXISTS assistant_spend (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, owner TEXT NOT NULL, model TEXT NOT NULL,
      day TEXT NOT NULL, month TEXT NOT NULL, at_ms INTEGER NOT NULL, reserved_micros INTEGER NOT NULL, cost_micros INTEGER, usage TEXT) STRICT;
      CREATE INDEX IF NOT EXISTS assistant_spend_day ON assistant_spend(day);
      CREATE INDEX IF NOT EXISTS assistant_spend_month ON assistant_spend(month);`);
    const known = [...Object.values(prices), ...Object.values(BUILT_IN_PRICES).flatMap(tiers => tiers.above === undefined ? [tiers.base] : [tiers.base, tiers.above.prices])];
    const most = (key: keyof ModelPrices): number => Math.max(...known.map(entry => entry[key]));
    this.#dearest = {input: most('input'), output: most('output'), cacheWrite: most('cacheWrite'), cacheRead: most('cacheRead')};
  }
  #sum(period: 'day' | 'month', key: string, limitMicros: number): SpendPeriod {
    const row = this.database.prepare(SUMS[period]).get(key) as Sum;
    return {period: key, spentMicros: row.spent ?? 0, limitMicros, unreported: row.unreported, unreportedMicros: row.unreportedMicros ?? 0};
  }
  totals(): SpendTotals {
    const day = localDay(this.now(), this.timeZone);
    return {version: 1, day: this.#sum('day', day, SPEND_LIMITS.dayMicros), month: this.#sum('month', day.slice(0, 7), this.monthMicros)};
  }
  /**
   * The limit that refuses a new paid turn now, as the message naming it, or undefined. With a model, the turn is also
   * refused when what remains of today's limit or of the month's estimate is below the smallest reservation of the turn's
   * first call, so a message is not admitted only to fail there.
   */
  reached(model?: string): string | undefined {
    const least = model === undefined ? 0 : this.minimum(model), {day, month} = this.totals();
    if (day.spentMicros >= day.limitMicros) return `The daily spend limit of ${dollars(day.limitMicros)} is reached: ${dollars(day.spentMicros)} is counted today. ${AFTER.day}`;
    if (day.spentMicros + least > day.limitMicros) return `The daily spend limit of ${dollars(day.limitMicros)} leaves too little for a model call: ${dollars(day.spentMicros)} is counted today and the smallest call could cost ${dollars(least)}. ${AFTER.day}`;
    if (month.spentMicros >= month.limitMicros) return `The local estimate of this month's spend has reached its ${dollars(month.limitMicros)} guard: an estimated ${dollars(month.spentMicros)} is counted this month. ${AFTER.month}`;
    if (month.spentMicros + least > month.limitMicros) return `The local estimate of this month's spend leaves too little under its ${dollars(month.limitMicros)} guard for a model call: an estimated ${dollars(month.spentMicros)} is counted this month and the smallest call could cost ${dollars(least)}. ${AFTER.month}`;
    return undefined;
  }
  /**
   * The smallest reservation a model call can make: the framing units at the model's dearest input price and the output
   * bound at its output price, the floor under any turn's first call.
   */
  minimum(model: string): number {return reservationCost(this.#prices(model, LIMITS.overheadUnits), LIMITS.overheadUnits, LIMITS.outputUnits);}
  /**
   * Reserves one call's most expensive cost before it is sent, or answers the message that refuses it: a reservation that
   * could pass the daily limit or the month's estimate. A refused call records nothing. Synchronous, so it joins the
   * caller's open transaction; an identifier already reserved throws.
   */
  reserve(call: SpendCall): string | undefined {
    const reserved = reservationCost(this.#prices(call.model, call.inputUnits), call.inputUnits, call.outputUnits), {day, month} = this.totals();
    if (day.spentMicros + reserved > day.limitMicros) return `The daily spend limit of ${dollars(day.limitMicros)} would be passed: ${dollars(day.spentMicros)} is counted today and this model call could cost up to ${dollars(reserved)}. The next model call was not sent.`;
    if (month.spentMicros + reserved > month.limitMicros) return `The local estimate of this month's spend would pass its ${dollars(month.limitMicros)} guard: an estimated ${dollars(month.spentMicros)} is counted this month and this model call could cost up to ${dollars(reserved)}. The next model call was not sent.`;
    this.database.prepare('INSERT INTO assistant_spend(id,purpose,owner,model,day,month,at_ms,reserved_micros) VALUES (?,?,?,?,?,?,?,?)')
      .run(call.id, call.purpose, call.owner, call.model, day.period, month.period, this.now(), reserved);
    return undefined;
  }
  /** Replaces a reservation with the reported usage's cost, at the tier its prompt falls in. Null, a lost answer, leaves the reservation counting. */
  settle(id: string, usage: TokenUsage | null): void {
    if (usage === null) return;
    const row = this.database.prepare('SELECT model FROM assistant_spend WHERE id=?').get(id) as {model: string} | undefined;
    if (row === undefined) return;
    const prices = this.#prices(row.model, usage.input + usage.cacheWrite + usage.cacheRead);
    this.database.prepare('UPDATE assistant_spend SET cost_micros=?,usage=? WHERE id=?').run(usageCost(prices, usage), JSON.stringify(usage), id);
  }
  /** Where a model's prices come from: a configured price overrides the built-in table. */
  source(model: string): PriceSource {
    return own(this.prices, model) !== undefined ? 'configured' : own(BUILT_IN_PRICES, model) !== undefined ? 'built-in' : 'dearest';
  }
  /** A model's prices for a prompt of this many tokens. Own entries only, so a name such as `constructor` finds no inherited member. */
  #prices(model: string, promptTokens: number): ModelPrices {
    const configured = own(this.prices, model);
    if (configured !== undefined) return configured;
    const builtIn = own(BUILT_IN_PRICES, model);
    return builtIn === undefined ? this.#dearest : tierOf(builtIn, promptTokens);
  }
}
