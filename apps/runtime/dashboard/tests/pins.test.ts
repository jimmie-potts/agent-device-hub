// Pages pinned to the rail (Hub #1889): this browser's list, with no dependence on storage, and the pages it can name.
import assert from 'node:assert/strict';
import test from 'node:test';
import {PINS_KEY, PinStore, monogram, parsePins, pinName, pinTargets, pinnableRoute} from '../src/pins.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';
import type {Route} from '../src/routes.ts';

const memory = (): {saved: Map<string, string>; storage: {getItem: (key: string) => string | null; setItem: (key: string, value: string) => void}} => {
  const saved = new Map<string, string>();
  return {saved, storage: {getItem: key => saved.get(key) ?? null, setItem: (key, value) => {saved.set(key, value);}}};
};
const lifx: Route = {kind: 'lighting-brand', brand: 'lifx'}, audio: Route = {kind: 'audio'}, library: Route = {kind: 'module', module: 'pixoo', page: 'library'};

void test('only device, lighting-brand, Audio and module pages can be pinned, and never the Conversation page', () => {
  for (const route of [lifx, audio, library, {kind: 'component', id: 'pixoo-1'}] satisfies Route[]) assert.equal(pinnableRoute(route), true, route.kind);
  for (const route of [{kind: 'home'}, {kind: 'devices'}, {kind: 'settings'}, {kind: 'rooms'}, {kind: 'visualizer'}, {kind: 'playback', sourceId: 'living-room'},
    {kind: 'module', module: 'companions', page: 'assistant'}, {kind: 'missing', hash: '#/nowhere'}] satisfies Route[]) assert.equal(pinnableRoute(route), false, route.kind);
});

void test('a saved list keeps only pinnable addresses, once each, and a damaged value is no pins', () => {
  assert.deepEqual(parsePins(null), []);
  for (const raw of ['', 'not json', 'null', '7', '"#/audio"', '{"0":"#/audio"}', '[1,null,{"route":"#/audio"}]']) assert.deepEqual(parsePins(raw), [], raw);
  assert.deepEqual(parsePins(JSON.stringify(['#/lights/lifx', '#/', '#/devices', '#/audio', 7, '#/lights/lifx', '#/module/companions/assistant', 'launch=abc', '#/audio/visualizer', '#/component/pixoo-1'])),
    ['#/lights/lifx', '#/audio', '#/component/pixoo-1'], 'the order is kept, and a repeat, a hub page and the Conversation page are dropped');
  assert.deepEqual(parsePins('["#/module/pixoo/Library%20two"]'), ['#/module/pixoo/Library%20two'], 'an address is kept in the form a link carries');
});

void test('pinning adds a page at the end, unpinning removes it, and both survive a reload', () => {
  const {saved, storage} = memory();
  const first = new PinStore(() => storage);
  let notified = 0;
  const unsubscribe = first.subscribe(() => {notified += 1;});
  assert.deepEqual(first.getSnapshot(), []);
  first.toggle(lifx);
  first.toggle(library);
  assert.deepEqual(first.getSnapshot(), ['#/lights/lifx', '#/module/pixoo/library']);
  assert.equal(notified, 2);
  assert.deepEqual(JSON.parse(saved.get(PINS_KEY) ?? 'null'), ['#/lights/lifx', '#/module/pixoo/library']);
  assert.deepEqual(new PinStore(() => storage).getSnapshot(), ['#/lights/lifx', '#/module/pixoo/library'], 'a reloaded page reads the pins in order');
  first.toggle(lifx);
  assert.deepEqual(first.getSnapshot(), ['#/module/pixoo/library']);
  assert.deepEqual(new PinStore(() => storage).getSnapshot(), ['#/module/pixoo/library'], 'an unpinned page stays unpinned after a reload');
  first.toggle({kind: 'home'});
  first.toggle({kind: 'module', module: 'companions', page: 'assistant'});
  assert.deepEqual(first.getSnapshot(), ['#/module/pixoo/library'], 'a page that cannot be pinned changes nothing');
  assert.equal(notified, 3);
  unsubscribe();
  first.toggle(audio);
  assert.equal(notified, 3, 'an unsubscribed listener hears nothing more');
});

void test('the snapshot is stable until the pins change', () => {
  const store = new PinStore(() => memory().storage);
  const before = store.getSnapshot();
  assert.equal(store.getSnapshot(), before);
  store.toggle(audio);
  assert.notEqual(store.getSnapshot(), before);
  const pinned = store.getSnapshot();
  store.storageChanged(PINS_KEY, '["#/audio"]');
  assert.equal(store.getSnapshot(), pinned, 'the same list from another tab is not a change');
});

void test('pins work for this page when storage is refused or missing', () => {
  const broken = {getItem: (): string | null => {throw new Error('blocked');}, setItem: (): void => {throw new Error('blocked');}};
  const refused = new PinStore(() => broken);
  assert.deepEqual(refused.getSnapshot(), []);
  refused.toggle(lifx);
  assert.deepEqual(refused.getSnapshot(), ['#/lights/lifx']);
  refused.toggle(lifx);
  assert.deepEqual(refused.getSnapshot(), []);
  const missing = new PinStore(() => {throw new Error('no storage');});
  missing.toggle(audio);
  assert.deepEqual(missing.getSnapshot(), ['#/audio']);
});

