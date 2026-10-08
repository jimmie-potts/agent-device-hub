// The LIFX module's registration (Hub #999): its factory, its place in the shipped list and how the scenario harnesses
// simulate its bulbs. A disposable run's supervisor holds the simulated bulbs, so they keep their state when the runtime
// restarts, and the runtime's module reaches them packet by packet over its link.
import type {DeviceAction, DeviceSimulation, ModuleRegistration} from '@jimmie-potts/sdk';
import {lifxModuleFactory} from './factory.js';
import {registerLifxFamilies} from './families.js';
import {createLifxModule} from './module.js';
import {SimulatedLifx} from './simulated.js';

/** One packet to the bulb at `address`, its payload in base64, as it crosses the link. */
type Exchange = {address: string; packet: number; payload: string; expected: number};

/** A bulb goes off the network, as one switched off at the wall, or comes back. */
function act(bulbs: SimulatedLifx, {action, address}: DeviceAction): void {
  if (action === 'online') bulbs.online(String(address));
  else bulbs.offline(String(address));
}

export const lifxSimulation: DeviceSimulation<SimulatedLifx, SimulatedLifx> = {
  actions: ['online', 'offline'],
  admits: (_action, {address, ...rest}) => typeof address === 'string' && address.length <= 64 && Object.keys(rest).length === 0,
  memory: {
    create: () => new SimulatedLifx(),
    state: bulbs => bulbs.state(),
    act,
    // Its outbox follows the core's acknowledgments, so it forgets what the core took.
    build: bulbs => createLifxModule({transport: bulbs}),
  },
  run: {
    create: () => new SimulatedLifx(),
    state: bulbs => bulbs.state(),
    act: (bulbs, simulation) => { act(bulbs, simulation); },
    async serve(bulbs, {args, signal}) {
      const {address, packet, payload, expected} = args as Exchange;
      return (await bulbs.exchange(address, packet, Buffer.from(payload, 'base64'), expected, signal)).toString('base64');
    },
    // A bulb off the network never answers, so the module's own deadline aborts the wait, which tells the supervisor too.
    remote: link => createLifxModule({transport: {connect: address => ({
      exchange: async (packet, payload, expected, signal) => {
        const exchange: Exchange = {address, packet, payload: Buffer.from(payload).toString('base64'), expected};
        const answer = await link.call('exchange', exchange, signal);
        if (answer.status === 'answered') return Buffer.from(String(answer.value), 'base64');
        throw new Error(answer.status === 'abandoned' ? 'the bulb did not answer' : 'the bulb refused the packet');
      },
      close: () => {},
    })}}),
  },
};

export const registration: ModuleRegistration = {
  ...lifxModuleFactory, shipped: true, order: 200, registerFamilies: registerLifxFamilies, simulation: lifxSimulation,
};
