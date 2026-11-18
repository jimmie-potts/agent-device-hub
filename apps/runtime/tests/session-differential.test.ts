// The differential test of Hub #1865 group 7 (tasks.md 7.2): the same inputs through the retained path, agent-state's
// owner fed each observation's 1.2 envelope with the core store's projection of main 6adad7e7 (fixtures/retained-core.ts),
// and through the core's own session logic on the real core store. Every step must publish the same records, removals
// and occurrences in the same order, with revisions and generations normalized: the retained path can raise a revision
// on a commit that publishes nothing, and its generations came from agent-state's revision. Notice IDs are normalized as
// well, since a notice on an unknown turn is named by the observation's semantic key, which no longer has the 1.x form.
// The inputs are the shared session case set and a seeded random corpus of observations, commands, clock moves and
// restarts over a small synthetic domain. Everything runs on a manual clock.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {loadSessionCases} from '@jimmie-potts/event-contracts/v2/session-cases';
import {
  registerCoreFamilies, sessionEntityId, type Identity, type KnownId, type LifecycleEvent, type LifecycleObservation, type Parent, type SessionRecord, type Title,
} from '@jimmie-potts/event-contracts/v2/families';
import type {Outcome} from '@jimmie-potts/agent-state';
import type {SessionOutcome} from '../src/core/store.js';
import {RetainedCore, type Sent} from './fixtures/retained-core.js';
import {World, lifecycleMessage} from './fixtures/store-world.js';
import {START, it, manualClock} from './support.js';

const validator = new MessageValidator();
registerCoreFamilies(validator);

/** One input of a sequence. Commands name their session; a notice is chosen from each side's own record. */
type Step =
  | {kind: 'observe'; observation: LifecycleObservation}
  | {kind: 'title'; identity: Identity; title: Title; atMs: number}
  | {kind: 'label'; identity: Identity; label: string | null}
  | {kind: 'acknowledge'; identity: Identity; notice: number; consumer: string}
  | {kind: 'acknowledge-all'; identity: Identity; notice: number}
  | {kind: 'recover'; identity: Identity; turnId: string}
  | {kind: 'archive'; archived: boolean}
  | {kind: 'advance'; ms: number}
  | {kind: 'restart'};

/** Replaces what the two paths may number differently with names that follow their order of appearance. */
class Normalizer {
  readonly #notices = new Map<string, string>();
  readonly #generations = new Map<string, number[]>();

  notice(id: string): string {
    let name = this.#notices.get(id);
    if (name === undefined) {
      name = `notice-${this.#notices.size}`;
      this.#notices.set(id, name);
    }
    return name;
  }

  generation(session: string, generation: number): string {
    const seen = this.#generations.get(session) ?? [];
    if (!seen.includes(generation)) seen.push(generation);
    this.#generations.set(session, seen);
    return `generation-${seen.indexOf(generation)}`;
  }

  sent(item: Sent): unknown {
    const data = structuredClone(item.data) as Record<string, unknown>;
    delete data.revision;
    if (item.type === 'org.bunny.session.updated') {
      const record = data as unknown as Omit<SessionRecord, 'generation'> & {generation: number | string};
      record.generation = this.generation(record.id, record.generation as number);
      for (const notice of record.notices) notice.id = this.notice(notice.id);
      if (record.readReceipt !== undefined) record.readReceipt.noticeId = this.notice(record.readReceipt.noticeId);
    }
    if (typeof data.noticeId === 'string') data.noticeId = this.notice(data.noticeId);
    return {type: item.type, subject: item.subject, data};
  }
}

/** An outcome as both paths can be compared on: taken with its outcome, or refused with the class of refusal. */
function outcomeOf(result: Outcome | SessionOutcome): string {
  if (result.ok) return result.outcome;
  switch (result.code) {
    case 'invalid-operation':
    case 'not-found':
    case 'invalid-state':
      return 'refused: no such target or state';
    case 'invalid-event':
    case 'invalid-request':
      return 'refused: invalid';
    case 'storage-failed':
    case 'unavailable':
      return 'refused: storage';
    case 'capacity':
    case 'revision-conflict':
      return `refused: ${result.code}`;
  }
}

/** The two paths side by side on one manual clock. */
class Pair {
  readonly clock = manualClock(START);
  archived = false;
  readonly retained: RetainedCore;
  world!: World;
  readonly #retainedNames = new Normalizer();
  readonly #portNames = new Normalizer();
  #messages = 0;
  /** How many approval recoveries the core accepted, so the corpus shows it compares owner-started clearings. */
  recoveries = 0;

