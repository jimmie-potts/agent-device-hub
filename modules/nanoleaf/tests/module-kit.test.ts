// The Nanoleaf module runs the module test kit (Hub #882, #919), as every module does: its manifest and section, its
// start and stop, policy A's check (a start that never waits on its device, which it then reports unavailable), its
// served families, its copy of the core's sessions, a command it accepts and one it refuses, and the outcome its outbox
// keeps and sends again after a restart. The kit's checks run in real time on simulated controllers.
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createNanoleafModule, nanoleafMessageSchemas, SimulatedNanoleaf, SYNTHETIC_TOKEN} from '../src/index.js';
import {READ_FAMILIES, SECTION} from './module-support.js';

const reportsUnavailable = (message: Message): boolean =>
  message.dataschema === 'https://bunny.invalid/events/device/2.0' && (message.data as {availability?: unknown}).availability === 'unavailable';

moduleConformance({
  create: () => createNanoleafModule({transport: new SimulatedNanoleaf().request}),
  schemas: nanoleafMessageSchemas,
  serves: [...READ_FAMILIES],
  copies: {families: ['session'], snapshot: {revision: 1, states: []}},
  accepted: {key: 'bunny.cmd.device-mode-set.wall', draft: {type: 'org.bunny.device-mode.set.requested', subject: 'wall',
    dataschema: 'https://bunny.invalid/events/device-mode-set/2.0', data: {mode: 'quiet'}}},
  refused: {key: 'bunny.cmd.moment-play.wall', draft: {type: 'org.bunny.moment.play.requested', subject: 'wall',
    dataschema: 'https://bunny.invalid/events/moment-play/2.0', data: {momentId: 'm1', mood: 'calm', durationMs: 1000, priorityClass: 'event',
      coversStatus: false, startAtMs: Date.now(), toleranceMs: 100}}, code: 'unsupported-capability'},
  config: SECTION,
  secrets: {token: SYNTHETIC_TOKEN},
  offline: {create: () => createNanoleafModule({transport: new SimulatedNanoleaf({online: false}).request}), unavailable: reportsUnavailable},
});
