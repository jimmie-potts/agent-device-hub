// The SDK's module conformance. The two command families are #679's; this stands in a closed schema for the one the kit sends.
import {artSchemas} from '@jimmie-potts/event-contracts/v2/art-state';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createArtModule} from '../src/module.js';
import {drawing, fakeImages} from './fixtures.js';
import {fakeCommands} from './support.js';

const REQUEST_SCHEMA = 'https://bunny.invalid/events/art-request/2.0';
const draft = (targets: string[]) => ({type: 'org.bunny.art-request.requested', subject: 'art', dataschema: REQUEST_SCHEMA, data: {action: 'generate', purpose: 'request', targets}});
moduleConformance({
  create: () => createArtModule({commands: fakeCommands, providers: {openai: fakeImages(drawing())}}),
  config: {},
  schemas: {...artSchemas, [REQUEST_SCHEMA]: {type: 'object'}},
  serves: ['art'],
  accepted: {key: 'bunny.cmd.art-request.art', draft: draft(['tidbyt'])},
  refused: {key: 'bunny.cmd.art-request.art', draft: draft(['wall']), code: 'invalid-request'},
});
