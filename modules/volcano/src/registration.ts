// The Volcano module's registration: a fixed shipped module that reaches no device or file of its host. Its collector runs
// beside the runtime and publishes over the SDK edge. Harnesses drive it from a synthetic device, held by the disposable
// run's supervisor so that it outlives a runtime restart as a real one would.
import type {VolcanoObservation} from '@jimmie-potts/event-contracts/v2/families';
import type {DeviceAction, DeviceLink, DeviceSimulation, ModuleRegistration} from '@jimmie-potts/sdk';
import {configureVolcano} from './configuration.js';
import {registerVolcanoFamilies, volcanoSchemas} from './families.js';
import {createVolcanoModule, type SyntheticFeed} from './module.js';
import {SIMULATION_ACTIONS, SimulatedVolcano, type SimulationAction} from './simulated.js';

export const VOLCANO_SIMULATED_SECTION = Object.freeze({id: 'volcano', label: 'Volcano', hostId: 'host-sim', sourceId: 'volcano-sim'});

const admits = (action: string, fields: Readonly<Record<string, unknown>>): boolean => {
  const {deciC, ...rest} = fields;
  if (Object.keys(rest).length !== 0) return false;
  return action === 'setpoint' ? typeof deciC === 'number' && Number.isSafeInteger(deciC) && deciC >= 0 && deciC <= 2300 : deciC === undefined;
};
const act = (device: SimulatedVolcano, {action, deciC}: DeviceAction): void => { device.act(action as SimulationAction, deciC as number | undefined); };

function remoteFeed(link: DeviceLink): SyntheticFeed {
  return {
    async observe(feed, nowMs) {
      const answer = await link.call('observe', {feed, nowMs});
      return answer.status === 'answered' && answer.value !== null ? answer.value as VolcanoObservation : undefined;
    },
    onChange(changed) {
      let listening = true;
      link.onPush(() => { if (listening) changed(); });
      return () => { listening = false; };
    },
  };
}

const simulation: DeviceSimulation<SimulatedVolcano, SimulatedVolcano> = {
  actions: SIMULATION_ACTIONS,
  admits,
  memory: {create: () => new SimulatedVolcano(), state: device => device.state(), act, build: device => createVolcanoModule({feed: device})},
  run: {
    create: () => new SimulatedVolcano(),
    state: device => device.state(),
    async act(device, value, push) { act(device, value); await push(value); },
    serve(device, {args}) {
      const {feed, nowMs} = args as {feed: VolcanoObservation['feed']; nowMs: number};
      return device.snapshot(feed, nowMs) ?? null;
    },
    remote: link => createVolcanoModule({feed: remoteFeed(link)}),
  },
};

export const registration: ModuleRegistration = {
  name: 'volcano', shipped: true, order: 860, create: () => createVolcanoModule(), simulate: () => createVolcanoModule({feed: new SimulatedVolcano()}),
  schemas: volcanoSchemas, registerFamilies: registerVolcanoFamilies, simulatedSection: {config: VOLCANO_SIMULATED_SECTION}, simulation, hostLocal: section => 'config' in configureVolcano(section),
};
