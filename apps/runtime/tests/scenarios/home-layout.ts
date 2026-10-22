import type {HomeLayoutRecord, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {act, answered, dispatchOnce, expect, holds, type Harness, type Scenario} from './framework.js';
const current = (h: Harness): HomeLayoutRecord | undefined => h.reader.states<HomeLayoutRecord>('home-layout').map(state => state.data).find(value => value.id === 'home');
const request = (expectedRevision: number) => ({key: 'bunny.cmd.home-layout-set.home', draft: {type: 'org.bunny.home-layout.set.requested', subject: 'home', dataschema: 'https://bunny.invalid/events/home-layout-set/2.0', data: {expectedRevision, layouts: {desktop: [{widget: 'hub-mode', size: 'large', hidden: false}], phone: [{widget: 'inbox', size: 'small', hidden: false}]}}}});
export const homeLayoutScenarios: readonly Scenario[] = [{
  id: 'home-layout', title: 'independent Home layouts persist without device effects or stale overwrites', seed: {modules: ['core'], follows: [['home-layout', 'operation']]},
  steps: [
    expect('the core serves the default arrangement marker', h => current(h)?.layouts === null || 'default missing'),
    act('the owner saves independent layouts', h => dispatchOnce(h, 'operator', 'home-save', request(0), 'home-first')),
    expect('the save was accepted', h => answered(h, 'home-save', 'accepted')),
    expect('the layouts remain distinct', h => current(h)?.layouts?.desktop[0]?.widget === 'hub-mode' && current(h)?.layouts?.phone[0]?.widget === 'inbox' || 'layouts differ from save'),
    act('a stale browser attempts an overwrite', async h => {await h.dispatch('operator', 'home-stale', request(0), 'home-conflict');}),
    expect('the stale save is refused', h => answered(h, 'home-stale', 'revision-conflict')),
    act('the reader reconnects after restart', async h => {await h.disconnect('reader');await h.restart();}),
    expect('the saved arrangement survives', h => current(h)?.layouts?.desktop[0]?.size === 'large' || 'saved arrangement missing'),
    holds('no device command was dispatched', h => h.reader.states<OperationRecord>('operation').every(state => state.data.family === 'home-layout-set') || 'unexpected device operation', 300),
  ],
}];
