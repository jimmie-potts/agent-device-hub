// agent-state's owner tests, translated to observations on the core's own session logic (Hub #1865 group 7, tasks.md
// 7.1). Each test keeps the agent-state test's name and rule: packages/agent-state/tests/approvals, capacity, retention,
// session-retirement, current-status and core. The hooks those tests normalized are written here as the 2.0
// observations the runtime's hook adapter sends: UserPromptSubmit is `turn-started` on its prompt or turn ID,
// PermissionRequest an approval without a request ID, PostToolUse an `attention-resolved` for its tool use, Stop
// `turn-ended`, SessionEnd `runtime-ended`, and a subagent's hooks the child session's own observations under a known
// parent, on an unknown turn. The consumers are the core's: `dashboard` keeps its notices across a new turn, `nanoleaf`
// and `pixoo` do not. Not translated, because the core does not keep them: agent-state's storage contract and leases,
// its journal, subscriptions, exports and imports, legacy formats and their startup settlements, the snapshot schemas,
// and the lossCount and revision counts of agent-state's own owner. The provider normalizer and hook tests belong to the
// hook adapter.
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import type {Identity, Label, LifecycleEvent, LifecycleObservation, Parent, SessionRecord, Title} from '@jimmie-potts/event-contracts/v2/families';
import type {Deriver} from '../src/core/store.js';
import {World, lifecycleMessage} from './fixtures/store-world.js';
import {it, manualClock} from './support.js';

const DAY = 86_400_000;
const START = 1_000_000_000_000;

type Options = {
  identity?: Identity; turn?: string | null; parent?: Parent; epoch?: string; sequence?: number; nativeEventId?: string; atMs?: number;
  hostSessionId?: string; title?: Title; label?: Label; project?: string; projectId?: string;
};

/** A session world on the core store, with the helpers the agent-state tests used. */
class Sessions {
  constructor(readonly world: World, readonly identity: (sessionId: string) => Identity) {}

  static async open(context: TestContext, identity: (sessionId: string) => Identity, options: {derivers?: readonly Deriver[]} = {}): Promise<Sessions> {
    // These tests need no sync to disk: crashes and their recovery are the store's own tests.
    const wrap = (db: DatabaseSync): DatabaseSync => { db.exec('PRAGMA synchronous = OFF'); return db; };
    return new Sessions(await World.open(context, {clock: manualClock(START), wrap, ...options}), identity);
  }

  now(): number {
    return this.world.clock.now();
  }

  advance(ms: number): void {
    this.world.clock.advance(ms);
  }

  observation(sessionId: string, event: LifecycleEvent, options: Options = {}): LifecycleObservation {
    const identity = options.identity ?? this.identity(sessionId);
    const turn = options.turn === undefined ? 'turn-1' : options.turn;
    return {
      identity, turn: turn === null ? {status: 'unknown'} : {status: 'known', id: turn}, parent: options.parent ?? {status: 'top-level'}, event,
      observedAtMs: options.atMs ?? this.now(),
      ordering: options.sequence === undefined ? {status: 'unknown'} : {status: 'known', authority: identity.sourceId, epoch: options.epoch ?? 'epoch-1', sequence: options.sequence},
      ...(options.nativeEventId === undefined ? {} : {nativeEventId: options.nativeEventId}),
      ...(options.hostSessionId === undefined ? {} : {hostSessionId: options.hostSessionId}),
      ...(options.title === undefined ? {} : {title: options.title}),
      ...(options.label === undefined ? {} : {label: options.label}),
      ...(options.project === undefined ? {} : {project: options.project}),
      ...(options.projectId === undefined ? {} : {projectId: options.projectId}),
    };
  }

  /** Takes one observation and gives its outcome word, or the refusal's code. */
  async take(observation: LifecycleObservation): Promise<string> {
    const result = await this.world.take(lifecycleMessage(observation, this.now()));
    return result.ok ? result.outcome : result.code;
  }

  observe(sessionId: string, event: LifecycleEvent, options: Options = {}): Promise<string> {
    return this.take(this.observation(sessionId, event, options));
  }

  /** A child's observation under a known parent, on an unknown turn, as a subagent's hooks report it. */
  child(sessionId: string, parent: string, event: LifecycleEvent, options: Options = {}): Promise<string> {
    return this.observe(sessionId, event, {turn: null, parent: {status: 'known', identity: this.identity(parent)}, ...options});
  }

  record(sessionId: string): SessionRecord {
    const found = this.world.store.records().find(record => record.identity.sessionId === sessionId);
    assert.ok(found, `${sessionId} is held`);
    return found;
  }

  ids(): string[] {
    return this.world.store.records().map(record => record.identity.sessionId).sort();
  }

  async due(): Promise<void> {
    await this.world.store.refresh();
  }
}

const unknownApproval: LifecycleEvent = {kind: 'attention-approval', attention: {status: 'unknown'}};
const known = (kind: 'attention-approval' | 'attention-input' | 'question-continuing' | 'attention-resolved', id: string): LifecycleEvent => ({kind, attention: {status: 'known', id}});
const started: LifecycleEvent = {kind: 'turn-started'}, ended: LifecycleEvent = {kind: 'turn-ended'};
const approvals = (record: SessionRecord): string[][] => record.attention.filter(item => item.kind === 'approval')
  .map(item => [item.turn.status === 'known' ? item.turn.id : 'unknown', item.id.status === 'known' ? item.id.id : 'no-id']);
const desktop = (sessionId: string): Identity => ({provider: 'codex', client: 'desktop', hostId: 'host', sourceId: 'desktop', sessionId});
const claude = (sessionId: string): Identity => ({provider: 'claude', client: 'code', hostId: 'host', sourceId: 'claude', sessionId});
const cli = (sessionId: string): Identity => ({provider: 'codex', client: 'cli', hostId: 'host', sourceId: 'cli', sessionId});

// approvals.test.mjs: #225, a newer turn proves that an approval without a request ID on the retired turn was answered.

it('a no-ID approval clears when a newer turn starts', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('session', started);
  await s.observe('session', unknownApproval);
  assert.deepEqual(approvals(s.record('session')), [['turn-1', 'no-id']]);
  await s.observe('session', started, {turn: 'turn-2'});
  assert.deepEqual(approvals(s.record('session')), []);
  assert.deepEqual(s.record('session').turn, {status: 'known', id: 'turn-2'});
  assert.ok(s.record('session').unavailable.some(item => item.dimension === 'attention' && item.reason === 'ambiguous'), 'earlier uncertainty stays');
});

it('no-ID questions and input requests on a retired turn stay', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('session', started);
  for (const kind of ['attention-input', 'question-continuing'] as const) await s.observe('session', {kind, attention: {status: 'unknown'}});
  await s.observe('session', started, {turn: 'turn-2'});
  assert.deepEqual(s.record('session').attention.map(item => [item.kind, item.turn.status === 'known' ? item.turn.id : '']).sort(), [['input', 'turn-1'], ['question', 'turn-1']]);
});

it('markers on the current or an unselected turn stay when another turn starts', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('session', started);
  await s.observe('session', unknownApproval, {turn: 'turn-9'});
  await s.observe('session', started, {turn: 'turn-2'});
  await s.observe('session', unknownApproval, {turn: 'turn-2'});
  assert.deepEqual(approvals(s.record('session')), [['turn-9', 'no-id'], ['turn-2', 'no-id']]);
});

it('a late no-ID approval for a retired turn is not retained', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('session', started);
  await s.observe('session', started, {turn: 'turn-2'});
  await s.observe('session', unknownApproval);
  assert.deepEqual(approvals(s.record('session')), []);
});

it('an approval with a request ID on a retired turn stays', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('session', started);
  await s.observe('session', known('attention-approval', 'request'));
  await s.observe('session', started, {turn: 'turn-2'});
  assert.deepEqual(approvals(s.record('session')), [['turn-1', 'request']]);
});

// #456: tool completion or the end of the same turn proves a no-ID approval on that turn was answered.

it('a tool completion on the approval\'s turn clears the no-ID marker', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe('session', started, {turn: 'p0'});
  await s.observe('session', ended, {turn: 'p0'});
  await s.observe('session', started, {turn: 'p1'});
  await s.observe('session', unknownApproval, {turn: 'p1'});
  const before = s.record('session');
  assert.deepEqual(approvals(before), [['p1', 'no-id']]);
  assert.equal(await s.observe('session', known('attention-resolved', 'tool-x'), {turn: 'p1'}), 'applied');
  const after = s.record('session');
  assert.deepEqual(approvals(after), []);
  assert.equal(after.activity, 'active');
  assert.deepEqual(after.turn, {status: 'known', id: 'p1'});
  assert.deepEqual(after.notices, before.notices);
  assert.deepEqual(after.notices[0]?.acknowledgedBy, ['nanoleaf', 'pixoo']);
});

it('a tool completion without a marker changes no attention and adds no ambiguity', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe('session', started, {turn: 'p1'});
  assert.equal(await s.observe('session', known('attention-resolved', 'tool-x'), {turn: 'p1'}), 'applied');
  assert.deepEqual(s.record('session').attention, []);
  assert.ok(!s.record('session').unavailable.some(item => item.dimension === 'attention'));
});

