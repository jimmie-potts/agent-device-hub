// The shared spend ledger (Hub #2024): the money the assistant's paid model calls may spend across all profiles, $20 a
// day and $150 a month by the runtime host's local day and month. Each paid call reserves its most expensive possible cost
// before it is sent, in the same transaction as the call's receipt; reported usage priced by the private configuration's
// table replaces the reservation, and a call whose usage is never reported keeps counting its reservation, never zero.
// A call counts on the day and month it was reserved. Coding-worker runs are not model calls here and are not counted.
//
// A call made outside a task, such as a conversation-level call, records its spend with the same two steps (Hub #2025):
// `reserve` before the request leaves, inside the caller's own transaction when it keeps a receipt, and `settle` with the
// reported usage, or null when the answer is lost. A refusal from `reserve` is the `capacity` message to show the owner.
import type {DatabaseSync} from 'node:sqlite';
import {localDay} from '../rules.js';
import {dollars, LIMITS, SPEND_LIMITS} from './limits.js';
import type {ModelPrices, PriceTable, SpendPeriod, SpendTotals, TokenUsage} from './spend-contract.js';

export type {ModelPrices, PriceTable, SpendPeriod, SpendTotals, SpendView, TokenUsage} from './spend-contract.js';
/**
 * One paid model call to reserve. `id` is unique for all time (a task call uses its effect id); `owner` is the task or
 * conversation it belongs to; `inputUnits` and `outputUnits` bound the tokens the request can use and the answer can report.
 */
export type SpendCall = {readonly id: string; readonly purpose: 'task' | 'conversation'; readonly owner: string; readonly model: string;
  readonly inputUnits: number; readonly outputUnits: number};

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
const unpriced = (model: string): string => `No price is configured for the model ${model}, so its spend cannot be counted. Nothing was sent.`;
type Sum = {spent: number | null; unreported: number; unreportedMicros: number | null};
const SUMS = {
  day: 'SELECT SUM(COALESCE(cost_micros,reserved_micros)) AS spent, COUNT(*) FILTER (WHERE cost_micros IS NULL) AS unreported, SUM(reserved_micros) FILTER (WHERE cost_micros IS NULL) AS unreportedMicros FROM assistant_spend WHERE day=?',
  month: 'SELECT SUM(COALESCE(cost_micros,reserved_micros)) AS spent, COUNT(*) FILTER (WHERE cost_micros IS NULL) AS unreported, SUM(reserved_micros) FILTER (WHERE cost_micros IS NULL) AS unreportedMicros FROM assistant_spend WHERE month=?',
} as const;

