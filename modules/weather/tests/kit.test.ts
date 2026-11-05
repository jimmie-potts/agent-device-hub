import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {weatherSchemas} from '../src/families.js';
import {createWeatherModule} from '../src/module.js';
import {registration} from '../src/registration.js';
import {SYNTHETIC_SECTION} from '../src/simulated.js';

moduleConformance({
  create: () => registration.simulate(), config: SYNTHETIC_SECTION, schemas: weatherSchemas, serves: ['weather-state'],
  offline: {create: () => createWeatherModule({fetch: () => () => Promise.reject(new Error('unreachable'))}),
    unavailable: message => message.type === 'org.bunny.weather-state.updated' && (message.data as {status?: string; reason?: string}).reason === 'outage'},
});
