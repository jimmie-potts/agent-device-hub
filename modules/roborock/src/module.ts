import { errorBody } from '@jimmie-potts/event-contracts/v2';
import { Outbox, SdkError, type BunnyModule } from '@jimmie-potts/sdk';
import { Collector, type CollectorTransport } from './collector.js';
import { configureRoborock, type RoborockConfig } from './configuration.js';
import { readContent } from './content.js';
import { roborockValidator, statusSchema } from './families.js';
import { RoborockStore } from './store.js';
import { stateDrafts } from './state.js';
import { LazyTransport } from './transport.js';
export type RoborockModule = BunnyModule<RoborockConfig> & {
    refreshForTest?: () => Promise<void>;
};
export function createRoborockModule(options: {
    transport?: CollectorTransport;
} = {}): RoborockModule {
    let collector: Collector | undefined, store: RoborockStore | undefined, closing = false, removeSyntheticListener: (() => void) | undefined;
    const module: RoborockModule = { manifest: { name: 'roborock', apiVersion: '1.3', configure: section => configureRoborock(section, options.transport !== undefined), pages: [{ id: 'status', title: 'Roborock', presentation: 'react' }],
            content: (ref, request) => { if (closing || collector === undefined)
                return errorBody('unavailable'); const failure = collector.storageFailure(); return failure === undefined ? readContent(ref, request, collector.state(), store) : errorBody(failure); },
            tools: [{ name: 'status', description: 'Read the retained Roborock status with observation time, partial-history and unverified map/clock evidence.', input: { type: 'object', additionalProperties: false, properties: {} }, output: statusSchema, read: () => { if (closing || collector === undefined)
                        return errorBody('unavailable'); const failure = collector.storageFailure(); return failure === undefined ? collector.state() : errorBody(failure); } }],
            settings: { schema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } }, show: config => ({ id: config.id }) } },
        async start(context) {
            if (!context.config)
                throw new SdkError(errorBody('invalid-request'));
            context.signal.addEventListener('abort', () => { closing = true; }, { once: true });
            const database = context.database();
            store = new RoborockStore(database);
            const outbox = new Outbox({ sdk: context.sdk, database, clock: context.clock, validator: roborockValidator(), log: context.log, trace: context.trace });
            collector = new Collector(context, store, outbox, options.transport ?? new LazyTransport(context));
            await context.sdk.serveSync(['device', 'roborock-vacuum'], request => { if (closing || collector === undefined)
                return errorBody('unavailable'); const failure = collector.storageFailure(); return failure === undefined ? { revision: collector.state().revision, states: stateDrafts(collector.state(), collector.generation()).filter(d => request.data.families.includes(d.dataschema.includes('/device/') ? 'device' : 'roborock-vacuum')) } : errorBody(failure); });
            collector.startlocal();
            const synthetic = options.transport as (CollectorTransport & {
                onChange?: (changed: () => Promise<void>) => () => void;
            }) | undefined;
            if (synthetic?.onChange)
                removeSyntheticListener = synthetic.onChange(() => collector?.refreshForTest() ?? Promise.resolve());
        }, async stop() { closing = true; removeSyntheticListener?.(); await collector?.stop(); } };
    // A host-held test seam. It is never part of the manifest, gateway or real transport.
    if (options.transport !== undefined)
        module.refreshForTest = () => collector?.refreshForTest() ?? Promise.resolve();
    return module;
}
