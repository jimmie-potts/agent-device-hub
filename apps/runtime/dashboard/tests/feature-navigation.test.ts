// The tabs over device and module pages, and the displays' own views (Hub #1950).
import assert from 'node:assert/strict';
import test from 'node:test';
import {featureNavigation} from '../src/feature-navigation.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';
import {parseRoute, routeHash} from '../src/routes.ts';
import {hardwareRuntime} from './hardware-fixture.ts';

const tabs = (hash: string, runtime: RuntimeData = hardwareRuntime): string[] | undefined => featureNavigation(parseRoute(hash), runtime)?.views.map(view =>
  `${view.current ? '*' : ''}${view.label} ${routeHash(view.route)}${view.pages.length === 0 ? '' : ` [${view.pages.map(page => `${page.current ? '*' : ''}${page.label} ${routeHash(page.route)}`).join(', ')}]`}${
    view.links.length === 0 ? '' : ` -> ${view.links.map(link => link.label).join(', ')}`}`);

void test('Pixoo opens Display, which links Advanced playback and Device settings, with Media for Library and Playlists and Agent status for the Monitor', () => {
  const media = 'Media #/module/pixoo/library [Library #/module/pixoo/library, Playlists #/module/pixoo/playlists]';
  assert.deepEqual(tabs('#/component/pixoo-1'), ['*Display #/component/pixoo-1 -> Advanced playback, Device settings', media, 'Agent status #/module/pixoo/monitor']);
  assert.deepEqual(tabs('#/module/pixoo/settings'), ['Display #/component/pixoo-1 -> Advanced playback, Device settings', media, 'Agent status #/module/pixoo/monitor',
    '*Device settings #/module/pixoo/settings'], 'a linked page is a tab of its own while it is open, at its existing address');
  assert.deepEqual(tabs('#/module/pixoo/player')?.at(-1), '*Advanced playback #/module/pixoo/player');
  assert.deepEqual(tabs('#/module/pixoo/playlists')?.[1], '*Media #/module/pixoo/library [Library #/module/pixoo/library, *Playlists #/module/pixoo/playlists]');
  assert.deepEqual(tabs('#/module/pixoo/monitor')?.[2], '*Agent status #/module/pixoo/monitor');
});

void test('a display view keeps only what is declared, and a page no view names stays reachable', () => {
  const runtime: RuntimeData = {...hardwareRuntime, copies: hardwareRuntime.copies.filter(copy => copy.owner !== 'bunny/modules/pixoo'),
    modules: hardwareRuntime.modules?.map(module => module.name === 'pixoo' ? {...module, pages: [...module.pages.filter(page => page.id !== 'settings'),
      {id: 'clock', title: 'Clock', path: '/modules/pixoo/clock', presentation: 'react' as const}]} : module)};
  assert.deepEqual(tabs('#/module/pixoo/player', runtime), ['*Display #/module/pixoo/player', 'Media #/module/pixoo/library [Library #/module/pixoo/library, Playlists #/module/pixoo/playlists]',
    'Agent status #/module/pixoo/monitor', 'Clock #/module/pixoo/clock'], 'without its record Display opens Advanced playback, and without Settings it links no Device settings');
});

void test('Tidbyt is one view and has no tabs; other modules keep their page tabs', () => {
  assert.equal(featureNavigation(parseRoute('#/component/tidbyt'), hardwareRuntime), undefined);
  assert.equal(featureNavigation(parseRoute('#/module/tidbyt/display'), hardwareRuntime), undefined);
  assert.deepEqual(tabs('#/component/wall'), ['Wall #/module/nanoleaf/wall', 'Saved shows #/module/nanoleaf/shows'], 'a light\'s page shows its brand\'s task pages');
  assert.deepEqual(tabs('#/module/nanoleaf/shows'), ['Wall #/module/nanoleaf/wall', '*Saved shows #/module/nanoleaf/shows']);
  assert.deepEqual(tabs('#/component/desk-plug'), undefined, 'a module with no pages has no tabs');
  assert.equal(featureNavigation(parseRoute('#/rooms'), hardwareRuntime), undefined);
});
