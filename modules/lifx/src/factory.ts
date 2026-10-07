// The LIFX module's entry in the runtime's shipped list (Hub #928): the module with its real UDP transport, or with
// simulated bulbs under `--simulate`, and its payload schemas for the SDK edge. It has the shape of the runtime's
// `ModuleFactory` without importing the runtime, which a module may not do.
import type {BunnyModule} from '@jimmie-potts/sdk';
import {lifxSchemas} from './families.js';
import {createLifxModule, MODULE_NAME, udpNetwork} from './module.js';
import {SimulatedLifx} from './simulated.js';

export const lifxModuleFactory: {
  readonly name: string; readonly create: () => BunnyModule; readonly simulate: () => BunnyModule; readonly schemas: Readonly<Record<string, object>>;
} = {
  name: MODULE_NAME,
  create: () => createLifxModule({transport: udpNetwork}),
  simulate: () => createLifxModule({transport: new SimulatedLifx()}),
  schemas: lifxSchemas,
};
