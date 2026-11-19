// The core forwards the companions module's approved assistant commands through its tracked dispatcher (Hub #46):
// one operation requested by the module, only the allowlisted family and target, and only from that module.
import assert from 'node:assert/strict';
import type {AssistantDispatch} from '@jimmie-potts/event-contracts/v2/assistant';
import type {InboxItem, ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {catalogFamily, catalogRoute, type CatalogBinding, type CatalogFamily} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {registerDeviceFamilies, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {starter} from '@jimmie-potts/event-contracts/v2/nanoleaf-shows';
import {lifxSchemas} from '@jimmie-potts/lifx';
import {nanoleafSchemas} from '@jimmie-potts/nanoleaf';
import {pixooOwnSchemas} from '@jimmie-potts/pixoo';
import {volcanoSchemas} from '@jimmie-potts/volcano';
import {wemoSchemas} from '@jimmie-potts/wemo';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {dispatchCatalogAction} from '../src/core/assistant-actions.js';
import type {Action, ActionAnswer} from '../src/core/tracker.js';
import {contextOf, fixture, it, run, waitFor} from './support.js';

const draft = <D extends AssistantDispatch>(data: D) => ({type: 'org.bunny.assistant.dispatch.requested', subject: 'assistant',
  dataschema: 'https://bunny.invalid/events/assistant-dispatch/2.0', data});

it('only companions can dispatch an allowlisted mode-set, tracked as its own operation, and nothing else', async context => {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  const companions = fixture('companions');
  const other = fixture('assistant-other');
  await run(context, {modules: [core, companions, other]});
  const modes: ModeState[] = [];
  const copy = await contextOf(companions).sdk.sync<ModeState>(['mode'], change => {
    if (change.type === 'updated') modes.push(change.message.data);
  }, {owner: 'bunny/core', timeoutMs: 5000});
  assert.equal(copy.status, 'synced');
  context.after(() => copy.status === 'synced' ? copy.copy.close() : Promise.resolve());
  const current = copy.status === 'synced' ? copy.copy.states().find(message => message.data.id === 'hub')?.data : undefined;
  assert.ok(current, 'the core serves its Hub mode');
  const requestId = 'assistant-mode-test';
  const data: AssistantDispatch = {requestId, family: 'mode-set', target: 'hub', data: {mode: current.mode === 'work' ? 'quiet' : 'work', expectedRevision: current.revision}};

  const refused = await contextOf(other).sdk.request('bunny.cmd.assistant-dispatch.assistant', draft(data), {timeoutMs: 2000, requestId: 'assistant-other-test'});
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'forbidden');
  assert.equal(handle?.operation('assistant-other-test'), undefined);

  const send = (payload: AssistantDispatch, id = payload.requestId) => contextOf(companions).sdk.request('bunny.cmd.assistant-dispatch.assistant', draft(payload), {timeoutMs: 2000, requestId: id});
  const wrongFamily = await send({...data, family: 'power-set' as 'mode-set', requestId: 'assistant-family-test'});
  assert.equal(wrongFamily.status === 'rejected' && wrongFamily.error.error.code, 'invalid-message');
  const wrongTarget = await send({...data, target: 'wall' as 'hub', requestId: 'assistant-target-test'});
  assert.equal(wrongTarget.status === 'rejected' && wrongTarget.error.error.code, 'invalid-message');
  assert.equal(handle?.operation('assistant-family-test'), undefined);
  assert.equal(handle?.operation('assistant-target-test'), undefined);

  assert.equal((await send(data)).status, 'accepted');
  await waitFor(() => handle?.operation(requestId)?.status === 'completed');
  const operation = handle?.operation(requestId);
  assert.equal(operation?.requestedBy, 'bunny/modules/companions');
  assert.equal(operation?.family, 'mode-set');
  assert.equal(operation?.result, 'succeeded');
  await waitFor(() => modes.some(mode => mode.id === 'hub' && mode.mode === data.data.mode));

  // The same request identity is answered again without a second operation; a stale revision is refused by the owner.
  assert.equal((await send(data)).status, 'accepted');
  assert.equal(handle?.operation(requestId)?.result, 'succeeded');
  const stale = await send({...data, requestId: 'assistant-stale-test'});
  assert.equal(stale.status === 'rejected' && stale.error.error.code, 'revision-conflict');
  assert.equal(handle?.operation('assistant-stale-test')?.status, 'rejected');
  // #1657 (AC3): the stale revision can never match again, so the refusal stays in history and the assistant's own
  // reply reports it; it opens no inbox item.
  assert.equal(handle?.operation('assistant-stale-test')?.error?.code, 'revision-conflict');
  const inbox = await contextOf(other).sdk.sync<InboxItem>(['inbox-item'], () => {}, {owner: 'bunny/core', timeoutMs: 2000});
  assert.equal(inbox.status, 'synced');
  if (inbox.status === 'synced') {
    assert.deepEqual(inbox.copy.states().map(message => message.data.item.requestId), []);
    await inbox.copy.close();
  }
});

it('every catalog route delivers its exact input and guards to the existing owner contract', async () => {
  const timestamp = Date.parse('2026-11-05T00:00:00.000Z');
  const hash = 'a'.repeat(64);
  const uuid = '11111111-1111-4111-8111-111111111111';
  const input: Record<CatalogFamily, Record<string, unknown>> = {
    'power-set': {on: true},
    'brightness-set': {percent: 25},
    'device-mode-set': {mode: 'free'},
    'lifx-color-set': {hue: 90, saturation: 50},
    'lifx-temperature-set': {kelvin: 4000},
    'scene-activate': {sceneId: 'scene-' + hash},
    'moment-play': {momentId: 'fixture-moment', mood: 'celebrate', palette: ['#ffaabb'], durationMs: 30_000,
      priorityClass: 'event', coversStatus: false, startAtMs: timestamp + 5000, toleranceMs: 2000},
    'media-start': {playlistId: uuid},
    'media-control': {action: 'pause'},
    'pixoo-media-show': {renditionId: hash, playback: {mode: 'plays', totalPlays: 1}},
    'pixoo-monitor-set': {filter: {}, cadenceMs: 3000},
    'pixoo-now-playing-set': {media: 'off'},
    'pixoo-moments-set': {overStatus: true},
    'nanoleaf-animation-play': {animation: {preset: 'ocean'}},
    'pixoo-playlist-change': {change: {operation: 'create', name: 'Fixture playlist'}},
    'pixoo-asset-change': {change: {operation: 'render', assetId: uuid}},
    'pixoo-notice-dismiss': {session: hash, noticeId: 'fixture-notice'},
    'nanoleaf-wall-edit': {edit: {kind: 'settings', settings: {rotation: 90}}},
    'nanoleaf-machine-edit': {edit: {kind: 'settings', settings: {style: 'project'}}},
    'nanoleaf-favorite-edit': {edit: {kind: 'rename', name: 'Old name', newName: 'New name'}},
    'nanoleaf-notice-acknowledge': {task: 'synthetic-task', noticeId: hash},
    'nanoleaf-reactive-preset-save': {presetId: 'preset-synthetic', expectedRevision: 7, name: 'Fixture preset',
      recipe: {rendererVersion: 1, effect: 'ambient', palette: ['#ffaabb']}},
    'wemo-hold-release': {heldRequestId: 'held-operation'},
    'playback-control': {action: 'pause'},
    'volcano-session-gap': {gapMinutes: 30},
    'art-show': {artworkId: 'synthetic-artwork', targets: ['browser', 'device']},
    'nanoleaf-show-save': starter('ocean', 'show-synthetic'),
    'music-lighting-control': {action: 'start-show', showId: 'show-synthetic', version: 1, positionMs: 0, startDelayMs: 250},
  };
  const common = {expiresat: new Date(timestamp + 10_000).toISOString(), specversion: '1.0', bunnyprofile: '2.0', kind: 'command', datacontenttype: 'application/json',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', time: new Date(timestamp).toISOString()} as const;
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerDeviceFamilies(validator);
  const schemas = {...lifxSchemas, ...nanoleafSchemas, ...pixooOwnSchemas, ...wemoSchemas, ...volcanoSchemas};
  for (const [id, schema] of Object.entries(schemas)) validator.register(id, schema);

  for (const [family, data] of Object.entries(input).filter((entry): entry is [CatalogFamily, Record<string, unknown>] => catalogFamily(entry[0]))) {
    const route = catalogRoute(family);
    const owners = route.binding === 'device' ? route.owners : [route.owner];
    for (const owner of owners) {
      const target = route.binding === 'fixed' ? route.target : 'device';
      const held = family === 'wemo-hold-release';
      const record = deviceRecord(target, 7, owner.split('/').at(-1) ?? 'device', held ? 'unavailable' : 'available');
      if (held) record.held = {requestId: 'held-operation', heldAtMs: timestamp};
      const binding: CatalogBinding = route.binding === 'device'
        ? {kind: 'device', owner, target, configurationRevision: record.configurationRevision, generation: record.generation}
        : route.binding === 'record' ? {kind: 'record', owner, target, revision: 7}
          : {kind: 'fixed', owner, target};
      const operation = ({key, draft: outgoing, requestedBy, requestId = ''}: Action): Promise<ActionAnswer> => {
        assert.equal(key, `bunny.cmd.${family}.${target}`);
        assert.equal(requestedBy, 'bunny/modules/companions');
        const guard = binding.kind === 'device' ? {expectedConfigurationRevision: binding.configurationRevision, expectedGeneration: binding.generation}
          : binding.kind === 'record' ? (family === 'volcano-session-gap' ? {expectedConfigurationRevision: 7} : {expectedRevision: 7}) : {};
        const save = family === 'nanoleaf-show-save' ? {admitByMs: timestamp + 1000} : {};
        assert.deepEqual(outgoing.data, {...data, ...guard, ...save});
        const result = validator.validate({...common, ...outgoing, id: 'forwarded-fixture', source: 'bunny/core', data: {...outgoing.data, requestId}});
        assert.ok(result.ok, `${family} for ${owner}: ${!result.ok ? result.error.detail : ''}`);
        return Promise.resolve({status: 'accepted', requestId});
      };
      const device = (): Message<DeviceRecord> => {
        const capabilities: DeviceRecord['capabilities'] = {...record.capabilities,
          power: {supported: true}, brightness: {supported: true, minimum: 0, maximum: 100},
          scenes: {supported: true, sceneIds: ['scene-' + hash]}, modes: {supported: true, values: ['free']},
          moments: {supported: true, moods: ['celebrate'], maxDurationMs: 30000, coversStatus: false},
          media: {supported: true, actions: ['pause'], playlistIds: [uuid], renditionIds: [hash]}};
        return {...common, ...deviceState({...record, capabilities}), id: 'fixture-device', source: owner, kind: 'state',
          data: {...record, capabilities}};
      };
      const requestId = 'catalog-fixture';
      const answer = await dispatchCatalogAction({dispatch: operation, operation: () => undefined, clock: {now: () => timestamp}},
        {...common, ...draft({requestId, family: 'catalog-action', command: family, target, binding, data,
          ...(family === 'nanoleaf-show-save' ? {admitByMs: timestamp + 1000} : {})}),
        id: requestId, source: 'bunny/modules/companions'}, device, operation);
      assert.deepEqual(answer, {status: 'accepted', requestId}, `${family} for ${owner}`);
    }
  }
});
