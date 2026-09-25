import type { Receipt } from '@jimmie-potts/device-contracts';
import { INSTALLATION_ID } from './connection.js';
import type { TidbytController } from './controller.js';
import { nowPlayingFrame, nowPlayingView, type NowPlayingView, type PlaybackSnapshot } from './nowplaying.js';
import { BoundedReader, EvaluationLoop, InstallationWriter, systemTimers, type InstallationState, type PublisherTimers } from './publishing.js';

/** The hub's playback snapshot, already validated for the configured source. */
export type PlaybackFeed = {
  /** Must settle within a bounded time; a read that outlives the publisher's timeout blocks further reads until it settles. */
  snapshot(): PlaybackSnapshot | Promise<PlaybackSnapshot>;
};

export type NowPlayingPublisherOptions = {
  feed: PlaybackFeed;
  /** The designated writer for this Tidbyt. The publisher submits nothing elsewhere. */
  controller: TidbytController;
  /** The additional installation that holds the card; never the status installation. */
  installation: string;
  /** Minimum time between writes. Default 15 s. */
  minIntervalMs?: number;
  /** Push an unchanged card again after this long. Default 10 minutes. */
  refreshMs?: number;
  /** Read the snapshot this often. Default 5 s. */
  pollMs?: number;
  /** A read slower than this counts as failed. Default 3 s. */
  feedTimeoutMs?: number;
  /** Monotonic milliseconds. */
  now?: () => number;
  timers?: PublisherTimers;
};

export type NowPlayingPublisherState = { installation: InstallationState; view?: NowPlayingView; lastWrite?: Receipt };

/**
 * Publishes the shared playback snapshot as a now-playing card in its own background
 * installation, through the Tidbyt controller queue. A card that goes stale is dimmed;
 * the installation is removed when nothing is known to be playing.
 */
export class TidbytNowPlayingPublisher {
  readonly #loop: EvaluationLoop;
  readonly #reader: BoundedReader<PlaybackSnapshot>;
  readonly #writer: InstallationWriter;
  readonly #now: () => number;
  #started = false;
  /** The last snapshot read, and when it arrived, kept while later reads fail. */
  #lastGood?: { snapshot: PlaybackSnapshot; receivedAtMs: number };
  #view?: NowPlayingView;

  constructor(options: NowPlayingPublisherOptions) {
    const minIntervalMs = options.minIntervalMs ?? 15_000;
    const refreshMs = options.refreshMs ?? 600_000;
    const pollMs = options.pollMs ?? 5_000;
    const feedTimeoutMs = options.feedTimeoutMs ?? 3_000;
    const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
    if (!options.feed || typeof options.feed.snapshot !== 'function' || !options.controller
        || typeof options.installation !== 'string' || !INSTALLATION_ID.test(options.installation)
        || ![minIntervalMs, refreshMs, pollMs, feedTimeoutMs].every(positive)) {
      throw new Error('invalid-now-playing-publisher-options');
    }
    const timers = options.timers ?? systemTimers;
    this.#now = options.now ?? (() => performance.now());
    this.#loop = new EvaluationLoop(() => this.#evaluate(), timers);
    this.#reader = new BoundedReader(() => options.feed.snapshot(), feedTimeoutMs, timers);
    this.#writer = new InstallationWriter({
      controller: options.controller, installation: options.installation, minIntervalMs, refreshMs, pollMs, now: this.#now,
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
  }

  update(): Promise<void> {
    return this.#loop.update();
  }

  /** Resolves once no evaluation is running. */
  whenIdle(): Promise<void> {
    return this.#loop.whenIdle();
  }

  state(): NowPlayingPublisherState {
    const lastWrite = this.#writer.lastWrite;
    return structuredClone({
      installation: this.#writer.installation,
      ...(this.#view ? { view: this.#view } : {}),
      ...(lastWrite ? { lastWrite } : {}),
    });
  }

  async #evaluate(): Promise<number> {
    const current = await this.#reader.read();
    const now = this.#now();
    if (current) this.#lastGood = { snapshot: current, receivedAtMs: now };
    const last = this.#lastGood;
    // A snapshot without an age carries no playback, so its age never matters.
    const ageMs = last ? (last.snapshot.ageMs ?? 0) + Math.max(0, now - last.receivedAtMs) : 0;
    const view = nowPlayingView(last?.snapshot, { readOk: current !== undefined, ageMs });
    this.#view = view;
    return this.#writer.write(view.card ? nowPlayingFrame(view).rgb : undefined);
  }
}
