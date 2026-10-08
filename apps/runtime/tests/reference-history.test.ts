// The reference history (Hub #831, the #842 hand-off): #842's root session fixtures in
// packages/event-contracts/fixtures/v2/families.json must be messages the real owner published, in one history it
// could produce. This test replays that history through the core store and its agent-state owner and compares every
// named fixture with what the owner published. `BUNNY_WRITE_REFERENCE=1` writes the owner's messages into the fixture
// file instead, keeping each fixture's `id` and `traceparent`; the notice the owner gave the finished turn replaces the
// one the fixtures named before.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import type {TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {Identity, LifecycleEvent, LifecycleObservation, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {World, lifecycleMessage} from './fixtures/store-world.js';
import {START, it} from './support.js';

const FIXTURES = new URL('../../fixtures/v2/families.json', import.meta.resolve('@jimmie-potts/event-contracts/v2'));
type Fixtures = {valid: Record<string, Message>; invalid: {name: string; base: string; set: Record<string, unknown>}[]};

const ROOT: Identity = {provider: 'codex', client: 'desktop', hostId: 'host-a', sourceId: 'codex-desktop', sessionId: 'session-root'};
const CHILD: Identity = {...ROOT, sessionId: 'session-child'};
const turn = (id: string): {status: 'known'; id: string} => ({status: 'known', id});
const ordered = (sequence: number): LifecycleObservation['ordering'] => ({status: 'known', authority: 'codex-desktop', epoch: 'codex-epoch-1', sequence});
/** The root's display metadata, as its hook reports it with every observation. */
const METADATA = {
  projectId: 'hub', label: {value: 'Port Nanoleaf', origin: 'user'}, title: {value: 'Translate the bridge tests', source: 'provider'}, project: 'agent-device-hub',
} as const;
const root = (event: LifecycleEvent, observedAtMs: number, rest: Partial<LifecycleObservation> = {}): LifecycleObservation =>
  ({identity: ROOT, turn: turn('turn-7'), parent: {status: 'top-level'}, event, observedAtMs, ordering: {status: 'unknown'}, ...METADATA, ...rest});

/**
 * Replays the reference history on a fresh store with the owner's clock at the fixtures' instant, and returns what the
 * owner published under each fixture's name.
 */
