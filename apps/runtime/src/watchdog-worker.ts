// The watchdog's thread. It sleeps on shared memory, never on its own event loop, and checks that the main thread's
// beats keep coming. When they have stopped for the limit, it writes one fatal record and kills the process.
import {writeSync} from 'node:fs';
import {workerData} from 'node:worker_threads';
import {BEATS, STOP, observe, type LagState} from './lag.js';
import {ENVIRONMENTS, RUNTIME_SCOPE, record, runtimeResource, type Resource} from './record.js';

// A duration attribute's registered bound: one day.
const MAX_MS = 86_400_000;

/** The runtime's resource, which the main thread passes, so the record names the same process and environment. */
function resourceOf(value: unknown): Resource | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const environment: unknown = 'deployment.environment.name' in value ? value['deployment.environment.name'] : undefined;
  const instance: unknown = 'service.instance.id' in value ? value['service.instance.id'] : undefined;
  const known = ENVIRONMENTS.find(name => name === environment);
  return known === undefined || typeof instance !== 'string' ? undefined : runtimeResource(known, instance);
}

const data: unknown = workerData;
if (typeof data !== 'object' || data === null || !('shared' in data) || !(data.shared instanceof SharedArrayBuffer)
  || !('limitMs' in data) || typeof data.limitMs !== 'number' || !('intervalMs' in data) || typeof data.intervalMs !== 'number'
  || !('resource' in data)) {
  throw new TypeError('the watchdog needs shared memory, a limit, an interval and the runtime\'s resource');
}
const resource = resourceOf(data.resource);
if (resource === undefined) throw new TypeError('the runtime\'s resource names no known environment or instance');
const view = new Int32Array(data.shared);
const {limitMs, intervalMs} = data;
const state: LagState = {seen: Atomics.load(view, BEATS), since: performance.now()};
while (Atomics.load(view, STOP) === 0) {
  const before = performance.now();
  Atomics.wait(view, STOP, 0, intervalMs);
  const now = performance.now();
  const lagMs = observe(state, Atomics.load(view, BEATS), now, now - before, intervalMs);
  if (lagMs >= limitMs && Atomics.load(view, STOP) === 0) {
    const attributes = {'bunny.lag.limit_ms': Math.min(limitMs, MAX_MS), 'bunny.lag.duration_ms': Math.min(Math.round(lagMs), MAX_MS)};
    const stuck = record('fatal', RUNTIME_SCOPE, 'runtime.stuck', attributes, Date.now(), resource);
    try {
      if (stuck !== undefined) writeSync(2, `${JSON.stringify(stuck)}\n`);
    } catch {
      // A closed stderr loses the record; the kill still restarts the runtime.
    }
    process.kill(process.pid, 'SIGKILL');
  }
}
