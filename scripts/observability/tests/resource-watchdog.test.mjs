import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessResources, startResourceWatchdog } from '../resource-watchdog.mjs';
const GiB = 1024 ** 3;
const good = () => ({ runDataBytes: 1000, cgroupMemoryBytes: GiB, hostAvailableMemoryBytes: 8 * GiB,
  minimumAvailableBytes: 3 * GiB, oomKilled: false });

test('resource assessment uses accepted hard caps and does not turn unknown measurements into zero', () => {
  assert.equal(assessResources(good()).ok, true);
  for (const [patch, reason] of [[{ runDataBytes: 2 * GiB + 1 }, 'run-data-cap'],
    [{ cgroupMemoryBytes: 4 * GiB + 1 }, 'stack-memory-cap'], [{ hostAvailableMemoryBytes: 8 * GiB - 1 }, 'host-reserve'],
    [{ minimumAvailableBytes: 0 }, 'storage-headroom'], [{ oomKilled: true }, 'oom'],
    [{ runDataBytes: undefined }, 'measurement-invalid']]) {
    assert.equal(assessResources({ ...good(), ...patch }).reason, reason);
  }
});

test('first verified sample gates readiness; cap breach saves projected evidence and stops once', async () => {
  let count = 0, stops = 0; const records = [];
  const watchdog = startResourceWatchdog({ intervalMs: 5, sampleTimeoutMs: 100,
    sample: async () => (++count === 1 ? good() : { ...good(), runDataBytes: 3 * GiB, raw: 'SYNTHETIC_SECRET' }),
    record: async value => records.push(value), stopOwned: async () => { stops++; return { confirmed: true }; } });
  assert.equal(await watchdog.ready, true);
  const result = await watchdog.done;
  assert.equal(result.reason, 'run-data-cap'); assert.equal(result.stopConfirmed, true); assert.equal(stops, 1);
  assert.equal(JSON.stringify(records).includes('SYNTHETIC_SECRET'), false);
  await watchdog.finish(); assert.equal(stops, 1);
});

test('missing samples and stalled sampling abort, remain unready and stop without retry', async () => {
  for (const sample of [async () => { throw new Error('SYNTHETIC_SECRET'); },
    async ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve(good()), { once: true }))]) {
    let stops = 0;
    const watchdog = startResourceWatchdog({ sample, sampleTimeoutMs: 20, intervalMs: 5,
      record: async () => {}, stopOwned: async () => { stops++; return { confirmed: true }; } });
    assert.equal(await watchdog.ready, false);
    const result = await watchdog.done;
    assert.equal(result.reason, 'sample-failed'); assert.equal(stops, 1);
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET'), false);
  }
});

test('evidence failure still attempts an owned stop and failed stop is never claimed confirmed', async () => {
  let stops = 0;
  const watchdog = startResourceWatchdog({ sample: async () => good(), record: async () => { throw new Error('disk full'); },
    stopOwned: async () => { stops++; throw new Error('daemon lost'); } });
  assert.equal(await watchdog.ready, false);
  const result = await watchdog.done;
  assert.equal(result.reason, 'evidence-failed'); assert.equal(result.stopConfirmed, false); assert.equal(stops, 1);
});

test('normal finish cancels sampling and does not stop the backend or mark missing evidence passed', async () => {
  let stops = 0;
  const watchdog = startResourceWatchdog({ sample: async () => good(), record: async () => {},
    stopOwned: async () => { stops++; }, intervalMs: 1000 });
  assert.equal(await watchdog.ready, true);
  const result = await watchdog.finish();
  assert.equal(result.status, 'finished'); assert.equal(stops, 0);
  assert.equal(result.sampleCount, 1);
});
