import type {ModuleRegistration} from '@jimmie-potts/sdk';
import {artSchemas, registerArtStateFamily} from './families.js';
import {createArtModule} from './module.js';

// It declares no device simulation because it reaches no device or local file: its paths are outbound HTTPS. `create`
// takes the seams' unwired defaults until #679 and #1418 merge, so it admits no command yet. A simulated run has no key
// and reaches no provider.
export const registration: ModuleRegistration = {name: 'art', shipped: true, order: 760,
  create: () => createArtModule(), simulate: () => createArtModule(),
  schemas: artSchemas, registerFamilies: registerArtStateFamily, simulatedSection: {config: {}}};
