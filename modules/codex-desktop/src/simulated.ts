// A simulated Codex Desktop marker (Hub #926), for the module's tests, the scenario catalog and disposable runs: what it
// lists as unread, or that it is unusable, and a folder that stalls, so that reads wait until it answers again. It never
// touches a file.
import type {MarkerRead, MarkerTransport} from './transport.js';

/** What the simulated marker shows, as plain data. */
export type MarkerState = {
  /** The unread thread IDs it lists, or null while it is unusable. */
  unread: string[] | null;
  /** Whether reads wait until it answers again, as on a stalled mount. */
  stalled: boolean;
  /** How many reads it answered, and how many wait. */
  reads: number;
  waiting: number;
};

export class SimulatedMarker implements MarkerTransport {
  #unread: string[] | null = [];
  /** Changes with each new content, as the file's stamp would. */
  #version = 1;
  #stalled = false;
  #failNext = false;
  #reads = 0;
  readonly #waiting: (() => void)[] = [];

  /** Desktop lists these threads as unread. */
  list(sessions: readonly string[]): void {
    this.#unread = [...sessions];
    this.#version += 1;
  }

  /** The marker turns into something the module cannot use: missing, malformed or another format. */
  unusable(): void {
    this.#unread = null;
    this.#version += 1;
  }

  /** The folder stalls: every read waits until `answer`. */
  stall(): void {
    this.#stalled = true;
  }

  /** The folder answers again, and every read that waited gets the marker as it is now. */
  answer(): void {
    this.#stalled = false;
    for (const settle of this.#waiting.splice(0)) settle();
  }

  /** The next read fails, as when the reader's process ends. */
  failNext(): void {
    this.#failNext = true;
  }

  read(_home: string, stamp: string): Promise<MarkerRead> {
    if (this.#failNext) {
      this.#failNext = false;
      return Promise.reject(new Error('the simulated marker reader ended'));
    }
    const answer = (): MarkerRead => {
      this.#reads += 1;
      const version = String(this.#version);
      return version === stamp ? {status: 'unchanged'} : {status: 'read', stamp: version, unread: this.#unread === null ? null : [...this.#unread]};
    };
    if (!this.#stalled) return Promise.resolve(answer());
    return new Promise(resolve => { this.#waiting.push(() => { resolve(answer()); }); });
  }

  /** The simulated folder outlives the module, as a real one would. */
  close(): void {}

  state(): MarkerState {
    return {unread: this.#unread === null ? null : [...this.#unread], stalled: this.#stalled, reads: this.#reads, waiting: this.#waiting.length};
  }
}
