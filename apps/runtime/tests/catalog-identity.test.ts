import assert from 'node:assert/strict';
import {it} from 'node:test';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {BunnyModule, ModuleManifest} from '@jimmie-potts/sdk';
import {hostedCatalogIdentity} from '../src/core/catalog-identity.js';
import {edgeConfig, manualClock, run, type EdgePart} from './support.js';

void it('resolves names through only their fixed owner content references and strips response details', async () => {
  const clock = manualClock(1000);
  const scene = 'scene-' + 'a'.repeat(64);
  const asset = '11111111-1111-4111-8111-111111111111';
  const requests: unknown[] = [];
  const content: NonNullable<ModuleManifest['content']> = (ref, request) => {
    assert.ok(request);
    requests.push({ref, query: request.query});
    if (request.query.name === 'Ambiguous name') return errorBody('invalid-state', {detail: 'Private detail'});
    const id = ref === 'scene-id-by-name' ? scene : asset;
    return {type: 'application/json', bytes: Buffer.from(JSON.stringify(request.query.name === 'Unexpected fields'
      ? {id, label: 'Private label'} : {id}))};
  };
  const host = {
    modules: () => ['nanoleaf', 'pixoo'].map(name => ({name, admitted: true, manifest: {apiVersion: '1.3', content}})),
    invoke: async <T>(name: string, call: () => T | Promise<T>): Promise<T> => {requests.push(name); return call();},
  };
  const lookup = hostedCatalogIdentity(host, clock.scheduler);
  assert.deepEqual(await lookup({kind: 'scene', deviceId: 'wall', name: 'Saved waves'}, 1200), {id: scene});
  assert.deepEqual(await lookup({kind: 'asset', name: 'Original'}, 1200), {id: asset});
  assert.deepEqual(requests, ['nanoleaf', {ref: 'scene-id-by-name', query: {device: 'wall', name: 'Saved waves'}},
    'pixoo', {ref: 'asset-id-by-name', query: {name: 'Original'}}]);
  assert.deepEqual(await lookup({kind: 'asset', name: 'Ambiguous name'}, 1200), errorBody('invalid-state'));
  assert.deepEqual(await lookup({kind: 'asset', name: 'Unexpected fields'}, 1200), errorBody('unavailable'));
  assert.equal(clock.pending(), 0);
});

void it('bounds the owner lookup and ignores a late reply', async () => {
  const clock = manualClock(1000);
  let signal: AbortSignal | undefined;
  const content: NonNullable<ModuleManifest['content']> = (_ref, request) => {
    signal = request?.signal;
    return new Promise<never>(() => {});
  };
  const lookup = hostedCatalogIdentity({
    modules: () => [{name: 'nanoleaf', admitted: true, manifest: {apiVersion: '1.3', content}}],
    invoke: async <T>(_name: string, call: () => T | Promise<T>): Promise<T> => call(),
  }, clock.scheduler);
  const found = lookup({kind: 'scene', deviceId: 'wall', name: 'Saved waves'}, 1200);
  clock.advance(1200);
  assert.deepEqual(await found, errorBody('unavailable'));
  assert.equal(signal?.aborted, true);
});

void it('the authenticated gateway keeps the two identity references local and serves existing content', async context => {
  const reader: EdgePart = {id: 'catalog-reader', source: 'bunny/parts/catalog-reader', token: 'tok_SYNTHETIC2183_catalog_reader', scopes: ['read']};
  const files = await edgeConfig(context, [reader]);
  const requests: string[] = [];
  const modules = ['nanoleaf', 'pixoo', 'companion-fixture'].map(name => ({
    manifest: {name, apiVersion: '1.3', content: (ref: string) => {
      requests.push(`${name}/${ref}`);
      return {type: 'application/json', bytes: Buffer.from('{}')};
    }},
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  } satisfies BunnyModule));
  const {runtime} = await run(context, {modules, configFile: files.config, edge: {schemas: {}}});
  const read = (path: string) => fetch(new URL(path, runtime.url), {headers: {authorization: `Bearer ${reader.token}`}});
  for (const path of ['/modules/nanoleaf/content/scene-id-by-name?name=Private', '/modules/pixoo/content/asset-id-by-name?name=Private']) {
    const response = await read(path);
    assert.equal(response.status, 404);
    assert.equal((await response.text()).includes('Private'), false);
  }
  for (const path of ['/modules/nanoleaf/content/show-version', '/modules/pixoo/content/catalog-media',
    '/modules/companion-fixture/content/asset-id-by-name']) {
    const response = await read(path);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
  }
  assert.deepEqual(requests, ['nanoleaf/show-version', 'pixoo/catalog-media', 'companion-fixture/asset-id-by-name']);
});
