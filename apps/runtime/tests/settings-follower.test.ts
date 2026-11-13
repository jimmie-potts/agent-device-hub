import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';
import {REMOTE_SCHEMA, childOf, prepareMessage, type Handler, type SubscribeOptions, type TraceContext} from '@jimmie-potts/sdk';
import {createCoreModule, standbyFollowerState} from '../src/core/core.js';
import {DEFAULT_INTERRUPT_SET, DEFAULT_SETTINGS} from '../src/core/automation.js';
import {initialArtRecord} from '../src/core/art-schedule-model.js';
import {ART_SCHEDULE_SCHEMA} from '@jimmie-potts/event-contracts/v2/art-schedule';
import {
  checkpointText, decodeSettingsPage, decodeSettingsSnapshot, SETTINGS_ANSWER_BYTES, SETTINGS_FAMILIES, type SettingsFact,
  type SettingsPage, type SettingsRecord, type SettingsSnapshot,
} from '../src/core/settings-contract.js';
import {SettingsFollower, type SettingsProgress, type SettingsReceipt, type SettingsReceiver} from '../src/core/settings-follower.js';
import {createSettingsPeer, SettingsContinuityError, settingsFailure, settingsPeerConfig, type SettingsPeer, type SettingsReadRequest} from '../src/core/settings-peer.js';
import {deferred, flush, health, it, manualClock, peek, run, stateDir} from './support.js';

const origin = '00000000-0000-4000-8000-000000000001';
const foreign = '00000000-0000-4000-8000-000000000002';
const at = 1_800_000_000_000;
const token = 'synthetic-settings-reader-token';
const config = {origin: 'https://settings-peer.invalid', source: 'bunny/parts/settings-reader', tokenFile: '/private/synthetic-settings-token'};
const cursor = (seq: number, id = origin, offset = 0): string => checkpointText({origin: id, seq,
  anchor: seq === 0 ? '-' : `00000000-0000-4000-8000-${String(seq + offset).padStart(12, '0')}`});
const free = {mode: 'free', overrides: []} as const;
const mode = (value: 'free' | 'work' | 'quiet'): SettingsRecord => ({family: 'mode', id: 'hub', value: {mode: value, overrides: []}});
const initial = (checkpoint = cursor(0), id = origin, value: 'free' | 'work' = 'free'): SettingsSnapshot => ({
  schema: 'history/2.0', settings: 'snapshot', origin: id, checkpoint,
  records: [
    mode(value),
    {family: 'home-layout', id: 'home', value: {version: 1, layouts: null}},
    {family: 'lighting-layout', id: 'lighting', value: {layout: {rooms: [], groups: [], assignments: [], home: null}}},
    {family: 'playback-layout', id: 'playback', value: {assignments: []}},
    {family: 'art-schedule', id: 'art', value: {policy: initialArtRecord().policy}},
    {family: 'automation-settings', id: 'settings', value: DEFAULT_SETTINGS},
    {family: 'automation-interrupt-set', id: 'interrupt-set', value: {kinds: [...DEFAULT_INTERRUPT_SET]}},
  ],
});

const end = (position: string): SettingsPage => ({
  schema: 'history/2.0', settings: 'page', origin, after: position, through: position, next: position,
  applyThrough: position, done: true, facts: [],
});

function modeEdit(seq: number, value: 'free' | 'work', revision = seq): SettingsFact {
  return {seq, revision, atMs: at, family: 'mode', id: 'hub', kind: 'change', changed: {mode: value}, removed: []};
}

class Receiver implements SettingsReceiver {
  value: SettingsReceipt | null = null;
  records = new Map<string, SettingsRecord>();
  snapshots = 0;
  slices: Parameters<SettingsReceiver['apply']>[0][] = [];
  projections = 0;
  lostReceipt = false;
  enter: (() => Promise<void>) | undefined;

  constructor(readonly now: () => number) {}

