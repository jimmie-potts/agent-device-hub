// The event-loop lag check (ADR 0012, failure isolation). A blocked event loop affects every module, so the process
// cannot contain it; the service manager restarts the whole runtime instead. The main thread counts a beat on a timer,
// and a worker thread, which keeps running while the main thread is stuck, kills the process with SIGKILL when the
// beats stop for `limitMs`. systemd's `Restart=on-failure` then starts the runtime again.
import {Worker} from 'node:worker_threads';
import {BEATS, STOP} from './lag.js';
import {INSTANCE_ID} from './log.js';
import {runtimeResource, type Resource} from './record.js';

const WORKER = new URL('./watchdog-worker.js', import.meta.url);

export type Watchdog = {stop(): Promise<void>};
/** What the runtime hears of a watchdog that breaks: an error it threw, and its thread ending unasked. */
export type WatchdogEvents = {failed(error: unknown): void; stopped(exitCode: number): void};

/**
 * Starts the lag check. `worker` replaces the thread's file, for tests. `resource` is the runtime's, which the thread's
 * `runtime.stuck` record carries; it defaults to this process's instance in the `development` environment.
 */
export function startWatchdog(limitMs: number, events: WatchdogEvents, worker = WORKER, resource: Resource = runtimeResource('development', INSTANCE_ID)): Watchdog {
  const shared = new Int32Array(new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT));
  const intervalMs = Math.max(1, Math.min(1000, Math.floor(limitMs / 4)));
  // No resourceLimits: the thread allocates almost nothing after it starts, and a heap limit below what V8 needs to
  // start an isolate aborts the whole process. The thread costs about 13 MiB of resident memory (#123).
  const thread = new Worker(worker, {workerData: {shared: shared.buffer, limitMs, intervalMs, resource}});
  let stopping = false;
  thread.on('error', error => { events.failed(error); });
  // A thread that ends unasked leaves the runtime without a lag check, so the runtime must hear of it.
  thread.once('exit', code => { if (!stopping) events.stopped(code); });
  thread.unref();
  const beat = setInterval(() => { Atomics.add(shared, BEATS, 1); }, intervalMs);
  beat.unref();
  return {stop: async () => {
    stopping = true;
    clearInterval(beat);
    Atomics.store(shared, STOP, 1);
    Atomics.notify(shared, STOP);
    await thread.terminate();
  }};
}
