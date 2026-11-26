import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {DEVICE_READBACK_SCHEMA, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {InProcessBus, type BunnyModule} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {ConversationActions, type CatalogAdmission, type CatalogIdentityQuery} from '../src/assistant/catalog-actions.js';

import {catalogSelectorSelected, readCatalogReferences} from '../src/assistant/catalog-grounding.js';
import {exactControlIds, type ModelControlScope} from '../src/assistant/model-control.js';

void test('catalog references must match a complete phrase in the cited current source', () => {
  const scope: ModelControlScope = {request: {id: 'request', revision: 1, text: 'Show Dawn on the wall.'},
    answer: {id: 'answer', revision: 1, text: 'Use id:wall-right.'}, exactTargets: [], history: [], references: [], modeRevision: null};
  const request = {role: 'artwork', source: 'request', kind: 'named', quote: 'Dawn'};
  const answer = {role: 'primary', source: 'answer', kind: 'named', quote: 'id:wall-right'};
  assert.deepEqual(readCatalogReferences([request, answer], scope), [request, answer]);
  for (const reference of [{...answer, source: 'request'}, {...answer, quote: 'wall'}, {...request, quote: 'Northern Dawn'},
    {...request, role: 'anything'}]) assert.equal(readCatalogReferences([reference], scope), undefined);
  assert.equal(readCatalogReferences([request, request], scope), undefined);
});

void test('a current named destructive asset selection never falls back to an earlier original', () => {
  const previous = '11111111-1111-4111-8111-111111111111';
  const scope = (text: string): ModelControlScope => ({request: {id: 'request', revision: 1, text},
    exactTargets: exactControlIds(text), history: [], references: [], modeRevision: null});
  const earlier = [`Use asset id:${previous}`];
  for (const name of ['Sunrise', 'Missing Sunrise']) {
    const request = scope(`Delete asset ${name} on id:desk-pixoo`);
    assert.equal(catalogSelectorSelected('asset', previous, request, earlier, ['desk-pixoo']), false);
    assert.equal(catalogSelectorSelected('asset', name, request, earlier, ['desk-pixoo']), true);
  }
  assert.equal(catalogSelectorSelected('asset', previous, scope('Delete it on id:desk-pixoo'), earlier, ['desk-pixoo']), true);
});

void test('catalog proposals bind only names from owner context to their existing guarded commands', async context => {
  const bus = new InProcessBus();
  const nanoleaf = bus.connect('bunny/modules/nanoleaf');
  const pixoo = bus.connect('bunny/modules/pixoo');
  const root = await mkdtemp(join(tmpdir(), 'catalog-owner-identity-'));
  const sceneId = 'scene-' + 'a'.repeat(64), assetId = '11111111-1111-4111-8111-111111111111';
  const unsupported = {supported: false} as const, unknown = {status: 'unknown'} as const;
  const device = (id: string, kind: DeviceRecord['kind']): DeviceRecord => ({
    id, label: id, kind, revision: 1, configurationRevision: 7, generation: {epoch: 'start-1', sequence: 0},
    availability: 'available', capabilities: {power: unsupported, brightness: unsupported, modes: unsupported,
      media: unsupported, moments: unsupported, preview: unsupported, zones: unsupported,
      scenes: kind === 'nanoleaf' ? {supported: true, sceneIds: [sceneId]} : unsupported},
    desired: {power: unknown, brightness: unknown, mode: unknown}, observed: unknown, pending: 0, pendingKinds: [],
    lastOutcome: unknown, lastTransmission: unknown, externalControl: unknown,
  });
  for (const [participant, data] of [[nanoleaf, device('wall', 'nanoleaf')], [pixoo, device('display', 'pixoo')]] as const) {
    await participant.serveSync(['device'], () => ({revision: 1, states: [
      {type: 'org.bunny.device.updated', subject: data.id, dataschema: DEVICE_READBACK_SCHEMA, data},
    ]}));
  }
  const requests: CatalogIdentityQuery[] = [];
  let granted = true, revokeOnLookup = false;
  let actions: ConversationActions | undefined;
  const module: BunnyModule = {manifest: {name: 'companions', apiVersion: '1.3'}, start: sdk => {
    actions = new ConversationActions(sdk, [], {instant: String, powerLimit: () => ''}, undefined, query => {
      requests.push(query);
      if (revokeOnLookup) granted = false;
      return Promise.resolve(query.kind === 'scene' ? {id: sceneId}
        : query.name === 'Duplicate' ? errorBody('invalid-state') : {id: assetId});
    });
    return Promise.resolve();
  }, stop: () => Promise.resolve()};
  const host = new ModuleHarness(module, {bus, stateDir: root});
  context.after(async () => {await host.stop(); await nanoleaf.close(); await pixoo.close(); await rm(root, {recursive: true, force: true});});
  await host.start();
  const catalog = actions ?? assert.fail('started Catalog owner fixture');
  const trace = {traceparent: '00-11111111111111111111111111111111-2222222222222222-01'};
  const admit = (name: string): CatalogAdmission => ({selector: (_kind, value) => value === name,
    target: () => granted ? undefined : 'forbidden', current: () => true, visible: () => granted,
    covers: () => true, ownerText: () => ({text: '', explicitIds: []})});
  const show = (name: string, ownerName: string) => catalog.propose('scene-activate', {id: 'scene', name: 'control_scene_activate',
    input: {owner: 'bunny/modules/nanoleaf', target: 'wall', arguments: JSON.stringify({sceneId: name})}}, trace, () => true, admit(ownerName));
  assert.deepEqual(await show('Unrequested scene', 'Saved waves'), {code: 'invalid-request'});
  assert.deepEqual(requests, []);
  const ready = await show('Saved waves', 'Saved waves');
  assert.ok('proposal' in ready);
  assert.deepEqual(ready.proposal.data, {sceneId});
  assert.deepEqual(ready.proposal.binding, {kind: 'device', target: 'wall', owner: 'bunny/modules/nanoleaf', configurationRevision: 7,
    generation: {epoch: 'start-1', sequence: 0}});
  const asset = (name: string, target = 'display') => catalog.propose('pixoo-asset-change', {id: 'asset', name: 'control_pixoo_asset_change',
    input: {owner: 'bunny/modules/pixoo', target, arguments: JSON.stringify({change: {operation: 'delete', assetId: name}})}},
  trace, () => true, admit(name));
  const selected = await asset('Original');
  assert.ok('proposal' in selected);
  assert.deepEqual(selected.proposal.data, {change: {operation: 'delete', assetId}});
  assert.ok('question' in await asset('Duplicate'));
  assert.deepEqual(requests, [{kind: 'scene', deviceId: 'wall', name: 'Saved waves'},
    {kind: 'asset', name: 'Original', currentText: ''}, {kind: 'asset', name: 'Duplicate', currentText: ''}]);
  granted = false;
  for (const target of ['id:display', 'id:unconfigured', 'display', 'unused label']) {
    assert.deepEqual(await asset('Duplicate', target), {code: 'not-found'});
  }
  assert.deepEqual(await show('Saved waves', 'Saved waves'), {code: 'not-found'});
  assert.equal(requests.length, 3, 'a denied device cannot be probed for private names');
  granted = true;
  revokeOnLookup = true;
  assert.deepEqual(await asset('Duplicate'), {code: 'forbidden'});
  assert.equal(requests.length, 4, 'revocation while waiting withholds the duplicate result');
  granted = true;
  assert.deepEqual(await show('Saved waves', 'Saved waves'), {code: 'forbidden'});
  assert.equal(requests.length, 5, 'revocation while waiting withholds the scene match');

});
