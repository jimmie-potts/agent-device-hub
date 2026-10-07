// The module test kit's conformance checks for the Pixoo module (Hub #843, #882): manifest, lifecycle, policy A with a
// silent device, sync of its families, copies of the core's sessions and the playback record, a command accepted and
// refused, and its outcome kept in the outbox across a restart.
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createPixooModule} from '../../src/module/module.js';
import {DEVICE_SCHEMA, FAMILIES, pixooSchemas, schemaOf} from '../../src/module/schemas.js';
import {SimulatedPixoo} from '../../src/module/transport.js';
import {DEVICE, FAST, SECTION} from './support.js';

const brightness = (percent: number): {key: string; draft: {type: string; subject: string; dataschema: string; data: {percent: number}}} => ({
  key: `bunny.cmd.brightness-set.${DEVICE}`,
  draft: {type: 'org.bunny.brightness.set.requested', subject: DEVICE, dataschema: schemaOf('brightness-set'), data: {percent}},
});

moduleConformance({
  create: () => createPixooModule({transport: new SimulatedPixoo(), timing: FAST}),
  schemas: pixooSchemas,
  serves: ['device', FAMILIES.display, FAMILIES.rendition, FAMILIES.playlist],
  copies: {families: ['session', 'playback'], snapshot: {revision: 1, states: []}},
  config: SECTION,
  accepted: brightness(40),
  // A playlist the library does not hold is not among the device's capabilities.
  refused: {
    key: `bunny.cmd.media-start.${DEVICE}`, code: 'unsupported-capability',
    draft: {type: 'org.bunny.media.start.requested', subject: DEVICE, dataschema: schemaOf('media-start'), data: {playlistId: '00000000-0000-4000-8000-000000000001'}},
  },
  // The runtime's own reach deadline, 2 s, is longer than the kit allows a start: a start that waited on the device fails.
  offline: {
    create: () => createPixooModule({transport: new SimulatedPixoo({mode: 'silent'})}),
    unavailable: (message: Message) => message.dataschema === DEVICE_SCHEMA && (message.data as Partial<DeviceRecord>).availability === 'unavailable',
  },
});
