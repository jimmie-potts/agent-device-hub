// Adding a module touches only its own folder (Hub #999). A throwaway module, written here under its own folder in a
// scratch checkout, `modules/zz-probe/`, with its registration, its simulated device and its scenario file, and nothing
// else: the registry the build writes imports it, the shipped list places it by its order when it declares itself
// shipped and leaves it out when it does not, the catalog's collection takes its scenario file, its scenario runs in the
// in-memory harness on both transports, and a disposable run's link drives its device. Nothing names it but itself.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {DeviceAction, ModuleRegistration} from '@jimmie-potts/sdk';
import {registrySource} from '../build/registry.js';
import {CORE_MODULE, registrations, shippedList} from '../src/index.js';
import {ChildLinks, SupervisorDevices} from '../verify/link.js';
import type {ChildMessage, SupervisorMessage} from '../verify/protocol.js';
import {collectModuleFiles} from './scenarios/catalog.js';
import {TRANSPORTS, runScenario} from './scenarios/framework.js';
import {startMemoryHarness} from './scenarios/memory.js';
import {it, manualClock, stateDir} from './support.js';

/** The probe's package entry: a device that counts pings, a module that pings it once at its start, and its registration. */
const PROBE = `
class ProbeDevice {
  pings = 0;
  aborted = 0;
  ping() { this.pings += 1; return Promise.resolve(this.pings); }
  /** Never answers; counts the calls whose caller abandoned them. */
  hang(signal) { return new Promise(resolve => { signal.addEventListener('abort', () => { this.aborted += 1; resolve(null); }); }); }
  reset() { this.pings = 0; }
  state() { return {pings: this.pings, aborted: this.aborted}; }
}
const probeModule = transport => ({manifest: {name: 'zz-probe', apiVersion: '1.0'}, start: () => transport.ping(), stop: () => {}});
export const pushed = [];
export const registration = {
  name: 'zz-probe', shipped: true, order: 250,
  create: () => { throw new Error('the probe has no real device'); },
  simulate: () => probeModule(new ProbeDevice()),
  simulation: {
    actions: ['reset'],
    memory: {create: () => new ProbeDevice(), state: device => device.state(), act: device => { device.reset(); }, build: device => probeModule(device)},
    run: {
      create: () => new ProbeDevice(), state: device => device.state(),
      act: async (device, simulation, push) => { device.reset(); await push(simulation); },
      serve: (device, {method, signal}) => method === 'ping' ? device.ping() : method === 'hang' ? device.hang(signal) : Promise.reject(new Error('no such call')),
      remote: link => {
        link.onPush(simulation => { pushed.push(simulation.action); });
        return probeModule({ping: async () => {
          const answer = await link.call('ping');
          if (answer.status !== 'answered') throw new Error('the probe did not answer');
        }});
      },
    },
  },
};
`;
/** The probe's scenario file, which the catalog's collection takes beside the core's scenarios. */
const SCENARIOS = `
const pings = h => h.devices()['zz-probe'].pings;
export const scenarios = [{
  id: 'zz-probe-pings', title: 'a module nothing else names pings its simulated device, which a scenario resets',
  seed: {modules: ['core', 'zz-probe'], follows: []},
  steps: [
    {kind: 'expect', name: 'the probe runs after the core', withinMs: 3000, check: async h => {
      const names = (await h.health()).map(module => module.name + ' ' + module.state);
      return JSON.stringify(names) === JSON.stringify(['core running', 'zz-probe running']) || JSON.stringify(names);
    }},
    {kind: 'expect', name: 'it pinged its device once at its start', withinMs: 3000, check: h => pings(h) === 1 || 'pings ' + pings(h)},
    {kind: 'act', name: 'the device resets', run: h => { h.simulate({device: 'zz-probe', action: 'reset'}); }},
    {kind: 'expect', name: 'the device shows no ping', withinMs: 3000, check: h => pings(h) === 0 || 'pings ' + pings(h)},
  ],
}];
`;

type Probe = {registration: ModuleRegistration; pushed: string[]};

/** Writes the probe's folder into a scratch checkout and loads its entry, as the build would after compiling it. */
async function probe(root: string): Promise<{probe: Probe; scenarios: URL}> {
  const folder = join(root, 'modules', 'zz-probe');
  await mkdir(join(folder, 'dist', 'scenarios'), {recursive: true});
  await writeFile(join(folder, 'package.json'), JSON.stringify({name: '@jimmie-potts/zz-probe', type: 'module', exports: './dist/index.js'}));
  await writeFile(join(folder, 'dist', 'index.js'), PROBE);
  await writeFile(join(folder, 'dist', 'scenarios', 'zz-probe.js'), SCENARIOS);
  return {probe: await import(pathToFileURL(join(folder, 'dist', 'index.js')).href) as Probe, scenarios: pathToFileURL(join(folder, 'dist', 'scenarios', '/'))};
}

