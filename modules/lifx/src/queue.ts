// One bulb's serialized queue (Hub #928). Copied from the `Bulb` class in controllers/lifx/src/controller.ts at main
// 483d3a93 and converted to the module boundary: the controller v1 envelope, admission and receipts are gone (the module
// answers 2.0 commands itself), and each attempt's deadline runs on the module's scheduler instead of `setTimeout`, so it
// follows the runtime's clock and ends when the module stops. What it keeps: one job at a time per bulb, a bounded
// number of jobs, a LightGet before every brightness, color or temperature write that keeps the other observed HSBK
// fields, an absolute zero-duration write, a bounded number of attempts per packet with the same absolute payload, a
// write without an acknowledgment reported as possibly applied, and a closed queue that cancels what waits in it
// without sending anything.
import {decodeState, encodeColor, encodePower, PACKET, type Hsbk, type LightState, type Transport} from './protocol.js';

export type Cancel = () => void;
/** The module's timers: `after` runs `callback` once after `delayMs` and returns what cancels it. */
export interface QueueScheduler {
  after(delayMs: number, callback: () => void): Cancel;
}

/** A reading taken from the bulb, with the runtime-clock instant it arrived. */
export type Observation = {state: LightState; atMs: number};

/** What a job does on the bulb. `paint` is the module's own status paint: one write, no LightGet, no power change. */
export type Operation =
  | {kind: 'read'}
  | {kind: 'power'; on: boolean}
  | {kind: 'brightness'; percent: number}
  | {kind: 'color'; hue: number; saturation: number}
  | {kind: 'temperature'; kelvin: number}
  | {kind: 'paint'; hsbk: Hsbk}
  /** Waits for its turn and sends nothing, so a local change such as a mode keeps its place among the bulb's writes. */
  | {kind: 'turn'};

/** How one job ended. */
export type Attempt = {
  /**
   * `sent`: the bulb acknowledged the write. `none`: no write went out, as for a read or a failure before the write.
   * `possible`: a write went out and no acknowledgment came, so it may have taken effect.
   */
  effect: 'sent' | 'none' | 'possible';
  /**
   * Why the job did not complete: the bulb did not answer, the queue retired the job, the command's own deadline passed
   * before the job sent its first packet or its write, or the module could not record the work before the write.
   */
  failure?: 'unreachable' | 'cancelled' | 'expired' | 'unrecorded';
  /** The reading the job took, if it read the bulb. */
  observed?: Observation;
  /** When the write's acknowledgment arrived. */
  transmittedAtMs?: number;
  /** How many packets the job sent, retries included. */
  exchanges: number;
};

export type RunOptions = {
  /**
   * The command's own deadline on the runtime's clock. No packet goes out once it has passed: a job whose turn comes
   * after it, or whose write would start after it, ends `expired` with no effect, and a write is not tried again after
   * it.
   */
  deadlineMs?: number;
  /**
   * Runs once, just before the job's first write goes out, so the module can record that its work began. When it
   * answers false, nothing is written and the job ends `unrecorded` with no effect.
   */
  beforeWrite?: () => boolean;
};

/** A place in the queue, held before the job is known to run, such as while the module stores a command it accepts. */
export interface Reservation {
  /** Runs `operation` in its turn. Once the queue has closed, it resolves cancelled without sending anything. */
  run(operation: Operation, options?: RunOptions): Promise<Attempt>;
  /** Gives the place back without running anything. */
  release(): void;
}

export type QueueOptions = {
  transport: Transport;
  /** How long one attempt waits for an answer. Defaults to 500 ms. */
  timeoutMs?: number;
  /** How many more attempts a packet gets after the first. Defaults to 1. */
  retries?: number;
  /** How many jobs may wait or run at once, reservations included. Defaults to 8. */
  maxPending?: number;
  now: () => number;
  scheduler: QueueScheduler;
};

type Counter = {exchanges: number};

const cancelled = (): Error => new Error('cancelled');
/** The command's deadline passed before a packet went out. */
class Expired extends Error {}
/** The module could not record the work before its write. */
class Unrecorded extends Error {}

/** One bulb's queue: the only path from the module to that bulb. */
export class BulbQueue {
  /** The last reading, kept through later failures. */
  observation: Observation | undefined;
  readonly #transport: Transport;
  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #maxPending: number;
  readonly #now: () => number;
  readonly #scheduler: QueueScheduler;
  readonly #jobs: (() => Promise<void>)[] = [];
  #reserved = 0;
  #draining: Promise<void> | undefined;
  #active: AbortController | undefined;
  #closed = false;

