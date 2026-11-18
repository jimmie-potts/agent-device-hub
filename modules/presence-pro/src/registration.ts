import type {ModuleRegistration} from '@jimmie-potts/sdk';
import {bookkeeping, presenceSchemas, registerPresenceFamilies} from './families.js';
import {createPresenceModule} from './module.js';
import {SYNTHETIC_SECTION, simulatedNative, simulation} from './simulated.js';

export const registration: ModuleRegistration = {name: 'presence-pro', shipped: true, order: 760,
  create: () => createPresenceModule(), simulate: () => createPresenceModule({native: simulatedNative}), schemas: presenceSchemas,
  registerFamilies: registerPresenceFamilies, bookkeeping, simulatedSection: {config: SYNTHETIC_SECTION}, simulation};
