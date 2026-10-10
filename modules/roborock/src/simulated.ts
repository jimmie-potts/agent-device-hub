import { errorBody } from '@jimmie-potts/event-contracts/v2';
import type { ReadOptions, Reading, ReadTransport, VendorJson } from '@jimmie-potts/roborock-transport';
export const SIMULATION_ACTIONS = ['online', 'offline', 'cleaning', 'complete', 'late', 'empty-history'] as const;
export type SimulationAction = typeof SIMULATION_ACTIONS[number];
/** Synthetic device model only. An action comes from the test host, never a gateway command. */
export class SimulatedRoborock implements ReadTransport {
    readonly #now: () => number;
    #online = true;
    #active: number | undefined;
    #records = new Map<number, VendorJson>();
    #empty = false;
    #late = false;
    #battery = 86;
    readonly calls: string[] = [];
    #changed: (() => Promise<void> | void) | undefined;
    constructor(now: () => number = Date.now) { this.#now = now; const begin = Math.floor(now() / 1000) - 86400; for (let i = 0; i < 30; i++) {
        const id = begin - i * 86400;
        this.#records.set(id, { begin: id, end: id + 60, duration: 40, area: 12000000, error: 0, complete: 1, start_type: 2, clean_type: 1, finish_reason: 1, owner_note: 'Synthetic private retained original' });
    } }
    identity(): Promise<string> { return Promise.resolve('synthetic-a97'); }
    onChange(changed: () => Promise<void> | void): () => void { this.#changed = changed; return () => { if (this.#changed === changed)
        this.#changed = undefined; }; }
    action(action: SimulationAction): Promise<void> {
        switch (action) {
            case 'online':
                this.#online = true;
                break;
            case 'offline':
                this.#online = false;
                break;
            case 'cleaning':
                this.#active = Math.floor(this.#now() / 1000);
                this.#battery = 86;
                break;
            case 'complete':
                if (this.#active !== undefined) {
                    const begin = this.#active, end = Math.max(begin + 1, Math.floor(this.#now() / 1000));
                    this.#records.set(begin, { begin, end, duration: end - begin, area: 15000000, error: 0, complete: 1, start_type: 2, clean_type: 1, finish_reason: 1, avoid_count: 3, wash_count: 1 });
                    this.#active = undefined;
                }
                break;
            case 'late':
                this.#late = true;
                break;
            case 'empty-history':
                this.#empty = true;
                break;
        }
        return Promise.resolve(this.#changed?.());
    }
    snapshot(): object { return { online: this.#online, active: this.#active ?? null, records: this.#records.size, calls: [...this.calls] }; }
    #read<T>(name: string, value: T, options?: ReadOptions): Promise<Reading<T>> { this.calls.push(name); if (options?.signal?.aborted === true)
        return Promise.resolve({ ok: false, error: errorBody('cancelled') }); if (!this.#online)
        return Promise.resolve({ ok: false, error: errorBody('unavailable') }); return Promise.resolve({ ok: true, value, observedAt: new Date(this.#now()).toISOString() }); }
    readStatus(options?: ReadOptions): Promise<Reading<VendorJson>> { if (this.#late) {
        this.#late = false;
        this.calls.push('status');
        return Promise.resolve({ ok: false, error: errorBody('unavailable') });
    } const begin = this.#active, active = begin !== undefined; if (active)
        this.#battery = Math.max(0, this.#battery - 1); return this.#read('status', { state: active ? 5 : 8, battery: this.#battery, in_cleaning: active ? 1 : 0, in_returning: 0, clean_time: begin !== undefined ? Math.max(0, Math.floor(this.#now() / 1000) - begin) : 40, clean_area: 12000000, error_code: 0, dock_error_status: 0, charge_status: active ? 0 : 1, dss: 0, owner_note: 'Synthetic private household' }, options); }
    readConsumables(options?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read('consumables', { main_brush_work_time: 7200, side_brush_work_time: 3600, filter_work_time: 1800, sensor_dirty_time: 900, strainer_work_times: 3, dust_collection_work_times: 4, cleaning_brush_work_times: 2, filter_element_work_time: 600 }, options); }
    readCleanSummary(options?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read('summary', [1200, 36000000, this.#records.size, this.#empty ? [] : [...this.#records.keys()]], options); }
    readCleanRecord(id: number, options?: ReadOptions): Promise<Reading<VendorJson>> { const record = this.#records.get(id); return record === undefined ? Promise.resolve({ ok: false, error: errorBody('not-found') }) : this.#read('record', structuredClone(record), options); }
    readRoomMapping(options?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read('rooms', [[16, 'Synthetic private room']], options); }
    readCurrentMap(options?: ReadOptions): Promise<Reading<Buffer>> { const bytes = Buffer.alloc(24); bytes.write('rr'); bytes.writeUInt32LE(7, 12); bytes.writeUInt32LE(9, 16); return this.#read('map', bytes, options); }
    stop(): void { }
}
