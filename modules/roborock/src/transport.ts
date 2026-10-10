import { createReadTransport, type Config, type Session, type ReadTransport, type Reading, type ReadOptions, type VendorJson } from '@jimmie-potts/roborock-transport';
import { errorBody } from '@jimmie-potts/event-contracts/v2';
import { SdkError, type ModuleContext } from '@jimmie-potts/sdk';
/** SDK private-secret checks own paths/permissions; the transport constructor validates the closed JSON contracts. */
export class LazyTransport implements ReadTransport {
    readonly #context: ModuleContext;
    #owner: ReadTransport | undefined;
    #loading: Promise<ReadTransport> | undefined;
    #identity: string | undefined;
    #stopped = false;
    constructor(context: ModuleContext) { this.#context = context; }
    async #load(): Promise<ReadTransport> {
        if (this.#stopped)
            throw new SdkError(errorBody('cancelled'));
        if (this.#owner !== undefined)
            return this.#owner;
        this.#loading ??= (async () => {
            const target = await this.#context.secrets.read('target'), session = await this.#context.secrets.read('session');
            if (this.#stopped)
                throw new SdkError(errorBody('cancelled'));
            let config: Config, auth: Session;
            try {
                config = JSON.parse(target) as Config;
                auth = JSON.parse(session) as Session;
            }
            catch {
                throw new SdkError(errorBody('invalid-request'));
            }
            const owner = createReadTransport(config, auth, { clock: this.#context.clock, scheduler: this.#context.scheduler, log: this.#context.log, trace: this.#context.trace });
            this.#identity = config.deviceId;
            this.#owner = owner;
            return owner;
        })();
        try {
            return await this.#loading;
        }
        finally {
            this.#loading = undefined;
        }
    }
    async identity(): Promise<string> { await this.#load(); if (this.#identity === undefined)
        throw new SdkError(errorBody('invalid-state')); return this.#identity; }
    async #read<T>(call: (owner: ReadTransport) => Promise<Reading<T>>): Promise<Reading<T>> {
        try {
            return await call(await this.#load());
        }
        catch (error) {
            return { ok: false, error: errorBody(error instanceof SdkError ? error.body.error.code : 'internal') };
        }
    }
    readStatus(options?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read(t => t.readStatus(options)); }
    readConsumables(options?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read(t => t.readConsumables(options)); }
    readCleanSummary(options?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read(t => t.readCleanSummary(options)); }
    readCleanRecord(id: number, options?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read(t => t.readCleanRecord(id, options)); }
    readRoomMapping(options?: ReadOptions): Promise<Reading<VendorJson>> { return this.#read(t => t.readRoomMapping(options)); }
    readCurrentMap(options?: ReadOptions): Promise<Reading<Buffer>> { return this.#read(t => t.readCurrentMap(options)); }
    stop(): void { this.#stopped = true; this.#owner?.stop(); }
}
