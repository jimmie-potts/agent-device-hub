// The jump palette's entry list and filter (Hub #1888): a projection of the shell's destinations and the catalog's
// declared pages, with no reads or commands of its own.
import assert from 'node:assert/strict';
import test from 'node:test';
import {JUMP_RECENTS, filterJump, jumpEntries, jumpShortcut, rememberRoute, textInput, type JumpKeyPlace, type JumpKeyPress} from '../src/jump.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';
import {routeHash, type Route} from '../src/routes.ts';

const runtime: RuntimeData = {control: true, catalogFailed: false, copies: [], modules: [
  {name: 'lifx', state: 'running', serves: ['device'], pages: []},
  {name: 'art', state: 'running', serves: ['art'], pages: [{id: 'gallery', title: 'Art Gallery', path: '/modules/art/gallery', presentation: 'react'}]},
  {name: 'playback', state: 'running', serves: ['playback'], pages: []},
  {name: 'speaker', state: 'running', serves: ['playback'], pages: []},
  {name: 'companions', state: 'running', serves: [], pages: [
    {id: 'assistant', title: 'Conversation', path: '/modules/companions/assistant', presentation: 'react'},
    {id: 'preferences', title: 'Preferences', path: '/modules/companions/preferences', presentation: 'react'},
  ]},
  {name: 'wispr', state: 'failed', serves: [], pages: [{id: 'analytics', title: 'Analytics', path: '/modules/wispr/analytics', presentation: 'react'}]},
], copies: [{owner: 'bunny/modules/lifx', family: 'device', synced: true, records: [{id: 'pendant-1', kind: 'lifx'}]}] as unknown as RuntimeData['copies']};
const home: Route = {kind: 'home'};
const names = (entries: readonly {group: string; label: string}[]): string[] => entries.map(entry => `${entry.group}: ${entry.label}`);

void test('the palette lists the hub destinations, every device page and each page a running module declares, once', () => {
  const before = JSON.stringify(runtime);
  const entries = jumpEntries(runtime, [], home);
  assert.deepEqual(names(entries), [
    'Hub: Home', 'Hub: Companions', 'Hub: Rooms', 'Hub: Devices', 'Hub: Automation', 'Hub: Timeline', 'Hub: Audio', 'Hub: Habitat', 'Hub: Settings', 'Hub: Connections',
    'Device pages: LIFX', 'Device pages: LIFX · Pendant 1',
    'Pages: Art · Art Gallery', 'Pages: Companions · Conversation', 'Pages: Companions · Preferences',
  ], 'pages outside the hardware inventory and each light\'s own page are still offered (Hub #1950)');
  assert.equal(entries.filter(entry => routeHash(entry.route) === '#/audio').length, 1, 'Audio is one hub entry');
  assert.equal(entries.some(entry => entry.label.includes('Analytics')), false, 'a module that is not running is not offered');
  assert.deepEqual(entries.find(entry => entry.label === 'LIFX'), {group: 'Device pages', label: 'LIFX', hint: 'Lighting', route: {kind: 'lighting-brand', brand: 'lifx'}});
  assert.deepEqual([entries.find(entry => entry.label === 'Timeline')?.hint, entries.find(entry => entry.label === 'Audio')?.hint, entries.find(entry => entry.label === 'Habitat')?.hint],
    ['Home', 'Home', 'Companions']);
  assert.deepEqual(entries.find(entry => entry.label === 'Companions · Preferences')?.hint, 'Companions');
  assert.equal(JSON.stringify(runtime), before, 'the projection does not change the runtime copies');
});

void test('a page named like its module is offered under the one name', () => {
  const named: RuntimeData = {control: true, catalogFailed: false, modules: [{name: 'tidbyt', state: 'running', serves: ['device'], pages: [
    {id: 'display', title: 'Tidbyt display', path: '/modules/tidbyt/display', presentation: 'react'}]}],
  copies: [{owner: 'bunny/modules/tidbyt', family: 'device', synced: true, records: [{id: 'tidbyt', kind: 'tidbyt'}]}] as unknown as RuntimeData['copies']};
  assert.deepEqual(names(jumpEntries(named, [], home)).slice(10), ['Device pages: Tidbyt', 'Device pages: Tidbyt · Tidbyt display']);
});

void test('an unread or failed catalog offers only the hub destinations', () => {
  assert.equal(jumpEntries({...runtime, modules: undefined}, [], home).every(entry => entry.group === 'Hub'), true);
  assert.equal(jumpEntries({...runtime, modules: undefined, catalogFailed: true}, [], home).length, 10);
});

void test('recent pages come first, without the current page, duplicates or addresses the catalog no longer declares', () => {
  const recents: Route[] = [{kind: 'audio'}, home, {kind: 'module', module: 'retired', page: 'gone'}, {kind: 'audio'}, {kind: 'rooms'},
    {kind: 'settings'}, {kind: 'habitat'}];
  const entries = jumpEntries(runtime, recents, home);
  assert.deepEqual(names(entries.slice(0, JUMP_RECENTS + 1)), ['Recent: Audio', 'Recent: Rooms', 'Recent: Settings', 'Hub: Home']);
  assert.equal(entries.filter(entry => entry.group === 'Recent').length, JUMP_RECENTS);
  assert.equal(entries.find(entry => entry.group === 'Recent' && entry.label === 'Audio')?.hint, 'Home', 'a recent page keeps its own hint');
});