  current: SettingsReceiver['current'] = ({projection}, {signal}) => {
    signal.throwIfAborted();
    if (projection === true) this.projections += 1;
    if (this.value === null) return Promise.resolve(null);
    return Promise.resolve({progress: this.value.progress, ...(projection === true ? {projection: [...this.records.values()]} : {})});
  };

  replace: SettingsReceiver['replace'] = (snapshot, expected, {signal}) => {
    signal.throwIfAborted();
    assert.deepEqual(expected, this.value?.progress ?? null);
    this.snapshots += 1;
    this.records = new Map(snapshot.records.map(record => [record.family, record]));
    return Promise.resolve(this.#commit({origin: snapshot.origin, checkpoint: snapshot.checkpoint, generation: String(this.snapshots),
      completedCheckpoint: snapshot.checkpoint, completedAtMs: this.now(), sourceAtMs: null}, [...this.records.values()]));
  };

  apply: SettingsReceiver['apply'] = async (slice, {signal}) => {
    signal.throwIfAborted();
    await this.enter?.();
    assert.deepEqual(slice.expected, this.value?.progress);
    this.slices.push(slice);
    const touched: SettingsRecord[] = [];
    for (const fact of slice.facts) {
      if (fact.kind === 'change' && fact.family === 'mode' && fact.changed.mode !== undefined) {
        const record = mode(fact.changed.mode);
        this.records.set(record.family, record);
        touched.push(record);
      }
    }
    const receipt = this.#commit({...slice.expected, checkpoint: slice.next,
      ...(slice.terminal ? {completedAtMs: this.now(), completedCheckpoint: slice.next} : {})}, touched);
    if (this.lostReceipt) {
      this.lostReceipt = false;
      throw settingsFailure('unavailable');
    }
    return receipt;
  };

  #commit(progress: SettingsProgress, projection: SettingsRecord[]): SettingsReceipt {
    return this.value = {progress, projection};
  }
}

function fakePeer() {
  const subscribed = new Map<string, {handle: Handler<object>; options: SubscribeOptions | undefined}>();
  const requests: SettingsReadRequest[] = [];
  const fake = {
    opens: 0, closes: 0, snapshots: 0,
    subscribed,
    requests,
    lose: () => {},
    beforeSubscribe: (_key: string): void => {},
    signal(value: 'free' | 'work', revision: number): void {
      const item = subscribed.get('bunny.state.mode.*');
      assert.ok(item);
      void item.handle(prepareMessage('bunny/core', {kind: 'state', type: 'org.bunny.mode.updated', subject: 'hub',
        dataschema: SCHEMA_BASE + 'mode/2.1', data: {id: 'hub', revision, mode: value, overrides: [], selectedAtMs: at}}, {now: () => at}));
    },
    artRun(revision: number): void {
      const item = subscribed.get('bunny.state.art-schedule.*');
      assert.ok(item);
      const record = {...initialArtRecord(), revision, weather: 'unavailable'};
      void item.handle(prepareMessage('bunny/core', {kind: 'state', type: 'org.bunny.art-schedule.updated', subject: 'art',
        dataschema: ART_SCHEDULE_SCHEMA, data: record}, {now: () => at}));
    },
    readSnapshot: (): SettingsSnapshot | Promise<SettingsSnapshot> => initial(),
    readPage: (read: SettingsReadRequest): SettingsPage | Promise<SettingsPage> => end(read.after),
  };
  const peer: SettingsPeer = {
    connect: (_signal, lost) => {
      fake.opens += 1;
      fake.lose = lost;
      return Promise.resolve({
        subscribe: <T extends object>(pattern: string, handle: Handler<T>, options?: SubscribeOptions) => {
          subscribed.set(pattern, {handle: handle as Handler<object>, options});
          fake.beforeSubscribe(pattern);
          return Promise.resolve({close: () => Promise.resolve()});
        },
        close: () => { fake.closes += 1; subscribed.clear(); return Promise.resolve(); },
      });
    },
    snapshot: async () => { fake.snapshots += 1; return fake.readSnapshot(); },
    page: async read => { requests.push(read); return fake.readPage(read); },
  };
  return {fake, peer};
}

