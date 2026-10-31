import type {ModuleRegistration} from '@jimmie-potts/sdk';
import {createCompanionsModule} from './module.js';
// Shared companion families are registered by event-contracts alongside the existing core families.
export const registration: ModuleRegistration = {name: 'companions', shipped: true, order: 700,
  // An empty section keeps the synthetic provider and no permitted tool, so a simulated run starts the module without a key.
  simulatedSection: {config: {}},
  create: () => createCompanionsModule(), simulate: () => createCompanionsModule()};
