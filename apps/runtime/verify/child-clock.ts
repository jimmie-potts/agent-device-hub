// The clock of a verification run's runtime child on virtual time (Hub #1710). The supervisor holds the run's virtual
// time and hands the child its start as an argument of the child's own (never the runtime's); the child runs the
// runtime on a manual clock from then on, passed to `runMain` as its test clock, which `runProcess` takes only in this
// simulated test run under the supervisor (Hub #1709). The same clock's monotonic reading goes to the fixture core's
// options, so the core's durations advance with its wall clock. Each `advance` from the supervisor moves the clock,
// with virtual time standing still while a module's worker call runs, and gives real work its turn, as the in-memory
// harness does (tests/scenarios/real-work.ts, stepping.ts, virtual-time.ts).
import type {BunnyModule, RemoteSimulationOptions} from '@jimmie-potts/sdk';
import type {CoreModule, TestClock} from '../src/index.js';
import {createCoreModule, type FixtureCoreOptions} from '../tests/fixtures/core.js';
import {realWork, settle} from '../tests/scenarios/real-work.js';
import {WorkerHold, manualClock} from '../tests/scenarios/virtual-time.js';

/** The child's clock argument on the real clock. */
export const REAL_CLOCK = 'real';
const START = /^(0|[1-9]\d{0,15})$/;

/** What one advance reports to the supervisor. */
export type Advanced = {nowMs: number; nextDueMs: number | null; busy: boolean};

export class ChildClock {
  readonly #clock: ReturnType<typeof manualClock>;
  readonly #workers = new WorkerHold();
  readonly #work = realWork();
  /** The test clock the child gives `runMain`. */
  readonly testClock: TestClock;

  constructor(startMs: number) {
    this.#clock = manualClock(startMs);
    this.testClock = {clock: {now: this.#clock.now}, scheduler: this.#clock.scheduler, monotonic: this.#clock.now};
  }

  /**
   * The clocks a registered module built over its link gets (Hub #1711): the test clock's wall clock, scheduler and
   * monotonic clock, so its simulated transport and its monotonic durations move with the run.
   */
  get remoteOptions(): RemoteSimulationOptions {
    return {now: this.#clock.now, scheduler: this.#clock.scheduler, monotonic: this.#clock.now};
  }

  /** The fixture core's options with the test clock's monotonic clock, the one `testClock` carries. */
  coreOptions(options: FixtureCoreOptions): FixtureCoreOptions {
    return {...options, monotonic: this.testClock.monotonic};
  }

  /** The module, whose worker calls hold virtual time while they run. */
  wrap(module: BunnyModule): BunnyModule {
    return this.#workers.wrap(module);
  }

  /** Moves the clock after held worker calls finish, fires due timers and gives real work its turn. */
  async advance(toMs: number, waiting: () => boolean): Promise<Advanced> {
    await this.#workers.idle();
    const ms = toMs - this.#clock.now();
    if (ms > 0) this.#clock.advance(ms);
    const busy = (): boolean => this.#busy(waiting);
    await settle(busy);
    return this.#state(busy());
  }

  /** Gives ready callbacks their turn and samples work without moving the clock or waiting for workers. */
  async observe(waiting: () => boolean): Promise<Advanced> {
    await settle(() => false);
    return this.#state(this.#busy(waiting));
  }

  #busy(waiting: () => boolean): boolean {
    return this.#work.busy() || waiting() || this.#workers.size > 0;
  }

  #state(busy: boolean): Advanced {
    const next = this.#clock.next();
    // A timer due at NaN counts as due now, as the in-memory harness's stepping takes it.
    return {nowMs: this.#clock.now(), nextDueMs: next === undefined ? null : Number.isFinite(next) ? next : this.#clock.now(), busy};
  }
}

/**
 * The options the child's fixture core is built with: on virtual time with the monotonic clock that `clock`'s test clock
 * carries, which the child gives `runMain` (Hub #1710), and on the real clock unchanged.
 */
export function fixtureCoreOptions(clock: ChildClock | undefined, options: FixtureCoreOptions): FixtureCoreOptions {
  return clock === undefined ? options : clock.coreOptions(options);
}

/** The child's fixture core, the only way the child builds one, with `fixtureCoreOptions`. It takes no other factory. */
export function fixtureCore(clock: ChildClock | undefined, options: FixtureCoreOptions): CoreModule {
  return createCoreModule(fixtureCoreOptions(clock, options));
}

/** The child's clock from its argument: undefined on the real clock. Anything but `real` or a start time is refused. */
export function childClockOf(argument: string): ChildClock | undefined {
  if (argument === REAL_CLOCK) return undefined;
  if (!START.test(argument)) throw new Error('the clock argument must be real or a start time in milliseconds');
  return new ChildClock(Number(argument));
}