function follow(peer: SettingsPeer, receiver: SettingsReceiver, clock: ReturnType<typeof manualClock>, replaceOnStart = false) {
  const faults: string[] = [];
  const follower = new SettingsFollower({receiver, clock, scheduler: clock.scheduler, replaceOnStart,
    signal: new AbortController().signal, openPeer: () => Promise.resolve(peer), failed: code => { faults.push(code); }});
  return {follower, faults};
}

it('subscriptions precede the first read and a signal burst produces one sealed follow-up without polling', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  const {peer, fake} = fakePeer();
  const held = deferred<SettingsSnapshot>();
  fake.readSnapshot = () => {
    assert.equal(fake.subscribed.size, SETTINGS_FAMILIES.length);
    return held.promise;
  };
  fake.beforeSubscribe = key => {
    if (key === `bunny.state.${SETTINGS_FAMILIES.at(-1)}.*`) fake.signal('work', 1);
  };
  fake.readPage = ({after}) => after === cursor(0) ? {...end(cursor(1)), after, facts: [modeEdit(1, 'work')]} : end(after);
  const {follower} = follow(peer, receiver, clock);
  t.after(() => follower.stop());
  await flush();
  assert.equal(fake.snapshots, 1);
  fake.signal('work', 2);
  fake.signal('work', 3);
  held.resolve(initial());
  await flush();
  assert.deepEqual(fake.requests, [{after: cursor(0)}]);
  assert.deepEqual(receiver.records.get('mode'), mode('work'));
  assert.equal(receiver.value?.progress.completedCheckpoint, cursor(1));
  fake.signal('work', 4);
  clock.advance(180_000);
  await flush();
  assert.equal(fake.requests.length, 1);
});

it('fixed pages advance over skipped rows and keep a split pair through one seal', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  await receiver.replace(initial(), null, {signal: new AbortController().signal, trace: childOf(undefined)});
  const {peer, fake} = fakePeer();
  const head = cursor(127), lighting: SettingsFact = {family: 'lighting-layout', id: 'lighting', seq: 126, revision: 5,
    atMs: at, kind: 'change', changed: {layout: {rooms: [], groups: [], assignments: [], home: null}}, removed: []};
  const home: SettingsFact = {family: 'home-layout', id: 'home', seq: 127, revision: 5,
    atMs: at, kind: 'change', changed: {layouts: null}, removed: []};
  fake.readPage = ({after}) => {
    if (after === cursor(0)) return {...end(head), done: false, after, next: cursor(63), applyThrough: cursor(62)};
    if (after === cursor(63)) return {...end(head), done: false, after, next: cursor(126), applyThrough: cursor(125), facts: [lighting]};
    return {...end(head), after, facts: [home]};
  };
  const {follower} = follow(peer, receiver, clock);
  t.after(() => follower.stop());
  await flush();
  assert.deepEqual(fake.requests, [{after: cursor(0)}, {after: cursor(63), through: head}, {after: cursor(126), through: head}]);
  assert.deepEqual(receiver.slices.map(({next, facts, terminal}) => [next, facts, terminal]), [
    [cursor(62), [], false], [cursor(125), [], false], [head, [lighting, home], true],
  ]);
});

it('a conflicting page cannot advance the accepted seal or report completion', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  await receiver.replace(initial(), null, {signal: new AbortController().signal, trace: childOf(undefined)});
  const {peer, fake} = fakePeer();
  const head = cursor(64);
  fake.readPage = ({after}) => after === cursor(0)
    ? {...end(head), done: false, after, next: cursor(63), applyThrough: cursor(62), facts: [modeEdit(62, 'work', 7)]}
    : {...end(head), after, facts: [modeEdit(64, 'free', 7)]};
  const {follower, faults} = follow(peer, receiver, clock);
  t.after(() => follower.stop());
  await flush();
  assert.deepEqual(faults, ['invalid-message']);
  assert.equal(receiver.value?.progress.checkpoint, cursor(62));
  assert.equal(receiver.value?.progress.completedCheckpoint, cursor(0));
  assert.deepEqual(receiver.records.get('mode'), mode('work'));
});

