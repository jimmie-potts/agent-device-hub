import assert from 'node:assert/strict';
import test from 'node:test';
import {moduleEntries, moduleOwner} from '../src/modules.ts';
import * as catalog from '../src/modules.ts';
import {parseRoute, routeHash} from '../src/routes.ts';
void test('only exact declared same-origin module page paths enter navigation', () => {
  const entries = moduleEntries({schema: 'module-list/2.0', modules: [{name: 'sign', state: 'running', serves: ['device'], pages: [
    {id: 'preview', title: 'Sign preview', path: '/modules/sign/preview'},
    {id: 'private', title: 'Private', path: 'file:///private'}, {id: 'installed', title: 'Installed', path: 'http://127.0.0.1:8788/'},
    {id: 'escape', title: 'Escape', path: '/modules/sign/../private'},
    {id: 'unknown', title: 'Unknown', path: '/modules/sign/unknown', presentation: 'external'},
    {id: 'assets', title: 'Reserved', path: '/modules/sign/assets'},
    {id: 'library', title: 'Library', path: '/modules/sign/library', presentation: 'react'},
    {id: 'editor', title: 'Editor', path: '/modules/sign/editor', presentation: 'trusted-editor'},
  ]}]});
  assert.deepEqual(entries, [{name: 'sign', state: 'running', serves: ['device'], pages: [
    {id: 'preview', title: 'Sign preview', path: '/modules/sign/preview', presentation: 'passive'},
    {id: 'library', title: 'Library', path: '/modules/sign/library', presentation: 'react'},
    {id: 'editor', title: 'Editor', path: '/modules/sign/editor', presentation: 'trusted-editor'},
  ]}]);
  assert.equal(moduleOwner('core'), 'bunny/core');
  assert.equal(moduleOwner('sign'), 'bunny/modules/sign');
  const route = {kind: 'module', module: 'sign', page: 'preview'} as const;
  assert.deepEqual(parseRoute(routeHash(route)), route);
});

void test('React pages require both a built contribution and a running declaration; frames retain their selected policy', () => {
  const Component = () => null;
  const [module] = moduleEntries({schema: 'module-list/2.0', modules: [{name: 'pixoo', state: 'running', pages: [
    {id: 'library', title: 'Library', path: '/modules/pixoo/library', presentation: 'react'},
    {id: 'preview', title: 'Preview', path: '/modules/pixoo/preview'},
    {id: 'editor', title: 'Editor', path: '/modules/pixoo/editor', presentation: 'trusted-editor'},
  ]}]});
  assert.ok(module);
  const frontend = {module: 'pixoo', pages: [{id: 'library', Component}]};
  assert.deepEqual(catalog.moduleView(module, 'library', [frontend]), {kind: 'react', Component});
  assert.equal(catalog.moduleView(module, 'library', [])?.kind, 'unavailable');
  assert.equal(catalog.moduleView({...module, state: 'failed'}, 'library', [frontend])?.kind, 'unavailable');
  assert.equal(catalog.moduleView(module, 'undeclared', [frontend]), undefined);
  assert.deepEqual(catalog.moduleView(module, 'preview', [frontend]), {kind: 'frame', path: '/modules/pixoo/preview', trusted: false});
  assert.deepEqual(catalog.moduleView(module, 'editor', [frontend]), {kind: 'frame', path: '/modules/pixoo/editor', trusted: true});
});
