import type {ModuleRegistration} from '@jimmie-potts/sdk';
import {createCompanionsModule} from './module.js';
// Shared companion families are registered by event-contracts alongside the existing core families.
export const registration: ModuleRegistration = {name: 'companions', shipped: true, order: 700,
  create: () => createCompanionsModule(), simulate: () => createCompanionsModule()};