async function replay(context: TestContext, fixtures: Fixtures): Promise<Map<string, Message>> {
  const world = await World.open(context);
  const named = new Map<string, Message>();
  const step = async (observation: LifecycleObservation, id?: string): Promise<Message[]> => {
    const from = world.published.length;
    const result = await world.take(lifecycleMessage(observation, START, id));
    assert.equal(result.ok && result.outcome, 'applied', JSON.stringify(observation.event));
    return world.since(from);
  };
  const last = (messages: readonly Message[], type: string, subject?: string): Message => {
    const found = messages.filter(message => message.type === type && (subject === undefined || message.subject === subject)).at(-1);
    assert.ok(found, `${type} was published`);
    return found;
  };
  const rootId = fixtures.valid.session?.subject ?? '';
  // The root session starts on turn 7, and its hook reports that it cannot see parentage.
  await step(root({kind: 'session-started'}, START - 9000, {ordering: ordered(38)}));
  named.set('session-at-2', last(await step(root({kind: 'evidence-unavailable', dimension: 'parent', reason: 'unsupported'}, START - 8500, {ordering: ordered(39)})), 'org.bunny.session.updated'));
  // A subagent starts under it, with the label the agent gave it.
  const child = await step({identity: CHILD, turn: {status: 'unknown'}, parent: {status: 'known', identity: ROOT}, event: {kind: 'session-started'},
    observedAtMs: START - 8000, ordering: {status: 'unknown'}, label: {value: 'Review the schema', origin: 'agent'}});
  named.set('session-child', last(child, 'org.bunny.session.updated', fixtures.valid['session-child']?.subject));
  // The approval prompt: the `lifecycle` fixture itself, observed at START - 3000. Later observations follow it.
  const prompt = fixtures.valid.lifecycle as Message<LifecycleObservation>;
  named.set('attention-raised', last(await step(prompt.data, prompt.id), 'org.bunny.attention.raised'));
  await step(root({kind: 'read-observed', state: 'unread'}, START - 2800));
  named.set('turn-ended', last(await step(root({kind: 'turn-ended'}, START - 2600, {ordering: ordered(41)})), 'org.bunny.turn.ended'));
  // Nanoleaf acknowledges the finished turn's notice.
  const notice = named.get('turn-ended')?.data.noticeId;
  assert.equal(typeof notice, 'string');
  const from = world.published.length;
  assert.equal((await world.owner?.acknowledge(ROOT, String(notice), 'nanoleaf'))?.ok, true);
  named.set('session', last(world.since(from), 'org.bunny.session.updated'));
  // The approval is resolved on its turn, after the turn ended.
  const resolved = await step(root({kind: 'attention-resolved', attention: {status: 'known', id: 'approval-1'}}, START - 2400, {ordering: ordered(42)}));
  named.set('attention-cleared', last(resolved, 'org.bunny.attention.cleared'));
  named.set('session-root-later', last(resolved, 'org.bunny.session.updated', rootId));
  // Turn 8 raises an approval without a request ID and is interrupted without a Stop; turn 9 retires it.
  await step(root({kind: 'turn-started'}, START - 2200, {turn: turn('turn-8'), ordering: ordered(43)}));
  await step(root({kind: 'attention-approval', attention: {status: 'unknown'}}, START - 2000, {turn: turn('turn-8'), ordering: ordered(44)}));
  named.set('attention-cleared-retired', last(await step(root({kind: 'turn-started'}, START - 1800, {turn: turn('turn-9'), ordering: ordered(45)})), 'org.bunny.attention.cleared'));
  // The runtime ends: the root and its subagent are retired.
  const ended = await step(root({kind: 'runtime-ended'}, START - 1500, {turn: turn('turn-9'), ordering: ordered(46)}));
  named.set('session-ended', last(ended, 'org.bunny.session.ended'));
  named.set('session-retired-root', last(ended, 'org.bunny.session.removed', rootId));
  named.set('session-retired-child', last(ended, 'org.bunny.session.removed', fixtures.valid['session-child']?.subject));
  return named;
}

/** A fixture as the owner published it, with the fixture's own `id` and `traceparent`. */
const asFixture = (fixture: Message, published: Message): Message => ({...published, id: fixture.id, traceparent: fixture.traceparent});

it('#842\'s root session fixtures are what the real owner published in one reference history', async context => {
  const text = readFileSync(FIXTURES, 'utf8');
  const fixtures = JSON.parse(text) as Fixtures;
  const named = await replay(context, fixtures);
  if (process.env.BUNNY_WRITE_REFERENCE === '1') {
    const oldNotice = (fixtures.valid.session?.data as SessionRecord).notices[0]?.id ?? '';
    const newNotice = String(named.get('turn-ended')?.data.noticeId);
    // Replacing an empty string would splice the new ID between every character of the file.
    assert.match(oldNotice, /^[0-9a-f]{64}$/, 'the fixtures name a notice to replace');
    for (const [name, published] of named) {
      const fixture = fixtures.valid[name];
      assert.ok(fixture, name);
      fixtures.valid[name] = asFixture(fixture, published);
    }
    // A generation after the revision stays one past the regenerated record's revision.
    const generation = fixtures.invalid.find(item => item.name === 'a generation after the revision');
    if (generation !== undefined) generation.set['/data/generation'] = (fixtures.valid.session?.data as SessionRecord).revision + 1;
    writeFileSync(FIXTURES, `${JSON.stringify(fixtures, null, 1).replaceAll(oldNotice, newNotice)}\n`);
    return;
  }
  for (const [name, published] of named) {
    const fixture = fixtures.valid[name];
    assert.ok(fixture, `families.json holds ${name}`);
    assert.deepEqual(fixture, asFixture(fixture, published), `${name} is the message the owner published`);
  }
  // Every fixture that names the finished turn's notice names the one the owner gave it.
  const notice = String(named.get('turn-ended')?.data.noticeId);
  for (const name of ['session', 'session-root-later', 'notice-acknowledge']) {
    assert.ok(JSON.stringify(fixtures.valid[name]).includes(notice), `${name} names the owner's notice`);
  }
});