it('a tool completion on another turn, session or source leaves the marker', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe('session', started, {turn: 'p1'});
  await s.observe('session', unknownApproval, {turn: 'p1'});
  await s.observe('session', known('attention-resolved', 'tool-x'), {turn: 'p2'});
  await s.observe('other', started, {turn: 'p1'});
  await s.observe('other', known('attention-resolved', 'tool-x'), {turn: 'p1'});
  await s.observe('session', known('attention-resolved', 'tool-x'), {turn: 'p1', identity: {...claude('session'), sourceId: 'elsewhere'}});
  assert.deepEqual(approvals(s.record('session')), [['p1', 'no-id']]);
});

it('Stop on the approval turn clears the marker; Stop on an earlier or unknown turn does not', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe('session', started, {turn: 'p0'});
  await s.observe('session', started, {turn: 'p1'});
  await s.observe('session', unknownApproval, {turn: 'p1'});
  await s.observe('session', ended, {turn: 'p0'});
  await s.observe('session', ended, {turn: null});
  assert.deepEqual(approvals(s.record('session')), [['p1', 'no-id']]);
  await s.observe('session', ended, {turn: 'p1'});
  assert.deepEqual(approvals(s.record('session')), []);
});

it('Codex turn end clears its own turn no-ID approval', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('session', started);
  await s.observe('session', unknownApproval);
  await s.observe('session', ended);
  assert.deepEqual(approvals(s.record('session')), []);
});

it('a new approval after a tool completion on the same turn creates a marker', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe('session', started, {turn: 'p1'});
  await s.observe('session', unknownApproval, {turn: 'p1'});
  await s.observe('session', known('attention-resolved', 'tool-x'), {turn: 'p1'});
  s.advance(1000);
  await s.observe('session', unknownApproval, {turn: 'p1'});
  assert.deepEqual(approvals(s.record('session')), [['p1', 'no-id']]);
});

it('the same resolution twice is a duplicate without a new revision', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe('session', started, {turn: 'p1'});
  await s.observe('session', unknownApproval, {turn: 'p1'});
  const resolution = s.observation('session', known('attention-resolved', 'tool-x'), {turn: 'p1'});
  assert.equal(await s.take(resolution), 'applied');
  const revision = s.world.store.revision;
  assert.equal(await s.take(structuredClone(resolution)), 'duplicate');
  assert.equal(s.world.store.revision, revision);
});

it('a resolution for another request ID leaves a known-ID approval', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe('session', started, {turn: 'p1'});
  await s.observe('session', known('attention-approval', 'request'), {turn: 'p1'});
  await s.observe('session', known('attention-resolved', 'tool-y'), {turn: 'p1'});
  await s.observe('session', ended, {turn: 'p1'});
  assert.deepEqual(approvals(s.record('session')), [['p1', 'request']]);
});

it('question and input markers survive tool completion and turn end', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe('session', started, {turn: 'p1'});
  for (const kind of ['attention-input', 'question-continuing'] as const) await s.observe('session', {kind, attention: {status: 'unknown'}}, {turn: 'p1'});
  await s.observe('session', known('attention-resolved', 'tool-x'), {turn: 'p1'});
  await s.observe('session', ended, {turn: 'p1'});
  assert.deepEqual(s.record('session').attention.map(item => item.kind).sort(), ['input', 'question']);
});

// capacity.test.mjs: Hub #807, subagent records must not crowd new root tasks out of a full core.

/** Fills the core with roots up to its limit, a millisecond apart. */
async function fillRoots(s: Sessions): Promise<void> {
  for (let index = s.world.store.records().length; index < 128; index++) {
    s.advance(1);
    await s.observe(`root-${index}`, started);
  }
  assert.equal(s.world.store.records().length, 128);
}
async function finishedChild(s: Sessions, sessionId: string, parent: string): Promise<void> {
  assert.equal(await s.observe(sessionId, {kind: 'session-started'}, {parent: {status: 'known', identity: s.identity(parent)}}), 'applied');
  assert.equal(await s.observe(sessionId, ended, {parent: {status: 'known', identity: s.identity(parent)}}), 'applied');
}
const source = (sessionId: string): Identity => ({provider: 'claude', client: 'code', hostId: 'host', sourceId: 'source', sessionId});

it('a new root task displaces the finished child subtree with the oldest evidence, with its descendants', async context => {
  const s = await Sessions.open(context, source);
  await s.observe('root-parent', started);
  for (const [name, parent] of [['child-old', 'root-parent'], ['grandchild', 'child-old'], ['child-new', 'root-parent']] as const) {
    s.advance(1);
    await finishedChild(s, name, parent);
  }
  assert.equal(s.record('child-old').activity, 'idle');
  await fillRoots(s);
  const roots = s.world.store.records().filter(record => record.parent.status !== 'known').length;
  const from = s.world.published.length;
  s.advance(1);
  assert.equal(await s.observe('new-root', {kind: 'session-started'}), 'applied');
  assert.ok(s.ids().includes('new-root'));
  assert.equal(s.ids().some(id => id === 'child-old' || id === 'grandchild'), false, 'the subtree goes together');
  assert.ok(s.ids().includes('child-new'));
  assert.equal(s.world.store.records().filter(record => record.parent.status !== 'known').length, roots + 1, 'no root is displaced');
  const revisions = new Set(s.world.since(from).map(message => (message.data as {revision: number}).revision));
  assert.equal(revisions.size, 1, 'one transaction retires the child subtree and admits the root');
  assert.equal(await s.observe('child-old', ended, {parent: {status: 'known', identity: source('root-parent')}}), 'stale', 'its guard holds');
});

it('subtree evidence ranks children: a child whose grandchild worked recently is not the oldest', async context => {
  const s = await Sessions.open(context, source);
  await s.observe('root-parent', started);
  s.advance(1);
  await finishedChild(s, 'child-a', 'root-parent');
  s.advance(1);
  await finishedChild(s, 'child-b', 'root-parent');
  s.advance(1);
  await finishedChild(s, 'grandchild-a', 'child-a');
  await fillRoots(s);
  s.advance(1);
  assert.equal(await s.observe('new-root', {kind: 'session-started'}), 'applied');
  assert.ok(s.ids().includes('child-a') && s.ids().includes('grandchild-a'));
  assert.equal(s.ids().includes('child-b'), false);
});

it('running, unknown or attended subtrees are never displaced', async context => {
  const s = await Sessions.open(context, source);
  await s.observe('root-parent', started);
  const under = (parent: string): Options => ({parent: {status: 'known', identity: source(parent)}, turn: null});
  s.advance(1);
  await s.observe('running', {kind: 'session-started'}, under('root-parent'));
  // A subagent's start and stop on its unknown turn leave its activity unknown.
  s.advance(1);
  await s.observe('subagent', {kind: 'session-started'}, under('root-parent'));
  s.advance(1);
  await s.observe('subagent', ended, under('root-parent'));
  s.advance(1);
  await finishedChild(s, 'attended', 'root-parent');
  s.advance(1);
  await finishedChild(s, 'pending-grandchild', 'attended');
  s.advance(1);
  await s.observe('pending-grandchild', unknownApproval, {parent: {status: 'known', identity: source('attended')}});
  s.advance(1);
  await finishedChild(s, 'eligible', 'root-parent');
  assert.equal(s.record('running').activity, 'active');
  assert.equal(s.record('subagent').activity, 'unknown');
  await fillRoots(s);
  s.advance(1);
  assert.equal(await s.observe('new-root', {kind: 'session-started'}), 'applied');
  for (const kept of ['running', 'subagent', 'attended', 'pending-grandchild']) assert.ok(s.ids().includes(kept), kept);
  assert.equal(s.ids().includes('eligible'), false);
  const before = s.ids();
  s.advance(1);
  assert.equal(await s.observe('another-root', {kind: 'session-started'}), 'capacity', 'with no eligible child left, the next root is refused');
  assert.deepEqual(s.ids(), before);
});

it('a full core refuses a new child even when a finished child exists', async context => {
  const s = await Sessions.open(context, source);
  await s.observe('root-parent', started);
  s.advance(1);
  await finishedChild(s, 'finished', 'root-parent');
  await fillRoots(s);
  const before = s.ids();
  s.advance(1);
  assert.equal(await s.observe('new-child', {kind: 'session-started'}, {parent: {status: 'known', identity: source('root-parent')}}), 'capacity');
  assert.deepEqual(s.ids(), before);
});

it('events that would not create a root displace nothing', async context => {
  const s = await Sessions.open(context, source);
  s.advance(2 * DAY);
  await s.observe('retired-root', started);
  await s.observe('retired-root', {kind: 'runtime-ended'});
  await s.observe('root-parent', started);
  s.advance(1);
  await finishedChild(s, 'finished', 'root-parent');
  await fillRoots(s);
  const before = s.ids();
  s.advance(1);
  assert.equal(await s.observe('reader', {kind: 'read-observed', state: 'read'}), 'stale', 'read evidence cannot establish a session');
  assert.equal(await s.observe('retired-root', ended), 'stale', 'a retired root\'s later non-start event is guarded');
  assert.equal(await s.observe('old-root', started, {atMs: s.now() - DAY - 1}), 'stale', 'older than the retention window');
  assert.deepEqual(s.ids(), before);
});

