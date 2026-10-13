// Bounded admission diagnostics shared by the listener and gateway (ADR 0012, Repetition).
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {Cancel, Scheduler, TraceContext} from '@jimmie-potts/sdk';
import {REGISTRY_REASONS} from '../diagnostics.js';
import type {RuntimeLogger} from '../log.js';

const REFUSAL_WINDOW_MS = 60_000;
type Repeats = {fields: Record<string, string | number>; level: 'info' | 'warn' | 'error'; count: number; cancel: Cancel};

/** Caller fields must be fixed contract vocabulary, never unauthenticated input. */
export class GatewayRefusals {
  readonly #repeats = new Map<string, Repeats>();
  readonly #log: RuntimeLogger;
  readonly #scheduler: Scheduler;
  #closed = false;

  constructor(log: RuntimeLogger, scheduler: Scheduler) {
    this.#log = log;
    this.#scheduler = scheduler;
  }

  close(): void {
    this.#closed = true;
    for (const repeats of this.#repeats.values()) {
      repeats.cancel();
      this.#summarize(repeats);
    }
    this.#repeats.clear();
  }

  /**
   * Records a refusal by the repetition rule (ADR 0012, "Repetition"): the first of a run at once, then its repeats as
   * one summary a minute with their count, until a quiet minute. A record never holds what the caller sent.
   */
  record(fields: Record<string, string | number>, level: 'debug' | 'info' | 'warn' | 'error', trace?: TraceContext): void {
    const severity = level === 'debug' ? 'info' : level;
    const key = JSON.stringify(fields);
    const open = this.#repeats.get(key);
    if (open !== undefined) {
      open.count += 1;
      return;
    }
    const code = fields['bunny.code'] as ErrorCode;
    const reason = REGISTRY_REASONS[code];
    const record = {...fields, ...(reason === undefined ? {} : {'bunny.reason': reason})};
    this.#log[severity]('runtime.edge.refused', record, trace);
    if (this.#closed) return;
    const repeats: Repeats = {fields: record, level: severity, count: 0, cancel: () => {}};
    this.#repeats.set(key, repeats);
    this.#window(key, repeats);
  }

  #window(key: string, repeats: Repeats): void {
    repeats.cancel = this.#scheduler.after(REFUSAL_WINDOW_MS, () => {
      if (repeats.count === 0) {
        this.#repeats.delete(key);
        return;
      }
      this.#summarize(repeats);
      this.#window(key, repeats);
    });
  }

  #summarize(repeats: Repeats): void {
    const {count} = repeats;
    repeats.count = 0;
    if (count > 0) this.#log[repeats.level]('runtime.edge.refused', {...repeats.fields, 'bunny.attempt_count': count});
  }
}

/** An HTTP method in the diagnostic contract's bounded vocabulary. */
export const methodOf = (method: string): string => ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'].includes(method) ? method : '_OTHER';
