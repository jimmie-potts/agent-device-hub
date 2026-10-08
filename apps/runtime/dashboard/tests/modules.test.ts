import assert from 'node:assert/strict';
import test from 'node:test';
import {moduleEntries, moduleOwner} from '../src/modules.ts';
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