it('an archived Codex Desktop conversation displaces nothing', async context => {
  const s = await Sessions.open(context, desktop);
  s.world.archived = target => target.sessionId === 'archived';
  await s.observe('parent', started);
  for (const kind of ['session-started', 'turn-ended'] as const) {
    s.advance(1);
    await s.observe('child', {kind}, {parent: {status: 'known', identity: desktop('parent')}});
  }
  await fillRoots(s);
  s.advance(1);
  assert.equal(await s.observe('archived', {kind: 'session-started'}), 'stale');
  assert.ok(s.ids().includes('child'), 'the child stays');
  assert.equal(await s.observe('live', {kind: 'session-started'}), 'applied');
  assert.equal(s.ids().includes('child'), false);
});

it('a failed displacement commit admits nothing and leaves the child', async context => {
  let failing = false;
  const s = await Sessions.open(context, source, {derivers: [() => { if (failing) throw new Error('disk'); }]});
  await s.observe('root-parent', started);
  s.advance(1);
  await finishedChild(s, 'finished', 'root-parent');
  await fillRoots(s);
  failing = true;
  s.advance(1);
  assert.equal(await s.observe('new-root', {kind: 'session-started'}), 'storage-failed');
  assert.ok(s.ids().includes('finished'));
  assert.equal(s.ids().includes('new-root'), false);
  assert.ok(s.world.store.sessions().some(session => session.identity.sessionId === 'finished'), 'the stored child too');
});

// retention.test.mjs: monitoring state is forgotten after a day without lifecycle evidence.

const unknownParent: Options = {parent: {status: 'unknown'}};

it('expiry frees capacity for identities beyond the lifetime limit', async context => {
  const s = await Sessions.open(context, desktop);
  for (let index = 0; index < 128; index++) assert.equal(await s.observe(`first-${index}`, {kind: 'session-started'}, unknownParent), 'applied');
  assert.equal(await s.observe('rejected', {kind: 'session-started'}, unknownParent), 'capacity');
  s.advance(DAY);
  assert.equal(await s.observe('second-0', {kind: 'session-started'}, unknownParent), 'applied');
  assert.deepEqual(s.ids(), ['second-0']);
  for (let index = 1; index < 128; index++) await s.observe(`second-${index}`, {kind: 'session-started'}, unknownParent);
  assert.equal(s.world.store.records().length, 128);
  s.advance(DAY - 1);
  assert.equal(await s.observe('third-0', {kind: 'session-started'}, unknownParent), 'capacity');
  s.advance(1);
  assert.equal(await s.observe('third-0', {kind: 'session-started'}, unknownParent), 'applied');
  assert.deepEqual(s.ids(), ['third-0']);
});

it('only lifecycle evidence renews the 24-hour window', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('renewed', {kind: 'session-started'}, unknownParent);
  await s.observe('labelled', started, unknownParent);
  await s.observe('labelled', ended, unknownParent);
  s.advance(3_600_000);
  await s.observe('renewed', started, {...unknownParent, turn: 'turn-2'});
  const labelled = s.record('labelled');
  assert.equal((await s.world.setLabel(labelled.identity, 'Chosen label')).ok, true);
  assert.equal((await s.world.acknowledge(labelled.identity, labelled.notices[0]?.id ?? '', 'nanoleaf')).ok, true);
  assert.equal(s.record('labelled').lastEvidenceAtMs, labelled.lastEvidenceAtMs);
  s.advance(DAY - 3_600_000 - 1);
  await s.due();
  assert.deepEqual(s.ids(), ['labelled', 'renewed']);
  s.advance(1);
  await s.due();
  assert.deepEqual(s.ids(), ['renewed']);
  s.advance(3_600_000 - 1);
  await s.due();
  assert.deepEqual(s.ids(), ['renewed']);
  s.advance(1);
  await s.due();
  assert.deepEqual(s.ids(), []);
});

it('a restart keeps the window and expires old sessions at startup', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('kept', {kind: 'session-started'}, unknownParent);
  s.advance(DAY - 1);
  await s.world.crashAndRestart();
  assert.deepEqual(s.ids(), ['kept']);
  // #1865 step 8: a quiet root has no running work for the restart to leave unconfirmed.
  assert.equal(s.record('kept').restartUncertain, false);
  s.advance(1);
  await s.world.crashAndRestart();
  assert.deepEqual(s.ids(), []);
  await s.world.crashAndRestart();
  assert.deepEqual(s.ids(), []);
});

it('expiry falls due on the core\'s clock without another provider event', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('idle', {kind: 'session-started'}, unknownParent);
  s.advance(3_600_000);
  await s.observe('recent', {kind: 'session-started'}, unknownParent);
  assert.equal(s.world.store.nextDue(), START + 3_600_000 + 300_000, 'freshness first');
  await s.due();
  s.advance(DAY - 3_600_000);
  assert.deepEqual(s.ids(), ['idle', 'recent'], 'nothing changes until the core\'s timer runs');
  assert.ok((s.world.store.nextDue() ?? Infinity) <= s.now(), 'the idle session\'s expiry is due');
  await s.due();
  assert.deepEqual(s.ids(), ['recent']);
  assert.deepEqual(s.world.store.sessions().map(session => session.identity.sessionId), ['recent']);
});

it('late and end-only observations cannot refill expired slots', async context => {
  const s = await Sessions.open(context, desktop);
  assert.equal(await s.observe('ended', {kind: 'runtime-ended'}, unknownParent), 'stale');
  await s.observe('kept', started, unknownParent);
  await s.observe('kept', ended, unknownParent);
  await s.world.setLabel(desktop('kept'), 'Old label');
  const kept = s.record('kept');
  s.advance(DAY);
  assert.equal(await s.observe('kept', started, {...unknownParent, turn: 'turn-2', atMs: s.now() - DAY}), 'stale');
  assert.equal(await s.observe('new', {kind: 'session-started'}, {...unknownParent, atMs: s.now() - DAY}), 'stale');
  await s.due();
  assert.deepEqual(s.ids(), []);
  assert.equal(await s.observe('kept', {kind: 'runtime-ended'}, unknownParent), 'stale');
  assert.deepEqual(s.ids(), []);
  assert.equal(await s.observe('kept', {kind: 'session-started'}, unknownParent), 'applied');
  const fresh = s.record('kept');
  assert.equal(fresh.label, undefined);
  assert.deepEqual(fresh.notices, []);
  assert.equal(fresh.read, 'unknown');
  assert.equal(fresh.restartUncertain, false);
  assert.ok(fresh.generation > kept.generation);
});

it('expiry forgets notices and attention without acknowledging them and keeps orphaned children valid', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('parent', started, unknownParent);
  await s.observe('parent', unknownApproval, unknownParent);
  await s.observe('parent', ended, unknownParent);
  await s.observe('other', {kind: 'session-started'}, unknownParent);
  s.advance(3_600_000);
  const parent: Parent = {status: 'known', identity: desktop('parent')};
  await s.observe('child', {kind: 'session-started'}, {parent, turn: null});
  for (const event of [started, {kind: 'attention-input', attention: {status: 'unknown'}} as const, ended]) await s.observe('other', event, {...unknownParent, turn: 'turn-2'});
  await s.world.setLabel(desktop('other'), 'Bystander');
  const other = s.record('other');
  assert.deepEqual([other.label?.value, other.notices.length, other.attention.length], ['Bystander', 1, 1]);
  const from = s.world.published.length;
  s.advance(DAY - 3_600_000);
  await s.due();
  assert.deepEqual(s.ids(), ['child', 'other']);
  assert.deepEqual(s.record('child').parent, parent);
  const {freshness: _freshness, revision: _revision, ...rest} = s.record('other');
  const {freshness: _before, revision: _old, ...before} = other;
  assert.deepEqual(rest, before);
  assert.equal(s.world.since(from).some(message => message.type === 'org.bunny.attention.cleared' || message.type === 'org.bunny.turn.ended'), false,
    'expiry is no acknowledgment or resolution');
});

it('a late observation cannot renew a live session, and a corrected clock jump does not strand producers', async context => {
  const s = await Sessions.open(context, desktop);
  s.advance(2 * DAY);
  await s.observe('live', {kind: 'session-started'}, unknownParent);
  const first = s.record('live').lastEvidenceAtMs;
  s.advance(DAY - 3_600_000);
  assert.equal(await s.observe('live', started, {...unknownParent, turn: 'turn-2', atMs: s.now() - DAY}), 'stale');
  assert.equal(s.record('live').lastEvidenceAtMs, first);
  assert.equal(await s.observe('live', started, {...unknownParent, turn: 'turn-3', atMs: s.now() - DAY + 1}), 'applied');
  assert.equal(s.record('live').lastEvidenceAtMs, s.now());
  s.advance(2 * DAY);
  assert.equal(await s.observe('ahead', {kind: 'session-started'}, unknownParent), 'applied');
  s.advance(-2 * DAY);
  assert.equal(await s.observe('corrected', {kind: 'session-started'}, unknownParent), 'applied');
  assert.ok(s.ids().includes('corrected'));
  assert.ok(s.record('corrected').lastEvidenceAtMs >= s.record('ahead').lastEvidenceAtMs, 'a change\'s instant never goes back before an earlier one');
});

// session-retirement.test.mjs: every supported provider and client path shares one retirement rule (Hub #241).