  constructor() {
    this.retained = new RetainedCore(this.clock.now, identity => this.archived && identity.client === 'desktop');
  }

  async start(context: TestContext): Promise<void> {
    await this.retained.start();
    // The port's store needs no sync to disk for this comparison.
    this.world = await World.open(context, {clock: this.clock, wrap: db => { db.exec('PRAGMA synchronous = OFF'); return db; }});
    this.world.archived = identity => this.archived && identity.client === 'desktop';
    context.after(() => this.retained.stop());
    await this.world.store.drain();
    this.#compare('the start');
  }

  #message(observation: LifecycleObservation): Message<LifecycleObservation> {
    return lifecycleMessage(observation, this.clock.now(), `differential-${++this.#messages}`);
  }

  /** Whether the core's intake would take this observation at all: the profile's check and the 1.x owner's own bound. */
  admissible(observation: LifecycleObservation): boolean {
    return validator.validate(this.#message(observation)).ok;
  }

  #notice(records: readonly SessionRecord[], identity: Identity, index: number): string {
    const record = records.find(item => item.id === sessionEntityId(identity));
    const notices = record?.notices ?? [];
    return notices.at(index)?.id ?? 'no-such-notice';
  }

  async step(step: Step, where: string): Promise<void> {
    let retained: Outcome | undefined, port: SessionOutcome | undefined;
    switch (step.kind) {
      case 'observe':
        retained = await this.retained.observe(step.observation);
        port = await this.world.take(this.#message(step.observation));
        break;
      case 'title': {
        const data = {identity: step.identity, turn: {status: 'unknown'}, parent: {status: 'unknown'}, event: {kind: 'metadata-observed'},
          observedAtMs: step.atMs, ordering: {status: 'unknown'}, title: step.title} satisfies LifecycleObservation;
        retained = await this.retained.title(step.identity, step.title, step.atMs, data);
        port = await this.world.title(step.identity, step.title, step.atMs);
        break;
      }
      case 'label':
        retained = await this.retained.label(step.identity, step.label);
        port = await this.world.setLabel(step.identity, step.label);
        break;
      case 'acknowledge':
        retained = await this.retained.acknowledge(step.identity, this.#notice(this.retained.records(), step.identity, step.notice), step.consumer);
        port = await this.world.acknowledge(step.identity, this.#notice(this.world.store.records(), step.identity, step.notice), step.consumer);
        break;
      case 'acknowledge-all':
        retained = await this.retained.acknowledgeAll(step.identity, this.#notice(this.retained.records(), step.identity, step.notice));
        port = await this.world.acknowledgeAll(step.identity, this.#notice(this.world.store.records(), step.identity, step.notice));
        break;
      case 'recover':
        retained = await this.retained.recoverApproval(step.identity, step.turnId);
        port = await this.world.recoverApproval(step.identity, step.turnId);
        if (port.ok) this.recoveries += 1;
        break;
      case 'archive':
        this.archived = step.archived;
        break;
      case 'advance':
        await this.advance(step.ms);
        break;
      case 'restart':
        await this.retained.restart();
        await this.world.crashAndRestart();
        break;
    }
    if (retained !== undefined && port !== undefined) assert.equal(outcomeOf(port), outcomeOf(retained), `${where}: the outcome of ${JSON.stringify(step)}`);
    await this.world.store.drain();
    this.#compare(`${where}: ${JSON.stringify(step)}`);
  }

  /** Moves the clock and runs what fell due on each path, as each core's timer would. */
  async advance(ms: number): Promise<void> {
    if (ms <= 0) return;
    this.clock.advance(ms);
    await this.retained.due();
    await this.world.store.refresh();
    await this.world.store.drain();
  }

  #compare(where: string): void {
    const retained = this.retained.sent.splice(0).map(item => this.#retainedNames.sent(item));
    const port = this.world.since(0).map(message => this.#portNames.sent({type: message.type, subject: message.subject, data: message.data}));
    this.world.published.splice(0);
    assert.deepEqual(port, retained, `${where}: the messages published`);
  }

  /** Both paths serve the same records. */
  same(where: string): void {
    const records = (items: readonly SessionRecord[], names: Normalizer): unknown =>
      items.map(record => names.sent({type: 'org.bunny.session.updated', subject: record.id, data: record})).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
    assert.deepEqual(records(this.world.store.records(), this.#portNames), records(this.retained.records(), this.#retainedNames), `${where}: the records served`);
  }
}

/** A seeded pseudo-random source, so every sequence can be run again from its seed. */
function random(seed: number): {next: () => number; pick: <T>(items: readonly T[]) => T; chance: (p: number) => boolean; int: (lo: number, hi: number) => number} {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {next, pick: items => items[Math.floor(next() * items.length)] as never, chance: p => next() < p, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1))};
}

const claude = (sessionId: string): Identity => ({provider: 'claude', client: 'code', hostId: 'synthetic-host', sourceId: 'claude-hooks', sessionId});
const ROOT = claude('root'), CHILD = claude('root-child'), GRANDCHILD = claude('root-grandchild');
const CLI: Identity = {provider: 'codex', client: 'cli', hostId: 'synthetic-host', sourceId: 'codex-hooks', sessionId: 'cli'};
const DESKTOP: Identity = {provider: 'codex', client: 'desktop', hostId: 'synthetic-host', sourceId: 'codex-desktop', sessionId: 'desktop'};
const DESKTOP_CHILD: Identity = {...DESKTOP, sessionId: 'desktop-child'};
const SESSIONS: {identity: Identity; parents: Parent[]}[] = [
  {identity: ROOT, parents: [{status: 'top-level'}, {status: 'unknown'}]},
  {identity: CHILD, parents: [{status: 'known', identity: ROOT}, {status: 'known', identity: ROOT}, {status: 'unknown'}, {status: 'top-level'}]},
  {identity: GRANDCHILD, parents: [{status: 'known', identity: CHILD}, {status: 'known', identity: ROOT}]},
  {identity: CLI, parents: [{status: 'top-level'}, {status: 'unknown'}]},
  {identity: DESKTOP, parents: [{status: 'top-level'}]},
  {identity: DESKTOP_CHILD, parents: [{status: 'known', identity: DESKTOP}]},
];
const TURNS = ['t1', 't2', 't3', 't4'];
const ATTENTION: KnownId[] = [{status: 'known', id: 'a1'}, {status: 'known', id: 'a2'}, {status: 'unknown'}];

/** One random sequence of steps over the synthetic domain. */
function sequence(seed: number, length: number, admissible: (observation: LifecycleObservation) => boolean, now: () => number): Step[] {
  const r = random(seed);
  const steps: Step[] = [];
  const sent: LifecycleObservation[] = [];
  const sequences = new Map<string, number>();
  let clock = now();
  while (steps.length < length) {
    const roll = r.next();
    if (roll < 0.06) {
      const ms = r.pick([1, 50, 1500, 60_000, 299_999, 300_000, 3_600_000, 86_400_000, 86_400_001]);
      steps.push({kind: 'advance', ms});
      clock += ms;
      continue;
    }
    if (roll < 0.08) { steps.push({kind: 'restart'}); continue; }
    if (roll < 0.09) { steps.push({kind: 'archive', archived: r.chance(0.5)}); continue; }
    if (roll < 0.12) {
      // An approval without a request ID on a turn, left uncertain by five minutes of silence or by a restart, then recovered.
      const session = r.pick(SESSIONS);
      const turn = r.pick(TURNS);
      const at = (event: LifecycleEvent): LifecycleObservation => ({identity: session.identity, turn: {status: 'known', id: turn}, parent: r.pick(session.parents),
        event, observedAtMs: clock, ordering: {status: 'unknown'}});
      for (const observation of [at({kind: 'turn-started'}), at({kind: 'attention-approval', attention: {status: 'unknown'}})]) {
        if (admissible(observation)) {
          sent.push(observation);
          steps.push({kind: 'observe', observation});
        }
      }
      if (r.chance(0.5)) {
        steps.push({kind: 'advance', ms: 300_000});
        clock += 300_000;
      } else steps.push({kind: 'restart'});
      steps.push({kind: 'recover', identity: session.identity, turnId: turn});
      continue;
    }
    const {identity} = r.pick(SESSIONS);
    if (roll < 0.17) {
      const command = r.int(0, 4);
      if (command === 0) steps.push({kind: 'acknowledge', identity, notice: r.pick([-1, 0, 5]), consumer: r.pick(['dashboard', 'nanoleaf', 'pixoo', 'tidbyt'])});
      else if (command === 1) steps.push({kind: 'acknowledge-all', identity, notice: r.pick([-1, -1, 0])});
      else if (command === 2) steps.push({kind: 'label', identity, label: r.chance(0.3) ? null : r.pick(['Alpha', 'Beta'])});
      else if (command === 3) steps.push({kind: 'recover', identity, turnId: r.pick(TURNS)});
      else steps.push({kind: 'title', identity, title: {value: r.pick(['One', 'Two']), source: r.pick(['provider', 'user'] as const)}, atMs: clock - r.int(0, 3000)});
      continue;
    }
    if (roll < 0.25 && sent.length > 0) {
      // A semantic repeat: an earlier observation sent again under a new message ID.
      steps.push({kind: 'observe', observation: structuredClone(r.pick(sent))});
      continue;
    }
    const session = SESSIONS.find(item => item.identity === identity);
    const kind = r.pick(['session-started', 'turn-started', 'turn-started', 'activity-observed', 'turn-ended', 'turn-ended', 'turn-interrupted', 'runtime-ended',
      'question-continuing', 'attention-input', 'attention-approval', 'attention-approval', 'attention-resolved', 'attention-resolved', 'read-observed',
      'evidence-unavailable'] as const);
    let event: LifecycleEvent;
    if (kind === 'question-continuing' || kind === 'attention-input' || kind === 'attention-approval' || kind === 'attention-resolved') event = {kind, attention: r.pick(ATTENTION)};
    else if (kind === 'read-observed') event = {kind, state: r.pick(['read', 'unread'] as const)};
    else if (kind === 'evidence-unavailable') {
      event = {kind, dimension: r.pick(['activity', 'attention', 'turn', 'parent', 'read', 'ordering'] as const),
        reason: r.pick(['unsupported', 'inaccessible', 'missing', 'ambiguous', 'lost'] as const)};
    } else event = {kind};
    const key = sessionEntityId(identity);
    let ordering: LifecycleObservation['ordering'] = {status: 'unknown'};
    if (r.chance(0.5)) {
      const sequenceNumber = r.chance(0.8) ? (sequences.get(key) ?? 0) + 1 : r.int(1, 8);
      sequences.set(key, Math.max(sequences.get(key) ?? 0, sequenceNumber));
      ordering = {status: 'known', authority: identity.sourceId, epoch: r.chance(0.85) ? 'e1' : 'e2', sequence: sequenceNumber};
    }
    const root = session?.parents.every(parent => parent.status !== 'known') ?? true;
    const observation: LifecycleObservation = {
      identity, turn: r.chance(0.15) ? {status: 'unknown'} : {status: 'known', id: r.pick(TURNS)}, parent: r.pick(session?.parents ?? [{status: 'unknown'}]),
      event, observedAtMs: r.chance(0.03) ? clock - 90_000_000 : clock - r.int(0, 3000), ordering,
      ...(r.chance(0.2) ? {nativeEventId: r.pick(['n1', 'n2', 'n3'])} : {}),
      ...(r.chance(0.1) ? {occurredAtMs: clock - r.int(0, 5000)} : {}),
      ...(r.chance(0.1) ? {title: {value: r.pick(['One', 'Two', 'Three']), source: r.pick(['provider', 'user'] as const)}} : {}),
      ...(r.chance(0.1) ? {label: {value: r.pick(['Agent', 'Owner']), origin: r.pick(['agent', 'user'] as const)}} : {}),
      ...(r.chance(0.1) ? {project: r.pick(['alpha', 'beta'])} : {}),
      ...(r.chance(0.08) ? {projectId: r.pick(['p1', 'p2'])} : {}),
      ...(root && r.chance(0.25) ? {hostSessionId: r.pick(['local_1', 'local_2'])} : {}),
    };
    if (!admissible(observation)) continue;
    sent.push(observation);
    steps.push({kind: 'observe', observation});
  }
  return steps;
}

/** How many random sequences run, and how long each is. */
const SEQUENCES = 250, LENGTH = 60;

it('the seeded random corpus publishes the same records and occurrences through both paths', async context => {
  let recoveries = 0;
  for (let seed = 1; seed <= SEQUENCES; seed++) {
    await context.test(`sequence ${seed}`, async t => {
      const pair = new Pair();
      await pair.start(t);
      const steps = sequence(seed, LENGTH, observation => pair.admissible(observation), pair.clock.now);
      for (const [index, step] of steps.entries()) await pair.step(step, `seed ${seed} step ${index}`);
      await pair.advance(86_400_001);
      pair.same(`seed ${seed} after a day`);
      recoveries += pair.recoveries;
      pair.world.close();
    });
  }
  context.diagnostic(`approval recoveries accepted on both paths: ${recoveries}`);
  assert.ok(recoveries > 0, 'the corpus compares owner-started recovered clearings');
}, 600_000);

it('the root sessions of two sources at the session limit displace finished child subtrees the same way on both paths', async context => {
  const pair = new Pair();
  await pair.start(context);
  const at = (identity: Identity, event: LifecycleEvent, turn: string, parent: Parent = {status: 'top-level'}): LifecycleObservation =>
    ({identity, turn: {status: 'known', id: turn}, parent, event, observedAtMs: pair.clock.now(), ordering: {status: 'unknown'}});
  let index = 0;
  const step = async (observation: LifecycleObservation): Promise<void> => { await pair.step({kind: 'observe', observation}, `capacity step ${index++}`); };
  // Two roots with a finished child each, a working child and a waiting child, then roots of two sources to the limit.
  await step(at(ROOT, {kind: 'turn-started'}, 't1'));
  await step(at(CHILD, {kind: 'turn-started'}, 'c1', {status: 'known', identity: ROOT}));
  await step(at(CHILD, {kind: 'turn-ended'}, 'c1', {status: 'known', identity: ROOT}));
  await pair.advance(1000);
  await step(at(GRANDCHILD, {kind: 'turn-started'}, 'g1', {status: 'known', identity: ROOT}));
  await step(at(DESKTOP, {kind: 'turn-started'}, 'd1'));
  await step(at(DESKTOP_CHILD, {kind: 'turn-started'}, 'k1', {status: 'known', identity: DESKTOP}));
  await step(at(DESKTOP_CHILD, {kind: 'attention-approval', attention: {status: 'known', id: 'a1'}}, 'k1', {status: 'known', identity: DESKTOP}));
  for (let filler = 0; pair.world.store.sessions().length < 128; filler++) {
    const identity = filler % 2 === 0 ? claude(`filler-${filler}`) : {...CLI, sessionId: `filler-${filler}`};
    await step(at(identity, {kind: 'session-started'}, `f${filler}`));
  }
  await step(at(GRANDCHILD, {kind: 'turn-ended'}, 'g1', {status: 'known', identity: ROOT}));
  await pair.advance(1000);
  // The first new root displaces the oldest finished subtree; the next finds the other finished one; then none is left.
  for (const sessionId of ['new-1', 'new-2', 'new-3']) await step(at(claude(sessionId), {kind: 'turn-started'}, 'n1'));
  await step(at({...CLI, sessionId: 'new-4'}, {kind: 'turn-started'}, 'n1'));
  // A new child is refused at the limit, even with a finished child to displace.
  await step(at(claude('new-child'), {kind: 'turn-started'}, 'n1', {status: 'known', identity: ROOT}));
  pair.same('capacity');
}, 120_000);

it('every case of the shared session case set publishes the same records and occurrences through both paths', async context => {
  const cases = loadSessionCases();
  for (const item of cases.cases) {
    // The reset is this step's own; the retained path has no reset to compare it with.
    if (item.steps.some(step => step.kind === 'reset')) continue;
    await context.test(item.id, async t => {
      const pair = new Pair();
      await pair.start(t);
      const identities = new Map(Object.values(cases.sessions).map(({identity}) => [sessionEntityId(identity), identity]));
      for (const [index, step] of item.steps.entries()) {
        const where = `${item.id} step ${index}`;
        await pair.advance(cases.startAtMs + step.atMs - pair.clock.now());
        if (step.kind === 'observe' || step.kind === 'deliver') await pair.step({kind: 'observe', observation: step.message.data}, where);
        else if (step.kind === 'fill') for (const message of step.messages) await pair.step({kind: 'observe', observation: message.data}, where);
        else if (step.kind === 'restart') await pair.step({kind: 'restart'}, where);
        else if (step.kind === 'acknowledge') {
          const identity = identities.get(step.message.subject);
          assert.ok(identity, where);
          const record = pair.retained.records().find(found => found.id === step.message.subject);
          const notice = record?.notices.findIndex(found => found.id === step.message.data.noticeId) ?? -1;
          await pair.step({kind: 'acknowledge', identity, notice: notice < 0 ? 99 : notice, consumer: step.message.data.consumerId}, where);
        }
      }
      for (const check of item.checks) await pair.advance(cases.startAtMs + check.atMs - pair.clock.now());
      pair.same(item.id);
      pair.world.close();
    });
  }
});