void test('leaving a page remembers it at the front, once, and never a missing address', () => {
  let recents: Route[] = [];
  for (const route of [home, {kind: 'rooms'}, home, {kind: 'missing', hash: '#/nope'}] satisfies Route[]) recents = rememberRoute(recents, route);
  assert.deepEqual(recents, [home, {kind: 'rooms'}]);
  for (const brand of ['a', 'b', 'c', 'd', 'e', 'f']) recents = rememberRoute(recents, {kind: 'lighting-brand', brand});
  assert.equal(recents.length, JUMP_RECENTS + 2, 'the remembered list stays short');
  assert.deepEqual(recents[0], {kind: 'lighting-brand', brand: 'f'});
});

void test('a query keeps entries whose name or hint holds every word, best name match first', () => {
  const entries = jumpEntries(runtime, [{kind: 'audio'}], home);
  assert.deepEqual(names(filterJump(entries, '')), names(entries), 'an empty query changes nothing');
  assert.deepEqual(names(filterJump(entries, '  ')), names(entries));
  assert.deepEqual(names(filterJump(entries, 'aud')), ['Hub: Audio'], 'the Recent copy is dropped, so a page appears once');
  assert.deepEqual(names(filterJump(entries, 'CO')), ['Hub: Companions', 'Hub: Connections', 'Pages: Companions · Conversation', 'Pages: Companions · Preferences', 'Hub: Habitat'],
    'a name that starts with the query comes before names that only contain it, and those before a hint match');
  assert.deepEqual(names(filterJump(entries, 'lighting')), ['Device pages: LIFX', 'Device pages: LIFX · Pendant 1'], 'the hint is searched');
  assert.deepEqual(names(filterJump(entries, 'companions pref')), ['Pages: Companions · Preferences'], 'every word must match');
  assert.deepEqual(names(filterJump(entries, 'home')), ['Hub: Home', 'Hub: Timeline', 'Hub: Audio'], 'a hint match ranks after a name match');
  assert.deepEqual(filterJump(entries, 'no such page'), []);
  // A narrowed list shows no group headings, so a group's label is not searched: "pa" must not keep every device page.
  assert.deepEqual(names(filterJump(entries, 'device pages')), []);
  assert.deepEqual(names(filterJump(entries, 'hub')), []);
  assert.equal(filterJump(entries, 'pa').every(entry => /pa/i.test(`${entry.label} ${entry.hint}`)), true);
  assert.equal(filterJump(entries, 'pa').length < entries.filter(entry => entry.group === 'Device pages' || entry.group === 'Pages').length, true);
});

void test('only an input that takes typed text counts as a text field', () => {
  for (const type of ['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', '', 'unknown', 'TEXT']) assert.equal(textInput(type), true, type);
  for (const type of ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'image', 'RANGE']) assert.equal(textInput(type), false, type);
});

const press = (key: string, held: Partial<JumpKeyPress> = {}): JumpKeyPress => ({key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...held});
const place = (at: Partial<JumpKeyPlace> = {}): JumpKeyPlace => ({mac: false, open: false, field: false, owned: false, modal: false, ...at});

void test('Command or Control and K opens or closes the palette from anywhere, and on a Mac Control and K stays a text key in a field', () => {
  for (const mac of [true, false]) {
    for (const open of [true, false]) {
      assert.equal(jumpShortcut(press('k', {metaKey: true}), place({mac, open, field: true, owned: true})), 'toggle', 'Command and K, in a field too');
      assert.equal(jumpShortcut(press('K', {ctrlKey: true}), place({mac, open})), 'toggle', 'Control and K outside a field, with Caps Lock too');
    }
  }
  assert.equal(jumpShortcut(press('k', {ctrlKey: true}), place({mac: false, field: true})), 'toggle', 'off a Mac, Control and K opens from a field');
  assert.equal(jumpShortcut(press('k', {ctrlKey: true}), place({mac: true, field: true})), undefined, 'on a Mac it deletes to the end of the line there');
  assert.equal(jumpShortcut(press('k', {ctrlKey: true}), place({mac: true, open: true, field: true, owned: true})), undefined, 'and in the palette\'s own field');
  for (const held of [{}, {altKey: true, metaKey: true}, {shiftKey: true, ctrlKey: true}, {altKey: true}, {shiftKey: true}]) {
    assert.equal(jumpShortcut(press('k', held), place()), undefined, `K with ${JSON.stringify(held)} is not the palette's`);
  }
});

void test('a slash opens the palette only outside a text field, an open menu, list or dialog, and the open palette', () => {
  assert.equal(jumpShortcut(press('/'), place()), 'open');
  assert.equal(jumpShortcut(press('/'), place({mac: true})), 'open');
  for (const at of [{field: true}, {owned: true}, {open: true}] satisfies Partial<JumpKeyPlace>[]) {
    assert.equal(jumpShortcut(press('/'), place(at)), undefined, JSON.stringify(at));
  }
  for (const held of [{metaKey: true}, {ctrlKey: true}, {altKey: true}] satisfies Partial<JumpKeyPress>[]) {
    assert.equal(jumpShortcut(press('/', held), place()), undefined, JSON.stringify(held));
  }
  assert.equal(jumpShortcut(press('?', {shiftKey: true}), place()), undefined, 'another key is not the palette\'s');
});

void test('no key reaches the palette while a modal dialog or a full-screen element covers the page', () => {
  for (const [key, held] of [['k', {metaKey: true}], ['k', {ctrlKey: true}], ['/', {}]] as const) {
    assert.equal(jumpShortcut(press(key, held), place({modal: true})), undefined, key);
    assert.equal(jumpShortcut(press(key, held), place({modal: true, mac: true, open: true})), undefined, key);
  }
});
