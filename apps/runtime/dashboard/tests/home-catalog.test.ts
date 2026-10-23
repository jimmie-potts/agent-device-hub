import assert from 'node:assert/strict';
import test from 'node:test';
import {addHomeCard, defaultHomeArrangements, homeCatalog, savedHomeCard} from '../src/home-catalog.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';
const runtime: RuntimeData = {modules: [], copies: [], control: true, catalogFailed: false};
void test('Timeline is placeable without silently adding it to an existing or default Home', () => {
  const catalog = homeCatalog(runtime, true), card = catalog.find(value => value.id === 'timeline');
  assert.ok(card !== undefined, 'Timeline is offered in Add card');
  assert.deepEqual(card.sizes, ['medium', 'large']);
  assert.equal(card.defaultSelected, false);
  const defaults = defaultHomeArrangements(catalog);
  assert(!defaults.desktop.some(value => value.widget === 'timeline'));
  const next = addHomeCard(defaults, 'desktop', card);
  assert.equal(next.desktop.at(-1)?.widget, 'timeline');
  assert.equal(next.phone.at(-1)?.widget, 'timeline');
  assert.deepEqual(savedHomeCard('timeline', catalog), card);
});
void test('the picker describes unavailable modules and keeps unavailable saved instances separate from retired definitions', () => {
  const catalog = homeCatalog(runtime, true);
  assert.equal(catalog.find(card => card.id === 'module:pixoo')?.reason, 'No configured source is available.');
  assert.equal(catalog.find(card => card.id === 'wispr')?.defaultSelected, false);
  assert.equal(savedHomeCard('wispr', catalog)?.source.kind, 'unavailable');
  assert.equal(savedHomeCard('device:bunny/modules/wemo:desk-plug', catalog)?.source.kind, 'unavailable');
  assert.equal(savedHomeCard('light:room:office', catalog)?.source.kind, 'unavailable');
  assert.equal(savedHomeCard('retired-widget', catalog), undefined);
});
void test('adding appends to the other breakpoint without replacing its independent order, size or hidden choice', () => {
  const catalog = homeCatalog(runtime, true), layouts = defaultHomeArrangements(catalog), original = structuredClone(layouts);
  layouts.phone.reverse();const first = layouts.phone[0];assert.ok(first !== undefined);first.hidden = true;
  const base = catalog[0];assert.ok(base !== undefined);const card = {...base, id: 'test-card', sizes: ['medium'] as const};
  const next = addHomeCard(layouts, 'desktop', card);
  assert.equal(next.desktop.at(-1)?.widget, 'test-card');assert.equal(next.phone.at(-1)?.widget, 'test-card');
  assert.deepEqual(next.phone.slice(0, -1), layouts.phone);assert.deepEqual(layouts.desktop, original.desktop);
  const added = next.desktop.find(entry => entry.widget === 'test-card');assert.ok(added !== undefined);added.hidden = true;
  const shown = addHomeCard(next, 'desktop', card);assert.equal(shown.desktop.at(-1)?.hidden, false);assert.equal(shown.phone.length, next.phone.length);
});