for (const [provider, client] of [['codex', 'desktop'], ['codex', 'cli'], ['claude', 'code']] as const) {
  const path = `${provider}/${client}`;
  const identity = (sessionId: string): Identity => ({provider, client, hostId: 'host', sourceId: 'source', sessionId});
  const under = (parent: string): Options => ({parent: {status: 'known', identity: identity(parent)}});

  it(`${path}: one end retires the parent and its known descendants in one change`, async context => {
    const s = await Sessions.open(context, identity);
    await s.observe('parent', started);
    await s.observe('parent', ended);
    await s.world.setLabel(identity('parent'), 'Old task');
    await s.observe('child', {kind: 'session-started'}, under('parent'));
    await s.observe('grandchild', {kind: 'session-started'}, under('child'));
    for (let index = 3; index < 128; index++) await s.observe(`unrelated-${index}`, started);
    const kept = s.world.store.records().filter(record => record.identity.sessionId.startsWith('unrelated-'));
    const from = s.world.published.length;
    assert.equal(await s.observe('parent', {kind: 'runtime-ended'}, {turn: null, parent: {status: 'unknown'}}), 'applied');
    const sent = s.world.since(from);
    assert.deepEqual(sent.map(message => message.type), ['org.bunny.session.ended', 'org.bunny.session.removed', 'org.bunny.session.removed', 'org.bunny.session.removed']);
    assert.equal(new Set(sent.map(message => (message.data as {revision: number}).revision)).size, 1, 'one revision');
    assert.deepEqual(s.world.store.records().map(record => record.id).sort(), kept.map(record => record.id).sort());
    assert.equal(await s.observe('new', started), 'applied', 'retirement released capacity');
    const revision = s.world.store.revision;
    assert.equal(await s.observe('parent', {kind: 'runtime-ended'}, {turn: null, parent: {status: 'unknown'}}), 'stale');
    assert.equal(await s.observe('unknown', {kind: 'runtime-ended'}, {turn: null}), 'stale');
    assert.equal(s.world.store.revision, revision);
    assert.deepEqual(s.world.rows('SELECT id FROM core_session_guards').length, 3);
  });

  it(`${path}: retirement guards survive restart and preserve fresh same-identity work after a missed removal`, async context => {
    const s = await Sessions.open(context, identity);
    const first = s.observation('parent', started, {nativeEventId: 'start-old'});
    const end = s.observation('parent', {kind: 'runtime-ended'}, {nativeEventId: 'end-old'});
    await s.take(first);
    await s.observe('parent', ended);
    await s.world.setLabel(identity('parent'), 'Forgotten');
    const old = s.record('parent');
    await s.take(end);
    await s.world.crashAndRestart();
    for (const observation of [first, s.observation('parent', {kind: 'activity-observed'}), end]) assert.equal(await s.take(observation), 'stale');
    assert.deepEqual(s.ids(), []);
    s.advance(1);
    await s.observe('parent', started, {turn: 'new-turn'});
    const fresh = s.record('parent');
    assert.ok(fresh.generation > old.generation);
    assert.equal(fresh.label, undefined);
    assert.deepEqual([fresh.notices, fresh.attention, fresh.read], [[], [], 'unknown']);
    assert.equal(await s.take(end), 'stale');
    assert.equal(await s.take(first), 'stale');
    assert.deepEqual(s.record('parent'), fresh);
    await s.world.crashAndRestart();
    assert.equal(s.record('parent').generation, fresh.generation);
  });

  it(`${path}: old ordered ends and delayed children cannot remove or refill a retired tree`, async context => {
    const s = await Sessions.open(context, identity);
    const ordered = (event: LifecycleEvent, sequence: number, turn = 'a'): Promise<string> => s.observe('parent', event, {turn, epoch: 'native', sequence});
    await ordered(started, 10);
    assert.equal(await ordered({kind: 'runtime-ended'}, 9), 'stale');
    assert.deepEqual(s.ids(), ['parent']);
    await s.observe('child', {kind: 'session-started'}, under('parent'));
    await ordered({kind: 'runtime-ended'}, 11);
    assert.deepEqual(s.ids(), []);
    assert.equal(await s.observe('unseen-child', {kind: 'session-started'}, under('parent')), 'stale');
    assert.equal(await s.observe('child', started), 'stale');
    await ordered(started, 12, 'b');
    assert.equal(await ordered({kind: 'runtime-ended'}, 11, 'unknown-old-turn'), 'stale');
    assert.deepEqual(s.ids(), ['parent']);
  });

  it(`${path}: ordinary completion, waiting, interruption, acknowledgment, child completion and a long turn retain their records`, async context => {
    const s = await Sessions.open(context, identity);
    await s.observe('waiting', started);
    await s.observe('waiting', known('attention-input', 'input'));
    await s.observe('finished', started);
    await s.observe('finished', ended);
    await s.world.acknowledge(identity('finished'), s.record('finished').notices[0]?.id ?? '', 'nanoleaf');
    if (client === 'desktop') await s.observe('finished', {kind: 'read-observed', state: 'read'});
    await s.observe('interrupted', started);
    await s.observe('interrupted', {kind: 'turn-interrupted'});
    await s.observe('parent', started);
    await s.observe('child', {kind: 'session-started'}, under('parent'));
    await s.observe('child', ended, under('parent'));
    await s.observe('long', started);
    s.advance(31 * 60_000);
    await s.due();
    assert.deepEqual(s.ids(), ['child', 'finished', 'interrupted', 'long', 'parent', 'waiting']);
    assert.ok(s.world.store.records().every(record => record.freshness === 'uncertain'));
    assert.equal(s.record('long').activity, 'active');
    assert.equal(s.record('finished').notices.length, 1);
    s.advance(DAY - 31 * 60_000 - 1);
    await s.due();
    assert.equal(s.ids().length, 6);
    s.advance(1);
    await s.due();
    assert.deepEqual(s.ids(), []);
  });
}

it('ending one path\'s last session preserves other paths, including the same session ID elsewhere', async context => {
  const s = await Sessions.open(context, desktop);
  const paths = [desktop, cli, (sessionId: string): Identity => ({...claude(sessionId), sourceId: 'cli'})];
  for (const path of paths) {
    await s.observe('shared', started, {identity: path('shared')});
    await s.observe('shared', ended, {identity: path('shared')});
    await s.observe('child', {kind: 'session-started'}, {identity: path('child'), parent: {status: 'known', identity: path('shared')}});
  }
  assert.equal(s.world.store.records().length, 6);
  const keys = (): string[] => s.world.store.records().map(record => `${record.identity.provider}/${record.identity.client}/${record.identity.sessionId}`).sort();
  const [desktopPath, cliPath, claudePath] = paths as [typeof desktop, typeof desktop, typeof desktop];
  assert.equal(await s.observe('shared', {kind: 'runtime-ended'}, {identity: claudePath('shared'), turn: null}), 'applied');
  assert.deepEqual(keys(), ['codex/cli/child', 'codex/cli/shared', 'codex/desktop/child', 'codex/desktop/shared']);
  assert.equal(await s.observe('shared', {kind: 'runtime-ended'}, {identity: cliPath('shared'), turn: null}), 'applied');
  assert.deepEqual(keys(), ['codex/desktop/child', 'codex/desktop/shared']);
  assert.equal(await s.observe('never-seen', {kind: 'runtime-ended'}, {identity: cliPath('never-seen'), turn: null}), 'stale');
  assert.equal(await s.observe('child', started, {identity: claudePath('child'), parent: {status: 'known', identity: claudePath('shared')}}), 'stale');
  assert.deepEqual(s.world.store.records().find(record => record.identity.client === 'desktop' && record.identity.sessionId === 'shared')?.notices[0]?.acknowledgedBy, [],
    'another path\'s end acknowledges nothing');
  assert.equal(await s.observe('shared', {kind: 'runtime-ended'}, {identity: desktopPath('shared'), turn: null}), 'applied');
  assert.deepEqual(keys(), []);
  s.advance(1);
  await s.observe('shared', started, {identity: claudePath('shared'), turn: 'resumed'});
  assert.deepEqual(keys(), ['claude/code/shared']);
  assert.equal(s.world.store.records()[0]?.generation, s.world.store.revision, 'a new session\'s generation is the revision that created it');
});

it('retirement guards are count-bounded, durable and expire independently of active records', async context => {
  const s = await Sessions.open(context, cli);
  for (let index = 0; index <= 128; index++) {
    await s.observe(`retired-${index}`, started);
    await s.observe(`retired-${index}`, {kind: 'runtime-ended'});
  }
  const guards = (): string[] => (s.world.rows('SELECT guard FROM core_session_guards ORDER BY seq') as {guard: string}[])
    .map(row => (JSON.parse(row.guard) as {identity: Identity}).identity.sessionId);
  assert.equal(guards().length, 128);
  assert.equal(guards()[0], 'retired-1');
  assert.deepEqual(s.ids(), []);
  await s.world.crashAndRestart();
  s.advance(DAY - 1);
  assert.equal(await s.observe('retired-1', started), 'stale');
  await s.observe('active', started);
  s.advance(1);
  await s.due();
  assert.deepEqual(s.ids(), ['active']);
  assert.deepEqual(guards(), []);
  await s.world.crashAndRestart();
  assert.equal(await s.observe('retired-1', started), 'applied');
});

it('an expired guard leaves the store when the started core prunes it', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe('gone', started);
  await s.observe('gone', {kind: 'runtime-ended'});
  assert.equal(s.world.rows('SELECT * FROM core_session_guards').length, 1);
  s.advance(25 * 3_600_000);
  await s.world.crashAndRestart();
  assert.deepEqual(s.world.rows('SELECT * FROM core_session_guards'), [], 'the start prunes the expired guard');
});

