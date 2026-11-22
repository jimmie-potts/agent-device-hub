// A session that keeps taking turns (Hub #2021): a long Claude-shaped session and a native conversation each end more
// turns than the session's notice limit, and a native conversation asks more questions than its watermark limit, without
// the core refusing the session's later observations. A turn end past the notice limit retires superseded notices, oldest
// first, and never one that still counts; a session whose counting notices alone pass the limit is still refused. Past the watermark limit the session drops the watermarks of attention it no longer
// holds and keeps a floor below which ordered evidence in a dimension without its own watermark is stale. Every identity,
// turn and conversation here is synthetic, and the store runs on the manual clock.
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {Identity, LifecycleEvent, LifecycleObservation, Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {noticeCounts} from '@jimmie-potts/event-contracts/v2/session-view';
import {SESSION_LIMITS, type StoredSession} from '../src/core/session/model.js';
import {WATERMARK_FLOOR} from '../src/core/session/reducer.js';
import {World, lifecycleMessage} from './fixtures/store-world.js';
import {it, manualClock} from './support.js';

const START = 1_000_000_000_000;
const NATIVE = 'https://bunny.invalid/events/lifecycle/2.2';
const quiet = (db: DatabaseSync): DatabaseSync => { db.exec('PRAGMA synchronous = OFF'); return db; };
const claude: Identity = {provider: 'claude', client: 'code', hostId: 'synthetic-host', sourceId: 'claude-hooks', sessionId: 'synthetic-long-session'};
const conversation: Identity = {provider: 'bunny', client: 'assistant', hostId: 'core', sourceId: 'companions', sessionId: 'synthetic-conversation'};

/** A hook-shaped root observation: its prompt's known turn and no ordering. */
const hook = (turn: string, event: LifecycleEvent, atMs: number): LifecycleObservation =>
  ({identity: claude, turn: {status: 'known', id: turn}, parent: {status: 'unknown'}, event, observedAtMs: atMs, ordering: {status: 'unknown'}});
/** A native observation: its task's known turn at the conversation's one ordering sequence. */
const native = (turn: string, event: LifecycleEvent, sequence: number, atMs: number): LifecycleObservation =>
  ({identity: conversation, turn: {status: 'known', id: turn}, parent: {status: 'top-level'}, event, observedAtMs: atMs,
    ordering: {status: 'known', authority: 'companions', epoch: conversation.sessionId, sequence}, nativeEventId: String(sequence)});
const nativeMessage = (data: LifecycleObservation, atMs: number): Message<LifecycleObservation> =>
  ({...lifecycleMessage(data, atMs), source: 'bunny/modules/companions', dataschema: NATIVE});

async function open(context: TestContext) {
  const world = await World.open(context, {clock: manualClock(START), wrap: quiet});
  const take = async (data: LifecycleObservation): Promise<string> => {
    world.clock.advance(1);
    const message = data.identity.provider === 'bunny' ? nativeMessage(data, world.clock.now()) : lifecycleMessage(data, world.clock.now());
    const result = await world.take(message);
    return result.ok ? result.outcome : result.code;
  };
  const record = (): Session30Record => {
    const [found] = world.store.records();
    assert.ok(found, 'the session is held');
    return found;
  };
  const stored = (): StoredSession => {
    const [found] = world.store.sessions();
    assert.ok(found, 'the session is stored');
    return found;
  };
  return {world, take, record, stored, at: (): number => world.clock.now()};
}

const noticeTurns = (record: Session30Record): string[] => record.outcome.notices.map(notice => notice.turn.status === 'known' ? notice.turn.id : 'unknown');
const range = (from: number, to: number, name: string): string[] => Array.from({length: to - from}, (_, index) => `${name}-${String(from + index)}`);

const turns = SESSION_LIMITS.notices + 8;

it(`a Claude-shaped session that ends ${String(turns)} turns keeps taking its observations`, async context => {
  const {take, record, at} = await open(context);
  const outcomes: string[] = [];
  for (let index = 0; index < turns; index++) {
    outcomes.push(await take(hook(`prompt-${String(index)}`, {kind: 'turn-started'}, at())));
    outcomes.push(await take(hook(`prompt-${String(index)}`, {kind: 'turn-ended'}, at())));
  }
  assert.deepEqual(outcomes.filter(outcome => outcome !== 'applied'), [], 'no observation is refused');
  const held = record();
  assert.deepEqual(held.turn, {status: 'known', id: `prompt-${String(turns - 1)}`});
  assert.deepEqual(held.status, {class: 'finished', detail: 'turn-ended'});
  assert.deepEqual(noticeTurns(held), range(turns - SESSION_LIMITS.notices, turns, 'prompt'), 'the oldest superseded notices retired, the newest kept');
  assert.deepEqual(held.outcome.notices.filter(notice => noticeCounts(notice, held.turn)).map(notice => notice.acknowledgedBy), [[]],
    'the notice that counts stays unread for every consumer');
});

it('below the notice limit nothing retires, and at it each turn end retires the oldest superseded notice, whatever its acknowledgments', async context => {
  const {world, take, record, at} = await open(context);
  for (let index = 0; index < SESSION_LIMITS.notices; index++) {
    await take(hook(`prompt-${String(index)}`, {kind: 'turn-started'}, at()));
    await take(hook(`prompt-${String(index)}`, {kind: 'turn-ended'}, at()));
  }
  assert.deepEqual(noticeTurns(record()), range(0, SESSION_LIMITS.notices, 'prompt'), 'every notice is kept up to the limit');
  // The dashboard acknowledges an earlier turn's notice; Nanoleaf and Pixoo did at the next turn.
  const settled = record().outcome.notices[5];
  assert.ok(settled);
  assert.equal((await world.acknowledge(claude, settled.id, 'dashboard')).ok, true);
  assert.deepEqual(record().outcome.notices[5]?.acknowledgedBy, ['nanoleaf', 'pixoo', 'dashboard']);
  assert.equal(record().outcome.notices.length, SESSION_LIMITS.notices, 'an acknowledgment retires nothing');
  const next = SESSION_LIMITS.notices;
  assert.equal(await take(hook(`prompt-${String(next)}`, {kind: 'turn-started'}, at())), 'applied');
  assert.equal(record().outcome.notices.length, SESSION_LIMITS.notices, 'a turn start retires nothing');
  assert.equal(await take(hook(`prompt-${String(next)}`, {kind: 'turn-ended'}, at())), 'applied');
  assert.deepEqual(noticeTurns(record()), range(1, next + 1, 'prompt'), 'the oldest retired, not the fully acknowledged one');
  assert.deepEqual(record().outcome.notices[4]?.acknowledgedBy, ['nanoleaf', 'pixoo', 'dashboard'], 'the acknowledged notice is kept');
  assert.equal(await take(hook(`prompt-${String(next + 1)}`, {kind: 'turn-started'}, at())), 'applied');
  assert.equal(await take(hook(`prompt-${String(next + 1)}`, {kind: 'turn-ended'}, at())), 'applied');
  assert.deepEqual(noticeTurns(record()), range(2, next + 2, 'prompt'), 'then the next oldest');
});

it('a notice without a known turn among more than 128 known-turn notices still counts and is never retired', async context => {
  const {take, record, at} = await open(context);
  await take(hook('prompt-0', {kind: 'turn-started'}, at()));
  await take(hook('prompt-0', {kind: 'turn-ended'}, at()));
  // A Stop whose provider named no prompt: its notice has no known turn, while the session stays on its known turn.
  assert.equal(await take({...hook('unused', {kind: 'turn-ended'}, at()), turn: {status: 'unknown'}}), 'applied');
  assert.deepEqual([record().turn, noticeTurns(record())], [{status: 'known', id: 'prompt-0'}, ['prompt-0', 'unknown']]);
  const outcomes: string[] = [];
  for (let index = 1; index < turns; index++) {
    outcomes.push(await take(hook(`prompt-${String(index)}`, {kind: 'turn-started'}, at())));
    outcomes.push(await take(hook(`prompt-${String(index)}`, {kind: 'turn-ended'}, at())));
  }
  assert.deepEqual(outcomes.filter(outcome => outcome !== 'applied'), [], 'no observation is refused');
  const held = record();
  assert.deepEqual(held.turn, {status: 'known', id: `prompt-${String(turns - 1)}`});
  assert.deepEqual(noticeTurns(held), ['unknown', ...range(turns - SESSION_LIMITS.notices + 1, turns, 'prompt')],
    'the notice without a known turn is kept and the oldest known-turn notices retire around it');
  assert.ok(noticeCounts(held.outcome.notices[0] ?? {turn: {status: 'known', id: 'none'}}, held.turn), 'it still counts');
});

it('at the notice limit a Stop for a prompt whose start was never seen is refused, and the next known start and end apply', async context => {
  const {world, take, record, at} = await open(context);
  for (let index = 0; index < SESSION_LIMITS.notices; index++) {
    await take(hook(`prompt-${String(index)}`, {kind: 'turn-started'}, at()));
    await take(hook(`prompt-${String(index)}`, {kind: 'turn-ended'}, at()));
  }
  const before = record(), revision = world.store.revision;
  // The end would make the session's own turn ambiguous, so every notice would count again.
  assert.equal(await take(hook('prompt-unseen', {kind: 'turn-ended'}, at())), 'capacity');
  assert.equal(world.store.revision, revision, 'the refusal changes nothing');
  assert.deepEqual(record(), before);
  const next = `prompt-${String(SESSION_LIMITS.notices)}`;
  assert.equal(await take(hook(next, {kind: 'turn-started'}, at())), 'applied');
  assert.equal(await take(hook(next, {kind: 'turn-ended'}, at())), 'applied');
  assert.deepEqual(record().status, {class: 'finished', detail: 'turn-ended'});
  assert.deepEqual(noticeTurns(record()), range(1, SESSION_LIMITS.notices + 1, 'prompt'));
});

it('a session already stored at the notice limit, working on a turn whose end an older release refused, recovers at that end', async context => {
  const {world, take, record, at} = await open(context);
  for (let index = 0; index < SESSION_LIMITS.notices; index++) {
    await take(hook(`prompt-${String(index)}`, {kind: 'turn-started'}, at()));
    await take(hook(`prompt-${String(index)}`, {kind: 'turn-ended'}, at()));
  }
  const stuck = `prompt-${String(SESSION_LIMITS.notices)}`;
  await take(hook(stuck, {kind: 'turn-started'}, at()));
  assert.deepEqual([record().status.class, record().outcome.notices.length], ['working', SESSION_LIMITS.notices]);
  await world.crashAndRestart();
  assert.equal(record().outcome.notices.length, SESSION_LIMITS.notices, 'the start transaction retires nothing');
  assert.equal(await take(hook(stuck, {kind: 'turn-ended'}, at())), 'applied');
  assert.deepEqual(record().status, {class: 'finished', detail: 'turn-ended'});
  assert.deepEqual(noticeTurns(record()), range(1, SESSION_LIMITS.notices + 1, 'prompt'));
});

it('notices that still count are never retired: past the limit with only those, a turn end is refused with capacity', async context => {
  const {world, take, record, at} = await open(context);
  // A root whose provider names no turn: every end is its own notice, and every one counts.
  const ended = (): LifecycleObservation => ({...hook('unused', {kind: 'turn-ended'}, at()), turn: {status: 'unknown'}});
  const outcomes: string[] = [];
  for (let index = 0; index <= SESSION_LIMITS.notices; index++) outcomes.push(await take(ended()));
  assert.deepEqual(outcomes, [...Array.from({length: SESSION_LIMITS.notices}, () => 'applied'), 'capacity']);
  const held = record();
  assert.equal(held.outcome.notices.length, SESSION_LIMITS.notices);
  assert.ok(held.outcome.notices.every(notice => noticeCounts(notice, held.turn)), 'every notice still counts');
  assert.equal(world.store.records().length, 1);
});

it(`a native conversation that ends ${String(turns)} tasks keeps taking its observations`, async context => {
  const {take, record, at} = await open(context);
  const outcomes: string[] = [];
  let sequence = 0;
  for (let index = 0; index < turns; index++) {
    outcomes.push(await take(native(`task-${String(index)}`, {kind: 'turn-started'}, ++sequence, at())));
    outcomes.push(await take(native(`task-${String(index)}`, {kind: 'turn-ended', result: 'succeeded'}, ++sequence, at())));
  }
  assert.deepEqual(outcomes.filter(outcome => outcome !== 'applied'), [], 'no observation is refused');
  const held = record();
  assert.deepEqual(held.turn, {status: 'known', id: `task-${String(turns - 1)}`});
  assert.deepEqual(held.status, {class: 'finished', detail: 'succeeded'});
  assert.deepEqual(noticeTurns(held), range(turns - SESSION_LIMITS.notices, turns, 'task'));
});

const questions = SESSION_LIMITS.watermarks + 8;

/** One task's questions, each asked and answered, from `from` up to `to`, at the conversation's next sequences. */
async function ask(take: (data: LifecycleObservation) => Promise<string>, at: () => number, sequence: {next: number}, from: number, to: number): Promise<string[]> {
  const outcomes: string[] = [];
  for (let index = from; index < to; index++) {
    const attention = {status: 'known' as const, id: `question-${String(index)}`};
    outcomes.push(await take(native('task-1', {kind: 'attention-input', attention}, ++sequence.next, at())));
    outcomes.push(await take(native('task-1', {kind: 'attention-resolved', attention}, ++sequence.next, at())));
  }
  return outcomes;
}

it(`a native conversation whose one task asks and answers ${String(questions)} questions keeps taking its observations`, async context => {
  const {take, record, stored, at} = await open(context);
  const sequence = {next: 0};
  const outcomes = [await take(native('task-1', {kind: 'turn-started'}, ++sequence.next, at()))];
  outcomes.push(...await ask(take, at, sequence, 0, questions));
  // A question still open when the limit is passed keeps its watermark.
  const pending = {status: 'known' as const, id: 'question-open'};
  outcomes.push(await take(native('task-1', {kind: 'attention-input', attention: pending}, ++sequence.next, at())));
  outcomes.push(...await ask(take, at, sequence, questions, questions + 4));
  assert.deepEqual(outcomes.filter(outcome => outcome !== 'applied'), [], 'no observation is refused');
  const watermarks = stored().watermarks;
  assert.ok(watermarks.length <= SESSION_LIMITS.watermarks);
  assert.ok(watermarks.some(item => item.dimension === 'activity'), 'the activity watermark is kept');
  assert.ok(watermarks.some(item => item.dimension === 'attention:question-open'), 'a held item keeps its watermark');
  assert.equal(watermarks.filter(item => item.dimension === WATERMARK_FLOOR).length, 1, 'one floor for the one epoch');
  assert.deepEqual(record().attention.items.map(item => item.id), [pending]);
  outcomes.push(await take(native('task-1', {kind: 'turn-ended', result: 'succeeded'}, ++sequence.next, at())));
  assert.deepEqual([record().status, record().attention.items], [{class: 'finished', detail: 'succeeded'}, []]);
});

it('ordered evidence at or below the watermark floor in a dimension without its own watermark is stale, and above it applies', async context => {
  const {take, record, stored, at} = await open(context);
  const sequence = {next: 0};
  await take(native('task-1', {kind: 'turn-started'}, ++sequence.next, at()));
  await ask(take, at, sequence, 0, questions);
  const floor = stored().watermarks.find(item => item.dimension === WATERMARK_FLOOR);
  assert.ok(floor, 'dropping watermarks leaves a floor');
  assert.equal(floor.epoch, conversation.sessionId);
  assert.ok(floor.sequence > 0 && floor.sequence < sequence.next);
  assert.equal(stored().watermarks.some(item => item.dimension === 'attention:question-0'), false, 'the oldest answered question\'s watermark is gone');
  const late = (id: string, position: number): LifecycleObservation => native('task-1', {kind: 'attention-input', attention: {status: 'known', id}}, position, at());
  assert.equal(await take(late('question-late', floor.sequence)), 'stale', 'at the floor');
  assert.equal(await take(late('question-later', floor.sequence - 1)), 'stale', 'below the floor');
  assert.deepEqual(record().attention.items, []);
  assert.equal(await take(late('question-above', floor.sequence + 1)), 'applied', 'above the floor, as a new dimension always did');
  assert.deepEqual(record().attention.items.map(item => item.id), [{status: 'known', id: 'question-above'}]);
});

it('a late duplicate of an answered question, after its retry key and watermark are gone, raises nothing', async context => {
  const {take, record, stored, at} = await open(context);
  const sequence = {next: 0};
  await take(native('task-1', {kind: 'turn-started'}, ++sequence.next, at()));
  const first = native('task-1', {kind: 'attention-input', attention: {status: 'known', id: 'question-first'}}, ++sequence.next, at());
  assert.equal(await take(first), 'applied');
  assert.equal(await take(native('task-1', {kind: 'attention-resolved', attention: {status: 'known', id: 'question-first'}}, ++sequence.next, at())), 'applied');
  await ask(take, at, sequence, 0, questions);
  assert.equal(stored().seen.length, SESSION_LIMITS.seen, 'the retry keys rotated');
  assert.equal(stored().watermarks.some(item => item.dimension === 'attention:question-first'), false);
  assert.equal(await take({...first, observedAtMs: at()}), 'stale', 'the redelivered question is older than the floor');
  assert.deepEqual(record().attention.items, []);
});
