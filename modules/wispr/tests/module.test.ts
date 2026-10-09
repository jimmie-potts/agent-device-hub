import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {test} from 'node:test';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createWisprModule} from '../src/module.js';
import {ANALYTICS_SCHEMA} from '../src/content.js';
import {addLanguage, world} from './support.js';

void test('hosted module starts lazily without stores, reads bounded content and releases its worker', async t => {
  const fixture = await world(t); const module = createWisprModule();
  const bus = new InProcessBus();
  const harness = new ModuleHarness(module, {bus, stateDir: fixture.directory, section: fixture.config, clock: {now: fixture.now}});
  t.after(() => harness.stop());
  const before = await readdir(fixture.directory); await harness.start();
  assert.equal(harness.runningWorkers(), 0); assert.equal(harness.databaseOpen(), false); assert.equal(harness.pendingTimers(), 0);
  assert.deepEqual(harness.sent, []); assert.deepEqual(await readdir(fixture.directory), before);
  assert.equal(module.browserExposed(), false);
  const result = await module.read('summary'); assert.ok(!('error' in result)); assert.equal(result.type, 'application/json');
  const document = JSON.parse(Buffer.from(result.bytes).toString()) as {schema: string; apiVersion?: string; data: {totals: {words: number}}};
  assert.equal(document.schema, ANALYTICS_SCHEMA); assert.equal(document.apiVersion, undefined); assert.equal(document.data.totals.words, 120);
  assert.equal(harness.runningWorkers(), 1); assert.equal(harness.databaseOpen(), false); assert.deepEqual(harness.sent, []);
  assert.deepEqual(await readdir(fixture.directory), before);
  const invalid = await module.read('summary', 'app=private-canary'); assert.ok('error' in invalid); assert.equal(invalid.error.code, 'invalid-request');
  assert.equal(JSON.stringify(invalid).includes('canary'), false);
  module.privacy(true, false); assert.equal(module.browserExposed(), true);
  const aborted = new AbortController(); aborted.abort(); const cancelled = await module.read('summary', '', aborted.signal);
  assert.ok('error' in cancelled); assert.equal(cancelled.error.code, 'cancelled');
  await harness.stop(); assert.equal(harness.runningWorkers(), 0); assert.deepEqual(harness.failures, []);
  const stopped = await module.read('summary'); assert.ok('error' in stopped); assert.equal(stopped.error.code, 'unavailable');
});

void test('delivery guard rejects resolved language bytes after sharing or browser exposure is disabled', async t => {
  const fixture = await world(t, true);
  addLanguage(fixture.snapshot); await fixture.publish(fixture.snapshot, true);
  const module = createWisprModule();
  const harness = new ModuleHarness(module, {bus: new InProcessBus(), stateDir: fixture.directory,
    section: {...fixture.config, exposeToDashboard: true}, clock: {now: fixture.now}});
  t.after(() => harness.stop()); await harness.start();
  const canDeliver = module.deliveryGuard();
  const result = await module.read('language', 'period=today&corpus=cleaned');
  assert.ok(!('error' in result)); assert.match(Buffer.from(result.bytes).toString(), /SUM/);
  assert.equal(canDeliver(), true);
  module.privacy(true, false);
  assert.equal(module.browserExposed(), true); assert.equal(canDeliver(), false);
  const afterOptOut = module.deliveryGuard(); assert.equal(afterOptOut(), true);
  module.privacy(false, false);
  assert.equal(module.browserExposed(), false); assert.equal(afterOptOut(), false);
  module.privacy(true, true); assert.equal(canDeliver(), false); assert.equal(afterOptOut(), false);
  assert.deepEqual(harness.sent, []);
});

void test('unavailable and stopped delivery guards never revive when a replacement reader starts', async t => {
  const fixture = await world(t); const module = createWisprModule(); const bus = new InProcessBus();
  const beforeStart = module.deliveryGuard(); assert.equal(beforeStart(), false);
  const first = new ModuleHarness(module, {bus, stateDir: fixture.directory, section: fixture.config, clock: {now: fixture.now}});
  t.after(() => first.stop()); await first.start();
  const original = module.deliveryGuard(); assert.equal(original(), true); assert.equal(beforeStart(), false);
  const stopping = first.stop(); assert.equal(original(), false); await stopping;
  const betweenStarts = module.deliveryGuard(); assert.equal(betweenStarts(), false);
  const replacement = new ModuleHarness(module, {bus, stateDir: fixture.directory, section: fixture.config, clock: {now: fixture.now}});
  t.after(() => replacement.stop()); await replacement.start();
  assert.equal(module.deliveryGuard()(), true);
  assert.equal(original(), false); assert.equal(beforeStart(), false); assert.equal(betweenStarts(), false);
  assert.equal(replacement.runningWorkers(), 0); assert.deepEqual(replacement.sent, []);
});

void test('delivery guard rejects lifetime cancellation before the reader is stopped', async t => {
  const fixture = await world(t); const module = createWisprModule(); const lifetime = new AbortController();
  const start = module.start.bind(module);
  module.start = context => start({...context, signal: lifetime.signal});
  const harness = new ModuleHarness(module, {bus: new InProcessBus(), stateDir: fixture.directory,
    section: fixture.config, clock: {now: fixture.now}});
  t.after(() => harness.stop()); await harness.start();
  const canDeliver = module.deliveryGuard(); assert.equal(canDeliver(), true);
  lifetime.abort();
  assert.equal(canDeliver(), false); assert.equal(module.deliveryGuard()(), false);
  assert.equal(harness.runningWorkers(), 0); assert.deepEqual(harness.sent, []);
});
