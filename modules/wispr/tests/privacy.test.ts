import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import type {Worker} from 'node:worker_threads';
import {configureWispr} from '../src/configuration.js';
import {createWispr, MAX_PENDING_READS, READ_TIMEOUT_MS} from '../src/wispr.js';

class ControlledWorker extends EventEmitter {
  requestId = 0;
  postMessage(message: {id?: number}): void { if (message.id !== undefined) this.requestId = message.id; }
  terminate(): Promise<number> { this.emit('exit', 0); return Promise.resolve(0); }
  answer(): void { this.emit('message', {id: this.requestId, response: {status: 200, body: '{"data":{"language":["PRIVATE_TEXT_CANARY"]}}'}}); }
}

void test('bounded admission refuses excess reads and the deadline retires the worker', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const configured = configureWispr({sourceId: 'dictation', aggregatePath: '/synthetic/aggregate.json', diagnosticsPath: '/synthetic/status.json'});
  assert.ok(!('error' in configured));
  const worker = new ControlledWorker(); const reader = createWispr(configured.config, Date.now, () => worker as unknown as Worker);
  try {
    const pending = Array.from({length: MAX_PENDING_READS}, () => assert.rejects(reader.request('summary', ''), {code: 'wispr-unavailable'}));
    assert.equal(reader.pending(), MAX_PENDING_READS);
    assert.throws(() => reader.request('summary', ''), {code: 'capacity'});
    t.mock.timers.tick(READ_TIMEOUT_MS);
    await Promise.all(pending); assert.equal(reader.pending(), 0);
  } finally { await reader.close(); }
});

void test('sharing opt-out fences a resolved worker reply before the caller receives it', async () => {
  const configured = configureWispr({sourceId: 'dictation', aggregatePath: '/synthetic/aggregate.json', diagnosticsPath: '/synthetic/status.json', shareTextAggregates: true});
  assert.ok(!('error' in configured));
  const worker = new ControlledWorker();
  const reader = createWispr(configured.config, Date.now, () => worker as unknown as Worker);
  try {
    const pending = reader.request('language', 'period=today');
    worker.answer(); // The promise was resolved; it is no longer in the pending map.
    reader.privacy(true, false);
    await assert.rejects(pending, {code: 'wispr-unavailable'});
    assert.equal(reader.config.shareTextAggregates, false);
  } finally { await reader.close(); }
});

for (const change of ['abort', 'stop', 'generation', 'pending-opt-out'] as const) {
  void test(`${change} discards an outstanding reply and releases the pending request`, async () => {
    const configured = configureWispr({sourceId: 'dictation', aggregatePath: '/synthetic/aggregate.json', diagnosticsPath: '/synthetic/status.json'});
    assert.ok(!('error' in configured));
    const worker = new ControlledWorker(); const cancellation = new AbortController();
    const reader = createWispr(configured.config, Date.now, () => worker as unknown as Worker);
    try {
      worker.emit('message', {kind: 'fence', fence: {namespace: 'n', generation: 'a', revision: 1}});
      const pending = reader.request('summary', '', cancellation.signal);
      worker.emit('message', {kind: 'fence', fence: {namespace: 'n', generation: 'a', revision: 1}});
      if (change !== 'pending-opt-out') worker.answer();
      if (change === 'abort') cancellation.abort();
      else if (change === 'stop') await reader.close();
      else if (change === 'generation') worker.emit('message', {kind: 'fence', fence: {namespace: 'n', generation: 'b', revision: 2}});
      else reader.privacy(false, false);
      await assert.rejects(pending, {code: change === 'abort' ? 'cancelled' : 'wispr-unavailable'});
      assert.equal(reader.pending(), 0);
    } finally { await reader.close(); }
  });
}
