import { validateSnapshot, type Snapshot } from '@jimmie-potts/agent-state';
import type { Receipt } from '@jimmie-potts/device-contracts';
import type { TidbytController } from './controller.js';
import { BoundedReader, EvaluationLoop, InstallationWriter, systemTimers, type InstallationState, type PublisherTimers } from './publishing.js';
import { statusFrame, statusView, type StatusView } from './status.js';

/**
 * The selected shared agent-state owner's feed. `snapshot()` returns its current
 * calculated state; `subscribe()` yields revision pointers or resync notices.
 */
export type StatusFeed = {
  /**
   * Must settle within a bounded time. A read that outlives the publisher's timeout
   * blocks further reads until it settles, so an adapter must enforce its own deadline.
   */
  snapshot(): Snapshot | Promise<Snapshot>;
  subscribe?(): AsyncIterable<unknown> & { close?(): void };
};

export type StatusTimers = PublisherTimers;

export type StatusPublisherOptions = {
  feed: StatusFeed;
  /** The designated writer for this Tidbyt. The publisher submits nothing elsewhere. */
  controller: TidbytController;
  acknowledgingConsumers?: readonly string[];
  /** Minimum time between writes. Default 15 s. */
  minIntervalMs?: number;
  /** Push an unchanged frame again after this long. Default 10 minutes. */
  refreshMs?: number;
  /** Re-read the feed this often without a change notice. Default 30 s. */
  pollMs?: number;
  /** A feed read slower than this counts as unavailable. Default 3 s. */
  feedTimeoutMs?: number;
  /** Monotonic milliseconds. */
  now?: () => number;
  timers?: StatusTimers;
};

export type StatusPublisherState = { installation: InstallationState; view?: StatusView; lastWrite?: Receipt };

/**
 * Publishes shared agent status to one Tidbyt through its controller queue:
 * push on change at most every `minIntervalMs`, refresh every `refreshMs`, and
 * remove the installation when a healthy feed shows nothing to display.
 */
export class TidbytStatusPublisher {
  readonly #feed: StatusFeed;
  readonly #consumers?: readonly string[];
  readonly #loop: EvaluationLoop;
  readonly #reader: BoundedReader<Snapshot>;
  readonly #writer: InstallationWriter;
  #started = false;
  #subscription?: AsyncIterable<unknown> & { close?(): void };
  /** The last snapshot that validated, kept for display while the feed is unavailable. */
  #lastGood?: Snapshot;
  #view?: StatusView;

  constructor(options: StatusPublisherOptions) {
    const minIntervalMs = options.minIntervalMs ?? 15_000;
    const refreshMs = options.refreshMs ?? 600_000;
    const pollMs = options.pollMs ?? 30_000;
    const feedTimeoutMs = options.feedTimeoutMs ?? 3_000;
    const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
    if (!options.feed || typeof options.feed.snapshot !== 'function' || !options.controller
        || ![minIntervalMs, refreshMs, pollMs, feedTimeoutMs].every(positive)
        || (options.acknowledgingConsumers !== undefined && !Array.isArray(options.acknowledgingConsumers))) {
      throw new Error('invalid-status-publisher-options');
    }
    const timers = options.timers ?? systemTimers;
    this.#feed = options.feed;
    this.#consumers = options.acknowledgingConsumers ? [...options.acknowledgingConsumers] : undefined;
    this.#loop = new EvaluationLoop(() => this.#evaluate(), timers);
    this.#reader = new BoundedReader(() => this.#feed.snapshot(), feedTimeoutMs, timers);
    this.#writer = new InstallationWriter({
      controller: options.controller, minIntervalMs, refreshMs, pollMs, now: options.now ?? (() => performance.now()),
    });
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    void this.update();
  }

  /** Stop publishing. A write already admitted to the controller reports its own result. */
  stop(): void {
    this.#loop.stop();
    this.#subscription?.close?.();
    this.#subscription = undefined;
  }

  /** Request an evaluation. Requests made while one runs coalesce into a single rerun. */
  update(): Promise<void> {
    return this.#loop.update();
  }

  /** Resolves once no evaluation is running. */
  whenIdle(): Promise<void> {
    return this.#loop.whenIdle();
  }

  state(): StatusPublisherState {
    const lastWrite = this.#writer.lastWrite;
    return structuredClone({
      installation: this.#writer.installation,
      ...(this.#view ? { view: this.#view } : {}),
      ...(lastWrite ? { lastWrite } : {}),
    });
  }

  #subscribe(): void {
    if (this.#subscription || !this.#feed.subscribe) return;
    let subscription: AsyncIterable<unknown> & { close?(): void };
    try {
      subscription = this.#feed.subscribe();
    } catch {
      return;
    }
    this.#subscription = subscription;
    void (async () => {
      try {
        for await (const _ of subscription) {
          if (this.#loop.stopped) break;
          void this.update();
        }
      } catch {
        // The next evaluation resubscribes; the poll keeps reading meanwhile.
      }
      if (this.#subscription === subscription) this.#subscription = undefined;
    })();
  }

  /** One evaluation. Returns the delay before the next scheduled evaluation. */
  async #evaluate(): Promise<number> {
    this.#subscribe();
    const value = await this.#reader.read();
    const valid = value === undefined ? undefined : validateSnapshot(value);
    const current = valid?.ok ? valid.value : undefined;
    if (current) this.#lastGood = current;
    const view = statusView(current ?? this.#lastGood, { feedAvailable: current !== undefined, acknowledgingConsumers: this.#consumers });
    this.#view = view;
    return this.#writer.write(view.idle ? undefined : statusFrame(view).rgb);
  }
}
