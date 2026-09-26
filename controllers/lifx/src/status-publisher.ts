import { validateSnapshot, type Snapshot } from '@jimmie-potts/agent-state';
import type { Mode, Receipt } from '@jimmie-potts/device-contracts';
import {
  BoundedReader, EvaluationLoop, highestStatus, STATUS_COLORS, systemTimers,
  type AgentState, type Feed, type HighestStatus, type PublisherTimers,
} from '@jimmie-potts/agent-status';
import { LifxController, type PaintHsbk } from './controller.js';

/**
 * Paints one bulb's shown key: the full status while in Work, only attention while in
 * Quiet (everything else collapses to `none`, which paints nothing), and never while
 * in Free. `idle` is warm white; `none` means "nothing to paint, leave the bulb alone".
 */
type PaintKey = AgentState | 'idle' | 'none';

const int = (value: unknown, lo: number, hi: number): value is number =>
  Number.isInteger(value) && Number(value) >= lo && Number(value) <= hi;

/** Standard RGB-to-HSV hue/saturation, ignoring value: brightness comes from the cap. */
function rgbToHueSat([r, g, b]: readonly [number, number, number]): { hue: number; saturation: number } {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue: Math.round(hue), saturation: Math.round(max === 0 ? 0 : (delta / max) * 100) };
}

/** Idle is warm white 2700 K at zero saturation. Every other key uses the shared status color. */
function colorFor(key: Exclude<PaintKey, 'none'>, capPercent: number): PaintHsbk {
  const brightness = Math.round((capPercent * 65535) / 100);
  if (key === 'idle') return { hue: 0, saturation: 0, brightness, kelvin: 2700 };
  const { hue, saturation } = rgbToHueSat(STATUS_COLORS[key]);
  return { hue: Math.round((hue * 65535) / 360), saturation: Math.round((saturation * 65535) / 100), brightness, kelvin: 3500 };
}

export type LifxStatusBulbConfig = {
  deviceId: string;
  /** Integer percent 1-100. Default 50. */
  brightnessCapPercent?: number;
  /** Integer percent 1-100. Used only for the one thing Quiet paints: attention. Default 20. */
  quietCapPercent?: number;
};

export type LifxStatusPublisherOptions = {
  feed: Feed<Snapshot>;
  controller: LifxController;
  bulbs: LifxStatusBulbConfig[];
  acknowledgingConsumers?: readonly string[];
  /** Re-read the feed this often without a mode-change notice. Default 30 s. */
  pollMs?: number;
  /** A feed read slower than this counts as unavailable. Default 3 s. */
  feedTimeoutMs?: number;
  now?: () => number;
  timers?: PublisherTimers;
};

type BulbState = { brightness: number; quiet: number; key?: PaintKey; lastReceipt?: Receipt; unsubscribe: () => void };

/**
 * Paints one shared agent-state owner's status to every configured qualified LIFX bulb,
 * through the controller's internal `paintStatus`. Painting never changes power. A paint
 * is sent only on a shown-state transition (never on a heartbeat, an unchanged snapshot,
 * a repeated read or a timer), and only while the bulb's mode is Work or Quiet. A failed
 * paint is not replayed: the next transition is a fresh request for the current state,
 * because the "last shown" key advances to the attempted target regardless of outcome.
 */
export class LifxStatusPublisher {
  readonly #controller: LifxController;
  readonly #reader: BoundedReader<Snapshot>;
  readonly #loop: EvaluationLoop;
  readonly #consumers?: readonly string[];
  readonly #bulbs = new Map<string, BulbState>();
  readonly #pollMs: number;
  #lastGood?: Snapshot;
  #started = false;

