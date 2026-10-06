// The watchdog's thread. It sleeps on shared memory, never on its own event loop, and checks that the main thread's
// beats keep coming. When they have stopped for the limit, it writes one fatal record and kills the process.
import {writeSync} from 'node:fs';
import {workerData} from 'node:worker_threads';
import {record} from './record.js';
import {BEATS, STOP} from './watchdog.js';

const data: unknown = workerData;
if (typeof data !== 'object' || data === null || !('shared' in data) || !(data.shared instanceof SharedArrayBuffer)
  || !('limitMs' in data) || typeof data.limitMs !== 'number' || !('intervalMs' in data) || typeof data.intervalMs !== 'number') {
  throw new TypeError('the watchdog needs shared memory, a limit and an interval');
}
const view = new Int32Array(data.shared);
const {limitMs, intervalMs} = data;
let seen = Atomics.load(view, BEATS);
let since = performance.now();
while (Atomics.load(view, STOP) === 0) {
  Atomics.wait(view, STOP, 0, intervalMs);
  const beats = Atomics.load(view, BEATS);
  const now = performance.now();
  if (beats !== seen) {
    seen = beats;
    since = now;
  } else if (now - since >= limitMs && Atomics.load(view, STOP) === 0) {
    const attributes = {'bunny.lag.limit_ms': limitMs, 'bunny.lag.ms': Math.round(now - since)};
    writeSync(2, `${JSON.stringify(record('fatal', 'bunny.runtime', 'runtime.stuck', attributes, Date.now()))}\n`);
    process.kill(process.pid, 'SIGKILL');
  }
}
