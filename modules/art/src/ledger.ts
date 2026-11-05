// The spending ledger (docs/art-generation-qualification.md, "Spending limits"), in integer micro-dollars. OpenAI and
// Claude each have their own monthly ceiling and daily pace, per the owner's decision of 2026-11-03; the loop guard stays
// one, since it bounds automatic calls however they are spent. Every method runs inside the caller's one SQLite
// transaction, so a reservation commits with the check that allowed it and concurrent reservations cannot pass a limit.
import type {ArtAdmission, ArtProviderName, ArtReason, ArtTarget} from '@jimmie-potts/event-contracts/v2/art-state';
import {costOf, reservationOf, type PriceKey, type Usage} from './prices.js';
import type {ArtStore} from './store.js';

export type ProviderLimits = {readonly ceilingMicros: number; readonly paceMicros: number};
export type Limits = Readonly<Record<ArtProviderName, ProviderLimits>>;
export type CallStatus = 'reserved' | 'dispatched' | 'settled' | 'uncertain' | 'released';
export type CallSpec = {readonly callId: string; readonly requestId: string; readonly target: ArtTarget | 'idea'; readonly key: PriceKey; readonly admittedBy: ArtAdmission; readonly atMs: number};
export type CallRow = {callId: string; requestId: string; target: ArtTarget | 'idea'; provider: ArtProviderName; model: string; status: CallStatus; admittedBy: ArtAdmission;
  month: string; day: string; reservedAtMs: number; dispatchedAtMs: number | null; reservedMicros: number; costMicros: number | null; key: PriceKey};
export type Totals = {spentMicros: number; reservedMicros: number; uncertainMicros: number; remainingMicros: number; todayMicros: number; excessMicros: number; earlierUncertainMicros: number};
export type Reserved = {ok: true; reservedMicros: number} | {ok: false; reason: Extract<ArtReason, 'unknown-price' | 'monthly-ceiling' | 'daily-pace' | 'loop-guard'>};

export const GUARD_LIMIT = 30;
export const GUARD_WINDOW_MS = 3_600_000;
const pad = (value: number): string => String(value).padStart(2, '0');
/** The host-local calendar month. */
export const monthKey = (nowMs: number): string => {const date = new Date(nowMs); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;};
export const dayKey = (nowMs: number): string => {const date = new Date(nowMs); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;};
/** What a call holds against a limit: its cost once settled, otherwise its reservation; a released call holds nothing. */
const HELD = "CASE status WHEN 'settled' THEN cost_micros WHEN 'released' THEN 0 ELSE reserved_micros END";

