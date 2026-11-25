// The record of a card fault the dashboard contained (Hub #2139, ADR 0012 "Safe errors" and "Levels"). One record per
// failure, through the SDK's recordLog, so its level is the code table's: `dashboard.card.failed` is an internal fault,
// ERROR. It names the card's identity and the error's type, never its message, stack or cause, which may hold anything a
// library quoted; the error itself stays in memory.
//
// The record is formed here and delivered nowhere: the page has no diagnostic route to the runtime yet (the diagnostic
// contract's browser relay is not adopted), so the records stay in this page's memory, in a bounded log that a later
// relay can read. Delivery is a named follow-up (#2159), and so is registering
// the event and `bunny.card` in the diagnostic catalog, which the contract requires before a record is exported.
import {errorType, recordLog, type LogEvent, type LogFields, type Logger} from '@jimmie-potts/sdk/remote';

export const CARD_FAULT_EVENT = 'dashboard.card.failed' satisfies LogEvent;

/** One record of the page's own log. */
export type PageRecord = {readonly level: 'debug' | 'info' | 'warn' | 'error'; readonly event: string; readonly fields: LogFields};

const LIMIT = 64;
const records: PageRecord[] = [];
const keep = (level: PageRecord['level']) => (event: string, fields: LogFields = {}): void => {
  records.push({level, event, fields});
  if (records.length > LIMIT) records.splice(0, records.length - LIMIT);
};

/** The page's own log: its newest 64 records, in memory only. */
export const pageLog: Logger = {debug: keep('debug'), info: keep('info'), warn: keep('warn'), error: keep('error')};

export function pageRecords(): readonly PageRecord[] {
  return records;
}

// A card's identity is a neutral configured ID: a Home placement such as `inbox` or `device:<owner>:<id>`, or a route's
// `component:<id>` or `module:<module>/<page>`. Anything else is recorded as `unknown`.
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/** Records that `card` failed with `error`, on `log` or the page's own log. */
export function recordCardFault(log: Logger | undefined, card: string, error: unknown): void {
  recordLog(log ?? pageLog, CARD_FAULT_EVENT, {'bunny.card': IDENTITY.test(card) ? card : 'unknown', 'bunny.code': 'internal', 'error.type': errorType(error)});
}

/**
 * Reports a contained error to the page as an uncaught error would be, so the browser's console shows it and a test that
 * watches page errors sees it. A browser without `reportError` is not told; the failed face and the record still are.
 */
export function reportCardError(error: unknown): void {
  const report = (globalThis as {reportError?: (error: unknown) => void}).reportError;
  if (typeof report === 'function') report(error);
}
