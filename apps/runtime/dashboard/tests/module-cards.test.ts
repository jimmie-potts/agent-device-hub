import assert from 'node:assert/strict';
import test from 'node:test';
import {moduleCard} from '../src/module-cards.ts';
import type {ModuleEntry} from '../src/modules.ts';

const page = (id: string): ModuleEntry['pages'][number] => ({id, title: id, path: `/modules/x/${id}`, presentation: 'react'});
const pixoo = (serves: string[]): ModuleEntry => ({name: 'pixoo', state: 'running', serves, pages: []});
const tidbyt = (state: string, pages: string[]): ModuleEntry => ({name: 'tidbyt', state, serves: ['device'], pages: pages.map(page)});

void test('the module card rule main.tsx mounts by and Home offers shapes by (#1672 PR B)', () => {
  assert.equal(moduleCard([pixoo(['device', 'pixoo-display'])], 'bunny/modules/pixoo', 'pixoo'), 'pixoo');
  assert.equal(moduleCard([pixoo(['device'])], 'bunny/modules/pixoo', 'pixoo'), undefined, 'the Pixoo module must serve its display');
  assert.equal(moduleCard([pixoo(['device', 'pixoo-display'])], 'bunny/modules/pixoo', 'lifx'), undefined, 'only the module\'s own device kind');
  assert.equal(moduleCard([tidbyt('running', ['display'])], 'bunny/modules/tidbyt', 'tidbyt'), 'tidbyt');
  assert.equal(moduleCard([tidbyt('stopped', ['display'])], 'bunny/modules/tidbyt', 'tidbyt'), undefined, 'the Tidbyt module must run');
  assert.equal(moduleCard([tidbyt('running', [])], 'bunny/modules/tidbyt', 'tidbyt'), undefined, 'with its display page');
  assert.equal(moduleCard(undefined, 'bunny/modules/pixoo', 'pixoo'), undefined, 'no catalog yet');
  assert.equal(moduleCard([pixoo(['device', 'pixoo-display'])], 'bunny/modules/wemo', 'wemo'), undefined, 'other owners have no module card');
});
