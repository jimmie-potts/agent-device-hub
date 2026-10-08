// The Nanoleaf module's registration (Hub #999): its factory, its place in the shipped list and how the scenario
// harnesses simulate its controllers. A disposable run's supervisor holds the simulated controllers, which keep their
// state across a runtime restart, and the runtime's module reaches them one request at a time over its link.
import type {DeviceSimulation, ModuleRegistration} from '@jimmie-potts/sdk';
import {HttpError} from '../transport.js';
import {createNanoleafModule, nanoleafFactory} from './index.js';
import {SimulatedNanoleaf, type SimulatedAction} from './simulated.js';

/** How long the runtime's module keeps a request the simulated controller never answers; the module's own deadline is shorter. */
const ABANDON_MS = 10_000;

/** One request as it crosses the link, with the token the module read from its secret file. */
type LightCall = {address: string; token: string; method: string; endpoint: string; payload: unknown};
/** The controller's reply, or the HTTP error status it answered with, or none when it did not answer. */
type LightAnswer = {reply: unknown} | {failed: number | null};

export const nanoleafSimulation: DeviceSimulation<SimulatedNanoleaf, SimulatedNanoleaf> = {
  actions: ['online', 'offline', 'power-on', 'power-off', 'lose-next-answer'] satisfies SimulatedAction[],
  memory: {
    create: ({now}) => new SimulatedNanoleaf({now}),
    state: nanoleaf => nanoleaf.state(),
    act: (nanoleaf, {action}) => { nanoleaf.act(action as SimulatedAction); },
    build: nanoleaf => createNanoleafModule({transport: nanoleaf.request}),
  },
  run: {
    create: () => new SimulatedNanoleaf(),
    state: nanoleaf => nanoleaf.state(),
    act: (nanoleaf, {action}) => { nanoleaf.act(action as SimulatedAction); },
    async serve(nanoleaf, {args}): Promise<LightAnswer> {
      const {address, token, method, endpoint, payload} = args as LightCall;
      try {
        return {reply: await nanoleaf.request({ip: address, token}, method, endpoint, payload)};
      } catch (error) {
        return {failed: error instanceof HttpError ? error.status : null};
      }
    },
    remote: link => createNanoleafModule({transport: async (address, method, endpoint = '', payload = null) => {
      const call: LightCall = {address: address.ip, token: address.token, method, endpoint, payload};
      const answer = await link.call('request', call, AbortSignal.timeout(ABANDON_MS));
      const value = answer.status === 'answered' ? answer.value as LightAnswer : {failed: null};
      if ('reply' in value) return value.reply;
      // A controller that answered with an HTTP error status is reached, as the Nanoleaf HTTP client reports it.
      throw value.failed === null ? new Error('the simulated controller did not answer') : new HttpError(value.failed);
    }}),
  },
};

export const registration: ModuleRegistration = {...nanoleafFactory, shipped: true, order: 500, simulation: nanoleafSimulation};