it('a failed retirement publishes no partial removal and a restart recovers the committed tree', async context => {
  let failing = false;
  const s = await Sessions.open(context, claude, {derivers: [() => { if (failing) throw new Error('private-adapter-failure'); }]});
  await s.observe('parent', started);
  await s.observe('child', {kind: 'session-started'}, {parent: {status: 'known', identity: claude('parent')}});
  const before = s.world.store.records();
  const from = s.world.published.length;
  failing = true;
  assert.equal(await s.observe('parent', {kind: 'runtime-ended'}), 'storage-failed');
  assert.deepEqual(s.world.store.records(), before);
  assert.deepEqual(s.world.published.slice(from), []);
  failing = false;
  await s.world.crashAndRestart([]);
  assert.deepEqual(s.ids(), ['child', 'parent']);
  await s.observe('parent', {kind: 'runtime-ended'});
  assert.deepEqual(s.ids(), []);
});

it('archive admission checks known ancestors even without a retained parent or retirement guard', async context => {
  const s = await Sessions.open(context, desktop);
  let archivedParent = false;
  s.world.archived = (candidate, ancestors) => archivedParent && [candidate, ...ancestors].some(item => item.sessionId === 'parent');
  const child = s.observation('child', {kind: 'session-started'}, {parent: {status: 'known', identity: desktop('parent')}});
  archivedParent = true;
  assert.equal(await s.take(child), 'stale');
  assert.deepEqual(s.ids(), []);
  archivedParent = false;
  assert.equal(await s.take(child), 'applied');
  archivedParent = true;
  assert.equal(await s.observe('grandchild', {kind: 'session-started'}, {parent: {status: 'known', identity: desktop('child')}}), 'stale');
  assert.deepEqual(s.ids(), ['child']);
});

it('archive admission stays specific to Codex Desktop identities', async context => {
  const s = await Sessions.open(context, claude);
  let calls = 0;
  s.world.archived = () => { calls += 1; return true; };
  assert.equal(await s.observe('claude', started), 'applied');
  assert.equal(calls, 0, 'no archive check for a Claude identity');
  assert.equal(await s.observe('desktop', started, {identity: desktop('desktop')}), 'stale');
  assert.equal(calls, 1);
  assert.deepEqual(s.ids(), ['claude']);
});

// current-status.test.mjs: ordinary starts and stops, delayed and contradictory evidence.

it('ordinary Desktop provider start stop next start updates activity and consumer notices', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('session', started, {...unknownParent, turn: 'turn-one'});
  assert.equal(s.record('session').activity, 'active');
  await s.observe('session', ended, {...unknownParent, turn: 'turn-one'});
  assert.equal(s.record('session').activity, 'idle');
  assert.deepEqual(s.record('session').notices.map(notice => notice.acknowledgedBy), [[]]);
  await s.observe('session', started, {...unknownParent, turn: 'turn-two'});
  const session = s.record('session');
  assert.equal(session.activity, 'active');
  assert.deepEqual(session.turn, {status: 'known', id: 'turn-two'});
  assert.deepEqual(session.ordering, {status: 'unknown'});
  assert.deepEqual(session.notices[0]?.acknowledgedBy, ['nanoleaf', 'pixoo']);
});

it('unchanged starts and stops with new receipt times cannot revive, refresh or restore notices', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('session', started, {...unknownParent, turn: 'a'});
  const startedAt = s.world.store.revision;
  s.advance(300_000);
  assert.equal(await s.observe('session', started, {...unknownParent, turn: 'a'}), 'duplicate');
  await s.due();
  assert.equal(s.record('session').freshness, 'uncertain');
  assert.ok(s.world.store.revision > startedAt);
  s.advance(1);
  await s.observe('session', ended, {...unknownParent, turn: 'a'});
  await s.world.acknowledge(desktop('session'), s.record('session').notices[0]?.id ?? '', 'dashboard');
  const stopped = s.record('session');
  s.advance(300_000);
  for (const event of [started, ended]) await s.observe('session', event, {...unknownParent, turn: 'a'});
  assert.equal(s.record('session').revision, stopped.revision);
  assert.equal(s.record('session').activity, 'idle');
  assert.deepEqual(s.record('session').notices[0]?.acknowledgedBy, ['dashboard']);
  s.advance(1);
  await s.observe('session', started, {...unknownParent, turn: 'b'});
  const selected = s.record('session');
  for (const event of [started, ended]) {
    s.advance(1);
    assert.equal(await s.observe('session', event, {...unknownParent, turn: 'a'}), 'stale');
  }
  assert.equal(s.record('session').revision, selected.revision);
  assert.deepEqual(s.record('session').turn, {status: 'known', id: 'b'});
  assert.deepEqual(s.record('session').notices[0]?.acknowledgedBy, ['dashboard', 'nanoleaf', 'pixoo']);
});

it('completion before start stays completed and an unseen delayed start has the documented receipt-order limit', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('session', ended, {...unknownParent, turn: 'a'});
  await s.observe('session', started, {...unknownParent, turn: 'a', atMs: s.now() + 1});
  assert.equal(s.record('session').activity, 'idle');
  // Native IDs and timestamps do not prove provider order: this unseen older start wins.
  await s.observe('session', started, {...unknownParent, turn: 'unseen-older', atMs: s.now() - 5000});
  const session = s.record('session');
  assert.deepEqual(session.turn, {status: 'known', id: 'unseen-older'});
  assert.equal(session.activity, 'active');
  assert.deepEqual(session.notices[0]?.acknowledgedBy, ['nanoleaf', 'pixoo']);
});

it('missing and contradictory turn evidence cannot select or clear; a genuinely new start recovers', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('session', ended, {...unknownParent, turn: 'a'});
  await s.observe('session', started, {...unknownParent, turn: null});
  let session = s.record('session');
  assert.equal(session.activity, 'unknown');
  assert.deepEqual(session.notices[0]?.acknowledgedBy, []);
  assert.ok(session.unavailable.some(item => item.dimension === 'turn'));
  await s.observe('session', started, {...unknownParent, turn: 'b'});
  await s.observe('session', ended, {...unknownParent, turn: 'unseen-other'});
  session = s.record('session');
  assert.equal(session.activity, 'unknown');
  assert.equal(session.turn.status, 'unknown');
  s.advance(1);
  await s.observe('session', started, {...unknownParent, turn: 'b'});
  assert.equal(s.record('session').activity, 'unknown');
  await s.observe('session', started, {...unknownParent, turn: 'c'});
  session = s.record('session');
  assert.equal(session.activity, 'active');
  assert.deepEqual(session.turn, {status: 'known', id: 'c'});
  assert.ok(!session.unavailable.some(item => item.dimension === 'activity' || item.dimension === 'turn'));
  assert.ok(session.unavailable.some(item => item.dimension === 'ordering'));
});

it('retiring a turn preserves its attention and accepts exact resolution without changing current activity', async context => {
  const s = await Sessions.open(context, desktop);
  const at = {...unknownParent};
  await s.observe('session', started, {...at, turn: 'a'});
  await s.observe('session', known('attention-approval', 'approval'), {...at, turn: 'a'});
  await s.observe('session', ended, {...at, turn: 'a'});
  await s.observe('session', started, {...at, turn: 'b'});
  await s.observe('session', known('attention-input', 'input'), {...at, turn: 'a'});
  await s.observe('session', known('attention-resolved', 'approval'), {...at, turn: 'b'});
  let session = s.record('session');
  assert.equal(session.attention.length, 2);
  assert.deepEqual(session.turn, {status: 'known', id: 'b'});
  await s.observe('session', known('attention-resolved', 'approval'), {...at, turn: 'a'});
  session = s.record('session');
  assert.equal(session.activity, 'active');
  assert.deepEqual(session.turn, {status: 'known', id: 'b'});
  assert.deepEqual(session.attention.map(item => item.kind), ['input']);
  assert.deepEqual(session.notices[0]?.acknowledgedBy, ['nanoleaf', 'pixoo']);
  assert.equal(session.read, 'unknown');
});

it('genuine ordering survives unordered interference and qualified attention can still lead a turn', async context => {
  const s = await Sessions.open(context, desktop);
  const ordered = (event: LifecycleEvent, turn: string, sequence: number): LifecycleObservation =>
    s.observation('session', event, {...unknownParent, turn, epoch: 'epoch', sequence, nativeEventId: `native-${sequence}`});
  await s.take(ordered(started, 'a', 1));
  await s.take(ordered(ended, 'a', 2));
  const approval = ordered(known('attention-approval', 'request'), 'b', 4);
  await s.take(approval);
  await s.take(ordered(started, 'b', 3));
  let session = s.record('session');
  assert.deepEqual(session.turn, {status: 'known', id: 'b'});
  assert.equal(session.attention.length, 1);
  assert.deepEqual(session.notices[0]?.acknowledgedBy, ['nanoleaf', 'pixoo']);
  await s.observe('session', started, {...unknownParent, turn: 'unordered'});
  assert.notEqual(s.record('session').activity, 'active');
  await s.observe('session', started, {...unknownParent, turn: 'another-unordered'});
  assert.notDeepEqual(s.record('session').turn, {status: 'known', id: 'another-unordered'});
  // A conflicting payload cannot reuse a qualified native event ID as a fresh start.
  assert.equal(await s.take({...approval, event: started, turn: {status: 'known', id: 'collision'}}), 'ambiguous');
  session = s.record('session');
  assert.notDeepEqual(session.turn, {status: 'known', id: 'collision'});
});