it('overflow, late old signals and equal signals during apply cannot hide a real return', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  const {peer, fake} = fakePeer();
  const {follower} = follow(peer, receiver, clock);
  t.after(() => follower.stop());
  await flush();

  const overflow = fake.subscribed.get('bunny.state.mode.*')?.options?.onOverflow;
  assert.ok(overflow);
  fake.readPage = ({after}) => ({...end(cursor(1)), after, facts: [modeEdit(1, 'work')]});
  await overflow({});
  await flush();
  assert.deepEqual(receiver.records.get('mode'), mode('work'));

  fake.readPage = ({after}) => end(after);
  fake.signal('free', 1);
  await flush();
  assert.equal(fake.requests.length, 2);
  fake.readPage = ({after}) => ({...end(cursor(2)), after, facts: [modeEdit(2, 'free')]});
  fake.signal('free', 2);
  await flush();
  assert.deepEqual(receiver.records.get('mode'), mode('free'));

  const entered = deferred<void>(), resume = deferred<void>();
  receiver.enter = async () => {
    receiver.enter = undefined;
    entered.resolve();
    await resume.promise;
  };
  fake.readPage = ({after}) => after === cursor(2)
    ? {...end(cursor(3)), after, facts: [modeEdit(3, 'work')]} : {...end(cursor(4)), after, facts: [modeEdit(4, 'free')]};
  fake.signal('work', 3);
  await entered.promise;
  fake.signal('free', 4);
  resume.resolve();
  await flush();
  assert.equal(receiver.value?.progress.checkpoint, cursor(4));
  assert.deepEqual(receiver.records.get('mode'), mode('free'));
});

it('an invalid terminal completion is retried from committed receiver progress', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  await receiver.replace(initial(), null, {signal: new AbortController().signal, trace: childOf(undefined)});
  const apply = receiver.apply;
  let stale = true;
  receiver.apply = async (slice, context) => {
    const receipt = await apply(slice, context);
    if (!stale) return receipt;
    stale = false;
    return {progress: {...receipt.progress, completedCheckpoint: slice.expected.completedCheckpoint,
      completedAtMs: slice.expected.completedAtMs}};
  };
  const {peer, fake} = fakePeer();
  fake.readPage = ({after}) => after === cursor(0)
    ? {...end(cursor(1)), after, facts: [modeEdit(1, 'work')]} : end(after);
  clock.advance(1);
  const {follower} = follow(peer, receiver, clock);
  t.after(() => follower.stop());
  await flush();
  assert.equal(follower.state, 'unavailable');
  assert.equal(receiver.value?.progress.checkpoint, cursor(1));
  clock.advance(1000);
  await flush();
  assert.equal(follower.state, 'following');
  assert.deepEqual(fake.requests, [{after: cursor(0)}, {after: cursor(1)}]);
  assert.equal(receiver.projections, 2);
});

it('a nonterminal receipt cannot change completed-read evidence', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  await receiver.replace(initial(), null, {signal: new AbortController().signal, trace: childOf(undefined)});
  const apply = receiver.apply;
  receiver.apply = async (slice, context) => {
    const receipt = await apply(slice, context);
    return {...receipt, progress: {...receipt.progress, completedCheckpoint: slice.next, completedAtMs: clock.now()}};
  };
  const {peer, fake} = fakePeer();
  const head = cursor(64);
  fake.readPage = ({after}) => after === cursor(0)
    ? {...end(head), after, done: false, next: cursor(63), applyThrough: cursor(62)}
    : {...end(head), after};
  const {follower} = follow(peer, receiver, clock);
  t.after(() => follower.stop());
  await flush();
  assert.equal(follower.state, 'unavailable');
  assert.deepEqual(fake.requests, [{after: cursor(0)}]);
  assert.equal(receiver.value?.progress.completedCheckpoint, cursor(0));
});

