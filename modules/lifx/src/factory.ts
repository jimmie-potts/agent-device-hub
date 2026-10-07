// The LIFX module's entry in the runtime's shipped list (Hub #928): the module with its real UDP transport, or with
// simulated bulbs under `--simulate`, and its payload schemas for the SDK edge. It has the shape of the runtime's
// `ModuleFactory` without importing the runtime, which a module may not do.
import type {BunnyModule} from '@jimmie-potts/sdk';
import {lifxSchemas} from './families.js';
import {createLifxModule, MODULE_NAME, udpNetwork} from './module.js';
import {SimulatedLifx} from './simulated.js';

/**
 * A section for the simulated bulbs, which tests and disposable runs of the shipped list use: `pendant-1`, a qualified
 * A19 that shows agent status, and the Beam, which is not qualified. The addresses are documentation addresses, and the
 * simulated bulbs answer at any of them. The module reads no secret.
 */
export const LIFX_SIMULATED_SECTION = Object.freeze({
  bulbs: [
    {id: 'pendant-1', address: '192.0.2.40', vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90, status: {brightnessCapPercent: 50, quietCapPercent: 20}},
    {id: 'beam', address: '192.0.2.41', vendor: 1, product: 38, firmwareMajor: 3, firmwareMinor: 70},
  ],
});

export const lifxModuleFactory: {
  readonly name: string; readonly create: () => BunnyModule; readonly simulate: () => BunnyModule; readonly schemas: Readonly<Record<string, object>>;
  /** The simulated build's section; the module reads no secret, so it names none. */
  readonly simulatedSection: {readonly config: Readonly<Record<string, unknown>>};
} = {
  name: MODULE_NAME,
  create: () => createLifxModule({transport: udpNetwork}),
  simulate: () => createLifxModule({transport: new SimulatedLifx()}),
  schemas: lifxSchemas,
  simulatedSection: {config: LIFX_SIMULATED_SECTION},
};