it('two sessions and consumer-scoped manual dismissal stay independent', async context => {
  const s = await Sessions.open(context, desktop);
  for (const sessionId of ['session', 'other']) {
    await s.observe(sessionId, started, {...unknownParent, turn: 'a'});
    await s.observe(sessionId, ended, {...unknownParent, turn: 'a'});
  }
  const first = s.record('session'), second = s.record('other');
  await s.world.acknowledge(desktop('session'), first.notices[0]?.id ?? '', 'dashboard');
  assert.equal((await s.world.acknowledge(desktop('other'), first.notices[0]?.id ?? '', 'pixoo')).ok, false, 'another session\'s notice');
  await s.observe('session', started, {...unknownParent, turn: 'b'});
  assert.deepEqual(s.record('session').notices[0]?.acknowledgedBy, ['dashboard', 'nanoleaf', 'pixoo']);
  assert.deepEqual(s.record('other'), second);
});

it('fresh selection can recover activity while conflicting parent evidence stays unknown', async context => {
  const s = await Sessions.open(context, desktop);
  const parent = (id: string): Parent => ({status: 'known', identity: desktop(id)});
  await s.observe('session', started, {turn: 'a', parent: parent('first-parent')});
  await s.observe('session', known('attention-approval', 'request'), {turn: 'a', parent: parent('other-parent')});
  await s.observe('session', started, {turn: 'b', parent: parent('first-parent')});
  const session = s.record('session');
  assert.equal(session.activity, 'active');
  assert.deepEqual(session.turn, {status: 'known', id: 'b'});
  assert.equal(session.parent.status, 'unknown');
  assert.ok(session.unavailable.some(item => item.dimension === 'parent' && item.reason === 'ambiguous'));
  assert.equal(session.attention.length, 1);
});

for (const [kind, repeated] of [['turn-started', 'turn-started'], ['turn-ended', 'turn-ended'], ['turn-ended', 'turn-started'], ['turn-interrupted', 'turn-started']] as const) {
  it(`a repeated ${repeated} preserves changed parent evidence without replaying ${kind}`, async context => {
    const s = await Sessions.open(context, desktop);
    const parent = (id: string): Parent => ({status: 'known', identity: desktop(id)});
    await s.observe('session', started, {...unknownParent, turn: 'a'});
    if (kind !== 'turn-started') await s.observe('session', {kind}, {...unknownParent, turn: 'a'});
    const before = s.record('session');
    await s.world.crashAndRestart();
    s.advance(300_000);
    assert.equal(await s.observe('session', {kind: repeated}, {turn: 'a', parent: parent('parent-a')}), 'applied', 'starts and stops carry independent metadata');
    assert.deepEqual(s.record('session').parent, parent('parent-a'));
    s.advance(1);
    assert.equal(await s.observe('session', {kind: repeated}, {turn: 'a', parent: parent('parent-b')}), 'ambiguous');
    const session = s.record('session');
    assert.deepEqual(session.parent, {status: 'unknown'});
    assert.ok(session.unavailable.some(item => item.dimension === 'parent' && item.reason === 'ambiguous'));
    assert.deepEqual([session.activity, session.turn, session.notices, session.lastEvidenceAtMs, session.observedAtMs],
      [before.activity, before.turn, before.notices, before.lastEvidenceAtMs, before.observedAtMs]);
    assert.equal(session.freshness, 'uncertain');
    // #1865 step 8: only running work is left unconfirmed by the restart, and a repeat does not confirm it.
    assert.equal(session.restartUncertain, before.activity === 'active');
    const revision = s.world.store.revision;
    s.advance(1);
    assert.equal(await s.observe('session', {kind: repeated}, {turn: 'a', parent: parent('parent-b')}), kind === 'turn-ended' && repeated === 'turn-started' ? 'stale' : 'duplicate');
    assert.equal(s.world.store.revision, revision);
  });
}

it('retained completions do not evict the 256 most recently superseded turns', async context => {
  const s = await Sessions.open(context, desktop);
  for (let index = 0; index < 128; index++) {
    await s.observe('session', started, {...unknownParent, turn: `done-${index}`});
    await s.observe('session', ended, {...unknownParent, turn: `done-${index}`});
  }
  for (let index = 0; index <= 256; index++) await s.observe('session', started, {...unknownParent, turn: `active-${index}`});
  assert.deepEqual(s.world.store.sessions()[0]?.retiredTurns, Array.from({length: 256}, (_, index) => `active-${index}`));
  await s.world.crashAndRestart();
  s.advance(1);
  for (const turn of ['active-0', 'active-100', 'active-255', 'done-0']) assert.equal(await s.observe('session', started, {...unknownParent, turn}), 'stale');
  assert.deepEqual(s.record('session').turn, {status: 'known', id: 'active-256'});
  assert.equal(s.record('session').restartUncertain, true);
  await s.observe('session', started, {...unknownParent, turn: 'active-257'});
  assert.equal(await s.observe('session', started, {...unknownParent, turn: 'active-0'}), 'applied');
  assert.equal(s.record('session').notices.length, 128);
});

it('retired identities use a bounded FIFO across restart; retained completions outlive retry-key eviction', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe('session', ended, {...unknownParent, turn: 'completed'});
  for (let index = 0; index < 259; index++) assert.equal(await s.observe('session', started, {...unknownParent, turn: `turn-${index}`, atMs: s.now() + index}), 'applied');
  const [stored] = s.world.store.sessions();
  assert.equal(stored?.retiredTurns.length, 256);
  assert.equal(stored?.seen.length, 256);
  assert.ok(stored?.retiredTurns.includes('turn-0') === false);
  await s.world.crashAndRestart();
  assert.equal(s.record('session').restartUncertain, true);
  for (const turn of ['turn-257', 'completed']) {
    await s.observe('session', started, {...unknownParent, turn});
    await s.observe('session', ended, {...unknownParent, turn});
  }
  assert.deepEqual(s.record('session').turn, {status: 'known', id: 'turn-258'});
  assert.equal(s.record('session').restartUncertain, true);
  assert.equal(s.record('session').notices.length, 1);
  await s.observe('session', started, {...unknownParent, turn: 'turn-0'});
  assert.deepEqual(s.record('session').turn, {status: 'known', id: 'turn-0'});
  assert.equal(s.record('session').restartUncertain, false);
});

// core.test.mjs: the reduction rules of agent-state's owner.

const ID = 'session-1';
const codexCli = (sessionId: string): Identity => ({provider: 'codex', client: 'cli', hostId: 'host-1', sourceId: 'source-1', sessionId});

it('explicit recovery retires only an uncertain uncorrelated approval', async context => {
  const s = await Sessions.open(context, codexCli);
  await s.observe(ID, started, unknownParent);
  await s.observe(ID, unknownApproval, unknownParent);
  const before = s.record(ID);
  assert.equal(before.attention[0]?.kind, 'approval');
  assert.deepEqual(await s.world.recoverApproval(codexCli(ID), 'turn-1'), {ok: false, code: 'invalid-state'});
  s.advance(300_000);
  assert.equal((await s.world.recoverApproval(codexCli(ID), 'turn-1')).ok, true);
  const after = s.record(ID);
  assert.deepEqual(after.attention, []);
  assert.equal(after.activity, before.activity);
  assert.equal(after.lastEvidenceAtMs, before.lastEvidenceAtMs);
  assert.deepEqual(await s.world.recoverApproval(codexCli(ID), 'turn-1'), {ok: false, code: 'invalid-state'});
  await s.world.crashAndRestart();
  assert.deepEqual(s.record(ID).attention, []);
});

it('read evidence changes only the read dimension', async context => {
  const s = await Sessions.open(context, desktop);
  const read = (state: 'read' | 'unread'): LifecycleObservation => s.observation(ID, {kind: 'read-observed', state}, {...unknownParent});
  assert.equal(await s.take(read('read')), 'stale', 'read evidence cannot establish a session');
  assert.deepEqual(s.ids(), []);
  await s.observe(ID, started, unknownParent);
  await s.observe(ID, ended, unknownParent);
  const before = s.record(ID);
  s.advance(300_000);
  assert.equal(await s.take(read('read')), 'applied');
  let session = s.record(ID);
  assert.equal(session.read, 'read');
  assert.equal(session.freshness, 'uncertain');
  assert.deepEqual([session.lastEvidenceAtMs, session.observedAtMs, session.turn, session.activity, session.notices],
    [before.lastEvidenceAtMs, before.observedAtMs, before.turn, before.activity, before.notices]);
  s.advance(1);
  assert.equal(await s.take(read('unread')), 'applied');
  s.advance(1);
  assert.equal(await s.take(read('read')), 'applied');
  assert.equal(s.record(ID).read, 'read');
  await s.world.crashAndRestart();
  await s.take(read('unread'));
  session = s.record(ID);
  assert.equal(session.read, 'unread');
  // #1865 step 8: the finished session had no running work for the restart to leave unconfirmed.
  assert.equal(session.restartUncertain, false);
});