it('a same-token reseed requires a new committed replacement generation', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  const old = await receiver.replace(initial(), null, {signal: new AbortController().signal, trace: childOf(undefined)});
  const replace = receiver.replace;
  let stale = true;
  receiver.replace = (snapshot, expected, context) => {
    if (!stale) return replace(snapshot, expected, context);
    stale = false;
    return Promise.resolve(old);
  };
  const {peer, fake} = fakePeer();
  fake.readSnapshot = () => initial(cursor(0), origin, 'work');
  const {follower} = follow(peer, receiver, clock, true);
  t.after(() => follower.stop());
  await flush();
  assert.equal(follower.state, 'unavailable');
  clock.advance(1000);
  await flush();
  assert.equal(follower.state, 'following');
  assert.equal(fake.snapshots, 2);
  assert.deepEqual(fake.requests, []);
  assert.deepEqual(receiver.records.get('mode'), mode('work'));
  assert.equal(receiver.projections, 2);
});

it('summarized read failures do not carry an individual request trace', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  await receiver.replace(initial(), null, {signal: new AbortController().signal, trace: childOf(undefined)});
  const {peer} = fakePeer();
  const reads: TraceContext[] = [], failures: {trace: TraceContext | undefined; count: number}[] = [];
  const follower = new SettingsFollower({receiver, clock, scheduler: clock.scheduler, signal: new AbortController().signal,
    openPeer: () => Promise.resolve({...peer, page: (_query, _signal, trace) => {
      reads.push(trace);
      return Promise.reject(settingsFailure('unavailable'));
    }}),
    failed: (_code, trace, count) => { failures.push({trace, count}); },
  });
  t.after(() => follower.stop());
  await flush();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000]) {
    clock.advance(delay);
    await flush();
  }
  assert.equal(new Set(reads.map(trace => trace.traceparent)).size, 7);
  assert.deepEqual(failures, [{trace: reads[0], count: 1}, {trace: undefined, count: 6}]);
});

it('a lost receipt resumes from the durable seal and rechecks a terminal metadata-only read', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  await receiver.replace(initial(), null, {signal: new AbortController().signal, trace: childOf(undefined)});
  const {peer, fake} = fakePeer();
  const {follower, faults} = follow(peer, receiver, clock);
  t.after(() => follower.stop());
  receiver.lostReceipt = true;
  fake.readPage = ({after}) => after === cursor(0) ? {...end(cursor(1)), after, facts: [modeEdit(1, 'work')]} : end(after);
  await flush();
  assert.deepEqual(faults, ['unavailable']);
  assert.equal(receiver.value?.progress.checkpoint, cursor(1));
  clock.advance(1000);
  await flush();
  assert.deepEqual(fake.requests, [{after: cursor(0)}, {after: cursor(1)}]);
  assert.deepEqual(receiver.slices.map(slice => slice.facts.length), [1, 0]);

  receiver.lostReceipt = true;
  await fake.subscribed.get('bunny.state.mode.*')?.options?.onOverflow?.({});
  await flush();
  clock.advance(1000);
  await flush();
  assert.deepEqual(fake.requests.slice(-2), [{after: cursor(1)}, {after: cursor(1)}]);
  const before = fake.requests.length;
  fake.signal('work', 10);
  fake.artRun(10);
  await flush();
  assert.equal(fake.requests.length, before);
});

it('a continuity refusal replaces an anchored checkpoint and a foreign snapshot cannot replace it', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  await receiver.replace(initial(cursor(1)), null, {signal: new AbortController().signal, trace: childOf(undefined)});
  const {peer, fake} = fakePeer();
  fake.readPage = () => { throw new SettingsContinuityError(); };
  const replacement = cursor(1, origin, 100);
  fake.readSnapshot = () => initial(replacement, origin, 'work');
  const first = follow(peer, receiver, clock);
  t.after(() => first.follower.stop());
  await flush();
  clock.advance(1000);
  await flush();
  assert.equal(receiver.value?.progress.checkpoint, replacement);
  assert.equal(receiver.snapshots, 2);
  await first.follower.stop();
  fake.readSnapshot = () => initial(cursor(0, foreign), foreign);
  const second = follow(peer, receiver, clock);
  t.after(() => second.follower.stop());
  await flush();
  clock.advance(1000);
  await flush();
  assert.deepEqual(second.faults, ['unavailable', 'invalid-state']);
  assert.equal(receiver.value?.progress.checkpoint, replacement);
});

