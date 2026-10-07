// The module test kit (Hub #882, #919) on the LIFX module: its manifest and section, its lifecycle, policy A with bulbs
// that never answer, the families it serves and copies, a command it accepts and one it refuses, and its outbox across
// a restart. The kit runs on real time, so these bulbs answer at once and the silent ones only on the offline check.
import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createLifxModule, lifxSchemas, reportsUnavailable, SimulatedLifx} from '../src/index.js';
import {BEAM, PENDANT, SECTION, command} from './support.js';

moduleConformance({
  create: () => createLifxModule({transport: new SimulatedLifx()}),
  // The kit registers the core families; the device families go first, since the LIFX commands use their guards.
  schemas: {...Object.fromEntries(deviceFamilies.map(family => [family.dataschema, family.schema])), ...lifxSchemas},
  serves: ['device', 'lifx-light'],
  copies: {families: ['session'], snapshot: {revision: 1, states: []}},
  accepted: command.power(PENDANT.id, false),
  refused: {...command.power(BEAM.id, true), code: 'unsupported-capability'},
  config: SECTION,
  offline: {create: () => createLifxModule({transport: new SimulatedLifx({online: false})}), unavailable: reportsUnavailable},
});
