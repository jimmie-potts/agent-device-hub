// The page's coding worker status (Hub #2028): slots, this companion's slot, a waiting hand-off and the plan usage windows.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {CodingReadiness, CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import {handOffWaiting, planUsage, slotBusy, slotStatus, workerAvailability} from '../src/frontend/coding-status.js';

const state = (patch: Partial<CodingState> = {}): CodingState => ({id: 'coding', revision: 4, endpointId: 'worker-endpoint-1', availability: 'available', active: null, readiness: null, slots: 3, runs: [], waiting: [], ...patch});
const run = (companion: 'bunny' | 'reachy' | 'microduck', taskId: string) => ({operationId: `${taskId}-step-1`, taskId, companion, status: 'started' as const});

void test('the worker line says how many of its slots are busy and how many hand-offs wait, never "not connected" while it is connected', () => {
  assert.equal(workerAvailability(state()), 'Connected and idle');
  assert.equal(workerAvailability(state({runs: [run('bunny', 'task-bunny-1'), run('reachy', 'task-reachy-1')]})), 'Connected, 2 of 3 slots busy');
  assert.equal(workerAvailability(state({runs: [run('bunny', 'task-bunny-1')], waiting: [{operationId: 'w-1', taskId: 'task-bunny-2', companion: 'bunny'}]})), 'Connected, 1 of 3 slots busy; 1 hand-off waiting');
  assert.equal(workerAvailability(state({slots: null, runs: [run('bunny', 'task-bunny-1')]})), 'Connected, 1 of 1 slot busy');
  assert.equal(workerAvailability(state({availability: 'off', endpointId: null})), 'Not connected');
  assert.equal(workerAvailability(undefined), 'Unknown');
});

void test('a companion\'s slot is its own on a three-slot worker and shared on an older one', () => {
  const busy = state({runs: [run('reachy', 'task-reachy-1')]});
  assert.equal(slotBusy(busy, 'reachy'), true); assert.equal(slotBusy(busy, 'bunny'), false);
  assert.equal(slotStatus(busy, 'reachy'), 'Running task task-rea (started)'); assert.equal(slotStatus(busy, 'bunny'), 'Idle');
  const lined = state({waiting: [{operationId: 'w-1', taskId: 'task-bunny-2', companion: 'bunny'}]});
  assert.equal(slotBusy(lined, 'bunny'), true, 'a line ahead makes the next hand-off wait too');
  const older = state({slots: null, runs: [run('reachy', 'task-reachy-1')]});
  assert.equal(slotBusy(older, 'bunny'), true); assert.match(slotStatus(older, 'bunny'), /one slot shared by every companion/);
  assert.equal(slotBusy(state({availability: 'off', endpointId: null}), 'bunny'), false);
  assert.equal(handOffWaiting(lined, 'task-bunny-2'), true); assert.equal(handOffWaiting(lined, 'task-bunny-1'), false); assert.equal(handOffWaiting(lined, undefined), false);
});

void test('plan usage shows each reported window with its use and reset, or says why there is none', () => {
  const at = (ms: number) => new Date(ms).toISOString();
  const readiness: CodingReadiness = {tool: 'claude-code', installed: 'yes', version: '2.1.292', signedIn: 'yes', plan: 'max', checkedAtMs: 1791374400000, limitsObservedAtMs: 1791374400000,
    limits: [{window: 'five-hour', status: 'allowed', resetsAtMs: 1791392400000, utilization: 42.4}, {window: 'seven-day', status: 'allowed-warning', resetsAtMs: null, utilization: null}]};
  assert.deepEqual(planUsage(readiness, at), ['five-hour: 42% used, resets 2026-10-07T17:00:00.000Z', 'seven-day: use unknown (warning), resets at an unknown time', 'as of 2026-10-07T12:00:00.000Z']);
  assert.deepEqual(planUsage({...readiness, limitsObservedAtMs: null}, at), ['five-hour: 42% used, resets 2026-10-07T17:00:00.000Z', 'seven-day: use unknown (warning), resets at an unknown time']);
  assert.deepEqual(planUsage({...readiness, limits: null, limitsObservedAtMs: null}, at), ['Not reported yet: the tool reports usage windows during a run']);
  assert.deepEqual(planUsage(null, at), ['Unknown: the worker reported no readiness']);
});
