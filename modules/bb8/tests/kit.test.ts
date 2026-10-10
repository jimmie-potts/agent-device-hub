import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createBb8Module} from '../src/module.js';
import {SimulatedLink} from '../src/simulated.js';
import {bb8Schemas} from '../src/families.js';
import {commandType, schemaOf} from '../src/contracts.js';
moduleConformance({
  create: () => createBb8Module({transport: new SimulatedLink()}), schemas: {...Object.fromEntries(deviceFamilies.map(f => [f.dataschema, f.schema])), ...bb8Schemas},
  config: {id: 'bb8', configurationRevision: 0}, serves: ['device', 'bb8-robot'],
  accepted: {key: 'bunny.cmd.bb8-connect.bb8', draft: {type: commandType('bb8-connect'), subject: 'bb8', dataschema: schemaOf('bb8-connect'), data: {expectedConfigurationRevision: 0, expectedHelperEpoch: 'simulated-helper', expectedConnectionGeneration: 0}}},
  refused: {key: 'bunny.cmd.bb8-wake.bb8', draft: {type: commandType('bb8-wake'), subject: 'bb8', dataschema: schemaOf('bb8-wake'), data: {expectedConfigurationRevision: 0, expectedHelperEpoch: 'wrong-helper', expectedConnectionGeneration: 0}}, code: 'revision-conflict'},
});
