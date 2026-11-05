import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {volcanoSchemas} from '../src/families.js';
import {createVolcanoModule} from '../src/module.js';
import {VOLCANO_SIMULATED_SECTION, registration} from '../src/registration.js';
import {SimulatedVolcano} from '../src/simulated.js';

const gap = (gapMinutes: number, expectedConfigurationRevision?: number) => ({
  key: 'bunny.cmd.volcano-session-gap.volcano',
  draft: {type: 'org.bunny.volcano-session.gap.requested', subject: 'volcano', dataschema: 'https://bunny.invalid/events/volcano-session-gap/2.0',
    data: {gapMinutes, ...(expectedConfigurationRevision === undefined ? {} : {expectedConfigurationRevision})}},
});

moduleConformance({
  create: () => registration.simulate(),
  schemas: {...Object.fromEntries(deviceFamilies.map(family => [family.dataschema, family.schema])), ...volcanoSchemas},
  config: VOLCANO_SIMULATED_SECTION,
  serves: ['device', 'volcano-status'],
  accepted: gap(20),
  refused: {...gap(20, 99), code: 'revision-conflict'},
  // With no collector the feed never reports, and the module starts at once and says unavailable.
  offline: {
    create: () => {
      const device = new SimulatedVolcano();
      device.act('collector-absent');
      return createVolcanoModule({feed: device});
    },
    unavailable: message => message.dataschema.endsWith('/device/2.1') && (message.data as {availability?: unknown}).availability === 'unavailable',
  },
});
