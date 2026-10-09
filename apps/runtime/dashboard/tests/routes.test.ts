// The shell's hash routes (Hub #247, #277), as the runtime dashboard keeps them (Hub #922). The Wispr route waits for
// #927, so its address is missing here.
import assert from 'node:assert/strict';
import test from 'node:test';
import {homeRoute, parseRoute, routeHash, sameRoute, type Route} from '../src/routes.ts';

void test('the home answers to an empty hash and its aliases', () => {
  for (const hash of ['', '#', '#/', '#/home', '#/activity']) assert.deepEqual(parseRoute(hash), homeRoute, hash);
  assert.equal(routeHash(homeRoute), '#/');
});

void test('built-in pages and components are distinct kinds, so an alias named like a page opens only that component', () => {
  assert.deepEqual(parseRoute('#/connections'), {kind: 'connections'});
  assert.deepEqual(parseRoute('#/component/connections'), {kind: 'component', id: 'connections'});
  assert.deepEqual(parseRoute('#/component/activity'), {kind: 'component', id: 'activity'});
  assert.equal(sameRoute(parseRoute('#/component/activity'), homeRoute), false);
  assert.equal(sameRoute(parseRoute('#/component/connections'), {kind: 'connections'}), false);
  assert.deepEqual(parseRoute('#/music/ht-a9'), {kind: 'playback', sourceId: 'ht-a9'});
});

void test('hashes round-trip through the canonical form, including encoded aliases', () => {
  const routes: Route[] = [{kind: 'component', id: 'wall'}, {kind: 'component', id: 'living room/lamp'}, {kind: 'playback', sourceId: 'ht-a9'}, {kind: 'connections'}, {kind: 'automation'}];
  for (const route of routes) assert.deepEqual(parseRoute(routeHash(route)), route);
  assert.equal(routeHash({kind: 'component', id: 'living room/lamp'}), '#/component/living%20room%2Flamp');
});

void test('a hash that is not a route is reported as missing rather than guessed', () => {
  for (const hash of ['#launch=abc', '#/component', '#/component/', '#/component/a/b', '#/music', '#/other', '#connections', '#/wispr/desk']) {
    assert.deepEqual(parseRoute(hash), {kind: 'missing', hash}, hash);
  }
  assert.equal(routeHash({kind: 'missing', hash: '#/other'}), '#/other');
});
