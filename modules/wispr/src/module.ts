import type {BunnyModule, ModuleContext} from '@jimmie-potts/sdk';
import {configureWispr, showWisprSettings, type WisprConfig} from './configuration.js';
import {adaptWisprResponse, readerRefusal, wisprRefusal, type WisprReadResult} from './content.js';
import {WisprError} from './common.js';
import {createWispr, type WisprWorkerFactory} from './wispr.js';

export const WISPR_MODULE = 'wispr';
export type WisprModule = BunnyModule<WisprConfig> & {
  /** Called only by the coordinator-owned authenticated read adapter, never an SDK family or MCP tool. */
  read(route: string, query?: string, signal?: AbortSignal): Promise<WisprReadResult>;
  browserExposed(): boolean;
  /** Internal settings/lifecycle seam. No new HTTP configuration writer is implied. */
  privacy(exposeToDashboard: boolean, shareTextAggregates: boolean): void;
};
export type WisprModuleOptions = {workerFactory?: WisprWorkerFactory};
const settingsSchema = {type: 'object' as const, additionalProperties: false, required: ['sourceId', 'freshnessMs', 'exposeToDashboard', 'shareTextAggregates'],
  properties: {sourceId: {type: 'string'}, freshnessMs: {type: 'integer'}, exposeToDashboard: {type: 'boolean'}, shareTextAggregates: {type: 'boolean'}}};

/** No database, files, subscriptions or collector action; source files open only when an authenticated read asks. */
export function createWisprModule(options: WisprModuleOptions = {}): WisprModule {
  let reader: ReturnType<typeof createWispr> | undefined;
  let lifetime: AbortSignal | undefined;
  const ended = (): boolean => lifetime?.aborted === true;
  return {
    // API1.3 page/content attachment belongs to the coordinator once its shared contract is integrated.
    manifest: {name: WISPR_MODULE, apiVersion: '1.2', configure: configureWispr,
      settings: {schema: settingsSchema, show: config => showWisprSettings(reader?.config ?? config)}},
    start(context: ModuleContext<WisprConfig>): void {
      if (context.config === undefined) throw new Error('the Wispr module started without its configuration');
      lifetime = context.signal;
      reader = createWispr(context.config, () => context.clock.now(), options.workerFactory ?? (data => context.workers.start(
        new URL('./wispr-worker.js', import.meta.url), {workerData: data, resourceLimits: {maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32}},
      )));
    },
    async stop(): Promise<void> { const previous = reader; reader = undefined; await previous?.close(); },
    browserExposed: () => reader?.config.exposeToDashboard === true && lifetime?.aborted !== true,
    privacy(expose: boolean, text: boolean): void {
      if (reader === undefined || ended()) throw new WisprError('wispr-unavailable', 503);
      reader.privacy(expose, text);
    },
    async read(route: string, query = '', signal?: AbortSignal): Promise<WisprReadResult> {
      const selected = reader;
      if (selected === undefined || ended()) return wisprRefusal('unavailable');
      const epoch = selected.epoch();
      const combined = signal === undefined ? lifetime : lifetime === undefined ? signal : AbortSignal.any([lifetime, signal]);
      try {
        const response = await selected.request(route, query, combined);
        if (selected !== reader || selected.epoch() !== epoch || ended()) return wisprRefusal('unavailable');
        if (combined?.aborted === true) return wisprRefusal('cancelled');
        return adaptWisprResponse(response);
      } catch (error) {
        if (error instanceof WisprError) return readerRefusal(error.code);
        throw error;
      }
    },
  };
}
