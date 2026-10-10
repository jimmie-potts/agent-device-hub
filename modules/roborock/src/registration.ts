import { errorBody } from '@jimmie-potts/event-contracts/v2';
import type { DeviceLink, DeviceSimulation, ModuleRegistration } from '@jimmie-potts/sdk';
import type { ReadOptions, Reading, VendorJson } from '@jimmie-potts/roborock-transport';
import { createRoborockModule } from './module.js';
import { registerRoborockFamilies, roborockSchemas } from './families.js';
import { SimulatedRoborock, SIMULATION_ACTIONS, type SimulationAction } from './simulated.js';
import type { CollectorTransport } from './collector.js';
const cancelled = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;
class RemoteSimulation implements CollectorTransport {
    #stopped = false;
    #changed: (() => void) | undefined;
    constructor(readonly link: DeviceLink) { link.onPush(() => { this.#changed?.(); }); }
    identity(): Promise<string> { return Promise.resolve('synthetic-a97'); }
    onChange(changed: () => void): () => void { this.#changed = changed; return () => { this.#changed = undefined; }; }
    async #read<T>(method: string, args: unknown, options?: ReadOptions): Promise<Reading<T>> { if (this.#stopped || cancelled(options?.signal))
        return { ok: false, error: errorBody('cancelled') }; const answer = await this.link.call(method, args, options?.signal); if (this.#stopped || cancelled(options?.signal))
        return { ok: false, error: errorBody('cancelled') }; return answer.status === 'answered' ? answer.value as Reading<T> : { ok: false, error: errorBody('unavailable') }; }
    readStatus(o?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read('status', {}, o); }
    readConsumables(o?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read('consumables', {}, o); }
    readCleanSummary(o?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read('summary', {}, o); }
    readCleanRecord(recordId: number, o?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read('record', { recordId }, o); }
    readRoomMapping(o?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read('rooms', {}, o); }
    async readCurrentMap(o?: ReadOptions): Promise<Reading<Buffer>> { const result = await this.#read<{
        base64: string;
    }>('map', {}, o); return result.ok ? { ...result, value: Buffer.from(result.value.base64, 'base64') } : result; }
    stop(): void { this.#stopped = true; this.#changed = undefined; }
}
const simulation: DeviceSimulation<SimulatedRoborock, SimulatedRoborock> = { actions: SIMULATION_ACTIONS,
    memory: { create: o => new SimulatedRoborock(o.now), state: d => d.snapshot(), act: (d, a) => { void d.action(a.action as SimulationAction); }, build: d => createRoborockModule({ transport: d }) },
    run: { create: o => new SimulatedRoborock(o.now), state: d => d.snapshot(), async act(d, a, push) { await d.action(a.action as SimulationAction); await push(a); },
        async serve(d, call) { const o = { signal: call.signal }; switch (call.method) {
            case 'status': return d.readStatus(o);
            case 'consumables': return d.readConsumables(o);
            case 'summary': return d.readCleanSummary(o);
            case 'record': return d.readCleanRecord((call.args as {
                recordId: number;
            }).recordId, o);
            case 'rooms': return d.readRoomMapping(o);
            case 'map': {
                const r = await d.readCurrentMap(o);
                return r.ok ? { ...r, value: { base64: r.value.toString('base64') } } : r;
            }
            default: return { ok: false, error: errorBody('invalid-request') };
        } }, remote: link => createRoborockModule({ transport: new RemoteSimulation(link) }) } };
export const registration: ModuleRegistration = { name: 'roborock', create: () => createRoborockModule(), simulate: () => createRoborockModule({ transport: new SimulatedRoborock() }), schemas: roborockSchemas, registerFamilies: registerRoborockFamilies, simulatedSection: { config: { id: 'vacuum' } }, shipped: true, order: 850, simulation };
