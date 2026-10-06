// The event-loop lag check (ADR 0012, failure isolation). A blocked event loop affects every module, so the process
// cannot contain it; the service manager restarts the whole runtime instead. The main thread counts a beat on a timer,
// and a worker thread, which keeps running while the main thread is stuck, kills the process with SIGKILL when the
// beats stop for `limitMs`. systemd's `Restart=on-failure` then starts the runtime again.
import {Worker} from 'node:worker_threads';

export const BEATS = 0;
export const STOP = 1;

export type Watchdog = {stop(): Promise<void>};

/** Starts the lag check. `failed` hears of a watchdog that broke, which leaves the runtime without the check. */
export function startWatchdog(limitMs: number, failed: (error: unknown) => void): Watchdog {
  const shared = new Int32Array(new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT));
  const intervalMs = Math.max(1, Math.min(1000, Math.floor(limitMs / 4)));
  // No resourceLimits: the thread allocates almost nothing after it starts, and a heap limit below what V8 needs to
  // start an isolate aborts the whole process. The thread costs about 15 MiB of resident memory (#123).
  const worker = new Worker(new URL('./watchdog-worker.js', import.meta.url), {workerData: {shared: shared.buffer, limitMs, intervalMs}});
  worker.on('error', failed);
  worker.unref();
  const beat = setInterval(() => { Atomics.add(shared, BEATS, 1); }, intervalMs);
  beat.unref();
  return {stop: async () => {
    clearInterval(beat);
    Atomics.store(shared, STOP, 1);
    Atomics.notify(shared, STOP);
    await worker.terminate();
  }};
}