export class Ledger {
  readonly #store: ArtStore;
  readonly #limits: Limits;
  constructor(store: ArtStore, limits: Limits) {this.#store = store; this.#limits = limits;}

  /** Reserves a call's worst case, or says why it is refused. A refusal leaves no row and spends nothing. */
  reserve(spec: CallSpec): Reserved {
    const reservedMicros = reservationOf(spec.key);
    if (reservedMicros === undefined) return {ok: false, reason: 'unknown-price'};
    const {provider} = spec.key, limits = this.#limits[provider], month = monthKey(spec.atMs), day = dayKey(spec.atMs);
    if (this.#held(provider, 'month', month) + reservedMicros > limits.ceilingMicros) return {ok: false, reason: 'monthly-ceiling'};
    if (spec.admittedBy === 'automatic') {
      if (this.#held(provider, 'day', day) + reservedMicros > limits.paceMicros) return {ok: false, reason: 'daily-pace'};
      if (this.guardCalls(spec.atMs) >= GUARD_LIMIT) return {ok: false, reason: 'loop-guard'};
    }
    this.#store.db.prepare(`INSERT INTO art_calls(call_id,request_id,target,provider,model,status,admitted_by,month,day,reserved_at_ms,dispatched_at_ms,reserved_micros,cost_micros,price_key)
      VALUES(?,?,?,?,?,'reserved',?,?,?,?,NULL,?,NULL,?)`).run(spec.callId, spec.requestId, spec.target, provider, spec.key.model, spec.admittedBy, month, day, spec.atMs, reservedMicros, JSON.stringify(spec.key));
    return {ok: true, reservedMicros};
  }
  /** Marks a call about to be sent. A restart treats only a dispatched call as possibly having had an effect. */
  dispatched(callId: string, atMs: number): void {
    this.#store.db.prepare("UPDATE art_calls SET status='dispatched',dispatched_at_ms=? WHERE call_id=? AND status='reserved'").run(atMs, callId);
  }
  /** Settles from reported usage, or at zero when an answer reported none and consumed nothing. Returns the excess over the reservation. */
  settle(callId: string, usage: Usage | null, reservedMicros: number): number {
    const row = this.call(callId);
    if (row === undefined) return 0;
    const costMicros = usage === null ? 0 : costOf(row.key, usage) ?? 0;
    this.#store.db.prepare("UPDATE art_calls SET status='settled',cost_micros=? WHERE call_id=?").run(costMicros, callId);
    return Math.max(0, costMicros - reservedMicros);
  }
  /** Keeps the reservation as uncertain spend. It is never refunded. */
  keep(callId: string): void {this.#store.db.prepare("UPDATE art_calls SET status='uncertain' WHERE call_id=?").run(callId);}
  /** Releases a reservation that was provably never sent. */
  release(callId: string): void {this.#store.db.prepare("UPDATE art_calls SET status='released' WHERE call_id=? AND status='reserved'").run(callId);}
  /** At start: a dispatched call's fate is unknown, and a reserved one never went out. */
  recover(): {uncertain: string[]; released: string[]} {
    const ids = (status: CallStatus) => (this.#store.db.prepare('SELECT call_id FROM art_calls WHERE status=? ORDER BY reserved_at_ms,call_id').all(status) as {call_id: string}[]).map(row => row.call_id);
    const uncertain = ids('dispatched'), released = ids('reserved');
    for (const id of uncertain) this.keep(id);
    for (const id of released) this.release(id);
    return {uncertain, released};
  }
  /** Automatic calls sent or about to be sent in the rolling window, whatever became of them. */
  guardCalls(nowMs: number): number {
    const row = this.#store.db.prepare(`SELECT COUNT(*) AS calls FROM art_calls WHERE admitted_by='automatic' AND status<>'released' AND reserved_at_ms>?`).get(nowMs - GUARD_WINDOW_MS) as {calls: number};
    return row.calls;
  }
  totals(provider: ArtProviderName, nowMs: number): Totals {
    const month = monthKey(nowMs), limits = this.#limits[provider];
    const sum = (where: string): number =>
      (this.#store.db.prepare(`SELECT COALESCE(SUM(${where}),0) AS value FROM art_calls WHERE provider=? AND month=?`).get(provider, month) as {value: number}).value;
    const spentMicros = sum("CASE status WHEN 'settled' THEN cost_micros ELSE 0 END");
    const reservedMicros = sum("CASE WHEN status IN ('reserved','dispatched') THEN reserved_micros ELSE 0 END");
    const uncertainMicros = sum("CASE status WHEN 'uncertain' THEN reserved_micros ELSE 0 END");
    const excessMicros = sum("CASE WHEN status='settled' AND cost_micros>reserved_micros THEN cost_micros-reserved_micros ELSE 0 END");
    const earlier = this.#store.db.prepare("SELECT COALESCE(SUM(reserved_micros),0) AS value FROM art_calls WHERE provider=? AND month<>? AND status='uncertain'").get(provider, month) as {value: number};
    return {spentMicros, reservedMicros, uncertainMicros, excessMicros, earlierUncertainMicros: earlier.value,
      remainingMicros: Math.max(0, limits.ceilingMicros - spentMicros - reservedMicros - uncertainMicros), todayMicros: this.#held(provider, 'day', dayKey(nowMs))};
  }
  call(callId: string): CallRow | undefined {
    const row = this.#store.db.prepare('SELECT * FROM art_calls WHERE call_id=?').get(callId) as RawCall | undefined;
    return row === undefined ? undefined : toRow(row);
  }
  calls(requestId: string): CallRow[] {
    return (this.#store.db.prepare('SELECT * FROM art_calls WHERE request_id=? ORDER BY reserved_at_ms,call_id').all(requestId) as RawCall[]).map(toRow);
  }
  /** The inspectable ledger, oldest first. Rows are never erased. */
  page(after: number, limit: number): {calls: CallRow[]; nextAfter: number | null} {
    const rows = (this.#store.db.prepare('SELECT rowid AS position,* FROM art_calls WHERE rowid>? ORDER BY rowid LIMIT ?').all(after, limit + 1) as (RawCall & {position: number})[]);
    const page = rows.slice(0, limit);
    return {calls: page.map(toRow), nextAfter: rows.length > limit ? page.at(-1)?.position ?? null : null};
  }
  #held(provider: ArtProviderName, column: 'month' | 'day', value: string): number {
    const row = this.#store.db.prepare(`SELECT COALESCE(SUM(${HELD}),0) AS held FROM art_calls WHERE provider=? AND ${column}=?`).get(provider, value) as {held: number};
    return row.held;
  }
}
type RawCall = {call_id: string; request_id: string; target: ArtTarget | 'idea'; provider: ArtProviderName; model: string; status: CallStatus; admitted_by: ArtAdmission; month: string; day: string;
  reserved_at_ms: number; dispatched_at_ms: number | null; reserved_micros: number; cost_micros: number | null; price_key: string};
const toRow = (row: RawCall): CallRow => ({callId: row.call_id, requestId: row.request_id, target: row.target, provider: row.provider, model: row.model, status: row.status, admittedBy: row.admitted_by,
  month: row.month, day: row.day, reservedAtMs: row.reserved_at_ms, dispatchedAtMs: row.dispatched_at_ms, reservedMicros: row.reserved_micros, costMicros: row.cost_micros, key: JSON.parse(row.price_key) as PriceKey});
