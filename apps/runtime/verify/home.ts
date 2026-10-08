// Hub #1015: the directly forked child reports one HOME value through its existing private IPC channel.
import {isAbsolute, normalize} from 'node:path';

export const HOME_REPORT = 'runtime.home';
export const MAX_HOME_BYTES = 4096;
const OBSERVATION_MS = 1000;
type HomeReport = {type: typeof HOME_REPORT; home: string};

/** A bounded canonical path, unchanged from the child's selected value; an unusable value supplies no evidence. */
function usable(home: unknown): home is string {
  return typeof home === 'string' && home.length > 0 && Buffer.byteLength(home) <= MAX_HOME_BYTES &&
    !/[\0\r\n]/.test(home) && isAbsolute(home) && normalize(home) === home;
}

/** Select only HOME; never serialize an environment object, even when the value is unusable. */
export function homeReport(home: string | undefined): HomeReport {
  return {type: HOME_REPORT, home: usable(home) ? home : ''};
}

/** HOME evidence belongs to one exact child object and generation, and never survives a new spawn. */
export class ChildHome {
  #child: object | undefined;
  #generation = 0;
  #value = '';
  #received: Promise<void> = Promise.resolve();
  #receive: () => void = () => {};

  get value(): string { return this.#value; }

  reset(child: object, generation: number): void {
    this.#receive();
    this.#child = child;
    this.#generation = generation;
    this.#value = '';
    this.#received = new Promise(resolve => { this.#receive = resolve; });
  }

  /** Consumes HOME reports, including invalid or stale ones; unrelated messages keep their existing owner. */
  hear(child: object, generation: number, message: unknown): boolean {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return false;
    const report = message as Record<string, unknown>;
    if (report.type !== HOME_REPORT) return false;
    if (child !== this.#child || generation !== this.#generation) return true;
    this.#value = Object.keys(report).length === 2 && Object.hasOwn(report, 'type') && Object.hasOwn(report, 'home') && usable(report.home) ? report.home : '';
    this.#receive();
    return true;
  }

  /** Stdout readiness and IPC can arrive in either order; a missing report remains missing after this bounded wait. */
  async settle(timeoutMs = OBSERVATION_MS): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.#received, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
    } finally {
      clearTimeout(timer);
    }
  }
}
