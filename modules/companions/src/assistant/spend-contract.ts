// The spend ledger's shapes (Hub #2024), free of Node imports so the browser page and the provider adapter share them.

/** A model's prices in US dollars per million tokens, as the provider's price list states them. */
export type ModelPrices = {readonly input: number; readonly output: number; readonly cacheWrite: number; readonly cacheRead: number};
export type PriceTable = Readonly<Record<string, ModelPrices>>;
/** The tokens one call reported, by price class: uncached input, output, cache writes and cache reads. */
export type TokenUsage = {readonly input: number; readonly output: number; readonly cacheWrite: number; readonly cacheRead: number};
/** What a period has counted, in millionths of a dollar: reported costs plus the reservations of calls without reported usage. */
export type SpendPeriod = {readonly period: string; readonly spentMicros: number; readonly limitMicros: number; readonly unreported: number; readonly unreportedMicros: number};
/** The private `spend` content route's answer: today's and this month's shared spend. */
export type SpendTotals = {readonly version: 1; readonly day: SpendPeriod; readonly month: SpendPeriod};
