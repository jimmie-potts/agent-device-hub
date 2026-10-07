// Hub #920: the run adapter's disconnect keeps the catalog's Harness contract. The runtime's edge ends the part's stream,
// and the same remote part reconnects; its timers wait for the next wait, as the in-memory harness's wait for virtual
// time to move, so the part stays away however long the steps in between take.
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {test} from 'node:test';
import {scenario} from '../../tests/scenarios/catalog.js';
import {connectRun} from '../adapter.js';
import {base, startRun} from './support.js';

void test('a dropped part stays away until the next wait, then the same part reconnects and resyncs', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  const reader = h.sdk('reader');
  assert.equal(h.reader.syncs('session'), 1);

  await h.disconnect('reader');
  await sleep(500);
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session')], [0, 1], 'it is still away after real time passed');
  for (let waited = 0; h.reader.syncs('session') < 2 && waited < 50; waited += 1) await h.wait(100);
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')], [1, 2, 2], 'it reconnected and synced each copy again');
  assert.equal(h.sdk('reader'), reader, 'the same remote part');
  assert.deepEqual(h.problems(), []);
});
