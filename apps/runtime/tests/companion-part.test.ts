// The core's companion part raises coding opportunities with no session freshness or restart term, and keeps the
// existing `companion-opportunity/2.0` host-clock checks (Hub #1865 task 4.1, design decision 10). It runs the part
// alone on an in-process bus and a manual clock, so a record the core would not publish today, such as running work
// left unconfirmed by a restart under a new question, can be given to it directly.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Message, MessageKind} from '@jimmie-potts/event-contracts/v2';
import {DEFAULT_CODING_BOUNDS, type CodingDispatch, type CodingRun, type CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import type {CompanionOpportunity} from '@jimmie-potts/event-contracts/v2/companions';
import {sessionEntityId, type AttentionRaised, type Identity} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession, type SessionFacts} from '@jimmie-potts/event-contracts/v2/session';
import {InProcessBus} from '@jimmie-potts/sdk';
import {CompanionPart} from '../src/core/companion-part.js';
import type {CoreHandle} from '../src/core/core.js';
import {flush, it, manualClock, waitFor} from './support.js';

const identity: Identity = {provider: 'claude', client: 'code', hostId: 'synthetic-host', sourceId: 'synthetic-source', sessionId: 'synthetic-session'};
const id = sessionEntityId(identity);

async function setup(context: Parameters<Parameters<typeof it>[1]>[0]) {
  const clock = manualClock(), bus = new InProcessBus({now: clock.now, scheduler: clock.scheduler});
  const core = bus.connect('bunny/core'), watcher = bus.connect('bunny/parts/companion-watcher');
  const raised: CompanionOpportunity[] = [];
  await watcher.subscribe<CompanionOpportunity>('bunny.event.companion-opportunity.*', message => {raised.push(message.data);});
  const part = new CompanionPart();
  await part.start({sdk: core, clock, log: {emit: () => {}}} as unknown as CoreHandle);
  context.after(async () => {part.close(); await watcher.close(); await core.close();});
  const envelope = <T>(kind: MessageKind, type: string, dataschema: string, data: T): Message<T> => ({
    specversion: '1.0', bunnyprofile: '2.0', id: randomUUID(), source: 'bunny/core', type, subject: id, time: new Date(clock.now()).toISOString(), kind,
    datacontenttype: 'application/json', dataschema: `https://bunny.invalid/events/${dataschema}`, traceparent: `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`, data,
  });
  let revision = 0;
  /** One committed live reduction: the session's record and its attention-raised occurrence, observed at `observedAtMs`. */
  const raise = async (patch: Partial<SessionFacts>, observedAtMs = clock.now()): Promise<CompanionOpportunity | undefined> => {
    revision += 1;
    const attention = {id: {status: 'known', id: `question-${String(revision)}`}, kind: 'question', turn: {status: 'known', id: 'turn-1'}} as const;
    const record = buildSession({id, revision, generation: 1, identity, parent: {status: 'unknown'}, turn: {status: 'known', id: 'turn-1'}, work: 'active',
      attention: [attention], notices: [], read: 'unknown', unavailable: [], ordering: {status: 'unknown'}, observedAtMs, lastEvidenceAtMs: clock.now(),
      children: {working: 0, unconfirmed: 0}, ...patch});
    const state = envelope('state', 'org.bunny.session.updated', 'session/3.0', record);
    const occurrence = envelope<AttentionRaised>('occurrence', 'org.bunny.attention.raised', 'attention-raised/2.0',
      {session: id, identity, turn: record.turn, observedAtMs, ordering: {status: 'unknown'}, revision, attention});
    const before = raised.length;
    part.committed({revision, messages: [state, occurrence]});
    const ended = part.publishing(occurrence);
    await core.publishMessage(`bunny.event.attention-raised.${id}`, occurrence);
    ended(); part.publicationEnded({revision, messages: [state, occurrence]});
    for (let turn = 0; turn < 4; turn += 1) await flush();
    assert.ok(raised.length <= before + 1);
    return raised.length > before ? raised.at(-1) : undefined;
  };
  return {clock, raise};
}

it('a question from a session whose work is unconfirmed still raises its opportunity', async context => {
  const {clock, raise} = await setup(context);
  const restarted = await raise({unconfirmed: 'restart'});
  assert.equal(restarted?.category, 'coding-attention', 'work left unconfirmed by a restart does not withhold the question');
  assert.equal(restarted?.validUntilMs, clock.now() + 30_000);
  const silent = await raise({lastEvidenceAtMs: clock.now() - 360_000});
  assert.equal(silent?.cue, 'question', 'a session silent for six minutes does not withhold the question');
});

