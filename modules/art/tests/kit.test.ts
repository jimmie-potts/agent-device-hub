// The SDK's module conformance, on the real families. A responder admits only the core, which the kit's requester stands in for.
import {artSchemas} from '@jimmie-potts/event-contracts/v2/art-state';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createArtModule} from '../src/module.js';
import {drawing, fakeImages} from './fixtures.js';

const draft = (targets: string[]) => ({type: 'org.bunny.art.request.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-request/2.0', data: {action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets}});
moduleConformance({
  create: () => createArtModule({providers: {openai: fakeImages(drawing())}}),
  config: {},
  requestSource: 'bunny/core',
  schemas: artSchemas,
  serves: ['art'],
  accepted: {key: 'bunny.cmd.art-request.art', draft: draft(['tidbyt'])},
  refused: {key: 'bunny.cmd.art-request.art', draft: {...draft(['tidbyt']), data: {action: 'cancel', jobRequestId: 'no-such-job'}}, code: 'not-found'},
});
