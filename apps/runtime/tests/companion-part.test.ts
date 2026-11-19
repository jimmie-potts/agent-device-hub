// The core's companion part raises coding opportunities with no session freshness or restart term, and keeps the
// existing `companion-opportunity/2.0` host-clock checks (Hub #1865 task 4.1, design decision 10). It runs the part
// alone on an in-process bus and a manual clock, so a record the core would not publish today, such as running work
// left unconfirmed by a restart under a new question, can be given to it directly.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Message, MessageKind} from '@jimmie-potts/event-contracts/v2';
import type {CompanionOpportunity} from '@jimmie-potts/event-contracts/v2/companions';
import {sessionEntityId, type AttentionRaised, type Identity} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession, type SessionFacts} from '@jimmie-potts/event-contracts/v2/session';
import {InProcessBus} from '@jimmie-potts/sdk';
import {CompanionPart} from '../src/core/companion-part.js';
import type {CoreHandle} from '../src/core/core.js';
import {flush, it, manualClock} from './support.js';

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
  const silent = await raise({unconfirmed: 'deadline', lastEvidenceAtMs: clock.now() - 360_000});
  assert.equal(silent?.cue, 'question', 'work unconfirmed after its deadline does not withhold the question');
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
