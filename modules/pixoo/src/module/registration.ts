// The Pixoo module's registration (Hub #999): its factory, its place in the shipped list and how the scenario harnesses
// simulate the Pixoo. In a disposable run the simulated Pixoo lives in the runtime's process, beside the module that
// reaches it: it reports what it shows to the supervisor, which hands that to the next runtime, so the Pixoo keeps its
// picture and its mode across a restart, as a real one does, and the supervisor hands each mode change to it.
import type {DeviceSimulation, ModuleRegistration} from '@jimmie-potts/sdk';
import {createPixooModule, pixooFactory} from './module.js';
import {SimulatedPixoo, type SimulatedMode, type SimulatedPixooState} from './transport.js';

const MODES: readonly string[] = ['online', 'offline', 'silent'] satisfies SimulatedMode[];

/** The supervisor's record of the Pixoo: what the current runtime's Pixoo last showed, and the mode it answers in. */
type Held = {state: SimulatedPixooState};

export const pixooSimulation: DeviceSimulation<SimulatedPixoo, Held> = {
  actions: MODES,
  memory: {
    create: () => new SimulatedPixoo(),
    state: pixoo => pixoo.state(),
    act: (pixoo, {action}) => { pixoo.set(action as SimulatedMode); },
    // Its outbox follows the core's acknowledgments, so it forgets what the core took.
    build: pixoo => createPixooModule({transport: pixoo}),
  },
  run: {
    create: () => ({state: new SimulatedPixoo().state()}),
    state: held => held.state,
    async act(held, simulation, push) {
      await push(simulation);
      held.state = {...held.state, mode: simulation.action as SimulatedMode};
    },
    // Only the current runtime's Pixoo reports what the panel shows.
    serve: (held, {method, args, current}) => {
      if (method === 'report' && current) held.state = args as SimulatedPixooState;
      return null;
    },
    handover: held => held.state,
    remote: link => {
      const left = link.handover as Partial<SimulatedPixooState> | null;
      if (left === null || typeof left !== 'object' || !MODES.includes(String(left.mode))) throw new Error('the run handed over no Pixoo state');
      const {mode, ...panel} = left as SimulatedPixooState;
      const pixoo = new SimulatedPixoo({mode, panel});
      pixoo.onChange(state => { void link.call('report', state); });
      link.onPush(({action}) => { pixoo.set(action as SimulatedMode); });
      return createPixooModule({transport: pixoo});
    },
  },
};

export const registration: ModuleRegistration = {...pixooFactory, shipped: true, order: 400, simulation: pixooSimulation};