it('restoration retires the old stream before accepting lower source revisions', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  await receiver.replace(initial(cursor(1)), null, {signal: new AbortController().signal, trace: childOf(undefined)});
  const {peer, fake} = fakePeer();
  const refuse = deferred<void>(), replacement = deferred<SettingsSnapshot>();
  fake.readPage = async () => {
    await refuse.promise;
    throw new SettingsContinuityError();
  };
  fake.readSnapshot = () => replacement.promise;
  const {follower} = follow(peer, receiver, clock);
  t.after(() => follower.stop());
  await flush();
  const old = fake.subscribed.get('bunny.state.mode.*')?.handle;
  assert.ok(old);
  fake.signal('free', 100);
  refuse.resolve();
  await flush();
  assert.equal(fake.closes, 1);
  clock.advance(1000);
  await flush();
  assert.equal(fake.opens, 2);
  const position = cursor(1, origin, 100);
  replacement.resolve(initial(position));
  await flush();
  await old(prepareMessage('bunny/core', {kind: 'state', type: 'org.bunny.mode.updated', subject: 'hub',
    dataschema: SCHEMA_BASE + 'mode/2.1', data: {id: 'hub', revision: 101, mode: 'free', overrides: [], selectedAtMs: at}}, {now: () => at}));
  fake.readPage = ({after}) => ({...end(cursor(2, origin, 100)), after, facts: [modeEdit(2, 'work')]});
  fake.signal('work', 2);
  await flush();
  assert.deepEqual(receiver.records.get('mode'), mode('work'));
  assert.equal(receiver.value?.progress.checkpoint, cursor(2, origin, 100));
});

it('an explicit reseed preserves intent when sequence-zero replacement acknowledgment is lost', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  await receiver.replace(initial(), null, {signal: new AbortController().signal, trace: childOf(undefined)});
  const original = receiver.replace;
  let lose = true;
  receiver.replace = async (...args) => {
    const result = await original(...args);
    if (lose) { lose = false; throw settingsFailure('unavailable'); }
    return result;
  };
  const {peer, fake} = fakePeer();
  fake.readSnapshot = () => initial(cursor(0), origin, 'work');
  const {follower} = follow(peer, receiver, clock, true);
  t.after(() => follower.stop());
  await flush();
  clock.advance(1000);
  await flush();
  assert.equal(fake.snapshots, 2);
  assert.deepEqual(fake.requests, []);
  assert.equal(receiver.snapshots, 3);
});

it('stop waits for an entered commit and fences a pending receiver read', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  await receiver.replace(initial(), null, {signal: new AbortController().signal, trace: childOf(undefined)});
  const {peer, fake} = fakePeer();
  const entered = deferred<void>(), resume = deferred<void>();
  receiver.enter = async () => { entered.resolve(); await resume.promise; };
  const {follower} = follow(peer, receiver, clock);
  t.after(() => follower.stop());
  await entered.promise;
  const stopping = follower.stop().then(() => 'stopped');
  assert.equal(await peek(stopping), undefined);
  resume.resolve();
  assert.equal(await stopping, 'stopped');
  assert.equal(receiver.slices.length, 1);

  const read = deferred<SettingsReceipt | null>();
  receiver.current = async () => read.promise;
  const later = follow(peer, receiver, clock);
  t.after(() => later.follower.stop());
  await flush();
  const calls = fake.requests.length;
  const stopped = later.follower.stop();
  read.resolve(receiver.value);
  await stopped;
  assert.equal(fake.requests.length, calls);
});

