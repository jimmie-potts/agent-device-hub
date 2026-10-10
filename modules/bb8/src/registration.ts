import type {DeviceLink, DeviceSimulation, ModuleContext, ModuleRegistration} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {bb8Schemas, registerBb8Families} from './families.js';
import {createBb8Module} from './module.js';
import {SimulatedLink} from './simulated.js';
import type {LinkRequest, LinkResult, LinkState} from './contracts.js';
import type {LinkAdmission, LinkPort} from './transport.js';
export const BB8_SIMULATED_SECTION = {id: 'bb8', configurationRevision: 0} as const;
class RemoteSimulation implements LinkPort {
  readonly #link: DeviceLink;
  #id = 'bb8';
  #state: LinkState | undefined;
  #results: LinkResult[] = [];
  #live = false;
  #changed: () => void = () => {};
  #stopped = false;
  constructor(link: DeviceLink) {this.#link = link; link.onPush(() => {void this.#refresh();});}
  start(id: string, _context: ModuleContext, changed: () => void): void {this.#id = id; this.#changed = changed; void this.#refresh();}
  state(): LinkState | undefined {return this.#state;}
  results(): LinkResult[] {return [...this.#results];}
  live(): boolean {return this.#live;}
  async #refresh(): Promise<void> {
    const result = await this.#link.call('snapshot', {id: this.#id}).catch(() => ({status: 'rejected' as const}));
    if (this.#stopped) return;
    if (result.status !== 'answered') {this.#live = false; this.#changed(); return;}
    const value = result.value as {state: LinkState; results: LinkResult[]; live: boolean};
    this.#state = value.state; this.#results = value.results; this.#live = value.live; this.#changed();
  }
  async execute(request: LinkRequest, _parent: object, signal: AbortSignal): Promise<LinkAdmission> {
    const result = await this.#link.call('execute', request, signal);
    await this.#refresh();
    return result.status === 'answered' ? result.value as LinkAdmission : {status: 'uncertain', error: errorBody('uncertain-result', {detail: 'simulated BB-8 link ended'})};
  }
  async recorded(id: string): Promise<void> {await this.#link.call('recorded', {id}); await this.#refresh();}
  async stop(): Promise<void> {this.#stopped = true; this.#live = false; this.#changed = () => {}; await Promise.resolve();}
}
const simulation: DeviceSimulation<SimulatedLink, SimulatedLink> = {
  actions: ['online', 'offline'],
  memory: {create: () => new SimulatedLink(), state: device => device.snapshot(), act: (device, action) => {device.online(action.action === 'online');}, build: device => createBb8Module({transport: device})},
  run: {
    create: options => {const device = new SimulatedLink(); device.attach('bb8', options.now, () => {}); return device;}, state: device => device.snapshot(),
    async act(device, action, push) {device.online(action.action === 'online'); await push(action);},
    async serve(device, call) {
      switch (call.method) {
        case 'snapshot': return {state: device.state(), results: device.results(), live: device.live()};
        case 'execute': return device.execute(call.args as LinkRequest, {traceparent: '00-11111111111111111111111111111111-1111111111111111-01'}, call.signal);
        case 'recorded': await device.recorded((call.args as {id: string}).id, {traceparent: '00-11111111111111111111111111111111-1111111111111111-01'}); return {};
        default: throw new Error('unknown BB-8 simulation method');
      }
    }, remote: link => createBb8Module({transport: new RemoteSimulation(link)}),
  },
};
export const registration: ModuleRegistration = {
  name: 'bb8', create: () => createBb8Module(), simulate: () => createBb8Module({transport: new SimulatedLink()}),
  schemas: bb8Schemas, simulatedSection: {config: BB8_SIMULATED_SECTION}, registerFamilies: registerBb8Families, shipped: true, order: 800, simulation,
};