it('read evidence leaves turn, ordering and metadata evidence unchanged', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe(ID, started, {...unknownParent, sequence: 1});
  const before = s.record(ID);
  assert.equal(await s.observe(ID, {kind: 'read-observed', state: 'read'}, {...unknownParent, turn: null}), 'applied');
  assert.equal(await s.observe(ID, {kind: 'read-observed', state: 'unread'}, {turn: 'turn-2', epoch: 'epoch-2', sequence: 5,
    parent: {status: 'known', identity: desktop('parent')}, label: {origin: 'user', value: 'Renamed'}}), 'applied');
  const after = s.record(ID);
  assert.equal(after.read, 'unread');
  assert.deepEqual([after.turn, after.ordering, after.unavailable, after.parent, after.label, after.activity],
    [before.turn, before.ordering, before.unavailable, before.parent, before.label, before.activity]);
});

it('child permission requests remain on the child established by its start', async context => {
  const s = await Sessions.open(context, codexCli);
  await s.child('child', ID, {kind: 'session-started'});
  await s.child('child', ID, unknownApproval);
  assert.deepEqual(s.ids(), ['child']);
  assert.equal(s.record('child').attention[0]?.kind, 'approval');
  assert.deepEqual(s.record('child').attention[0]?.turn, {status: 'unknown'});
});

it('an unordered turn cannot retire a turn supported by a later qualified sequence', async context => {
  const s = await Sessions.open(context, codexCli);
  await s.observe(ID, started, {...unknownParent, sequence: 20});
  await s.observe(ID, started, {...unknownParent, turn: 'old'});
  const result = await s.observe(ID, ended, {...unknownParent, sequence: 21});
  assert.ok(result === 'applied' || result === 'ambiguous', result);
  assert.ok(s.record(ID).notices.some(notice => notice.turn.status === 'known' && notice.turn.id === 'turn-1'));
});

it('unordered successive starts select by receipt and reject a superseded completion', async context => {
  const s = await Sessions.open(context, codexCli);
  for (const turn of ['turn-1', 'turn-3', 'turn-2']) await s.observe(ID, started, {...unknownParent, turn});
  assert.equal(await s.observe(ID, ended, {...unknownParent, turn: 'turn-3'}), 'stale');
  const session = s.record(ID);
  assert.deepEqual(session.turn, {status: 'known', id: 'turn-2'});
  assert.equal(session.activity, 'active');
  assert.deepEqual(session.ordering, {status: 'unknown'});
  assert.equal(session.notices.length, 0);
});

for (const kind of ['attention-approval', 'attention-input', 'question-continuing', 'turn-ended'] as const) {
  it(`${kind} arriving before its newer turn start is retained without a retry`, async context => {
    const s = await Sessions.open(context, codexCli);
    await s.observe(ID, started, {...unknownParent, sequence: 1});
    await s.observe(ID, ended, {...unknownParent, sequence: 2});
    const observation = s.observation(ID, kind === 'turn-ended' ? {kind} : known(kind, 'request'), {...unknownParent, turn: 'turn-2', sequence: 4});
    assert.ok(['applied', 'ambiguous'].includes(await s.take(observation)));
    await s.observe(ID, started, {...unknownParent, turn: 'turn-2', sequence: 3});
    const session = s.record(ID);
    assert.deepEqual(session.turn, {status: 'known', id: 'turn-2'});
    if (kind === 'turn-ended') {
      assert.equal(session.activity, 'idle');
      assert.ok(session.notices.some(notice => notice.turn.status === 'known' && notice.turn.id === 'turn-2'));
    } else assert.deepEqual(session.attention.map(item => item.turn), [{status: 'known', id: 'turn-2'}]);
    assert.equal(await s.take(structuredClone(observation)), 'duplicate');
  });
}

it('unordered child start and stop permutations yield the same uncertain count after restart', async context => {
  for (const order of [['session-started', 'turn-ended'], ['turn-ended', 'session-started']] as const) {
    await context.test(order.join(' then '), async t => {
      const s = await Sessions.open(t, codexCli);
      await s.observe(ID, started, unknownParent);
      for (const kind of [...order, ...order]) await s.child('child', ID, {kind});
      assert.deepEqual(s.record(ID).children, {active: 0, uncertain: 1});
      assert.equal(s.record('child').activity, 'unknown');
      assert.equal(s.record('child').freshness, 'current');
      await s.world.crashAndRestart();
      assert.deepEqual(s.record(ID).children, {active: 0, uncertain: 1});
    });
  }
});

it('conflicting parent permutations cannot attribute a child to either parent', async context => {
  for (const parents of [[ID, 'other-parent'], ['other-parent', ID]] as const) {
    await context.test(parents.join(' then '), async t => {
      const s = await Sessions.open(t, codexCli);
      for (const parent of [ID, 'other-parent']) await s.observe(parent, started, {...unknownParent, sequence: 1});
      for (const [index, parent] of [...parents, parents[0]].entries()) {
        await s.observe('child', {kind: 'activity-observed'}, {sequence: index + 1, parent: {status: 'known', identity: codexCli(parent)}});
      }
      for (const parent of [ID, 'other-parent']) assert.deepEqual(s.record(parent).children, {active: 0, uncertain: 0});
      assert.deepEqual(s.record('child').parent, {status: 'unknown'});
      assert.ok(s.record('child').unavailable.some(item => item.dimension === 'parent' && item.reason === 'ambiguous'));
      await s.world.crashAndRestart();
      assert.deepEqual(s.record('child').parent, {status: 'unknown'});
    });
  }
});

it('qualified child ordering gives the same idle count in either delivery order', async context => {
  for (const order of [[1, 2], [2, 1]] as const) {
    await context.test(order.join(' then '), async t => {
      const s = await Sessions.open(t, codexCli);
      await s.observe(ID, started, unknownParent);
      const under = {parent: {status: 'known', identity: codexCli(ID)}} as const;
      for (const sequence of order) await s.observe('child', sequence === 1 ? started : ended, {...under, sequence});
      assert.deepEqual(s.record(ID).children, {active: 0, uncertain: 0});
      assert.equal(s.record('child').activity, 'idle');
    });
  }
});

it('parent identity is independent of JSON property order', async context => {
  const s = await Sessions.open(context, codexCli);
  await s.observe(ID, started, unknownParent);
  await s.observe('child', started, {sequence: 1, parent: {status: 'known', identity: codexCli(ID)}});
  const reversed = Object.fromEntries(Object.entries(codexCli(ID)).reverse()) as Identity;
  await s.take({...s.observation('child', {kind: 'activity-observed'}, {sequence: 2}), parent: {identity: reversed, status: 'known'}});
  assert.deepEqual(s.record(ID).children, {active: 1, uncertain: 0});
});

it('attention identity is independent of JSON property order', async context => {
  const s = await Sessions.open(context, codexCli);
  await s.observe(ID, known('attention-approval', 'approval'), {...unknownParent, sequence: 1});
  await s.take({...s.observation(ID, {kind: 'attention-approval', attention: {id: 'approval', status: 'known'} as const}, {...unknownParent, sequence: 2}),
    turn: {id: 'turn-1', status: 'known'} as const});
  assert.equal(s.record(ID).attention.length, 1);
});

it('restart restores committed labels and notices and requires fresh evidence', async context => {
  const s = await Sessions.open(context, codexCli);
  assert.equal(await s.observe(ID, started, {...unknownParent, sequence: 1}), 'applied');
  assert.equal((await s.world.setLabel(codexCli(ID), 'Build monitor')).ok, true);
  assert.equal(await s.observe(ID, ended, {...unknownParent, sequence: 2}), 'applied');
  const before = s.record(ID);
  assert.equal(before.label?.value, 'Build monitor');
  assert.equal(before.notices.length, 1);
  await s.world.crashAndRestart();
  const after = s.record(ID);
  assert.equal(after.label?.value, 'Build monitor');
  assert.deepEqual(after.notices, before.notices);
  // #1865 step 8: a finished session keeps its status across the restart; only running work turns unconfirmed.
  assert.equal(after.freshness, 'current');
  assert.equal(after.restartUncertain, false);
});

it('activity, correlated attention, notices and consumer acknowledgment stay independent', async context => {
  const s = await Sessions.open(context, codexCli);
  const at = (sequence: number): Options => ({...unknownParent, sequence});
  await s.observe(ID, started, at(1));
  await s.observe(ID, known('question-continuing', 'question-1'), at(2));
  await s.observe(ID, known('attention-approval', 'approval-1'), at(3));
  await s.observe(ID, {kind: 'activity-observed'}, at(4));
  assert.equal(s.record(ID).attention.length, 2);
  await s.observe(ID, {kind: 'attention-resolved', attention: {status: 'unknown'}}, at(5));
  assert.equal(s.record(ID).attention.length, 2);
  await s.observe(ID, known('attention-resolved', 'approval-1'), at(6));
  assert.deepEqual(s.record(ID).attention.map(item => item.kind), ['question']);
  await s.observe(ID, ended, at(7));
  const notice = s.record(ID).notices[0];
  await s.observe(ID, {kind: 'turn-interrupted'}, at(8));
  assert.equal(await s.observe('someone-else', {kind: 'runtime-ended'}, at(9)), 'stale');
  assert.equal(s.record(ID).notices.length, 1);
  assert.equal(s.record(ID).activity, 'interrupted');
  assert.equal((await s.world.acknowledge(codexCli(ID), notice?.id ?? '', 'pixoo')).ok, true);
  assert.deepEqual(s.record(ID).notices[0]?.acknowledgedBy, ['pixoo']);
  assert.equal(s.record(ID).read, 'unknown');
  assert.equal(s.record(ID).attention.length, 1);
});

