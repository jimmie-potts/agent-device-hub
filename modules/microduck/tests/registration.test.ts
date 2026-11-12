// The MicroDuck simulation a disposable run builds (Hub #1711): on the real clock, where the run gives no monotonic clock
// and the remote module no options, the supervisor's device and the module both keep `process.hrtime`, as before; on
// virtual time both follow the run's clock. Nothing waits on real time: hrtime is mocked and the hosts run on a test clock.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {setImmediate as turn} from 'node:timers/promises';
import {InProcessBus, type BunnyModule, type DeviceLink, type DeviceSimulation, type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {MICRODUCK_SIMULATED_SECTION as section, registration} from '../src/registration.js';
import type {MicroDuckState} from '../src/contracts.js';
import type {SimulatedMicroDuck} from '../src/simulated.js';
import {TestClock} from './support.js';

const simulation = registration.simulation;
assert.ok(simulation !== undefined);
const run = simulation.run as DeviceSimulation<SimulatedMicroDuck, SimulatedMicroDuck>['run'];
/** A scheduler whose timers never fire: the supervisor's device needs none here. */
const still: Scheduler = {after: () => () => {}};
const sensorOf = (device: SimulatedMicroDuck): string => device.state().observation.sensorNs;

/** A link that serves each call from `device` in this process, as the run's supervisor does over its link. */
const linkTo = (device: SimulatedMicroDuck): DeviceLink => ({
  call: async (method, args, signal = new AbortController().signal) => {
    try {
      return {status: 'answered', value: await run.serve(device, {method, args, signal, current: true})};
    } catch {
      return {status: 'failed'};
    }
  },
  handover: undefined,
  onPush: () => {},
});

/**
 * Hosts `module` on the test's clock and answers the connection it first reports. The module reports a connection after
 * two observations; between them `poll` lets the remote poll once more, on the run's clock or on mocked real timers.
 */
async function connection(context: TestContext, module: BunnyModule, clock: TestClock, poll: () => Promise<void>): Promise<MicroDuckState['connection'] | undefined> {
  const dir = await mkdtemp(join(tmpdir(), 'microduck-registration-'));
  const bus = new InProcessBus({now: clock.now, scheduler: clock.scheduler});
  const operator = bus.connect('bunny/parts/operator'), states: MicroDuckState[] = [];
  await operator.subscribe<MicroDuckState>('bunny.state.microduck-state.*', message => { states.push(message.data); });
  const host = new ModuleHarness(module, {bus, stateDir: dir, section, clock, scheduler: clock.scheduler});
  context.after(async () => { await host.stop(); await operator.close(); await rm(dir, {recursive: true, force: true}); });
  await host.start();
  // The first connection other than `unknown`: available, or stale when the observation's stamp is on another clock.
  const judged = (): MicroDuckState['connection'] | undefined => states.find(state => state.connection !== 'unknown')?.connection;
  await clock.advance(5);
  for (let polls = 0; judged() === undefined && polls < 20; polls += 1) {
    await poll();
    for (let turns = 0; turns < 20; turns += 1) await turn();
  }
  return judged();
}

void test('on the real clock a run\'s MicroDuck device and remote module keep process.hrtime, as before virtual time', async context => {
  // hrtime as a machine up for 5 s, moving 1 ms each time it is read.
  let uptime = 5_000_000_000n;
  context.mock.method(process.hrtime, 'bigint', () => (uptime += 1_000_000n));
  // A run on the real clock gives `run.create` its wall clock and scheduler, and no monotonic clock.
  context.mock.timers.enable({apis: ['setInterval']});
  const device = run.create({now: Date.now, scheduler: still});
  assert.equal(sensorOf(device), '5001000000', 'the device stamps its sensor with hrtime');
  // The module judges that stamp fresh only on the same clock: on the wall clock it would be decades old.
  assert.equal(await connection(context, run.remote(linkTo(device)), new TestClock(), () => { context.mock.timers.tick(100); return Promise.resolve(); }), 'available',
    'the module without options reads hrtime and polls on real timers');
});

void test('on virtual time a run\'s MicroDuck device and remote module follow the run\'s clock', async context => {
  context.mock.method(process.hrtime, 'bigint', () => 5_000_000_000n);
  const clock = new TestClock();
  const device = run.create({now: clock.now, scheduler: clock.scheduler, monotonic: clock.now});
  assert.equal(sensorOf(device), String(BigInt(clock.now()) * 1_000_000n), 'the device stamps its sensor with the run\'s time');
  assert.equal(await connection(context, run.remote(linkTo(device), {now: clock.now, scheduler: clock.scheduler, monotonic: clock.now}), clock, () => clock.advance(100)), 'available',
    'the module with the run\'s clocks reads the run\'s time');
});
