// #1272: the Music lighting part alone on a real SQLite store, with a manual clock and scheduler. Only the tracker's
// operations, the dispatcher and the Nanoleaf owner's synced copy are stand-ins, so deadline paths run without waiting.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {LightingControl, LightingDeviceState, LightingState} from '@jimmie-potts/event-contracts/v2/music-lighting';
import type {Command, Draft, Logger, Responder, Sdk, SyncCompleted, SyncHandler} from '@jimmie-potts/sdk';
import {MusicLightingPart, lightingWorkRequestId} from '../src/core/music-lighting.js';
import type {Operation} from '../src/core/operations.js';
import type {CoreTransaction} from '../src/core/store.js';
import type {Action, ActionAnswer} from '../src/core/tracker.js';
import {it, manualClock, waitFor} from './support.js';

const TRACE = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const CAPTURE = {endpointId: 'music-endpoint', generation: '00000000-0000-4000-8000-000000001505'};
type ControlData = {action: 'start'; capture: typeof CAPTURE; presetId: string} | {action: 'stop'};
const flush = () => new Promise(resolve => { setTimeout(resolve, 5); });

/** One part instance over a shared store, operations and clock, so a test can restart it. */
type Shared = {database: DatabaseSync; clock: ReturnType<typeof manualClock>; operations: Map<string, Operation>; revision: {value: number}};
const shared = (): Shared => ({database: new DatabaseSync(':memory:'), clock: manualClock(Date.now()), operations: new Map(), revision: {value: 0}});

async function unit(store: Shared, targets: readonly string[] = ['wall']) {
  const {database, clock, operations, revision} = store;
  const dispatched: Action[] = [];
  let answer: (action: Action) => Promise<ActionAnswer> = action => Promise.resolve({status: 'accepted', requestId: action.requestId ?? ''});
  let responder: Responder<LightingControl> | undefined, handler: SyncHandler<LightingDeviceState> | undefined, restarted: (() => void) | undefined;
  let deviceRevision = 0;
  const part = new MusicLightingPart({admit: () => true, complete: () => () => {}, end: () => {}}, clock.scheduler, () => ({...CAPTURE, input: 'music'}));
  part.open(database);
  part.setParticipants(targets.map(id => ({id, kind: 'nanoleaf' as const})));
  const transaction = <R>(work: (tx: CoreTransaction) => R): Promise<R> => {
    database.exec('BEGIN');
    try {
      const tx = {database, atMs: clock.now(), revision: () => revision.value + 1, take: () => {}, record: () => {}, step: () => {},
        add: (_key: string, draft: Draft<object>) => draft} as unknown as CoreTransaction;
      const result = work(tx);
      database.exec('COMMIT');revision.value += 1;
      return Promise.resolve(result);
    } catch (error) {database.exec('ROLLBACK');return Promise.reject(error instanceof Error ? error : new Error('transaction'));}
  };
  const sdk = {source: 'bunny/core',
    respond: (_pattern: string, given: Responder<LightingControl>) => {responder = given;return Promise.resolve({close: () => Promise.resolve()});},
    sync: (_families: readonly string[], given: SyncHandler<LightingDeviceState>, options: {onRestarted?: () => void}) => {
      handler = given;restarted = options.onRestarted;
      return Promise.resolve({status: 'synced', copy: {close: () => Promise.resolve(), states: () => [], get: () => undefined}, message: {}});
    },
  } as unknown as Sdk;
  await part.start({sdk, clock: {now: clock.now}, ready: Promise.resolve(), log: {info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {}} as unknown as Logger,
    received: () => 'new', operation: id => operations.get(id), transaction,
    dispatch: action => {dispatched.push(action);return answer(action);}});
  const command = (requestId: string, data: ControlData, target = 'wall'): Command<LightingControl> => ({
    specversion: '1.0', bunnyprofile: '2.0', id: `message-${requestId}`, source: 'bunny/core', type: 'org.bunny.music-lighting.control.requested', subject: target,
    time: new Date(clock.now()).toISOString(), expiresat: new Date(clock.now() + 5000).toISOString(), kind: 'command', datacontenttype: 'application/json',
    dataschema: 'https://bunny.invalid/events/music-lighting-control/2.0', traceparent: TRACE,
    data: {requestId, expectedRevision: state(target).revision, ...data},
  });
  const state = (target = 'wall'): LightingState => {
    const found = part.states(['music-lighting-state']).map(draft => draft.data as LightingState).find(record => record.id === target);
    assert.ok(found);return found;
  };
  const control = async (requestId: string, data: ControlData, target = 'wall') => {
    assert.ok(responder);const reply = await responder(command(requestId, data, target));
    return 'error' in reply ? reply.error.code : reply.status;
  };
  const device = async (session: LightingDeviceState['session'], target = 'wall') => {
    deviceRevision += 1;
    await handler?.({type: 'updated', entity: {family: 'music-lighting-device', id: target},
      message: {source: 'bunny/modules/nanoleaf', subject: target, traceparent: TRACE, data: {id: target, revision: deviceRevision, session}} as Message<LightingDeviceState>});
  };
  const synced = async () => {await handler?.({type: 'synced', message: {} as Message<SyncCompleted>});};
  /** The tracker's change to one of the part's work operations, in a core transaction. */
  const track = async (operation: Operation, previous?: Operation) => {
    operations.set(operation.requestId, operation);
    await transaction(tx => {part.tracked({operation, previous}, tx);});
  };
  return {part, clock, operations, dispatched, state, control, device, synced, track, restart: () => restarted?.(),
    setAnswer: (given: (action: Action) => Promise<ActionAnswer>) => {answer = given;}};
}

