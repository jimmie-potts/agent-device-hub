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
