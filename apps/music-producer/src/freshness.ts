import {DiagnosticEpisodes, type LogFields, type Scheduler} from '@jimmie-potts/sdk';
import {CAPTURE_VALIDITY_MS} from '@jimmie-potts/event-contracts/v2/music-capture';
import type {ClockReading} from './timing.js';

type Stage = 'dequeued' | 'attempted' | 'acknowledged';
type Progress = Readonly<{sequence: number; monotonicMs: number; sourceAge?: number}>;
type TimestampStage = 'dequeue' | 'publication';
type Loss = 'dequeue-quiet' | 'dequeued-window-expired' | 'publish-unacknowledged' | 'dequeue-timestamp-rejected' | 'publication-timestamp-rejected';

export class ProducerFreshness {
  readonly #reports: DiagnosticEpisodes;
  readonly #stages: Partial<Record<Stage, Progress>> = {};
  #cancel: (() => void) | undefined;
  #loss: Loss | undefined;
  #closed = false;
  #active = false;
  #publication: 'pending' | 'acknowledged' | 'rejected' | undefined;
  readonly #timestampRejected = {dequeue: false, publication: false};

  constructor(generation: string, private readonly scheduler: Scheduler, private readonly clock: () => ClockReading,
    write: (fields: LogFields) => void) {
    this.#reports = new DiagnosticEpisodes((delay, callback) => scheduler.after(delay, callback), (kind, fields) => {
      write({'bunny.music.capture_generation': generation, 'bunny.music.checkpoint': kind, ...fields});
    });
  }

  observe(stage: Stage, sequence: number, now: ClockReading, sourceEnd?: number): void {
    if (this.#closed || !Number.isFinite(now.monotonicMs) || !Number.isSafeInteger(sequence) || sequence <= 0) return;
    this.#sample(now);
    const sourceAge = sourceEnd === undefined ? undefined : this.#age(now.monotonicMs - sourceEnd);
    if (stage === 'attempted') this.#publication = 'pending';
    if (stage === 'acknowledged') this.#publication = 'acknowledged';
    this.#stages[stage] = {sequence, monotonicMs: now.monotonicMs, ...(sourceAge === undefined ? {} : {sourceAge})};
    this.#sample(now);
  }

  timestamp(stage: TimestampStage, rejected: boolean, now: ClockReading): void {
    if (this.#closed || this.#timestampRejected[stage] === rejected) return;
    this.#timestampRejected[stage] = rejected;
    this.#sample(now);
  }

  publicationRefused(): void {
    if (!this.#closed) this.#publication = 'rejected';
  }

  start(): void {
    if (this.#closed || this.#cancel !== undefined) return;
    this.#active = true;
    try {
      this.#cancel = this.scheduler.after(CAPTURE_VALIDITY_MS, () => {
        this.#cancel = undefined;
        if (this.#closed) return;
        try {this.#sample(this.clock());} catch { /* No diagnostic failure reaches capture. */ }
        this.start();
      });
    } catch { /* An unavailable observer does not change capture. */ }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {this.#cancel?.();} catch { /* The closed observer stays fenced. */ }
    this.#cancel = undefined;
    let fields: LogFields = {};
    try {fields = this.#fields(this.clock().monotonicMs);} catch { /* Keep the terminal marker. */ }
    this.#reports.close(fields);
  }

  #sample(now: ClockReading): void {
    const dequeued = this.#stages.dequeued;
    if (!this.#active || dequeued === undefined || !Number.isFinite(now.monotonicMs) || now.monotonicMs < dequeued.monotonicMs) return;
    const attempted = this.#stages.attempted;
    const acknowledged = this.#stages.acknowledged;
    const idle = now.monotonicMs - dequeued.monotonicMs;
    const loss = idle >= CAPTURE_VALIDITY_MS ? 'dequeue-quiet'
      : dequeued.sourceAge !== undefined && idle + dequeued.sourceAge >= CAPTURE_VALIDITY_MS ? 'dequeued-window-expired'
      : this.#timestampRejected.dequeue ? 'dequeue-timestamp-rejected'
      : this.#timestampRejected.publication ? 'publication-timestamp-rejected'
      : attempted !== undefined && attempted.sequence > (acknowledged?.sequence ?? 0)
        && now.monotonicMs - attempted.monotonicMs >= CAPTURE_VALIDITY_MS ? 'publish-unacknowledged' : undefined;
    if (loss === this.#loss) return;
    const prior = this.#loss;
    this.#loss = loss;
    const fields = this.#fields(now.monotonicMs);
    if (loss !== undefined) {
      this.#reports.loss({...fields, 'bunny.music.observation': loss,
        ...(Number.isSafeInteger(now.wallMs) && now.wallMs >= 0 ? {'bunny.music.loss_at_ms': now.wallMs} : {})});
    } else if (prior !== undefined) this.#reports.recovery(fields);
  }

  #fields(now: number): LogFields {
    const fields: Record<string, string | number | boolean> = this.#publication === undefined ? {} :
      {'bunny.music.publication_state': this.#publication};
    for (const stage of ['dequeued', 'attempted', 'acknowledged'] as const) {
      const step = this.#stages[stage];
      if (step === undefined) continue;
      fields[`bunny.music.${stage}_sequence`] = step.sequence;
      const age = this.#age(now - step.monotonicMs);
      if (age !== undefined) fields[`bunny.music.${stage}_idle_ms`] = age;
      if (step.sourceAge !== undefined) fields[`bunny.music.${stage}_source_age_ms`] = step.sourceAge;
    }
    const dequeued = this.#stages.dequeued;
    const attempted = this.#stages.attempted;
    if (dequeued?.sourceAge !== undefined && now >= dequeued.monotonicMs) {
      fields['bunny.music.dequeued_window_expired'] = now - dequeued.monotonicMs + dequeued.sourceAge >= CAPTURE_VALIDITY_MS;
    }
    if (this.#publication === 'pending' && attempted !== undefined && now >= attempted.monotonicMs) {
      fields['bunny.music.publish_pending_overdue'] = now - attempted.monotonicMs >= CAPTURE_VALIDITY_MS;
    }
    return fields;
  }

  #age(value: number): number | undefined {
    return Number.isFinite(value) && value >= 0 ? Math.min(86_400_000, Math.floor(value)) : undefined;
  }
}
