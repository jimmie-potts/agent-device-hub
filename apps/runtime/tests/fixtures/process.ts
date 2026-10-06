// A runtime process with in-test fixture modules, run as `node process.js <scenario> <runtime arguments>`. It goes
// through the same entry point as the shipped runtime, with these modules instead of the shipped list.
import type {BunnyModule} from '@jimmie-potts/sdk';
import {runMain} from '../../src/index.js';

const module = (name: string, start: BunnyModule['start']): BunnyModule => ({manifest: {name, apiVersion: '1.0'}, start, stop: () => {}});
const steady = module('steady', async ({sdk}) => { await sdk.respond('bunny.cmd.mode.steady', () => ({status: 'accepted'})); });
/** Keeps the event loop busy for `ms`, and returns how often it looked at the clock. */
const spin = (ms: number): number => {
  const until = performance.now() + ms;
  let spins = 0;
  while (performance.now() < until) spins += 1;
  return spins;
};

const scenarios: Record<string, readonly BunnyModule[]> = {
  // Errors raised in each module's own flow, outside every SDK handler and runtime timer, reach the process.
  escaping: [
    module('thrower', () => { setTimeout(() => { throw new Error('thrown from a timer'); }, 10); }),
    module('rejecter', () => { setTimeout(() => { void Promise.reject(new Error('rejected and never handled')); }, 10); }),
    steady,
  ],
  'runtime-error': [steady],
  // The loop sticks for good shortly after start, as a module stuck in a synchronous loop would.
  stuck: [module('spinner', () => { setTimeout(() => { spin(Number.POSITIVE_INFINITY); }, 200); })],
  // One busy spell of 150 ms.
  busy: [module('spinner', () => { setTimeout(() => { spin(150); }, 100); })],
};

const [scenario = '', ...args] = process.argv.slice(2);
const modules = scenarios[scenario];
if (modules === undefined) throw new Error(`unknown scenario ${scenario}`);
await runMain(args, modules);
if (scenario === 'runtime-error') setTimeout(() => { throw new Error('a bug outside every module'); }, 50);
