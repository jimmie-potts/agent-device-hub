import assert from 'node:assert/strict';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';
const layouts = () => ({desktop: [{widget: 'light:room:office', size: 'medium', hidden: false}], phone: [{widget: 'inbox', size: 'small', hidden: true}]});
const envelope = (command = false) => ({specversion: '1.0', bunnyprofile: '2.0', id: 'home-contract', source: 'bunny/core',
  type: command ? 'org.bunny.home-layout.set.requested' : 'org.bunny.home-layout.updated', subject: 'home',
  time: '2026-10-22T12:00:00.000Z', kind: command ? 'command' : 'state', datacontenttype: 'application/json',
  dataschema: `https://bunny.invalid/events/${command ? 'home-layout-set' : 'home-layout'}/2.0`,
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  ...(command ? {expiresat: '2026-10-22T12:00:10.000Z'} : {}),
  data: command ? {requestId: 'home-contract', expectedRevision: 0, layouts: layouts()} : {id: 'home', revision: 1, version: 1, layouts: layouts()}});
test('Home registers versioned metadata and guarded saves without retaining display content', () => {
  const validator = new MessageValidator();registerCoreFamilies(validator);
  for (const command of [false, true]) {const message = envelope(command), before = structuredClone(message);assert.equal(validator.validate(message).ok, true);assert.deepEqual(message, before);}
  const initial = envelope();initial.data.layouts = null;assert.equal(validator.validate(initial).ok, true);
  for (const mutate of [
    data => {data.layouts.desktop.push(data.layouts.desktop[0]);},
    data => {data.layouts.desktop[0].name = 'Private name';},
    data => {data.layouts.desktop[0].size = 'giant';},
    data => {data.layouts.desktop[0].hidden = 'false';},
    data => {data.layouts.desktop[0].widget = '../private';},
    data => {data.layouts.desktop = Array.from({length: 129}, (_, i) => ({widget: `card-${i}`, size: 'small', hidden: false}));},
    data => {data.layouts.tablet = [];},
    data => {delete data.expectedRevision;},
  ]) {const message = envelope(true);mutate(message.data);assert.equal(validator.validate(message).ok, false, String(mutate));}
  const future = envelope();future.data.version = 2;assert.equal(validator.validate(future).ok, false);
  const wrongOwner = envelope();wrongOwner.source = 'bunny/modules/pixoo';assert.equal(validator.validate(wrongOwner).ok, false);
});

test('Home art options are bounded, art-only and additive to legacy arrangements', () => {
  const validator = new MessageValidator(); registerCoreFamilies(validator);
  const art = {widget: 'art', size: 'medium', hidden: false, art: {format: 'square', pinned: true}};
  const state = envelope(); state.dataschema = 'https://bunny.invalid/events/home-layout/2.1';
  state.data.layouts.desktop.push(art);
  assert.equal(validator.validate(state).ok, true, 'the additive state carries an explicit art reservation');
  const command = envelope(true); command.data.layouts.desktop.push(art);
  assert.equal(validator.validate(command).ok, true, 'the existing save accepts optional art metadata');
  assert.equal(validator.validate(envelope()).ok, true, 'legacy state remains valid');
  assert.equal(validator.validate({...state, dataschema: 'https://bunny.invalid/events/home-layout/2.0'}).ok, false, 'legacy state has no art fields');
  for (const format of ['auto', 'banner', 'square', 'tall']) {
    const value = structuredClone(state); value.data.layouts.desktop[1].art.format = format;
    assert.equal(validator.validate(value).ok, true, format);
  }
  for (const mutate of [
    entry => {entry.widget = 'inbox';},
    entry => {entry.art.format = 'freeform';},
    entry => {entry.art.pinned = 'true';},
    entry => {entry.art.width = 1000;},
    entry => {entry.art.artworkId = 'private-art';},
    entry => {delete entry.art.format;},
  ]) {
    const value = structuredClone(command); mutate(value.data.layouts.desktop[1]);
    assert.equal(validator.validate(value).ok, false, String(mutate));
  }
});

test('Home card shapes are optional, bounded and additive to width-only arrangements (#1672)', () => {
  const validator = new MessageValidator(); registerCoreFamilies(validator);
  const state = envelope(); state.dataschema = 'https://bunny.invalid/events/home-layout/2.2';
  assert.equal(validator.validate(state).ok, true, 'a width-only arrangement stays valid in 2.2');
  for (const shape of ['square', 'wide', 'tall', 'large-square']) {
    const value = structuredClone(state); value.data.layouts.desktop[0].shape = shape;
    assert.equal(validator.validate(value).ok, true, shape);
    const command = envelope(true); command.data.layouts.desktop[0].shape = shape;
    assert.equal(validator.validate(command).ok, true, `the existing save accepts ${shape}`);
  }
  const withArt = structuredClone(state);
  withArt.data.layouts.desktop.push({widget: 'art', size: 'medium', hidden: false, shape: 'wide', art: {format: 'banner', pinned: true}});
  assert.equal(validator.validate(withArt).ok, true, 'art keeps its options beside a shape');
  for (const mutate of [entry => {entry.shape = 'giant';}, entry => {entry.shape = 'Square';}, entry => {entry.shape = 1;}, entry => {entry.columns = 2;}]) {
    const value = envelope(true); mutate(value.data.layouts.desktop[0]);
    assert.equal(validator.validate(value).ok, false, String(mutate));
  }
  for (const version of ['2.0', '2.1']) {
    const older = structuredClone(state); older.dataschema = `https://bunny.invalid/events/home-layout/${version}`; older.data.layouts.desktop[0].shape = 'tall';
    assert.equal(validator.validate(older).ok, false, `home-layout/${version} has no shape`);
    delete older.data.layouts.desktop[0].shape;
    assert.equal(validator.validate(older).ok, true, `home-layout/${version} width-only state stays valid`);
  }
});