/** A tracked work operation as the tracker would hold it after `patch`. */
function operation(action: Action, sentAtMs: number, patch: Partial<Operation>): Operation {
  return {requestId: action.requestId ?? '', kind: 'device', key: action.key, family: 'music-lighting-work', command: action.draft.type, dataschema: action.draft.dataschema,
    target: action.draft.subject, data: action.draft.data as Record<string, unknown>, requestedBy: action.requestedBy, status: 'sent', outcomes: [],
    sentAtMs, deadlineAtMs: sentAtMs + 30_000, updatedAtMs: sentAtMs, traceparent: TRACE, ...patch};
}

it('a lost Start reply the module never admitted settles expired at the outcome deadline, only against a fresh copy', async () => {
  const store = shared(), u = await unit(store);
  await u.device(null);await u.synced();
  const t0 = u.clock.now();
  u.setAnswer(action => {
    store.operations.set(action.requestId ?? '', operation(action, t0, {status: 'uncertain', result: 'uncertain', evidence: 'none', error: {code: 'uncertain-result', retryable: false}}));
    return Promise.resolve(errorBody('uncertain-result'));
  });
  assert.equal(await u.control('start-lost', {action: 'start', capture: CAPTURE, presetId: 'preset-pulse'}), 'accepted');
  await waitFor(() => u.state().session.status === 'uncertain');
  const session = u.state().session;assert.ok(session.status === 'uncertain');
  u.clock.advance(29_000);await flush();
  assert.equal(u.state().session.status, 'uncertain', 'the Start could still be in flight before its outcome deadline');
  u.restart();
  u.clock.advance(1_100);await flush();
  assert.equal(u.state().session.status, 'uncertain', 'a copy that is not fresh decides nothing');
  await u.synced();
  await waitFor(() => u.state().session.status === 'idle', 2000, 'the expired Start');
  assert.deepEqual(u.state().last, {generation: session.generation, reason: 'expired', restoration: 'none', atMs: u.clock.now()});
  assert.equal(u.dispatched.length, 1, 'nothing is sent again');
});