  constructor({transport, timeoutMs = 500, retries = 1, maxPending = 8, now, scheduler}: QueueOptions) {
    this.#transport = transport;
    this.#timeoutMs = timeoutMs;
    this.#retries = retries;
    this.#maxPending = maxPending;
    this.#now = now;
    this.#scheduler = scheduler;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Jobs waiting or running, and places reserved for jobs. */
  get load(): number {
    return this.#jobs.length + this.#reserved;
  }

  /** Holds a place in the queue, or answers undefined when the queue is closed or full. */
  reserve(): Reservation | undefined {
    if (this.#closed || this.load >= this.#maxPending) return undefined;
    this.#reserved += 1;
    let held = true;
    const give = (): boolean => {
      if (!held) return false;
      held = false;
      this.#reserved -= 1;
      return true;
    };
    return {
      run: (operation, options = {}) => {
        if (!give()) return Promise.reject(new Error('reservation-used'));
        return new Promise<Attempt>(resolve => {
          this.#enqueue(async () => { resolve(await this.#execute(operation, options)); });
        });
      },
      release: () => { give(); },
    };
  }

  /** Runs `operation` in its turn, or answers undefined when the queue is closed or full. */
  run(operation: Operation, options?: RunOptions): Promise<Attempt> | undefined {
    return this.reserve()?.run(operation, options);
  }

  /**
   * Closes the queue: it admits nothing more, every job still waiting resolves cancelled without sending anything, and
   * the job in flight is aborted, so a write it had sent is reported as possibly applied. Resolves once every job has
   * settled and the transport has closed.
   */
  async close(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      this.#active?.abort();
    }
    if (this.#draining !== undefined) await this.#draining;
    this.#transport.close();
  }

  #enqueue(run: () => Promise<void>): void {
    this.#jobs.push(run);
    if (this.#draining === undefined) this.#draining = this.#drain();
  }

  async #drain(): Promise<void> {
    for (let job = this.#jobs[0]; job !== undefined; job = this.#jobs[0]) {
      await job();
      this.#jobs.shift();
    }
    this.#draining = undefined;
  }

  async #execute(operation: Operation, {deadlineMs, beforeWrite}: RunOptions): Promise<Attempt> {
    const counter: Counter = {exchanges: 0};
    let written = false;
    let observed: Observation | undefined;
    try {
      this.#live();
      this.#within(deadlineMs);
      if (operation.kind === 'turn') return {effect: 'none', exchanges: 0};
      if (operation.kind === 'read') {
        observed = await this.#read(counter, deadlineMs);
        return {effect: 'none', observed, exchanges: counter.exchanges};
      }
      let type: number;
      let payload: Buffer;
      if (operation.kind === 'power') {
        type = PACKET.setPower;
        payload = encodePower(operation.on);
      } else if (operation.kind === 'paint') {
        type = PACKET.setColor;
        payload = encodeColor(operation.hsbk);
      } else {
        // Read, then write one absolute color that keeps the fields this command does not change.
        observed = await this.#read(counter, deadlineMs);
        const color = {...observed.state.color};
        if (operation.kind === 'brightness') color.brightness = Math.round((operation.percent * 65535) / 100);
        else if (operation.kind === 'color') {
          color.hue = Math.round((operation.hue * 65535) / 360);
          color.saturation = Math.round((operation.saturation * 65535) / 100);
        } else color.kelvin = operation.kelvin;
        type = PACKET.setColor;
        payload = encodeColor(color);
      }
      // The last checks before anything can change on the bulb: the queue is open, the deadline has not passed and the
      // module has recorded that the work began.
      this.#live();
      this.#within(deadlineMs);
      if (beforeWrite !== undefined && !beforeWrite()) throw new Unrecorded();
      written = true;
      await this.#exchange(type, payload, PACKET.acknowledgment, counter, deadlineMs);
      return {effect: 'sent', ...(observed === undefined ? {} : {observed}), transmittedAtMs: this.#now(), exchanges: counter.exchanges};
    } catch (error) {
      return {effect: written ? 'possible' : 'none', failure: this.#failure(error, written), ...(observed === undefined ? {} : {observed}), exchanges: counter.exchanges};
    }
  }

  /** Why a job ended early. Once a write went out, only the queue's close or the bulb's silence explains it. */
  #failure(error: unknown, written: boolean): NonNullable<Attempt['failure']> {
    if (this.#closed) return 'cancelled';
    if (!written && error instanceof Expired) return 'expired';
    if (!written && error instanceof Unrecorded) return 'unrecorded';
    return 'unreachable';
  }

  /** Throws `Expired` once the command's own deadline has passed. */
  #within(deadlineMs: number | undefined): void {
    if (deadlineMs !== undefined && this.#now() >= deadlineMs) throw new Expired();
  }

  async #read(counter: Counter, deadlineMs: number | undefined): Promise<Observation> {
    const raw = await this.#exchange(PACKET.lightGet, Buffer.alloc(0), PACKET.lightState, counter, deadlineMs);
    const observation = {state: decodeState(raw), atMs: this.#now()};
    this.observation = observation;
    return observation;
  }

  /** Throws once the queue has closed, so a retired job sends nothing more. */
  #live(): void {
    if (this.#closed) throw cancelled();
  }

  /**
   * Sends one packet and waits for its answer, with at most `retries` more attempts of the same absolute payload, each
   * with its own deadline. No attempt starts once `deadlineMs`, the command's own deadline, has passed.
   */
  async #exchange(type: number, payload: Buffer, expected: number, counter: Counter, deadlineMs: number | undefined): Promise<Buffer> {
    for (let attempt = 0; ; attempt += 1) {
      this.#live();
      this.#within(deadlineMs);
      const abort = new AbortController();
      this.#active = abort;
      counter.exchanges += 1;
      let cancelTimer: Cancel = () => {};
      try {
        return await new Promise<Buffer>((resolve, reject) => {
          abort.signal.addEventListener('abort', () => { reject(cancelled()); }, {once: true});
          try {
            cancelTimer = this.#scheduler.after(this.#timeoutMs, () => { reject(new Error('timeout')); });
          } catch {
            // The module's timers refuse use once it stops.
            reject(cancelled());
            return;
          }
          this.#transport.exchange(type, payload, expected, abort.signal).then(resolve, () => { reject(new Error('transport')); });
        });
      } catch {
        this.#live();
        if (attempt >= this.#retries) throw new Error('unanswered');
      } finally {
        cancelTimer();
        abort.abort();
        if (this.#active === abort) this.#active = undefined;
      }
    }
  }
}
