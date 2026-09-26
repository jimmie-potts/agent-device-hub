import type { Receipt } from '@jimmie-potts/device-contracts';
import { EvaluationLoop, BoundedReader, systemTimers, type PublisherTimers } from '@jimmie-potts/agent-status';
import type { DisplayRequest, TidbytController } from './controller.js';
import { FRAME_ENCODING } from './render.js';

/**
 * Display-specific write policy for one Tidbyt installation. The generic feed-cadence
 * machinery (`EvaluationLoop`, `BoundedReader`) moved to `@jimmie-potts/agent-status` in
 * hub #20, since the LIFX status publisher needs the same evaluation cadence; re-exported
 * here so existing imports of this module keep working unchanged.
 */
export { EvaluationLoop, BoundedReader, systemTimers, type PublisherTimers };

export type InstallationState = 'present' | 'absent' | 'unknown';

export type InstallationWriterOptions = {
  /** The designated writer for this Tidbyt. The writer submits nothing elsewhere. */
  controller: TidbytController;
  /** An additional installation the controller's connection lists; omitted, the default one. */
  installation?: string;
  minIntervalMs: number;
  refreshMs: number;
  pollMs: number;
  /** Monotonic milliseconds. */
  now: () => number;
};

/**
 * Keeps one installation showing the latest frame: push on change at most every
 * `minIntervalMs`, push an unchanged frame again after `refreshMs`, and remove the
 * installation when there is nothing to show. Failed writes are never replayed.
 */
export class InstallationWriter {
  readonly #controller: TidbytController;
  readonly #target: { installation: string } | Record<string, never>;
  readonly #minIntervalMs: number;
  readonly #refreshMs: number;
  readonly #pollMs: number;
  readonly #now: () => number;
  /** The last frame the cloud accepted, and when that push was submitted. */
  #sent?: { rgb: Uint8Array; atMs: number };
  #lastWriteAtMs?: number;
  #lastWrite?: Receipt;
  /** Consecutive writes not confirmed sent; each after the first doubles the wait before the next. */
  #failures = 0;
  #installation: InstallationState = 'unknown';

  constructor(options: InstallationWriterOptions) {
    this.#controller = options.controller;
    this.#target = options.installation === undefined ? {} : { installation: options.installation };
    this.#minIntervalMs = options.minIntervalMs;
    this.#refreshMs = options.refreshMs;
    this.#pollMs = options.pollMs;
    this.#now = options.now;
  }

  get installation(): InstallationState { return this.#installation; }
  get lastWrite(): Receipt | undefined { return this.#lastWrite; }

  /** Show `rgb`, or remove the installation when it is undefined. Returns the delay before the next evaluation. */
  async write(rgb: Uint8Array | undefined): Promise<number> {
    const now = this.#now();
    let command: DisplayRequest['command'] | undefined;
    if (rgb) {
      const unchanged = this.#sent !== undefined && Buffer.from(this.#sent.rgb).equals(rgb);
      if (!unchanged || now - this.#sent!.atMs >= this.#refreshMs) {
        command = { kind: 'tidbyt.display', frame: { width: 64, height: 32, encoding: FRAME_ENCODING, data: Buffer.from(rgb).toString('base64') }, ...this.#target };
      }
    } else if (this.#installation !== 'absent') {
      command = { kind: 'tidbyt.remove', ...this.#target };
    }
    const refreshDue = this.#sent && rgb ? Math.max(1, this.#sent.atMs + this.#refreshMs - now) : this.#pollMs;
    if (!command) return Math.min(this.#pollMs, refreshDue);
    const wait = this.#lastWriteAtMs === undefined ? 0 : this.#lastWriteAtMs + this.#backoffMs() - now;
    if (wait > 0) return wait;
    this.#lastWriteAtMs = now;
    const holds = this.#controller.snapshot().display.holds;
    if (command.kind === 'tidbyt.remove' && this.#installation === 'unknown' && !holds.authentication && holds.rateLimitRemainingMs === 0) {
      // Read the installation list first, so an installation that is already gone is not deleted again.
      const listing = await this.#controller.refresh(command.installation);
      if (listing?.ok && !listing.present) {
        this.#installation = 'absent';
        this.#failures = 0;
        return this.#pollMs;
      }
    }
    const receipt = await this.#submit(command);
    if (receipt) this.#record(command, receipt, rgb, now);
    else this.#failures += 1;
    return receipt?.outcome === 'sent' ? Math.min(this.#pollMs, refreshDue) : this.#backoffMs();
  }

  /** The minimum interval, doubled for each consecutive write not confirmed sent after the first, up to the refresh period. */
  #backoffMs(): number {
    const doublings = Math.min(Math.max(0, this.#failures - 1), 16);
    return Math.min(this.#minIntervalMs * 2 ** doublings, Math.max(this.#minIntervalMs, this.#refreshMs));
  }

  /** Submit a fresh request built from the controller's current identities. Never resubmits an earlier one. */
  async #submit(command: DisplayRequest['command']): Promise<Receipt | undefined> {
    const snapshot = this.#controller.snapshot().controller;
    const request: DisplayRequest = {
      apiVersion: '1.0', controllerId: snapshot.identity.controllerId, deviceId: snapshot.identity.deviceId,
      requestId: snapshot.nextRequestId, expectedConfigurationRevision: snapshot.configurationRevision,
      expectedGeneration: snapshot.generation, command,
    };
    const submission = this.#controller.submit(request);
    return 'done' in submission ? submission.done : undefined;
  }

  #record(command: DisplayRequest['command'], receipt: Receipt, rgb: Uint8Array | undefined, atMs: number): void {
    this.#lastWrite = receipt;
    this.#failures = receipt.outcome === 'sent' ? 0 : this.#failures + 1;
    if (receipt.outcome === 'sent') {
      if (command.kind === 'tidbyt.display') {
        this.#sent = { rgb: rgb!, atMs };
        this.#installation = 'present';
      } else {
        this.#sent = undefined;
        this.#installation = 'absent';
      }
    } else if (receipt.outcome === 'uncertain') {
      this.#sent = undefined;
      this.#installation = 'unknown';
    } else if (command.kind === 'tidbyt.remove') {
      // The installation may already be gone; the next attempt reads the list before deleting again.
      this.#installation = 'unknown';
    }
  }
}