export class SpendLedger {
  constructor(readonly database: DatabaseSync, readonly prices: PriceTable, readonly now: () => number, readonly timeZone: string = hostTimeZone()) {
    database.exec(`CREATE TABLE IF NOT EXISTS assistant_spend (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, owner TEXT NOT NULL, model TEXT NOT NULL,
      day TEXT NOT NULL, month TEXT NOT NULL, at_ms INTEGER NOT NULL, reserved_micros INTEGER NOT NULL, cost_micros INTEGER, usage TEXT) STRICT;
      CREATE INDEX IF NOT EXISTS assistant_spend_day ON assistant_spend(day);
      CREATE INDEX IF NOT EXISTS assistant_spend_month ON assistant_spend(month);`);
  }
  #sum(period: 'day' | 'month', key: string, limitMicros: number): SpendPeriod {
    const row = this.database.prepare(SUMS[period]).get(key) as Sum;
    return {period: key, spentMicros: row.spent ?? 0, limitMicros, unreported: row.unreported, unreportedMicros: row.unreportedMicros ?? 0};
  }
  totals(): SpendTotals {
    const day = localDay(this.now(), this.timeZone);
    return {version: 1, day: this.#sum('day', day, SPEND_LIMITS.dayMicros), month: this.#sum('month', day.slice(0, 7), SPEND_LIMITS.monthMicros)};
  }
  /** The limit that refuses a new paid turn now, as the message naming it, or undefined below both limits. */
  /**
   * With a model, the turn is also refused when the model has no price, or when what remains of today's or this month's
   * limit is below the smallest reservation of the turn's first call, so a message is not admitted only to fail there.
   */
  reached(model?: string): string | undefined {
    const floor = model === undefined ? 0 : this.minimum(model);
    if (model !== undefined && floor === undefined) return unpriced(model);
    const {day, month} = this.totals(), least = floor ?? 0;
    const after = {day: 'A new message can start after midnight, the runtime host\'s local time.', month: 'A new message can start when the next month begins.'};
    if (day.spentMicros >= day.limitMicros) return `The daily spend limit of ${dollars(day.limitMicros)} is reached: ${dollars(day.spentMicros)} is counted today. ${after.day}`;
    if (day.spentMicros + least > day.limitMicros) return `The daily spend limit of ${dollars(day.limitMicros)} leaves too little for a model call: ${dollars(day.spentMicros)} is counted today and the smallest call could cost ${dollars(least)}. ${after.day}`;
    if (month.spentMicros >= month.limitMicros) return `The monthly spend limit of ${dollars(month.limitMicros)} is reached: ${dollars(month.spentMicros)} is counted this month. ${after.month}`;
    if (month.spentMicros + least > month.limitMicros) return `The monthly spend limit of ${dollars(month.limitMicros)} leaves too little for a model call: ${dollars(month.spentMicros)} is counted this month and the smallest call could cost ${dollars(least)}. ${after.month}`;
    return undefined;
  }
  /**
   * The smallest reservation a model call can make: the framing units at the model's dearest input price and the output
   * bound at its output price, the floor under any turn's first call. Undefined when the model has no price.
   */
  minimum(model: string): number | undefined {
    const prices = this.prices[model];
    return prices === undefined ? undefined : reservationCost(prices, LIMITS.overheadUnits, LIMITS.outputUnits);
  }
  /**
   * Reserves one call's most expensive cost before it is sent, or answers the message that refuses it: a model without a
   * price, or a reservation that could pass the daily or the monthly limit. A refused call records nothing. Synchronous,
   * so it joins the caller's open transaction; an identifier already reserved throws.
   */
  reserve(call: SpendCall): string | undefined {
    const prices = this.prices[call.model];
    if (prices === undefined) return unpriced(call.model);
    const reserved = reservationCost(prices, call.inputUnits, call.outputUnits), {day, month} = this.totals();
    if (day.spentMicros + reserved > day.limitMicros) return `The daily spend limit of ${dollars(day.limitMicros)} would be passed: ${dollars(day.spentMicros)} is counted today and this model call could cost up to ${dollars(reserved)}. Nothing was sent.`;
    if (month.spentMicros + reserved > month.limitMicros) return `The monthly spend limit of ${dollars(month.limitMicros)} would be passed: ${dollars(month.spentMicros)} is counted this month and this model call could cost up to ${dollars(reserved)}. Nothing was sent.`;
    this.database.prepare('INSERT INTO assistant_spend(id,purpose,owner,model,day,month,at_ms,reserved_micros) VALUES (?,?,?,?,?,?,?,?)')
      .run(call.id, call.purpose, call.owner, call.model, day.period, month.period, this.now(), reserved);
    return undefined;
  }
  /** Replaces a reservation with the reported usage's cost. Null, a lost answer, leaves the reservation counting. */
  settle(id: string, usage: TokenUsage | null): void {
    if (usage === null) return;
    const row = this.database.prepare('SELECT model FROM assistant_spend WHERE id=?').get(id) as {model: string} | undefined;
    const prices = row === undefined ? undefined : this.prices[row.model];
    if (prices === undefined) return;
    this.database.prepare('UPDATE assistant_spend SET cost_micros=?,usage=? WHERE id=?').run(usageCost(prices, usage), JSON.stringify(usage), id);
  }
  /** Whether a model is priced, so its calls can be counted. */
  priced(model: string): boolean {return Object.hasOwn(this.prices, model);}
}
