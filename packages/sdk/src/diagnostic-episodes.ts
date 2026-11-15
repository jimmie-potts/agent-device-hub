import type {LogFields} from './module.js';

const REPORT_WINDOW_MS = 60_000;

/** Retains one loss snapshot during a reporting window. This owns no application state. */
export class DiagnosticEpisodes {
  #timer: (() => void) | undefined;
  #lastSuppressed: LogFields | undefined;
  #suppressed = 0;
  #reportRecovery = false;
  #closed = false;

  constructor(private readonly after: (delay: number, callback: () => void) => () => void,
    private readonly write: (kind: 'loss' | 'recovery' | 'summary' | 'terminal', fields: LogFields) => void) {}

  loss(fields: LogFields): void {
    if (this.#closed) return;
    if (this.#timer !== undefined) {
      this.#reportRecovery = false;
      this.#suppressed = Math.min(Number.MAX_SAFE_INTEGER, this.#suppressed + 1);
      this.#lastSuppressed = Object.freeze({...fields});
      return;
    }
    try {
      this.#timer = this.after(REPORT_WINDOW_MS, () => {
        this.#timer = undefined;
        if (!this.#closed) this.#flush();
      });
    } catch {return;}
    this.#reportRecovery = true;
    this.#emit('loss', fields);
  }

  recovery(fields: LogFields): void {
    if (this.#closed || !this.#reportRecovery) return;
    this.#reportRecovery = false;
    this.#emit('recovery', fields);
  }

  close(fields: LogFields): void {
    if (this.#closed) return;
    this.#closed = true;
    try {this.#timer?.();} catch { /* The timer is fenced by closed. */ }
    this.#timer = undefined;
    this.#flush();
    this.#emit('terminal', fields);
  }

  #flush(): void {
    const snapshot = this.#lastSuppressed;
    if (snapshot === undefined) return;
    const count = this.#suppressed;
    this.#lastSuppressed = undefined;
    this.#suppressed = 0;
    this.#emit('summary', {...snapshot, 'bunny.attempt_count': count});
  }

  #emit(kind: Parameters<DiagnosticEpisodes['write']>[0], fields: LogFields): void {
    try {this.write(kind, fields);} catch { /* A failed sink cannot affect capture. */ }
  }
}
