import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createRoborockModule} from '../src/module.js';
import {roborockSchemas} from '../src/families.js';
import {SimulatedRoborock} from '../src/simulated.js';

moduleConformance({
  create: () => createRoborockModule({transport: new SimulatedRoborock()}),
  schemas: {...Object.fromEntries(deviceFamilies.map(family => [family.dataschema, family.schema])), ...roborockSchemas},
  config: {id: 'vacuum'},
  serves: ['device', 'roborock-vacuum'],
  offline: {
    create: () => {
      const device = new SimulatedRoborock();
      void device.action('offline');
      return createRoborockModule({transport: device});
    },
    unavailable: message => message.dataschema.endsWith('/device/2.0')
      && (message.data as {availability?: unknown}).availability === 'unavailable',
  },
});