  constructor(options: LifxStatusPublisherOptions) {
    const pollMs = options.pollMs ?? 30_000;
    const feedTimeoutMs = options.feedTimeoutMs ?? 3_000;
    if (!options.feed || typeof options.feed.snapshot !== 'function' || !(options.controller instanceof LifxController)
        || !Array.isArray(options.bulbs) || !int(pollMs, 1, Number.MAX_SAFE_INTEGER) || !int(feedTimeoutMs, 1, Number.MAX_SAFE_INTEGER)
        || (options.acknowledgingConsumers !== undefined && !Array.isArray(options.acknowledgingConsumers))) {
      throw new Error('invalid-lifx-status-options');
    }
    this.#pollMs = pollMs;
    this.#controller = options.controller;
    this.#consumers = options.acknowledgingConsumers ? [...options.acknowledgingConsumers] : undefined;
    const timers = options.timers ?? systemTimers;
    this.#reader = new BoundedReader(() => options.feed.snapshot(), feedTimeoutMs, timers);
    this.#loop = new EvaluationLoop(() => this.#evaluate(), timers);
    for (const bulb of options.bulbs) {
      const brightness = bulb.brightnessCapPercent ?? 50;
      const quiet = bulb.quietCapPercent ?? 20;
      if (typeof bulb.deviceId !== 'string' || !int(brightness, 1, 100) || !int(quiet, 1, 100)) {
        throw new Error('invalid-lifx-status-options');
      }
      // Entering Work or Quiet, or a fresh construction reading either mode, must paint the
      // current state once even if it matches an earlier attempt from before the change.
      const unsubscribe = this.#controller.onModeChange(bulb.deviceId, () => {
        const state = this.#bulbs.get(bulb.deviceId);
        if (state) state.key = undefined;
        void this.update();
      });
      this.#bulbs.set(bulb.deviceId, { brightness, quiet, unsubscribe });
    }
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    void this.update();
  }

  stop(): void {
    this.#loop.stop();
    for (const state of this.#bulbs.values()) state.unsubscribe();
  }

  /** Request an evaluation. Requests made while one runs coalesce into a single rerun. */
  update(): Promise<void> {
    return this.#loop.update();
  }

  /** Resolves once no evaluation is running. */
  whenIdle(): Promise<void> {
    return this.#loop.whenIdle();
  }

  /** Diagnostic snapshot: each configured bulb's last shown key and last paint receipt. */
  state(): Record<string, { key?: PaintKey; lastReceipt?: Receipt }> {
    return Object.fromEntries([...this.#bulbs].map(([deviceId, s]) => [
      deviceId, { ...(s.key !== undefined ? { key: s.key } : {}), ...(s.lastReceipt ? { lastReceipt: structuredClone(s.lastReceipt) } : {}) },
    ]));
  }

  async #evaluate(): Promise<number> {
    const value = await this.#reader.read();
    const valid = value === undefined ? undefined : validateSnapshot(value);
    const current = valid?.ok ? valid.value : undefined;
    if (current) this.#lastGood = current;
    const status = highestStatus(current ?? this.#lastGood, { feedAvailable: current !== undefined, acknowledgingConsumers: this.#consumers });
    for (const [deviceId, state] of this.#bulbs) this.#paintOne(deviceId, state, status);
    return this.#pollMs;
  }

  #mode(deviceId: string): Mode | undefined {
    try {
      const desired = this.#controller.snapshot(deviceId).controller.state.desired.mode;
      return desired.status === 'known' ? desired.value as Mode : 'Free';
    } catch {
      return undefined; // Unknown device: nothing to paint.
    }
  }

  #paintOne(deviceId: string, state: BulbState, status: HighestStatus): void {
    const mode = this.#mode(deviceId);
    if (mode === undefined || mode === 'Free' || status === 'unknown') return;
    const target: PaintKey = mode === 'Quiet' ? (status === 'attention' ? 'attention' : 'none') : status;
    if (target === state.key) return;
    state.key = target;
    if (target === 'none') return;
    const cap = mode === 'Quiet' ? state.quiet : state.brightness;
    const submission = this.#controller.paintStatus(deviceId, colorFor(target, cap));
    if ('done' in submission) void submission.done.then(receipt => { state.lastReceipt = receipt; }).catch(() => {});
  }
}
