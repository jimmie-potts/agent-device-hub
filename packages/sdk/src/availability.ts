// Repeated device failures (ADR 0012, "Observability", "Repetition"; Hub #949). A polled device that stays offline logs
// one degradation and one recovery, not a warning per poll: its first failure is a warning, later ones are counted and
// summarized at DEBUG at most once a minute, and its recovery counts them all.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {LogFields, Logger} from './module.js';
import type {Clock, TraceContext} from './sdk.js';

/** How often repeated failures of one device are summarized, at most. */
export const SUMMARY_MS = 60_000;
// The diagnostic contract's bound on a duration.
const MAX_DURATION_MS = 86_400_000;
// The diagnostic contract's `bunny.device.id` pattern.
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * The device's ID as a record's field, or nothing for an ID the contract's pattern refuses, such as an address with a
 * path: the record keeps the rest rather than be dropped whole, as a request ID that its pattern refuses is left out.
 */
const deviceOf = (device: string): LogFields => DEVICE_ID.test(device) ? {'bunny.device.id': device} : {};

export type AvailabilityOptions = {
  /** The module's logger. */
  log: Logger;
  /** The module's clock. */
  clock: Clock;
};

type Outage = {sinceMs: number; failed: number; unsummarized: number; summarizedAtMs: number};

/** Tracks whether each of a module's devices can be reached, and logs only the changes. */
export class DeviceAvailability {
  readonly #log: Logger;
  readonly #clock: Clock;
  readonly #outages = new Map<string, Outage>();

  constructor({log, clock}: AvailabilityOptions) {
    this.#log = log;
    this.#clock = clock;
  }

  /**
   * A poll or call could not reach `device`, for the reason `code`. The first failure logs `device.unavailable` at WARN;
   * later ones are counted, and logged as one `device.unavailable` summary at DEBUG at most once a minute.
   */
  unreachable(device: string, code: ErrorCode, trace?: TraceContext): void {
    const now = this.#clock.now();
    const outage = this.#outages.get(device);
    if (outage === undefined) {
      this.#outages.set(device, {sinceMs: now, failed: 1, unsummarized: 0, summarizedAtMs: now});
      this.#write('warn', 'device.unavailable', {...deviceOf(device), 'bunny.code': code, 'bunny.attempt_count': 1}, trace);
      return;
    }
    outage.failed += 1;
    outage.unsummarized += 1;
    if (now - outage.summarizedAtMs < SUMMARY_MS) return;
    this.#write('debug', 'device.unavailable', {...deviceOf(device), 'bunny.code': code, 'bunny.attempt_count': outage.unsummarized}, trace);
    outage.unsummarized = 0;
    outage.summarizedAtMs = now;
  }

  /**
   * A poll or call reached `device`. After failures it logs one `device.available` record at INFO with how many attempts
   * failed and how long the outage lasted; while the device is available it logs nothing.
   */
  reached(device: string, trace?: TraceContext): void {
    const outage = this.#outages.get(device);
    if (outage === undefined) return;
    this.#outages.delete(device);
    const duration = Math.min(MAX_DURATION_MS, Math.max(0, this.#clock.now() - outage.sinceMs));
    this.#write('info', 'device.available', {...deviceOf(device), 'bunny.attempt_count': outage.failed, 'bunny.duration_ms': duration}, trace);
  }

  /** Whether `device` is unreachable now. */
  unavailable(device: string): boolean {
    return this.#outages.has(device);
  }

  #write(level: 'debug' | 'info' | 'warn', event: string, fields: LogFields, trace: TraceContext | undefined): void {
    try {
      this.#log[level](event, fields, trace);
    } catch {
      // Telemetry is never acknowledged: a failing logger loses the record, and the module goes on.
    }
  }
}
