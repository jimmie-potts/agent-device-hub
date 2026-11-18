// The rail's collapse preference (Hub #1887): defaults by window size, one remembered choice per size, and no dependence on storage.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {RAIL_PREFERENCE_KEY, RailPreferenceStore, parseRailPreference, railAttribute, railExpanded} from '../src/rail-preference.ts';

const memory = (): {saved: Map<string, string>; storage: {getItem: (key: string) => string | null; setItem: (key: string, value: string) => void}} => {
  const saved = new Map<string, string>();
  return {saved, storage: {getItem: key => saved.get(key) ?? null, setItem: (key, value) => {saved.set(key, value);}}};
};

void test('the rail starts expanded in a wide window and collapsed in a narrower one', () => {
  const unset = parseRailPreference(null);
  assert.deepEqual(unset, {wide: null, narrow: null});
  assert.equal(railExpanded(unset, 'wide'), true);
  assert.equal(railExpanded(unset, 'narrow'), false);
  assert.equal(railExpanded({wide: false, narrow: true}, 'wide'), false, 'a saved choice wins over the default');
  assert.equal(railExpanded({wide: false, narrow: true}, 'narrow'), true);
});

void test('a damaged saved value is no preference', () => {
  for (const raw of ['', 'not json', 'null', '7', '"expanded"', '[true,false]', '{"wide":"yes","narrow":1}', '{"other":true}']) {
    assert.deepEqual(parseRailPreference(raw), {wide: null, narrow: null}, raw);
  }
  assert.deepEqual(parseRailPreference('{"wide":false,"narrow":"x","extra":1}'), {wide: false, narrow: null}, 'a valid half is kept');
});

void test('each window size remembers its own toggle across a reload', () => {
  const {saved, storage} = memory();
  const first = new RailPreferenceStore(() => storage);
  let notified = 0;
  const unsubscribe = first.subscribe(() => {notified += 1;});
  first.toggle('narrow');
  assert.deepEqual(first.getSnapshot(), {wide: null, narrow: true}, 'the narrow rail expands; the wide rail keeps its default');
  assert.equal(notified, 1);
  assert.deepEqual(JSON.parse(saved.get(RAIL_PREFERENCE_KEY) ?? 'null'), {wide: null, narrow: true});
  first.toggle('wide');
  assert.deepEqual(first.getSnapshot(), {wide: false, narrow: true});
  const reloaded = new RailPreferenceStore(() => storage);
  assert.deepEqual(reloaded.getSnapshot(), {wide: false, narrow: true}, 'a reloaded page reads both choices');
  assert.equal(railExpanded(reloaded.getSnapshot(), 'wide'), false);
  assert.equal(railExpanded(reloaded.getSnapshot(), 'narrow'), true);
  unsubscribe();
  first.toggle('wide');
  assert.equal(notified, 2, 'an unsubscribed listener hears nothing more');
  assert.deepEqual(first.getSnapshot(), {wide: true, narrow: true});
});

void test('the snapshot is stable until the preference changes', () => {
  const store = new RailPreferenceStore(() => memory().storage);
  const before = store.getSnapshot();
  assert.equal(store.getSnapshot(), before);
  store.toggle('wide');
  assert.notEqual(store.getSnapshot(), before);
});

void test('the toggle works for this page when storage is refused or missing', () => {
  const broken = {getItem: (): string | null => {throw new Error('blocked');}, setItem: (): void => {throw new Error('blocked');}};
  const refused = new RailPreferenceStore(() => broken);
  assert.deepEqual(refused.getSnapshot(), {wide: null, narrow: null});
  refused.toggle('wide');
  assert.equal(railExpanded(refused.getSnapshot(), 'wide'), false);
  const missing = new RailPreferenceStore(() => {throw new Error('no storage');});
  missing.toggle('narrow');
  assert.equal(railExpanded(missing.getSnapshot(), 'narrow'), true);
});

void test('a choice made in another tab is followed, and other keys are ignored', () => {
  const store = new RailPreferenceStore(() => memory().storage);
  let notified = 0;
  store.subscribe(() => {notified += 1;});
  store.storageChanged(RAIL_PREFERENCE_KEY, '{"wide":false,"narrow":null}');
  assert.deepEqual(store.getSnapshot(), {wide: false, narrow: null});
  assert.equal(notified, 1);
  store.storageChanged(RAIL_PREFERENCE_KEY, '{"wide":false,"narrow":null}');
  assert.equal(notified, 1, 'an unchanged value does not notify');
  store.storageChanged('bunny.art-theme.v1', '{"wide":true,"narrow":true}');
  assert.deepEqual(store.getSnapshot(), {wide: false, narrow: null});
  store.storageChanged(RAIL_PREFERENCE_KEY, null);
  assert.deepEqual(store.getSnapshot(), {wide: null, narrow: null}, 'a cleared value returns to the defaults');
});

void test('a saved choice is published to the stylesheet and no choice leaves its default', () => {
  assert.equal(railAttribute(null), undefined);
  assert.equal(railAttribute(true), 'expanded');
  assert.equal(railAttribute(false), 'collapsed');
});

void test('the stylesheet gives the icon rail the same rules at both window sizes', async () => {
  const css = await readFile(new URL('../src/shell.css', import.meta.url), 'utf8');
  const rules = (prefix: string): string[] => css.split('\n').filter(line => line.includes(prefix))
    .map(line => line.trim().replace(/^@media[^{]*\{/, '').replaceAll(prefix, 'RAIL'));
  const narrow = rules('.shell:not([data-rail-narrow=expanded])'), wide = rules('.shell[data-rail-wide=collapsed]');
  assert.ok(narrow.length >= 10, 'the icon rail rules are present');
  assert.deepEqual(narrow, wide);
  assert.match(css, /@media\(min-width:680\.02px\) and \(max-width:1199\.98px\)\{/, 'narrower windows default to the icon rail, from just above the phone width');
  assert.match(css, /@media\(min-width:1200px\)\{/, 'wide windows collapse only by choice');
});