it('the window keeps the reporting host clock: a clock ahead of the hub drops the opportunity', async context => {
  const {clock, raise} = await setup(context);
  assert.equal(await raise({}, clock.now() + 60_000), undefined, 'a host clock a minute ahead raises nothing');
  assert.equal(await raise({}, clock.now() + 1), undefined, 'any instant after the hub\'s now raises nothing');
  assert.equal(await raise({}, clock.now() - 40_000), undefined, 'a host clock 40 s behind raises nothing');
  assert.equal(await raise({}, clock.now() - 30_000), undefined, 'a host clock 30 s behind raises nothing');
  const behind = await raise({}, clock.now() - 10_000);
  assert.equal(behind?.validUntilMs, clock.now() + 20_000, 'a host clock 10 s behind shortens the window to 20 s');
});


it('the core reads the current worker on late attach and resyncs before forwarding explicit work after a delivery gap', async context => {
  const clock = manualClock();
  const bus = new InProcessBus({now: clock.now, scheduler: clock.scheduler, maxQueued: 1});
  const sdk = bus.connect('bunny/core'), owner = bus.connect('bunny/modules/companions');
  const part = new CompanionPart();
  const starts: {selectionId?: string; version: string}[] = [];
  context.after(async () => {part.close(); await owner.close(); await sdk.close();});
  let revision = 1, reads = 0, release = (): void => {};
  let selectionId: string | undefined = randomUUID();
  let readHeld: Promise<void> | undefined;
  const state = () => ({kind: 'state' as const, type: 'org.bunny.coding-state.updated', subject: 'coding',
    dataschema: `https://bunny.invalid/events/coding-state/${selectionId === undefined ? '2.3' : '2.4'}`,
    data: {id: 'coding', revision, endpointId: 'shared-endpoint', availability: 'available', active: null, readiness: null,
      slots: selectionId === undefined ? 3 : null, runs: [], waiting: [],
      ...(selectionId === undefined ? {} : {selectionId, capacity: 'uncapped', counts: {runs: 0, waiting: 0}})} satisfies CodingState});
  const publish = () => owner.publish('bunny.state.coding-state.coding', state());
  await owner.serveSync(['coding-state'], async () => {
    reads += 1;
    await readHeld;
    return {revision, states: [state()]};
  });
  await publish();
  await part.start({sdk, clock, log: {emit: () => {}}, dispatch: (action: Parameters<CoreHandle['dispatch']>[0]) => {
    const data = action.draft.data as CodingRun;
    starts.push({...(data.selectionId === undefined ? {} : {selectionId: data.selectionId}), version: action.draft.dataschema});
    return Promise.resolve({status: 'accepted'});
  }} as unknown as CoreHandle);
  const send = (requestId: string) => owner.request<CodingDispatch>('bunny.cmd.coding-dispatch.assistant',
    {type: 'org.bunny.coding.dispatch.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/coding-dispatch/2.1',
      data: {requestId, endpointId: 'shared-endpoint', taskId: 'task-codex', repository: 'agent-device-hub',
        brief: 'Synthetic review.', bounds: DEFAULT_CODING_BOUNDS, harness: 'codex'}}, {timeoutMs: 5000});
  try {
    await waitFor(() => reads === 1);
    await flush();
    const firstId = selectionId;
    assert.equal((await send('late-attach')).status, 'accepted');
    assert.deepEqual(starts, [{selectionId: firstId, version: 'https://bunny.invalid/events/coding-run/2.2'}]);
    readHeld = new Promise<void>(resolve => {release = resolve;});
    revision = 2;
    await Promise.all(Array.from({length: 12}, publish));
    await waitFor(() => reads === 2);
    assert.equal((await send('binding-unknown-during-gap')).status, 'rejected');
    assert.equal(starts.length, 1);
    selectionId = randomUUID();
    revision = 3;
    release();
    await flush();
    const replacement = selectionId;
    assert.equal((await send('fresh-after-gap')).status, 'accepted');
    assert.deepEqual(starts.at(-1), {selectionId: replacement, version: 'https://bunny.invalid/events/coding-run/2.2'});
    // A late finite state must not replace the newer copied uncapped selection.
    selectionId = undefined;
    revision = 2;
    await publish();
    await flush();
    assert.equal((await send('after-old-state')).status, 'accepted');
    assert.deepEqual(starts.at(-1), {selectionId: replacement, version: 'https://bunny.invalid/events/coding-run/2.2'});
  } finally {release();}
});
