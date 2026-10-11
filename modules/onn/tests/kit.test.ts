import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createOnnModule} from '../src/module.js';
import {SimulatedOnn} from '../src/simulated.js';
import {onnSchemas} from '../src/families.js';
import {schemaOf, types} from '../src/contracts.js';
const section = {id: 'onn', configurationRevision: 1, adbSocket: '/not-configured/s', serial: '192.0.2.10:12345', hostExecutable: '/not-configured/adb', hostExecutableSha256: '0'.repeat(64), hostVersion: '37.0.1', hostKeyDirectory: '/not-configured/keys'};
moduleConformance({
  create: () => createOnnModule({transport: new SimulatedOnn()}), schemas: {...Object.fromEntries(deviceFamilies.map(family => [family.dataschema, family.schema])), ...onnSchemas}, config: section,
  serves: ['device', 'onn-state'],
  accepted: {key: 'bunny.cmd.onn-key-press.onn', draft: {type: types['onn-key-press'], subject: 'onn', dataschema: schemaOf('onn-key-press'), data: {key: 'right'}}},
  refused: {key: 'bunny.cmd.onn-key-press.other', draft: {type: types['onn-key-press'], subject: 'other', dataschema: schemaOf('onn-key-press'), data: {key: 'right'}}, code: 'not-found'},
  offline: {create: () => {const transport = new SimulatedOnn(); transport.online = false; return createOnnModule({transport});}, unavailable: message => message.type === 'org.bunny.device.updated' && message.data.availability === 'unavailable'},
});