it('a lost Start settles at the deadline timer while the copy stays fresh, and an admitted Start never does', async () => {
  const store = shared(), u = await unit(store, ['wall', 'desk']);
  await u.device(null, 'wall');await u.device(null, 'desk');await u.synced();
  const t0 = u.clock.now();
  u.setAnswer(action => {
    store.operations.set(action.requestId ?? '', operation(action, t0, {status: 'uncertain', result: 'uncertain', evidence: 'none', error: {code: 'uncertain-result', retryable: false}}));
    return Promise.resolve(errorBody('uncertain-result'));
  });
  await u.control('start-wall', {action: 'start', capture: CAPTURE, presetId: 'preset-pulse'}, 'wall');
  await u.control('start-desk', {action: 'start', capture: CAPTURE, presetId: 'preset-pulse'}, 'desk');
  await waitFor(() => u.state('wall').session.status === 'uncertain' && u.state('desk').session.status === 'uncertain');
  // The desk's module did hold its Start: its record names the generation, so only it decides.
  const desk = u.state('desk').session;assert.ok(desk.status === 'uncertain');
  await u.device({generation: desk.generation, status: 'starting'}, 'desk');
  await u.device(null, 'desk');
  u.clock.advance(30_100);
  await waitFor(() => u.state('wall').session.status === 'idle', 2000, 'the wall Start expired');
  assert.equal(u.state('wall').last?.reason, 'expired');
  await flush();
  assert.equal(u.state('desk').session.status, 'uncertain', 'a Start the module reported is not relabelled expired');
});

it('a restarted core labels a Start the module never received expired, not restart, and one it held restart', async () => {
  const store = shared();
  const first = await unit(store, ['wall', 'desk']);
  await first.device(null, 'wall');await first.device(null, 'desk');await first.synced();
  const t0 = store.clock.now();
  // Neither Start's reply comes back before the core stops.
  first.setAnswer(action => {store.operations.set(action.requestId ?? '', operation(action, t0, {}));return new Promise(() => {});});
  await first.control('start-wall', {action: 'start', capture: CAPTURE, presetId: 'preset-pulse'}, 'wall');
  await first.control('start-desk', {action: 'start', capture: CAPTURE, presetId: 'preset-pulse'}, 'desk');
  await waitFor(() => first.dispatched.length === 2);
  const desk = first.state('desk').session, wall = first.state('wall').session;
  assert.ok(desk.status === 'starting' && wall.status === 'starting');
  await first.device({generation: desk.generation, status: 'playing'}, 'desk');
  await waitFor(() => first.state('desk').session.status === 'active');

  const second = await unit(store, ['wall', 'desk']);
  await second.part.recover();
  assert.equal(second.state('wall').session.status, 'uncertain');assert.equal(second.state('desk').session.status, 'uncertain');
  // The owner restarted too and holds neither session. The wall Start is still pending, so it may yet be admitted.
  await second.device(null, 'wall');await second.device(null, 'desk');await second.synced();
  await waitFor(() => second.state('desk').session.status === 'idle', 2000, 'the desk restart');
  assert.deepEqual(second.state('desk').last, {generation: desk.generation, reason: 'restart', restoration: 'none', atMs: store.clock.now()});
  assert.equal(second.state('wall').session.status, 'uncertain', 'a pending Start is not labelled');
  // The tracker's outcome deadline ends the wall Start uncertain: it can no longer be admitted.
  store.clock.advance(30_100);
  const wallWork = lightingWorkRequestId('start-wall', 'wall'), before = store.operations.get(wallWork);assert.ok(before);
  await second.track({...before, status: 'uncertain', result: 'uncertain', evidence: 'none', error: {code: 'uncertain-result', retryable: false}}, before);
  await waitFor(() => second.state('wall').session.status === 'idle', 2000, 'the wall Start expired');
  assert.deepEqual(second.state('wall').last, {generation: wall.generation, reason: 'expired', restoration: 'none', atMs: store.clock.now()});
  assert.equal(first.dispatched.length + second.dispatched.length, 2, 'a restart resends nothing');
});
