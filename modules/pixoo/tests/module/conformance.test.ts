// The module test kit's conformance checks for the Pixoo module (Hub #843, #882): manifest, lifecycle, policy A with a
// silent device, sync of its families, copies of the core's sessions and the playback record, a command accepted and
// refused, and its outcome kept in the outbox across a restart.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MessageValidator, SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createPixooModule} from '../../src/module/module.js';
import {DEVICE_SCHEMA, DISPLAY_SCHEMA, FAMILIES, pixooOwnSchemas, pixooSchemas, schemaOf} from '../../src/module/schemas.js';
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

// ADR 0014: the display record reports the Hub's mode and the base on the display, and a show takes no mode precondition.
void test('pixoo-display/2.1 reports the Hub mode, the base and moments over status, and a show carries no requireMode', () => {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  for (const [dataschema, schema] of Object.entries(pixooOwnSchemas)) validator.register(dataschema, schema);
  assert.ok(Object.hasOwn(pixooOwnSchemas, DISPLAY_SCHEMA), 'the module publishes pixoo-display/2.1');
  assert.equal(DISPLAY_SCHEMA, `${SCHEMA_BASE}${FAMILIES.display}/2.1`);
  const display = {
    id: DEVICE, revision: 3, mode: 'work', pendingMode: null, base: 'status', participating: true, showing: 'dashboard',
    monitor: {filter: {}, cadenceMs: 1000, connection: 'current', sessions: 1, matched: 1, attention: 0, page: 0, pages: 1},
    nowPlaying: {media: 'off', card: false, stale: false, takeover: null},
    player: {state: 'idle', intent: 'stopped', playlistId: null, itemId: null, renditionId: null, lastError: null},
    moments: {overStatus: true, playing: null},
  };
  const state = (data: object, dataschema = DISPLAY_SCHEMA): Message => ({
    specversion: '1.0', bunnyprofile: '2.0', id: 'msg-display', source: 'bunny/modules/pixoo', type: 'org.bunny.pixoo-display.updated', subject: DEVICE,
    time: '2026-11-08T12:00:00.000Z', kind: 'state', datacontenttype: 'application/json', dataschema,
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data,
  } as unknown as Message);
  for (const mode of ['work', 'free', 'quiet']) {
    for (const base of ['status', 'playback']) {
      const checked = validator.validate(state({...display, mode, pendingMode: mode, base}));
      assert.equal(checked.ok, true, `${mode} over ${base}: ${JSON.stringify(checked)}`);
    }
  }
  for (const broken of [{mode: 'monitor'}, {mode: 'media'}, {pendingMode: 'monitor'}, {base: 'nothing'}, {moments: {overMonitor: true, playing: null}}]) {
    assert.equal(validator.validate(state({...display, ...broken})).ok, false, JSON.stringify(broken));
  }
  const show = (data: object): Message => ({
    specversion: '1.0', bunnyprofile: '2.0', id: 'msg-show', source: 'bunny/core', type: 'org.bunny.pixoo-media.show.requested', subject: DEVICE,
    time: '2026-11-08T12:00:00.000Z', kind: 'command', datacontenttype: 'application/json', dataschema: schemaOf(FAMILIES.show),
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', expiresat: '2026-11-08T12:00:05.000Z', data,
  } as unknown as Message);
  const renditionId = 'a'.repeat(64);
  assert.equal(validator.validate(show({requestId: 'req-show', renditionId}), {nowMs: Date.parse('2026-11-08T12:00:00.000Z')}).ok, true);
  assert.equal(validator.validate(show({requestId: 'req-show', renditionId, requireMode: 'media'}), {nowMs: Date.parse('2026-11-08T12:00:00.000Z')}).ok, false);
  // The setting a moment over the status base follows is now named after that base.
  const moments = {...show({requestId: 'req-moments', overStatus: false}), type: 'org.bunny.pixoo-moments.set.requested', dataschema: schemaOf(FAMILIES.moments)} as Message;
  assert.equal(validator.validate(moments, {nowMs: Date.parse('2026-11-08T12:00:00.000Z')}).ok, true);
  assert.equal(validator.validate({...moments, data: {requestId: 'req-moments', overMonitor: false}} as Message, {nowMs: Date.parse('2026-11-08T12:00:00.000Z')}).ok, false);
});