it('history transport uses strict redirects, bounds actual bytes and times out after headers', async t => {
  const clock = manualClock(at);
  const peer = createSettingsPeer(config, token, clock.scheduler);
  const read = (): Promise<SettingsSnapshot> => peer.snapshot(new AbortController().signal, childOf(undefined));
  const held = deferred<AbortSignal>();
  let redirect: RequestRedirect | undefined;
  const mocked = t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    redirect = init.redirect;
    assert.ok(init.signal);
    held.resolve(init.signal);
    return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([123])); },
    })));
  });
  const pending = assert.rejects(read(), {message: 'unavailable'});
  const signal = await held.promise;
  clock.advance(30_000);
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(redirect, 'error');
  mocked.mock.mockImplementation(() => Promise.resolve(new Response(new Uint8Array(SETTINGS_ANSWER_BYTES + 1), {
    status: 409, headers: {'content-length': '1'},
  })));
  await assert.rejects(read(), {message: 'too-large: the response exceeds its byte limit'});
});

it('decoders validate exact shapes and keep the existing retained identifiers', () => {
  const snapshot = initial();
  assert.deepEqual(decodeSettingsSnapshot(snapshot), snapshot);
  assert.equal(decodeSettingsSnapshot({...snapshot, records: [...snapshot.records, mode('work')]}), undefined);
  assert.equal(decodeSettingsSnapshot({...snapshot, records: snapshot.records.slice(1)}), undefined);
  assert.equal(decodeSettingsSnapshot({...snapshot, records: snapshot.records.map(record => record.family === 'mode'
    ? {...record, value: {...free, unexpected: true}} : record)}), undefined);
  assert.equal(decodeSettingsPage({...end(cursor(1)), facts: [{...modeEdit(1, 'work'), removed: ['mode']}]}), undefined);
  assert.deepEqual(decodeSettingsPage(end(cursor(0))), end(cursor(0)));
});

it('history transport treats only a typed page refusal as continuity loss', async t => {
  const clock = manualClock(at);
  const peer = createSettingsPeer(config, token, clock.scheduler);
  const signal = new AbortController().signal, trace = childOf(undefined);
  const refused = {error: {code: 'revision-conflict', retryable: false, detail: 'synthetic'}};
  const mocked = t.mock.method(globalThis, 'fetch', () => Promise.resolve(Response.json(refused, {status: 409})));
  await assert.rejects(peer.page({after: cursor(1)}, signal, trace), SettingsContinuityError);
  await assert.rejects(peer.snapshot(signal, trace), error => !(error instanceof SettingsContinuityError));
  mocked.mock.mockImplementation(() => Promise.resolve(Response.json(refused, {status: 503})));
  await assert.rejects(peer.page({after: cursor(1)}, signal, trace), {message: 'invalid-message'});
});

it('peer configuration accepts only a private HTTPS origin and an ordinary source', () => {
  assert.deepEqual(settingsPeerConfig({peer: {...config, origin: 'https://Settings-Peer.INVALID:443/'}}, true), config);
  assert.equal(settingsPeerConfig(undefined, false), undefined);
  for (const origin of ['http://settings-peer.invalid', 'https://settings-peer.invalid/?', 'https://settings-peer.invalid/#',
    'https://settings-peer.invalid/./', 'https://user@settings-peer.invalid', 'https://settings-peer.invalid\\']) {
    assert.throws(() => settingsPeerConfig({peer: {...config, origin}}, true), {code: 'config-invalid'});
  }
  assert.throws(() => settingsPeerConfig({peer: {...config, source: 'bunny/core'}}, true), {code: 'config-invalid'});
  assert.throws(() => settingsPeerConfig({peer: config}, false), {code: 'config-invalid'});
});

