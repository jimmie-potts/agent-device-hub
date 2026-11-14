import {recordLog, type Cancel, type Logger, type ModuleScheduler} from '@jimmie-potts/sdk';

export type ReadSource = 'sampler' | 'music-admission' | 'music-session';
export type ReadEnd = 'reply' | 'http-error' | 'transport-deadline' | 'transport-rejection' | 'link-deadline';
type Sample = {startedAt: number; count: number; maxDelay: number};
type Timing = {endedAt: number; elapsed: number; count: number; observed?: number; pending?: number};

const PROBE_MS = 100;
const MAX_ACTIVE = 16;
const MAX_DURATION_MS = 86_400_000;
const EMIT_INTERVAL_MS = 60_000;
const bounded = (ms: number): number => Math.min(MAX_DURATION_MS, Math.max(0, ms));

/** One timer on the runtime thread, shared by the Nanoleaf links while monitored reads are active. */
export class ReadTimingProbe {
  readonly #active = new Set<Sample>();
  #probe: {dueAt: number; cancel: Cancel} | undefined;

  constructor(private readonly scheduler: ModuleScheduler, private readonly now: () => number = () => performance.now()) {}

  start(): ((end: 'stopped' | 'settled') => Timing | undefined) | undefined {
    if (this.#active.size >= MAX_ACTIVE) return;
    const sample: Sample = {startedAt: this.now(), count: 0, maxDelay: 0};
    this.#active.add(sample);
    this.#schedule();
    return end => {
      if (!this.#active.delete(sample)) return;
      const pendingAt = this.#probe?.dueAt;
      try {
        if (end === 'stopped') return;
        const endedAt = this.now();
        const pending = pendingAt === undefined ? 0 : bounded(endedAt - Math.max(sample.startedAt, pendingAt));
        return {endedAt, elapsed: bounded(endedAt - sample.startedAt), count: sample.count,
          ...(sample.count === 0 ? {} : {observed: sample.maxDelay}), ...(pending === 0 ? {} : {pending})};
      } finally {
        if (this.#active.size === 0) this.#cancel();
      }
    };
  }

  #schedule(): void {
    if (this.#probe !== undefined || this.#active.size === 0) return;
    try {
      const dueAt = this.now() + PROBE_MS;
      const cancel = this.scheduler.after(PROBE_MS, () => {
        if (this.#probe?.cancel !== cancel) return;
        this.#probe = undefined;
        try {
          const firedAt = this.now();
          for (const sample of this.#active) {
            sample.count = Math.min(Number.MAX_SAFE_INTEGER, sample.count + 1);
            sample.maxDelay = Math.max(sample.maxDelay, bounded(firedAt - Math.max(sample.startedAt, dueAt)));
          }
          this.#schedule();
        } catch {
          // Timing loss is local to diagnostics.
        }
      });
      this.#probe = {dueAt, cancel};
    } catch {
      // A stopped timer can leave timing without a scheduler sample.
    }
  }

  #cancel(): void {
    const probe = this.#probe;
    this.#probe = undefined;
    probe?.cancel();
  }
}

type ReadSeries = {lastBaseline: number; lastFailure: number; failures: number; unreported: number};

/** One bounded series per read source on a link. */
export class ReadTimingRecords {
  readonly #series = new Map<ReadSource, ReadSeries>();

  constructor(private readonly log: Logger, private readonly device: string) {}

  record(source: ReadSource, end: ReadEnd, deadline: number, timing: Timing): void {
    const {endedAt, elapsed, count, pending, observed} = timing;
    let series = this.#series.get(source);
    if (series === undefined) {
      series = {lastBaseline: -Infinity, lastFailure: -Infinity, failures: 0, unreported: 0};
      this.#series.set(source, series);
    }
    const fields = {'bunny.device.id': this.device, 'bunny.nanoleaf.read.source': source, 'bunny.nanoleaf.read.end': end,
      'bunny.duration_ms': elapsed, 'bunny.timeout_ms': deadline, 'bunny.nanoleaf.probe.sample_count': count,
      ...(observed === undefined ? {} : {'bunny.lag.duration_ms': observed}),
      ...(pending === undefined ? {} : {'bunny.nanoleaf.probe.pending_ms': pending})};
    if (end !== 'reply') {
      series.failures = Math.min(Number.MAX_SAFE_INTEGER, series.failures + 1);
      series.unreported = Math.min(Number.MAX_SAFE_INTEGER, series.unreported + 1);
      if (series.failures > 1 && endedAt - series.lastFailure < EMIT_INTERVAL_MS) return;
      const attempts = series.unreported;
      series.lastFailure = endedAt;
      series.unreported = 0;
      const event = series.failures === 1 ? 'nanoleaf.http.read.failed' : 'nanoleaf.http.read.summary';
      recordLog(this.log, event, {...fields, 'bunny.attempt_count': attempts});
    } else if (series.failures > 0) {
      const attempts = series.failures;
      series.failures = 0;
      series.unreported = 0;
      series.lastBaseline = endedAt;
      recordLog(this.log, 'nanoleaf.http.read.recovered', {...fields, 'bunny.attempt_count': attempts});
    } else if (endedAt - series.lastBaseline >= EMIT_INTERVAL_MS) {
      series.lastBaseline = endedAt;
      recordLog(this.log, 'nanoleaf.http.read.sampled', fields);
    }
  }
}