it('new evidenced turn retires only its configured notices and rejects late old turns', async context => {
  const s = await Sessions.open(context, codexCli);
  await s.observe(ID, started, {...unknownParent, sequence: 1});
  await s.observe(ID, ended, {...unknownParent, sequence: 2});
  await s.observe(ID, started, {...unknownParent, turn: 'turn-2', sequence: 3});
  const current = s.record(ID);
  assert.deepEqual(current.turn, {status: 'known', id: 'turn-2'});
  assert.deepEqual(current.notices[0]?.acknowledgedBy, ['nanoleaf', 'pixoo']);
  assert.equal(await s.observe(ID, ended, {...unknownParent, sequence: 4}), 'stale');
  assert.deepEqual(s.record(ID), current);
});

it('unknown ordering and native ID collisions stay uncertain without clearing state', async context => {
  const s = await Sessions.open(context, codexCli);
  const event = s.observation(ID, ended, {...unknownParent, nativeEventId: 'event-1', turn: null});
  await s.take(event);
  assert.equal(await s.take(structuredClone(event)), 'duplicate');
  assert.equal(await s.take({...event, event: {kind: 'activity-observed'}}), 'ambiguous');
  const revision = s.world.store.revision;
  assert.equal(await s.take({...event, event: {kind: 'activity-observed'}}), 'duplicate');
  assert.equal(s.world.store.revision, revision);
  assert.equal(s.record(ID).notices.length, 1);
  assert.ok(s.record(ID).unavailable.some(item => item.dimension === 'ordering'));
});

it('ordered observations preserve independently reordered activity and attention', async context => {
  const s = await Sessions.open(context, codexCli);
  await s.observe(ID, started, {...unknownParent, sequence: 1});
  await s.observe(ID, known('attention-approval', 'approval'), {...unknownParent, sequence: 5});
  await s.observe(ID, ended, {...unknownParent, sequence: 4});
  assert.equal(s.record(ID).activity, 'idle');
  assert.equal(s.record(ID).attention.length, 1);
  assert.equal(await s.observe(ID, {kind: 'activity-observed'}, {...unknownParent, sequence: 3}), 'stale');
  await s.observe(ID, known('attention-resolved', 'approval'), {...unknownParent, sequence: 6});
  assert.equal(s.record(ID).attention.length, 0);
  assert.equal(s.record(ID).notices.length, 1);
});

it('observation age and unique child counts are independent of reads', async context => {
  const s = await Sessions.open(context, codexCli);
  const start = s.observation(ID, started, {...unknownParent, sequence: 1});
  await s.take(start);
  const child = s.observation('child-1', started, {sequence: 1, parent: {status: 'known', identity: codexCli(ID)}});
  for (let index = 0; index < 3; index++) await s.take(structuredClone(child));
  assert.deepEqual(s.record(ID).children, {active: 1, uncertain: 0});
  s.advance(300_000);
  await s.take(structuredClone(start));
  await s.due();
  assert.equal(s.record(ID).freshness, 'uncertain');
  assert.deepEqual(s.record(ID).children, {active: 0, uncertain: 1});
});

it('a failed commit publishes no speculative revision and keeps the committed state', async context => {
  let failing = false;
  const s = await Sessions.open(context, codexCli, {derivers: [() => { if (failing) throw new Error('PRIVATE_CANARY'); }]});
  await s.observe(ID, started, unknownParent);
  const revision = s.world.store.revision;
  failing = true;
  const result = await s.world.setLabel(codexCli(ID), 'Saved label');
  assert.deepEqual(result, {ok: false, code: 'storage-failed'});
  assert.equal(s.world.store.revision, revision);
  assert.equal(s.record(ID).label, undefined);
  assert.ok(!JSON.stringify([result, s.world.store.records(), s.world.store.sessions()]).includes('PRIVATE_CANARY'));
  failing = false;
  await s.world.crashAndRestart([]);
  assert.equal(s.record(ID).label, undefined);
});

it('all consumers acknowledge one notice in one save without changing read or lifecycle evidence', async context => {
  const s = await Sessions.open(context, codexCli);
  await s.observe(ID, started, {...unknownParent, sequence: 1});
  await s.observe(ID, ended, {...unknownParent, sequence: 2});
  const before = s.record(ID), notice = before.notices.at(-1);
  const revision = s.world.store.revision;
  assert.equal((await s.world.acknowledgeAll(codexCli(ID), notice?.id ?? '')).ok, true);
  const after = s.record(ID);
  assert.equal(s.world.store.revision, revision + 1);
  assert.deepEqual(after.notices.at(-1)?.acknowledgedBy, ['dashboard', 'nanoleaf', 'pixoo']);
  assert.deepEqual([after.read, after.lastEvidenceAtMs, after.activity], [before.read, before.lastEvidenceAtMs, before.activity]);
  assert.equal((await s.world.acknowledgeAll(codexCli(ID), notice?.id ?? '')).ok && 'duplicate', 'duplicate');
  assert.equal(s.world.store.revision, revision + 1);
});

it('all-consumer acknowledgment refuses an older retained notice after a newer one arrives', async context => {
  const s = await Sessions.open(context, codexCli);
  await s.observe(ID, started, {...unknownParent, sequence: 1});
  await s.observe(ID, ended, {...unknownParent, sequence: 2});
  const old = s.record(ID).notices.at(-1)?.id ?? '';
  await s.observe(ID, started, {...unknownParent, turn: 'turn-2', sequence: 3});
  await s.observe(ID, ended, {...unknownParent, turn: 'turn-2', sequence: 4});
  const before = s.world.store.records();
  assert.deepEqual(await s.world.acknowledgeAll(codexCli(ID), old), {ok: false, code: 'revision-conflict'});
  assert.deepEqual(s.world.store.records(), before);
});

// metadata.test.mjs and host-session.test.mjs: display metadata and the host session ID.

it('title and project renames persist independently of explicit labels', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe(ID, started, {title: {value: 'First', source: 'provider'}, project: 'alpha'});
  await s.world.setLabel(claude(ID), 'Chosen');
  await s.observe(ID, {kind: 'activity-observed'}, {title: {value: 'Second', source: 'provider'}, project: 'beta', label: {value: 'Agent', origin: 'agent'}});
  const session = s.record(ID);
  assert.deepEqual([session.title, session.project, session.label], [{value: 'Second', source: 'provider'}, 'beta', {value: 'Chosen', origin: 'user'}],
    'an agent label never replaces the owner\'s');
  await s.world.crashAndRestart();
  assert.deepEqual(s.record(ID).title, {value: 'Second', source: 'provider'});
});

it('a metadata-only rename preserves the lifecycle evidence clock', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe(ID, started);
  const before = s.record(ID);
  s.advance(1000);
  assert.equal(await s.observe(ID, started, {title: {value: 'Renamed', source: 'provider'}}), 'applied');
  assert.equal(s.record(ID).lastEvidenceAtMs, before.lastEvidenceAtMs);
  assert.equal(s.record(ID).title?.value, 'Renamed');
});

it('Desktop metadata titles preserve lifecycle evidence, labels and restart uncertainty, and an older title is stale', async context => {
  const s = await Sessions.open(context, desktop);
  await s.observe(ID, started, {...unknownParent, label: {value: 'Mine', origin: 'user'}});
  await s.world.crashAndRestart();
  const before = s.record(ID);
  assert.equal((await s.world.title(desktop(ID), {value: 'Provider title', source: 'provider'}, s.now())).ok, true);
  const after = s.record(ID);
  assert.deepEqual([after.lastEvidenceAtMs, after.label, after.restartUncertain], [before.lastEvidenceAtMs, before.label, true]);
  assert.equal(after.title?.value, 'Provider title');
  const older = await s.world.title(desktop(ID), {value: 'Older', source: 'provider'}, s.now() - 1);
  assert.equal(older.ok && older.outcome, 'stale');
  assert.equal((await s.world.title(desktop('unknown'), {value: 'Nobody', source: 'provider'}, s.now())).ok && 'stale', 'stale', 'a title establishes no session');
});

it('committed observations set or clear the host session ID; a child never carries one; removal forgets it', async context => {
  const s = await Sessions.open(context, claude);
  await s.observe(ID, started, {hostSessionId: 'local_1'});
  assert.equal(s.record(ID).hostSessionId, 'local_1');
  assert.equal(await s.observe(ID, started, {hostSessionId: 'local_2'}), 'duplicate', 'a repeated start that changes nothing commits nothing');
  assert.equal(s.record(ID).hostSessionId, 'local_1', 'so it does not speak for the host session');
  s.advance(1);
  assert.equal(await s.observe(ID, {kind: 'activity-observed'}, {hostSessionId: 'local_2'}), 'applied');
  assert.equal(s.record(ID).hostSessionId, 'local_2');
  await s.world.crashAndRestart();
  assert.equal(s.record(ID).hostSessionId, 'local_2', 'kept with the session across a restart');
  s.advance(1);
  await s.observe(ID, {kind: 'activity-observed'});
  assert.equal(s.record(ID).hostSessionId, undefined, 'an observation without one clears it');
  await s.observe('child', started, {parent: {status: 'known', identity: claude(ID)}, hostSessionId: 'local_3'});
  assert.equal(s.record('child').hostSessionId, undefined);
  await s.observe(ID, {kind: 'runtime-ended'}, {hostSessionId: 'local_1'});
  assert.deepEqual(s.world.store.sessions(), []);
});