it('staged standby stays healthy without reading its token or opening a peer', async t => {
  const clock = manualClock(at);
  const core = createCoreModule({standby: true});
  const localFetch = globalThis.fetch;
  let outgoing = 0;
  t.mock.method(globalThis, 'fetch', (url: string | URL, init?: RequestInit) => {
    if (String(url).startsWith(config.origin)) { outgoing += 1; assert.fail('staged peer request'); }
    return localFetch(url, init);
  });
  const {runtime, logs} = await run(t, {modules: [core], clock, scheduler: clock.scheduler,
    config: {modules: {core: {peer: config}}}});
  assert.equal((await health(runtime.url)).body.status, 'ok');
  assert.equal(standbyFollowerState(core), 'unavailable');
  clock.advance(180_000);
  await flush();
  assert.equal(outgoing, 0);
  assert.deepEqual(logs.filter(log => log.event_name === 'operation.failed').map(log => log.attributes['bunny.code']), ['unavailable']);
  assert.equal(JSON.stringify(logs).includes(config.tokenFile), false);
});

it('a refused token leaves the standby core healthy and makes no peer request', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  const core = createCoreModule({standby: true, settingsReceiver: () => receiver});
  const tokenDir = await stateDir(t), tokenFile = join(tokenDir, 'missing-token');
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url: string | URL, init?: RequestInit) => {
    assert.equal(String(url).startsWith(config.origin), false);
    return localFetch(url, init);
  });
  const failed = deferred<void>(), codes: unknown[] = [];
  const {runtime} = await run(t, {modules: [core], clock, scheduler: clock.scheduler,
    config: {modules: {core: {peer: {...config, tokenFile}}}},
    log: record => {
      if (record.event_name !== 'operation.failed') return;
      assert.equal(JSON.stringify(record).includes(tokenFile), false);
      codes.push(record.attributes['bunny.code']);
      failed.resolve();
    },
  });
  await failed.promise;
  assert.equal((await health(runtime.url)).body.status, 'ok');
  assert.equal(standbyFollowerState(core), 'unavailable');
  assert.deepEqual(codes, ['not-found']);
  assert.equal(receiver.value, null);
});

it('in-process standby activates a test receiver after lease readiness without waiting for the peer', async t => {
  const clock = manualClock(at), receiver = new Receiver(clock.now);
  const tokenDir = await stateDir(t), tokenFile = join(tokenDir, 'synthetic-token');
  await writeFile(tokenFile, token + '\n', {mode: 0o600});
  const core = createCoreModule({standby: true, settingsReceiver: () => {
    assert.ok('settings' in core.history.settings({mode: 'snapshot'}));
    return receiver;
  }});
  const opened = deferred<AbortSignal>(), headers = deferred<Response>();
  const localFetch = globalThis.fetch;
  const calls: {path: string; redirect: RequestRedirect | undefined}[] = [];
  t.mock.method(globalThis, 'fetch', (url: string | URL, init?: RequestInit) => {
    if (!String(url).startsWith(config.origin)) return localFetch(url, init);
    const path = new URL(url).pathname;
    calls.push({path, redirect: init?.redirect});
    if (path.endsWith('/stream')) {
      const signal = init?.signal;
      assert.ok(signal);
      opened.resolve(signal);
      signal.addEventListener('abort', () => headers.resolve(new Response(null, {status: 503})), {once: true});
      return headers.promise;
    }
    if (path.endsWith('/subscribe')) return Promise.resolve(Response.json({schema: REMOTE_SCHEMA, status: 'subscribed'}));
    return Promise.resolve(Response.json(initial()));
  });
  const {runtime} = await run(t, {modules: [core], clock, scheduler: clock.scheduler,
    config: {modules: {core: {peer: {...config, tokenFile}}}}});
  const stream = await opened.promise;
  assert.equal((await health(runtime.url)).body.status, 'ok');
  assert.equal(receiver.value, null);
  const encoder = new TextEncoder();
  headers.resolve(new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify({schema: REMOTE_SCHEMA, connection: 'synthetic'})}\n\n`)); },
  })));
  await flush();
  const committed = await receiver.current({}, {signal: new AbortController().signal, trace: childOf(undefined)});
  assert.equal(committed?.progress.checkpoint, cursor(0));
  assert.ok(calls.every(call => call.redirect === 'error'));
  await runtime.stop();
  assert.equal(stream.aborted, true);
});
