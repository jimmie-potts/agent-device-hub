// How a host-local collector reports its publications (ADR 0012, "Repetition"): the first failure after successes is one
// `operation.failed` record at its table level, later ones are summarized at DEBUG at most once a minute, and the first
// success after them is one `operation.completed` record. Nothing is retried; the next cycle publishes the next snapshot.
import type {ErrorCode, Message} from '@jimmie-potts/event-contracts/v2';
import {Outcome, SUMMARY_MS, recordLog, type Logger, type PublishOnceResult} from '@jimmie-potts/sdk';

export class PublicationFailures {
  readonly #log: Logger;
  readonly #operation: 'lifecycle' | 'feed';
  #since: number | undefined;
  #summarized = 0;
  constructor(log: Logger, operation: 'lifecycle' | 'feed' = 'lifecycle') {
    this.#log = log;
    this.#operation = operation;
  }
  failed(at: number, result: Exclude<PublishOnceResult, {status: 'published'}> | 'late', message: Message): void {
    const uncertain = result === 'late' || result.status === 'uncertain';
    const code: ErrorCode = result === 'late' ? 'uncertain-result' : result.error.error.code;
    const fields = {'bunny.operation': this.#operation, 'bunny.outcome': uncertain ? Outcome.uncertain : Outcome.rejected, 'bunny.code': code} as const;
    if (this.#since === undefined) {
      this.#since = at;
      this.#summarized = at;
      recordLog(this.#log, 'operation.failed', fields, message);
    } else if (at - this.#summarized >= SUMMARY_MS) {
      this.#summarized = at;
      this.#log.debug('operation.failed', fields, message);
    }
  }
  succeeded(): void {
    if (this.#since === undefined) return;
    this.#since = undefined;
    recordLog(this.#log, 'operation.completed', {'bunny.operation': this.#operation, 'bunny.outcome': Outcome.succeeded});
  }
}
