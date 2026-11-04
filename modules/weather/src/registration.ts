import type {ModuleRegistration} from '@jimmie-potts/sdk';
import {weatherSchemas, registerWeatherFamilies} from './families.js';
import {createWeatherModule} from './module.js';
import {SYNTHETIC_SECTION, simulatedFetch} from './simulated.js';

// It declares no device simulation because it reaches no device or local file: its one path is outbound HTTPS.
export const registration: ModuleRegistration = {name: 'weather', shipped: true, order: 750,
  create: () => createWeatherModule(), simulate: () => createWeatherModule({fetch: simulatedFetch}),
  schemas: weatherSchemas, registerFamilies: registerWeatherFamilies, simulatedSection: {config: SYNTHETIC_SECTION}};