void test('a change in another tab is followed, other keys are ignored and a cleared store clears the pins', () => {
  const store = new PinStore(() => memory().storage);
  let notified = 0;
  store.subscribe(() => {notified += 1;});
  store.storageChanged(PINS_KEY, '["#/audio","#/lights/lifx"]');
  assert.deepEqual(store.getSnapshot(), ['#/audio', '#/lights/lifx']);
  assert.equal(notified, 1);
  store.storageChanged(PINS_KEY, '["#/audio","#/lights/lifx"]');
  assert.equal(notified, 1, 'an unchanged value does not notify');
  store.storageChanged('bunny.dashboard.rail.v1', '["#/component/pixoo-1"]');
  assert.deepEqual(store.getSnapshot(), ['#/audio', '#/lights/lifx']);
  store.storageChanged(PINS_KEY, '["#/lights/lifx","#/audio"]');
  assert.deepEqual(store.getSnapshot(), ['#/lights/lifx', '#/audio'], 'a new order is a change');
  store.storageChanged(null, null);
  assert.deepEqual(store.getSnapshot(), [], 'clearing the browser store clears the pins');
  assert.equal(notified, 3);
});

const runtime: RuntimeData = {control: true, catalogFailed: false, modules: [
  {name: 'lifx', state: 'running', serves: ['device'], pages: []},
  {name: 'pixoo', state: 'running', serves: ['device'], pages: [{id: 'library', title: 'Library', path: '/modules/pixoo/library', presentation: 'react'}]},
  {name: 'roborock', state: 'running', serves: ['device'], pages: []},
  {name: 'playback', state: 'running', serves: ['playback'], pages: []},
  {name: 'companions', state: 'running', serves: [], pages: [
    {id: 'assistant', title: 'Conversation', path: '/modules/companions/assistant', presentation: 'react'},
    {id: 'preferences', title: 'Preferences', path: '/modules/companions/preferences', presentation: 'react'},
  ]},
  {name: 'wispr', state: 'failed', serves: [], pages: [{id: 'analytics', title: 'Analytics', path: '/modules/wispr/analytics', presentation: 'react'}]},
], copies: [
  {owner: 'bunny/modules/lifx', family: 'device', synced: true, records: [{id: 'pendant-1', kind: 'lifx', label: 'Pendant'}]},
  {owner: 'bunny/modules/pixoo', family: 'device', synced: true, records: [{id: 'pixoo-1', kind: 'pixoo'}]},
  {owner: 'bunny/modules/roborock', family: 'device', synced: true, records: [{id: 'vacuum', kind: 'roborock', label: 'Downstairs vacuum'}]},
] as unknown as RuntimeData['copies']};

void test('every page the directory lists can be pinned, and so can a light\'s own page', () => {
  const before = JSON.stringify(runtime);
  const targets = pinTargets(runtime);
  assert.deepEqual([...targets.values()].map(target => `${target.hash} = ${pinName(target)} [${target.mono}]`), [
    '#/lights/lifx = LIFX [LI]',
    '#/component/pixoo-1 = Pixoo · pixoo-1 [PP]',
    '#/module/pixoo/library = Pixoo · Library [PL]',
    '#/component/vacuum = Roborock [Ro]',
    '#/audio = Music [Mu]',
    '#/module/companions/preferences = Companions · Preferences [CP]',
    '#/module/wispr/analytics = Wispr · failed [Wi]',
    '#/component/pendant-1 = LIFX · Pendant [LP]',
  ]);
  assert.equal(targets.has('#/module/companions/assistant'), false, 'the Conversation page has no pin');
  assert.equal(targets.has('#/module/pixoo/player'), false, 'a page the catalog does not declare cannot be shown as a pin');
  assert.deepEqual(targets.get('#/module/pixoo/library'), {hash: '#/module/pixoo/library', route: library, name: 'Library', group: 'Pixoo', mono: 'PL', note: ''});
  assert.equal(targets.get('#/module/wispr/analytics')?.note, 'failed', 'a page of a module that is not running carries the module\'s state');
  const stopped = pinTargets({...runtime, modules: runtime.modules?.map(module => module.name === 'lifx' ? {...module, state: 'stopped'} : module)});
  assert.deepEqual([stopped.get('#/lights/lifx')?.note, stopped.get('#/component/pendant-1')?.note, stopped.get('#/component/pixoo-1')?.note], ['stopped', 'stopped', ''],
    'a stopped module marks its brand page and its lights\' own pages, and no other module\'s');
  const unlisted = pinTargets({...runtime, modules: runtime.modules?.filter(module => module.name !== 'lifx')});
  assert.equal(unlisted.get('#/component/pendant-1')?.note, '', 'a device whose owner the catalog does not list has no state to show');
  assert.equal(JSON.stringify(runtime), before, 'the projection does not change the runtime copies');
  assert.equal(pinTargets({...runtime, modules: undefined, copies: []}).size, 0, 'nothing is declared until the catalog is read');
});

void test('a page has a short mark for the icon rail', () => {
  assert.equal(monogram('Roborock', ''), 'Ro');
  assert.equal(monogram('Wall', 'Nanoleaf'), 'NW');
  assert.equal(monogram('sign preview', 'sign'), 'SS');
  assert.equal(monogram('B.U.N.N.Y.', ''), 'BU', 'punctuation is skipped');
  assert.equal(monogram('…', ''), '·', 'a name with no letter still has a mark');
  assert.equal(pinName({name: 'Wall', group: 'Nanoleaf'}), 'Nanoleaf · Wall');
  assert.equal(pinName({name: 'Roborock', group: ''}), 'Roborock');
  assert.equal(pinName({name: 'Wall', group: 'Nanoleaf', note: 'stopped'}), 'Nanoleaf · Wall · stopped');
  assert.equal(pinName({name: 'Roborock', group: '', note: ''}), 'Roborock');
});