it('a module written only under its own folder is collected, shipped by its order, and runs its scenario on both transports', async context => {
  const root = await stateDir(context);
  const {probe: {registration}, scenarios} = await probe(root);
  assert.match(registrySource(root), /^import \{registration as m0\} from "@jimmie-potts\/zz-probe";$/m, 'the registry the build writes imports it');
  const names = (list: readonly {name: string}[]): string[] => list.map(({name}) => name);
  const shipped = names(shippedList(registrations));
  const placed = names(shippedList([...registrations, registration]));
  assert.equal(placed[0], CORE_MODULE);
  assert.deepEqual(placed.filter(name => name !== 'zz-probe'), shipped, 'the other modules keep their order');
  assert.ok(registrations.filter(({shipped: ships, order}) => ships && order < 250).every(({name}) => placed.indexOf(name) < placed.indexOf('zz-probe')), 'it starts after every lower order');
  assert.ok(registrations.filter(({shipped: ships, order}) => ships && order > 250).every(({name}) => placed.indexOf(name) > placed.indexOf('zz-probe')), 'and before every higher one');
  assert.deepEqual(names(shippedList([...registrations, {...registration, shipped: false}])), shipped, 'a module that does not ship is left out');
  const collected = await collectModuleFiles(scenarios);
  const [scenario] = collected['zz-probe']?.scenarios ?? [];
  assert.ok(scenario !== undefined, 'the catalog\'s collection takes its scenario file');
  for (const transport of TRANSPORTS) {
    const h = await startMemoryHarness(scenario.seed, transport, {registrations: [...registrations, registration]});
    try {
      const result = await runScenario(scenario, h);
      assert.equal(result.outcome, 'passed', `${transport}: ${JSON.stringify(result.steps)}`);
      assert.throws(() => { h.simulate({device: 'zz-probe', action: 'explode'}); }, /unknown device, action or field/, 'an action it does not take is refused');
      assert.throws(() => { h.simulate({device: 'zz-probe', action: 'reset', extra: true}); }, /unknown device, action or field/, 'as is a field it does not take');
      assert.deepEqual(h.problems(), []);
    } finally {
      await h.close();
    }
  }
});

it('a disposable run\'s link drives the module\'s device through its registration alone: calls, pushes and abandoned calls', async context => {
  const {probe: {registration, pushed}} = await probe(await stateDir(context));
  const clock = manualClock();
  const supervisor = new SupervisorDevices([...registrations, registration], {now: clock.now, scheduler: clock.scheduler});
  const fromChild: ChildMessage[] = [];
  let child: ChildLinks | undefined;
  // The channel between the processes: the child's calls reach the supervisor, and its answers and pushes come back.
  const tell = (message: SupervisorMessage): void => {
    if (message.type === 'device.answered' || message.type === 'device.failed' || message.type === 'device.push') child?.hear(message);
  };
  child = new ChildLinks(message => {
    fromChild.push(message);
    if (message.type === 'device.call') supervisor.serve(1, true, message, tell);
    if (message.type === 'device.abandon') supervisor.abandon(1, message.id);
  }, supervisor.handovers());
  const module = registration.simulation?.run.remote(child.link('zz-probe'));
  assert.ok(module !== undefined);
  await module.start({} as never);
  assert.deepEqual(supervisor.states()['zz-probe'], {pings: 1, aborted: 0}, 'the module\'s call reached the supervisor\'s device');
  assert.equal(supervisor.admits({device: 'zz-probe', action: 'reset'}), true);
  for (const refused of [{device: 'zz-probe', action: 'explode'}, {device: 'zz-probe', action: 'reset', extra: 1}, {device: 'zz-probe'}, {device: 'nowhere', action: 'reset'}]) {
    assert.equal(supervisor.admits(refused), false, JSON.stringify(refused));
  }
  await supervisor.act({device: 'zz-probe', action: 'reset'}, async (simulation: DeviceAction) => {
    tell({type: 'device.push', id: 99, device: 'zz-probe', simulation});
    await Promise.resolve();
  });
  assert.deepEqual([supervisor.states()['zz-probe'], pushed], [{pings: 0, aborted: 0}, ['reset']], 'the push reached the module\'s process');
  const link = child.link('zz-probe');
  const calls = fromChild.length;
  assert.deepEqual(await link.call('ping', null, AbortSignal.abort()), {status: 'abandoned'}, 'an aborted call is never sent');
  assert.equal(fromChild.length, calls);
  assert.deepEqual(await link.call('jump'), {status: 'failed'}, 'a call the device refuses fails');
  const aborted = (): number => (supervisor.states()['zz-probe'] as {aborted: number}).aborted;
  const controller = new AbortController();
  const hung = link.call('hang', null, controller.signal);
  controller.abort();
  assert.deepEqual(await hung, {status: 'abandoned'});
  assert.deepEqual([fromChild.filter(message => message.type === 'device.abandon').length, aborted()], [1, 1], 'the supervisor heard it and aborted its own call');
  // A call whose runtime ended is never answered; the supervisor aborts it.
  void link.call('hang');
  supervisor.ended(1);
  assert.equal(aborted(), 2, 'a runtime that ended waits on none of its calls');
});
