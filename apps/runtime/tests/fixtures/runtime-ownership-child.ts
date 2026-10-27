// Synthetic lifetime exercise: this child stays alive after host.stop, including late callbacks.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {BunnyModule} from '@jimmie-potts/sdk';
import {bindCoreRuntimeOwnership, createCoreModule} from '../../src/core/core.js';
import {acquireRuntimeOwnership} from '../../src/runtime-ownership.js';
import {startRuntime} from '../../src/runtime.js';

const [root, mode] = process.argv.slice(2);
if (root === undefined || mode === undefined) throw new Error('fixture-arguments');
const continuing = new Promise<void>(resolve => process.once('message', () => resolve()));
let timerStarted = false;
const late = async (): Promise<void> => {
  timerStarted = true;
  await continuing;
  await writeFile(join(root, 'late-effect'), 'synthetic');
  process.send?.('late-finished');
};
const extra: BunnyModule = {
  manifest: {name: 'late', apiVersion: '1.3'},
  start: context => {
    if (mode === 'late-start') return late();
    if (mode === 'timer') context.scheduler.after(0, late);
    return undefined;
  },
  stop: () => mode === 'late-stop' ? late() : undefined,
};
const core = createCoreModule(mode === 'core-failure' ? {parts: [{open: () => {throw new Error('synthetic-core-failure');}}]} : {});
const owner = await acquireRuntimeOwnership(root);
bindCoreRuntimeOwnership(core, owner);
assert.throws(() => owner.releaseBeforeStartup());
const options = {stateDir: root, port: 0, modules: [core, extra], log: () => {}, startTimeoutMs: 300, stopTimeoutMs: 30};
const starting = startRuntime(options);
if (mode === 'concurrent') await assert.rejects(startRuntime(options));
const runtime = await starting;
const response = await fetch(`${runtime.url}/api/runtime/v1/health`);
const report = await response.json() as {modules: {name: string; state: string}[]};
assert.equal(report.modules.find(module => module.name === 'core')?.state, mode === 'core-failure' ? 'failed' : 'running');
if (mode === 'timer') {
  for (let i = 0; !timerStarted && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(timerStarted, true);
}
await runtime.stop();
await assert.rejects(startRuntime(options));
for (let i = 0; i < 10; i++) {global.gc?.(); await new Promise(resolve => setTimeout(resolve, 1));}
process.send?.('stopped');
setInterval(() => {}, 1000);
