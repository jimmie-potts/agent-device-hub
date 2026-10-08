// The Codex Desktop module's registration (Hub #999): its factory, its place in the shipped list and how the scenario
// harnesses simulate its marker. A disposable run's supervisor holds the simulated marker, and the runtime's module
// reads it over its link; no path crosses it.
import type {DeviceAction, DeviceSimulation, ModuleRegistration} from '@jimmie-potts/sdk';
import {codexDesktopFactory} from './factory.js';
import type {MarkerRead} from './marker.js';
import {createCodexDesktopModule} from './module.js';
import {SimulatedMarker} from './simulated.js';

/** The threads the simulated marker may list: at most 64 thread IDs. */
const THREAD = /^[A-Za-z0-9_.-]{1,128}$/;
const threads = (value: unknown): boolean => Array.isArray(value) && value.length <= 64 && value.every(id => typeof id === 'string' && THREAD.test(id));

/** Desktop lists these threads as unread, the marker turns unusable, its folder stalls so every read waits, or it answers again. */
function act(marker: SimulatedMarker, {action, sessions}: DeviceAction): void {
  switch (action) {
    case 'list':
      marker.list(sessions as readonly string[]);
      return;
    case 'unusable':
      marker.unusable();
      return;
    case 'stall':
      marker.stall();
      return;
    case 'answer':
      marker.answer();
      return;
  }
}

export const codexDesktopSimulation: DeviceSimulation<SimulatedMarker, SimulatedMarker> = {
  actions: ['list', 'unusable', 'stall', 'answer'],
  admits: (action, {sessions, ...rest}) => Object.keys(rest).length === 0 && (action === 'list' ? threads(sessions) : sessions === undefined),
  memory: {
    create: () => new SimulatedMarker(),
    state: marker => marker.state(),
    act,
    build: marker => createCodexDesktopModule({transport: marker}),
  },
  run: {
    create: () => new SimulatedMarker(),
    state: marker => marker.state(),
    act: (marker, simulation) => { act(marker, simulation); },
    // A read waits while the folder stalls, whichever runtime asked; one that ended meanwhile no longer hears the answer.
    serve: (marker, {args}) => marker.read('', (args as {stamp: string}).stamp),
    remote: link => createCodexDesktopModule({transport: {
      read: async (_home, stamp) => {
        const answer = await link.call('read', {stamp});
        if (answer.status !== 'answered') throw new Error('the marker could not be read');
        return answer.value as MarkerRead;
      },
      close: () => {},
    }}),
  },
};

export const registration: ModuleRegistration = {...codexDesktopFactory, shipped: true, order: 600, simulation: codexDesktopSimulation};
