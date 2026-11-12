// The Reachy Mini remote module a disposable run builds (Hub #1711): without the run's clocks it polls the supervisor's
// device on a real 100 ms setInterval, as before; with them it polls on the run's scheduler. Nothing waits on real time:
// setInterval is mocked and the run's scheduler is a manual clock.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {setImmediate as turn} from 'node:timers/promises';
import {InProcessBus, type BunnyModule, type DeviceLink, type DeviceSimulation, type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {REACHY_SIMULATED_SECTION as section, registration} from '../src/registration.js';
import type {SimulatedReachy} from '../src/simulated.js';

const simulation = registration.simulation;
assert.ok(simulation !== undefined);
const run = simulation.run as DeviceSimulation<SimulatedReachy, SimulatedReachy>['run'];

/** A wall clock and scheduler that move only when `advance` is called. */
function manualClock(): {now: () => number; scheduler: Scheduler; advance: (ms: number) => Promise<void>} {
  let now = Date.parse('2026-11-12T12:00:00.000Z');
  const timers = new Set<{at: number; callback: () => void}>();
  return {
    now: () => now,
    scheduler: {after: (delayMs, callback) => {
      const timer = {at: now + delayMs, callback};
      timers.add(timer);
      return () => { timers.delete(timer); };
    }},
    advance: async ms => {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(timer => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        now = Math.max(now, due.at);
        if (timers.delete(due)) due.callback();
        await turn();
      }
      now = end;
      for (let step = 0; step < 10; step += 1) await turn();
    },
  };
}

/** Hosts `module` on `clock` until it has connected, and answers how many times the link was asked for the device's state. */
async function hosted(context: TestContext, build: (link: DeviceLink) => BunnyModule, clock: ReturnType<typeof manualClock>): Promise<() => number> {
  const device = run.create({now: clock.now, scheduler: clock.scheduler});
  let reads = 0;
  const link: DeviceLink = {
    handover: undefined, onPush: () => {},
    call: async (method, args, signal = new AbortController().signal) => {
      if (method === 'state') reads += 1;
      try {
        return {status: 'answered', value: await run.serve(device, {method, args, signal, current: true})};
      } catch {
        return {status: 'failed'};
      }
    },
  };
  const dir = await mkdtemp(join(tmpdir(), 'reachy-registration-'));
  const host = new ModuleHarness(build(link), {bus: new InProcessBus({now: clock.now, scheduler: clock.scheduler}), stateDir: dir, section, clock, scheduler: clock.scheduler});
  context.after(async () => { await host.stop(); await rm(dir, {recursive: true, force: true}); });
  await host.start();
  await clock.advance(0);
  assert.equal(reads, 1, 'the module read the device once as it connected');
  return () => reads;
}

void test('without the run\'s clocks a run\'s Reachy remote polls on a real 100 ms setInterval, as before virtual time', async context => {
  context.mock.timers.enable({apis: ['setInterval']});
  const clock = manualClock();
  const reads = await hosted(context, link => run.remote(link), clock);
  await clock.advance(1000);
  assert.equal(reads(), 1, 'the run\'s time does not drive its polls');
  context.mock.timers.tick(100);
  for (let step = 0; step < 10; step += 1) await turn();
  assert.equal(reads(), 2, 'the real interval does');
});

void test('with the run\'s clocks a run\'s Reachy remote polls every 100 ms of the run\'s time', async context => {
  context.mock.timers.enable({apis: ['setInterval']});
  const clock = manualClock();
  const reads = await hosted(context, link => run.remote(link, {now: clock.now, scheduler: clock.scheduler, monotonic: clock.now}), clock);
  context.mock.timers.tick(1000);
  for (let step = 0; step < 10; step += 1) await turn();
  assert.equal(reads(), 1, 'a real interval does not drive its polls');
  await clock.advance(100);
  assert.equal(reads(), 2, 'the run\'s time does');
  await clock.advance(300);
  assert.equal(reads(), 5);
});
