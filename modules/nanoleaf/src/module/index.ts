// The Nanoleaf runtime module (Hub #844; ADR 0012): the port of codex-nanoleaf (Hub #26) as one of the runtime's shipped
// modules. `createNanoleafModule({transport})` takes how the module reaches its controllers, as every module factory does
// (#846): the Nanoleaf HTTP client (`lightRequest`), or a simulated controller in tests and disposable runs. The devices'
// addresses and tokens come through the module's configuration and secrets (#919), never through the factory.
import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {BunnyModule} from '@jimmie-potts/sdk';
import {lightRequest, type LightRequest} from '../transport.js';
import {LINES_ADDRESS, SimulatedNanoleaf} from './simulated.js';
import {configureNanoleaf, type NanoleafConfig} from './config.js';
import {NanoleafRuntime} from './runtime.js';
import {nanoleafSchemas} from './schemas.js';

export {configureNanoleaf, registryFile, MAX_DEVICES, type DeviceSection, type NanoleafConfig} from './config.js';
export {CONSUMER, CORE_OWNER, envelopeOf, SessionFeed, sharedConfig, sharedSession, type Projected} from './feed.js';
export {DeviceLink, DeviceUnreachable, REQUEST_MS, type Observation} from './link.js';
export {
  ACKNOWLEDGE_MS, EDIT_POLL_MS, OBSERVE_MAX_MS, OBSERVE_MS, PUBLISH_RETRY_MS, RESTART_MAX_MS, RESTART_MS, RESTARTED_MS, SYNC_RETRY_MAX_MS, SYNC_TIMEOUT_MS,
  TRANSMISSION_MS,
} from './runtime.js';
export {NANOLEAF_FAMILIES, nanoleafSchemas, schemaOf} from './schemas.js';
export {
  KEPT_WRITES, LINES_ADDRESS, PANELS_ADDRESS, SCENES, SIMULATED_LINES, SIMULATED_TRIANGLES, SimulatedNanoleaf, SYNTHETIC_TOKEN, type SimulatedDevice,
  type SimulatedAction, type SimulatedKind, type SimulatedState, type SimulatedWrite,
} from './simulated.js';

/** The module's name: its source `bunny/modules/nanoleaf`, its store, its folder, its section and its consumer ID. */
export const NANOLEAF_MODULE = 'nanoleaf';

/**
 * A section, without its `secrets` member, for the simulated Lines controller: its secret, `token`, holds the synthetic
 * token, and its qualified source is the runtime's synthetic Claude Code hook's.
 */
export const SIMULATED_SECTION = Object.freeze({
  devices: [{id: 'wall', kind: 'lines', address: LINES_ADDRESS, secret: 'token'}],
  qualifiedSources: [{provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code'}],
});

export type NanoleafModuleOptions = {
  /** How the module reaches each controller: `lightRequest` for real devices, or a simulated controller's `request`. */
  transport: LightRequest;
};

/**
 * Every payload schema a Nanoleaf message uses beyond the core families, by `dataschema`: the general device families and
 * the module's own, the device families first, as a validator registers them.
 */
export const nanoleafMessageSchemas: Readonly<Record<string, object>> = {
  ...Object.fromEntries(deviceFamilies.map(family => [family.dataschema, family.schema])),
  ...nanoleafSchemas,
};

/** The Nanoleaf module with the given controller transport. */
export function createNanoleafModule({transport}: NanoleafModuleOptions): BunnyModule<NanoleafConfig> {
  let running: NanoleafRuntime | undefined;
  return {
    manifest: {
      name: NANOLEAF_MODULE, apiVersion: '1.3', configure: configureNanoleaf,
      pages: [{id: 'wall', title: 'Wall', presentation: 'react'}],
      content: (ref, request) => running === undefined
        ? errorBody('unavailable', {detail: 'The Nanoleaf module is not running.'}) : running.content(ref, request),
    },
    async start(context) {
      if (context.config === undefined) throw new Error('the Nanoleaf module started without its configuration');
      running = await NanoleafRuntime.start({...context, config: context.config}, context.config, transport);
    },
    async stop() {
      const current = running;
      running = undefined;
      await current?.stop();
    },
  };
}

/** The module with the real Nanoleaf HTTP client. */
export const createRealNanoleafModule = (): BunnyModule<NanoleafConfig> => createNanoleafModule({transport: lightRequest});

/**
 * The shipped list's factory: the real controllers over the Nanoleaf HTTP client, or, under `--simulate`, a simulated
 * controller that answers every address its configuration names, with the section that configures the simulated build.
 * The module takes a configuration, so the runtime refuses it without its section.
 */
export const nanoleafFactory = {
  name: NANOLEAF_MODULE,
  create: createRealNanoleafModule,
  simulate: (): BunnyModule<NanoleafConfig> => createNanoleafModule({transport: new SimulatedNanoleaf({anyAddress: true}).request}),
  schemas: nanoleafSchemas,
  // The simulated Lines' token comes from the secret `token`, whose synthetic file each consumer writes.
  simulatedSection: {config: SIMULATED_SECTION, secrets: ['token']},
} as const;
