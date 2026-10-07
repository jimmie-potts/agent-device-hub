// The module test kit (Hub #882, #919) on the Tidbyt module: its manifest and section, its lifecycle, policy A with a
// cloud that never answers, the device record it serves, the two copies it follows, and a general command it refuses.
// The kit runs on real time, so the simulated cloud answers at once, and the silent one meets a short call deadline.
import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createTidbytModule, reportsUnavailable} from '../src/module.js';
import {SIMULATED_API_KEY, SimulatedCloud} from '../src/simulated.js';
import {SECTION} from './support.js';

moduleConformance({
  create: () => createTidbytModule({transport: new SimulatedCloud().fetch}),
  // The kit registers the core families; the device families carry the record and the refused command.
  schemas: Object.fromEntries(deviceFamilies.map(family => [family.dataschema, family.schema])),
  serves: ['device'],
  // The kit's one stand-in owner serves both families the module copies, each synced on its own as in the runtime.
  copies: {families: ['session', 'playback'], snapshot: {revision: 1, states: []}},
  refused: {
    key: 'bunny.cmd.power-set.tidbyt',
    draft: {type: 'org.bunny.power.set.requested', subject: 'tidbyt', dataschema: 'https://bunny.invalid/events/power-set/2.0', data: {on: true}},
    code: 'unsupported-capability',
  },
  config: SECTION,
  secrets: {token: SIMULATED_API_KEY},
  offline: {create: () => createTidbytModule({transport: new SimulatedCloud({online: false}).fetch, callTimeoutMs: 300}), unavailable: reportsUnavailable},
});
