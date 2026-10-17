// Private room/group metadata through the existing operator dispatcher, sync and durable restart.
import type {LightingLayout, LightingLayoutRecord, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {act, answered, dispatchOnce, expect, holds, type Harness, type Scenario} from './framework.js';
const current = (h: Harness): LightingLayoutRecord | undefined => h.reader.states<LightingLayoutRecord>('lighting-layout').map(state => state.data).find(value => value.id === 'lighting');
const layout: LightingLayout = {rooms: [{id: 'studio', name: 'Studio'}], assignments: [{device: 'lamp-a', room: 'studio'}], groups: [], home: [{kind: 'room', id: 'studio'}]};
const request = (expectedRevision: number) => ({key: 'bunny.cmd.lighting-layout-set.lighting', draft: {type: 'org.bunny.lighting-layout.set.requested', subject: 'lighting', dataschema: 'https://bunny.invalid/events/lighting-layout-set/2.0', data: {expectedRevision, layout}}});
export const lightingScenarios: readonly Scenario[] = [{
  id: 'lighting-layout', title: 'room composition persists without device commands or stale-save replay',
  seed: {modules: ['core'], follows: [['lighting-layout', 'operation']]},
  steps: [
    expect('the core serves an empty automatic layout', h => current(h)?.revision === 0 && current(h)?.layout.home === null || 'initial layout not synced'),
    act('the operator saves a room and its Home card', h => dispatchOnce(h, 'operator', 'layout-save', request(0), 'layout-first')),
    expect('the save was accepted', h => answered(h, 'layout-save', 'accepted')),
    expect('the core publishes the saved room', h => current(h)?.layout.rooms[0]?.id === 'studio' || 'room not saved'),
    act('another browser attempts a stale overwrite', async h => { await h.dispatch('operator', 'layout-stale', request(0), 'layout-conflict'); }),
    expect('the stale overwrite was refused', h => answered(h, 'layout-stale', 'revision-conflict')),
    act('the reader disconnects and the runtime restarts', async h => { await h.disconnect('reader'); await h.restart(); }),
    expect('the room and selection survive a replacement sync', h => current(h)?.layout.rooms[0]?.id === 'studio' && current(h)?.layout.home?.[0]?.kind === 'room' || 'saved layout not restored'),
    holds('layout saves, conflict and restart created no device operations', h => h.reader.states<OperationRecord>('operation').every(state => state.data.family === 'lighting-layout-set') || 'unexpected device operation', 300),
  ],
}];
