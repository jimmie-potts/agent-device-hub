import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBoundedSink } from '../bounded-sink.mjs';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const accounted = queue => {
  const c = queue.counts();
  assert.equal(c.attempted, c.exported + c.failed + c.dropped + c.queued);
  assert.equal(c.accepted + c.rejected, c.attempted);
};

test('sink runs asynchronously, preserves order and charges the in-flight item to both bounds', async () => {
  const gate = deferred(), seen = [];
  const queue = createBoundedSink(async line => { seen.push(line); if (line === 'one') await gate.promise; }, { maxRecords: 2, maxBytes: 6 });
  assert.equal(queue.push('one'), true); assert.equal(queue.push('two'), true);
  assert.deepEqual(seen, []);
  await tick();
  assert.deepEqual(seen, ['one']);
  assert.equal(queue.push('x'), false);
  assert.equal(queue.counts().queued, 2); assert.equal(queue.counts().bytes, 6); accounted(queue);
  gate.resolve(); await queue.close();
  assert.deepEqual(seen, ['one', 'two']);
  assert.equal(queue.counts().exported, 2); assert.equal(queue.counts().dropped, 1); accounted(queue);
});

test('default record and byte ceilings drop newest and UTF-8 bytes determine capacity', async () => {
  const queue = createBoundedSink(() => new Promise(() => {}), { flushMs: 5 });
  for (let i = 0; i < 512; i++) assert.equal(queue.push('x'.repeat(8192)), true);
  assert.equal(queue.counts().bytes, 4 * 1024 * 1024);
  assert.equal(queue.push('x'), false);
  await queue.close(); accounted(queue);
  const records = createBoundedSink(() => new Promise(() => {}), { flushMs: 5 });
  for (let i = 0; i < 1024; i++) assert.equal(records.push('x'), true);
  assert.equal(records.push('x'), false); await records.close(); accounted(records);
  const bytes = createBoundedSink(() => {}, { maxBytes: 3 });
  assert.equal(bytes.push('é'), true); assert.equal(bytes.push('é'), false);
  assert.equal(bytes.push('x'.repeat(8193)), false); assert.equal(bytes.push({ secret: 'SYNTHETIC_SECRET' }), false);
  await bytes.close(); accounted(bytes);
});

test('sink failures are counted once without retries and later items still drain', async () => {
  const seen = [];
  const queue = createBoundedSink(line => {
    seen.push(line);
    if (line === 'throws') throw Error('SYNTHETIC_SECRET');
    if (line === 'rejects') return Promise.reject(Error('SYNTHETIC_SECRET'));
  });
  queue.push('throws'); queue.push('rejects'); queue.push('works');
  await queue.close();
  assert.deepEqual(seen, ['throws', 'rejects', 'works']);
  assert.equal(queue.counts().failed, 2); assert.equal(queue.counts().exported, 1);
  assert.equal(JSON.stringify(queue.counts()).includes('SYNTHETIC_SECRET'), false); accounted(queue);
});

test('shutdown aborts a stalled sink, accounts abandoned work and ignores late settlement', async () => {
  const gate = deferred(); let signal;
  const queue = createBoundedSink((_line, value) => { signal = value; return gate.promise; }, { flushMs: 10 });
  queue.push('active'); queue.push('waiting'); await tick();
  const closing = queue.close(); assert.equal(queue.close(), closing);
  assert.equal(queue.push('late'), false);
  await closing;
  assert.equal(signal.aborted, true);
  assert.equal(queue.counts().queued, 0); assert.equal(queue.counts().bytes, 0);
  assert.equal(queue.counts().dropped, 3); accounted(queue);
  const settled = queue.counts(); gate.reject(Error('SYNTHETIC_SECRET')); await tick();
  assert.deepEqual(queue.counts(), settled);
});

test('configuration cannot raise owner-approved ceilings or create zero/invalid limits', () => {
  for (const options of [{ maxRecords: 1025 }, { maxBytes: 4194305 }, { flushMs: 1001 },
    { maxRecords: 0 }, { maxBytes: NaN }, { flushMs: -1 }, { maxRecords: 1.5 }]) {
    assert.throws(() => createBoundedSink(() => {}, options), /limit/);
  }
});

test('nonclosing flush is bounded, coalesces waiters and leaves later export enabled', async () => {
  const gate = deferred(); let first = true;
  const queue = createBoundedSink(() => { if (first) { first = false; return gate.promise; } }, { flushMs: 10 });
  queue.push('first');
  const flushing = queue.flush(); assert.equal(queue.flush(), flushing);
  assert.equal(await flushing, false, 'a timeout is not successful flush');
  assert.equal(queue.counts().queued, 1);
  gate.resolve(); await tick();
  assert.equal(queue.push('second'), true);
  assert.equal(await queue.flush(), true);
  await queue.close(); accounted(queue);
});
