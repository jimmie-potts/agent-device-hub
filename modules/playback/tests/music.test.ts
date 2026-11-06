import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {MUSIC_PLAYBACK_SOURCE, type MusicPlaybackEndpoint, type MusicPlaybackField, type MusicPlaybackResult,
  type MusicPlaybackSample, type MusicPlaybackWork, type PlaybackPositionState} from '@jimmie-potts/event-contracts/v2/music-playback';
import {InProcessBus, SdkError, type BusOptions, type Command, type Participant} from '@jimmie-potts/sdk';
import {PLAYBACK_POSITION_SCHEMA} from '../src/module.js';
import {SimulatedSpeakers} from '../src/simulated.js';
import {ID, SECTION, flush, host, manualClock, refuseWrites, storedCommands, test} from './support.js';

const epoch = '00000000-0000-4000-8000-000000000571';
const schema = (family: string): string => `https://bunny.invalid/events/${family}/2.0`;
function sample(now: number, sequence = 1): MusicPlaybackSample {
  const interval = {earliestAtMs: now - 20, latestAtMs: now};
  const field = <T>(value: T): MusicPlaybackField<T> => ({status: 'observed', value, interval});
  return {sequence, interval, clockUncertaintyMs: 50, discontinuity: sequence === 1, status: 'sample', processEpoch: epoch,
    libraryScopeId: 'synthetic-library', state: field('paused'), position: field(0), item: field('0123456789ABCDEF'),
    itemAssociation: {status: 'bounded-match', interval}, metadata: {title: field('Synthetic Music'), artist: field('Synthetic artist'),
      album: field('Synthetic album'), durationSeconds: field(120)},
    outputSelection: {status: 'observed', provenance: 'music-declared-selection', interval, selectionInterval: interval,
      airPlayEnabled: field(true), devices: []}};
}
async function world(context: TestContext, options: {musicOnly?: boolean; absent?: boolean; monotonic?: () => number; clock?: ReturnType<typeof manualClock>;
  bus?: (settings: BusOptions) => InProcessBus} = {}) {
  let bus: InProcessBus | undefined;
  const speakers = new SimulatedSpeakers({sony: {input: 'airplay', status: 'playing', title: 'Synthetic receiver'}});
  const section = {id: ID, sources: options.absent === true ? SECTION.sources : options.musicOnly === true ? [{kind: 'music'}] : [{kind: 'music'}, ...SECTION.sources]};
  const hosted = await host(context, speakers, {section, ...(options.clock === undefined ? {} : {clock: options.clock}),
    ...(options.monotonic === undefined ? {} : {monotonic: options.monotonic}), bus: settings => {bus = options.bus?.(settings) ?? new InProcessBus(settings); return bus;}});
  assert.ok(bus);
  const producer = bus.connect(MUSIC_PLAYBACK_SOURCE), gateway = bus.connect('bunny/runtime/gateway');
  context.after(async () => {await producer.close(); await gateway.close();});
  const work: Command<MusicPlaybackWork>[] = [];
  let automatic = true;
  const publishResult = (command: Command<MusicPlaybackWork>, status: 'sent' | 'refused' = 'sent') => {
    const data: MusicPlaybackResult = status === 'sent' ? {...command.data, status} : {...command.data, status, error: {code: 'invalid-state', retryable: false}};
    // requestId belongs to the work only.
    const {operationId, processEpoch, action} = data;
    return producer.publish(`bunny.event.music-playback-result.${command.subject}`, {kind: 'occurrence',
      type: 'org.bunny.music-playback.result.observed', subject: command.subject, dataschema: schema('music-playback-result'),
      data: data.status === 'sent' ? {operationId, processEpoch, action, status: data.status}
        : {operationId, processEpoch, action, status: data.status, error: data.error}}, {parent: command});
  };
  await producer.respond<MusicPlaybackWork>('bunny.cmd.music-playback-work.endpoint-1', async command => {
    work.push(command);
    if (automatic) await publishResult(command);
    return {status: 'accepted'};
  });
  const enable = (endpointId = 'endpoint-1', libraryScopeId = 'synthetic-library') => producer.request(`bunny.cmd.music-playback-endpoint.${endpointId}`, {
    type: 'org.bunny.music-playback.endpoint.requested', subject: endpointId, dataschema: schema('music-playback-endpoint'),
    data: {action: 'enable', libraryScopeId} satisfies Omit<Extract<MusicPlaybackEndpoint, {action: 'enable'}>, 'requestId'>,
  }, {timeoutMs: 1000});
  const disable = (endpointId: string) => producer.request(`bunny.cmd.music-playback-endpoint.${endpointId}`, {
    type: 'org.bunny.music-playback.endpoint.requested', subject: endpointId, dataschema: schema('music-playback-endpoint'), data: {action: 'disable'},
  }, {timeoutMs: 1000});
  const observe = async (data = sample(hosted.clock.now()), endpointId = 'endpoint-1') => {
    await producer.publish(`bunny.event.music-playback-observation.${endpointId}`, {kind: 'occurrence', type: 'org.bunny.music-playback.observed',
      subject: endpointId, dataschema: schema('music-playback-observation'), data}); await flush();
  };
  const unavailable = async (sequence: number) => {
    await producer.publish('bunny.event.music-playback-observation.endpoint-1', {kind: 'occurrence', type: 'org.bunny.music-playback.observed',
      subject: 'endpoint-1', dataschema: schema('music-playback-observation'), data: {sequence,
        interval: {earliestAtMs: hosted.clock.now(), latestAtMs: hosted.clock.now()}, clockUncertaintyMs: 50, discontinuity: true,
        status: 'unavailable', error: {code: 'capacity', retryable: true}}}); await flush();
  };
  const lost = async (endpointId = 'endpoint-1') => {
    await gateway.publish(`bunny.event.music-playback-lost.${endpointId}`, {kind: 'occurrence', type: 'org.bunny.music-playback.endpoint-lost',
      subject: endpointId, dataschema: schema('music-playback-lost'), data: {id: endpointId}}); await flush();
  };
  const positions = () => hosted.published.filter((message): message is Message<PlaybackPositionState> => message.dataschema === PLAYBACK_POSITION_SCHEMA)
    .map(message => message.data);
  return {hosted, speakers, producer, work, enable, disable, observe, unavailable, lost, positions, publishResult, hold: () => {automatic = false;}};
}

test('an explicit Music source preserves paused/playing equality and routes only to its presented endpoint', async context => {
  const w = await world(context);
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal(w.work.length, 0);
  await w.observe();
  const playback = w.hosted.record().playback;
  assert.equal(playback.status, 'known');
  assert.equal(playback.status === 'known' && playback.title, 'Synthetic Music');
  assert.equal((await w.hosted.send('next', 'music-next', w.hosted.record().revision)).status, 'accepted');
  assert.deepEqual(w.work.map(command => [command.source, command.subject, command.data.action]), [['bunny/modules/playback', 'endpoint-1', 'next']]);
  assert.deepEqual([w.speakers.state().sony.commands, w.speakers.state().sonos.commands], [[], []]);
  assert.equal(w.hosted.outcomes().at(-1)?.evidence, 'transmitted');
  assert.equal(w.positions().at(-1)?.recordingAssociation, 'unqualified');
  assert.deepEqual(w.hosted.problems(), []);
});

test('Music is never enrolled without configuration and a second endpoint cannot replace the first', async context => {
  const absent = await world(context, {absent: true});
  assert.equal((await absent.enable()).status, 'rejected');
  assert.equal(absent.positions().length, 0);
  const w = await world(context, {musicOnly: true});
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.enable('endpoint-2')).status, 'rejected');
  await w.observe();
  assert.equal(w.hosted.record().availability, 'available');
});

test('position-only updates retain playback admission revision and mixed sync uses owner high water', async context => {
  const w = await world(context, {musicOnly: true});
  await w.enable(); await w.observe();
  const before = w.hosted.record().revision;
  await w.hosted.advance(1000);
  const next = sample(w.hosted.clock.now(), 2); next.position = {...next.position, status: 'observed', value: 1};
  await w.observe(next);
  assert.equal(w.hosted.record().revision, before);
  assert.ok((w.positions().at(-1)?.revision ?? 0) > before);
  const synced: Message[] = [];
  const sync = await w.producer.sync(['playback', 'playback-position'], change => {if (change.type === 'updated') synced.push(change.message);}, {owner: 'bunny/modules/playback', timeoutMs: 1000});
  assert.equal(sync.status, 'synced');
  assert.equal(synced.filter(message => message.kind === 'state').length, 2);
  assert.deepEqual(w.hosted.problems(), []);
});

test('late samples do not refresh freshness and endpoint loss retires position and guarded controls', async context => {
  const w = await world(context, {musicOnly: true});
  await w.enable(); const original = sample(w.hosted.clock.now()); await w.observe(original);
  const revision = w.hosted.record().revision;
  await w.hosted.advance(5100);
  await w.observe({...original, sequence: 2});
  assert.equal(w.hosted.record().availability, 'stale');
  assert.equal((await w.hosted.send('next', 'stale')).status, 'rejected');
  await w.lost();
  assert.equal(w.hosted.record().availability, 'unavailable');
  assert.equal(w.positions().at(-1)?.evidence.status, 'unavailable');
  assert.equal((await w.hosted.send('next', 'old-revision', revision)).status, 'rejected');
  assert.equal((await w.enable()).status, 'rejected');
  assert.equal((await w.enable('endpoint-2')).status, 'accepted');
  await w.observe({...original, sequence: 3});
  assert.equal(w.hosted.record().availability, 'unavailable');
  assert.equal(w.work.length, 0);
});

test('original live late evidence resolves uncertainty once, while retired endpoint evidence cannot', async context => {
  const w = await world(context, {musicOnly: true});
  await w.enable(); await w.observe(); w.hold();
  const request = w.hosted.send('next', 'late-result'); await flush();
  await w.hosted.advance(4001); assert.equal((await request).status, 'accepted');
  assert.equal(w.hosted.outcomes().at(-1)?.result, 'uncertain');
  const command = w.work[0]; assert.ok(command);
  await w.publishResult(command); await flush();
  assert.deepEqual(w.hosted.outcomes().map(outcome => outcome.result), ['uncertain', 'succeeded']);
  await w.publishResult(command); await flush();
  assert.equal(w.hosted.outcomes().length, 2);
  await w.lost(); await w.publishResult(command, 'refused'); await flush();
  assert.equal(w.hosted.outcomes().length, 2);
  assert.equal(w.work.length, 1);
});

test('storage refusal sends nothing and restart keeps position unavailable without replay', async context => {
  const w = await world(context, {musicOnly: true});
  await w.enable(); await w.observe();
  const release = refuseWrites(w.hosted);
  assert.equal((await w.hosted.send('next', 'no-storage')).status, 'rejected');
  assert.equal(w.work.length, 0); release();
  w.hold(); const command = w.hosted.send('next', 'unfinished'); await flush();
  await w.hosted.stop(); await command;
  await w.hosted.start(); await flush();
  assert.equal(w.hosted.record().availability, 'unavailable');
  assert.equal(w.positions().at(-1)?.evidence.status, 'unavailable');
  assert.ok(storedCommands(w.hosted).includes('unfinished uncertain'));
  assert.equal(w.work.length, 1);
});

test('missing samples and changed local items mark discontinuity instead of trusting a false producer flag', async context => {
  const w = await world(context, {musicOnly: true}); await w.enable(); await w.observe();
  await w.hosted.advance(100);
  const gap = {...sample(w.hosted.clock.now(), 3), discontinuity: false}; await w.observe(gap);
  const gapped = w.positions().at(-1)?.evidence;
  assert.equal(gapped?.status === 'observed' && gapped.observation.discontinuity, true);
  await w.hosted.advance(100);
  const changed = {...sample(w.hosted.clock.now(), 4), discontinuity: false};
  changed.item = {status: 'observed', value: 'FEDCBA9876543210', interval: changed.interval}; await w.observe(changed);
  const evidence = w.positions().at(-1)?.evidence;
  assert.equal(evidence?.status === 'observed' && evidence.observation.discontinuity, true);
});

test('process replacement with identical text invalidates an earlier revision and clock jumps send nothing', async context => {
  const clock = manualClock(); let offset = 0;
  const w = await world(context, {musicOnly: true, clock, monotonic: () => clock.now() + offset});
  await w.enable(); await w.observe(); const before = w.hosted.record().revision;
  await w.observe({...sample(clock.now(), 2), processEpoch: '00000000-0000-4000-8000-000000000572'});
  assert.ok(w.hosted.record().revision > before);
  assert.equal((await w.hosted.send('next', 'old-process', before)).status, 'rejected');
  offset = 1000;
  assert.equal((await w.hosted.send('next', 'clock-jump')).status, 'rejected');
  await flush();
  assert.equal(w.work.length, 0);
  assert.equal(w.positions().at(-1)?.evidence.status, 'unavailable');
});

test('a failed companion transaction rolls back its revision and never refreshes persisted sync evidence', async context => {
  const w = await world(context, {musicOnly: true}); await w.enable(); await w.observe();
  const before = w.positions().at(-1); assert.ok(before);
  const release = refuseWrites(w.hosted); await w.hosted.advance(100);
  await w.observe(sample(w.hosted.clock.now(), 2));
  assert.deepEqual(w.positions().at(-1), before);
  const sync = await w.producer.sync(['playback-position'], () => {}, {owner: 'bunny/modules/playback', timeoutMs: 1000});
  assert.equal(sync.status, 'synced');
  if (sync.status === 'synced') {assert.deepEqual(sync.copy.states()[0]?.data, before); await sync.copy.close();}
  release(); await w.hosted.advance(100); await w.observe(sample(w.hosted.clock.now(), 3));
  assert.ok((w.positions().at(-1)?.revision ?? 0) > before.revision);
});

test('a failed Music handoff cannot send an old displayed revision to the newly selected source', async context => {
  const w = await world(context); await w.enable();
  const displayed = w.hosted.record();
  assert.equal(displayed.playback.status === 'known' && displayed.playback.title, 'Synthetic receiver');
  const release = refuseWrites(w.hosted); await w.observe(); release();
  assert.equal(w.hosted.record().revision, displayed.revision);
  assert.equal((await w.hosted.send('next', 'failed-handoff', displayed.revision)).status, 'rejected');
  assert.deepEqual(w.work, []);
  assert.deepEqual(w.speakers.state().sony.commands, []);
  await w.observe(sample(w.hosted.clock.now(), 2));
  assert.ok(w.hosted.record().revision > displayed.revision);
  assert.equal((await w.hosted.send('next', 'new-handoff', w.hosted.record().revision)).status, 'accepted');
  assert.equal(w.work.length, 1);
});

test('two retired endpoints cannot cycle back into live authority', async context => {
  const w = await world(context, {musicOnly: true});
  await w.enable(); await w.disable('endpoint-1'); await w.enable('endpoint-2'); await w.disable('endpoint-2');
  assert.equal((await w.enable()).status, 'rejected');
  assert.equal(w.work.length, 0);
});

test('endpoint retirement memory refuses at its bound and a fresh owner requires new observations', async context => {
  const w = await world(context, {musicOnly: true});
  for (let index = 0; index < 64; index += 1) {
    const id = `endpoint-${index}`;
    assert.equal((await w.enable(id)).status, 'accepted');
    assert.equal((await w.disable(id)).status, 'accepted');
  }
  const refused = await w.enable('endpoint-64');
  assert.ok(refused.status === 'rejected'); assert.equal(refused.error.error.code, 'capacity');
  await w.hosted.restart();
  assert.equal((await w.enable('endpoint-65')).status, 'accepted');
  assert.equal(w.hosted.record().availability, 'unavailable'); assert.equal(w.work.length, 0);
});

test('future state evidence cannot install a new process or become an actionable source', async context => {
  const w = await world(context, {musicOnly: true}); await w.enable(); await w.observe();
  const future = sample(w.hosted.clock.now(), 2);
  future.processEpoch = '00000000-0000-4000-8000-000000000572';
  future.interval.latestAtMs += 100;
  future.state = {status: 'observed', value: 'playing', interval: {earliestAtMs: w.hosted.clock.now() + 1, latestAtMs: w.hosted.clock.now() + 2}};
  await w.observe(future);
  assert.equal(w.hosted.record().availability, 'unavailable');
  assert.equal((await w.hosted.send('pause', 'future-state')).status, 'rejected');
  assert.equal(w.work.length, 0); assert.deepEqual(w.hosted.problems(), []);
});

test('a missing read disables controls while retaining definitive late evidence for the original operation', async context => {
  const w = await world(context, {musicOnly: true}); await w.enable(); await w.observe(); w.hold();
  const request = w.hosted.send('next', 'missing-read-late'); await flush(); await w.hosted.advance(4001); await request;
  await w.unavailable(2);
  assert.equal(w.hosted.record().availability, 'unavailable');
  const command = w.work[0]; assert.ok(command); await w.publishResult(command); await flush();
  assert.deepEqual(w.hosted.outcomes().map(outcome => outcome.result), ['uncertain', 'succeeded']);
  assert.equal(w.work.length, 1);
});

test('two refused state commits leave only the last durable mixed-family snapshot', async context => {
  const w = await world(context, {musicOnly: true}); await w.enable(); await w.observe();
  const before = w.positions().at(-1); assert.ok(before); const release = refuseWrites(w.hosted);
  const publish = (sequence: number) => w.producer.publish('bunny.event.music-playback-observation.endpoint-1', {
    kind: 'occurrence', type: 'org.bunny.music-playback.observed', subject: 'endpoint-1', dataschema: schema('music-playback-observation'),
    data: sample(w.hosted.clock.now(), sequence)});
  await Promise.all([publish(2), publish(3)]); await flush();
  const synced = await w.producer.sync(['playback-position'], () => {}, {owner: 'bunny/modules/playback', timeoutMs: 1000});
  assert.equal(synced.status, 'synced');
  if (synced.status === 'synced') {
    assert.deepEqual(synced.copy.states()[0]?.data, before); assert.equal(synced.message.data.revision, before.revision); await synced.copy.close();
  }
  assert.deepEqual(w.positions().at(-1), before); release();
});

class RefusedPublicationBus extends InProcessBus {
  refusing = false;
  override connect(source: string): Participant {
    const inner = super.connect(source);
    if (source !== 'bunny/modules/playback') return inner;
    return {...inner, publishMessage: <T extends object>(key: string, message: Message<T>) => this.refusing
      ? Promise.reject(new SdkError(errorBody('unavailable'))) : inner.publishMessage(key, message)};
  }
}

test('post-commit publication refusal retains the Music snapshot and outcome without repeating the action', async context => {
  let bus: RefusedPublicationBus | undefined;
  const w = await world(context, {musicOnly: true, bus: settings => {bus = new RefusedPublicationBus(settings); return bus;}});
  await w.enable(); assert.ok(bus); bus.refusing = true;
  const publishedBefore = w.hosted.record(); await w.observe();
  assert.equal(w.hosted.record().revision, publishedBefore.revision, 'the refused publication has not reached consumers');
  const synced = await w.producer.sync(['playback', 'playback-position'], () => {}, {owner: 'bunny/modules/playback', timeoutMs: 1000});
  assert.ok(synced.status === 'synced');
  const ordinary = synced.copy.states().find(message => message.dataschema.endsWith('/playback/2.1'));
  assert.ok(ordinary !== undefined && 'revision' in ordinary.data && typeof ordinary.data.revision === 'number');
  const revision = ordinary.data.revision;
  assert.ok(revision > publishedBefore.revision); await synced.copy.close();
  assert.equal((await w.hosted.send('next', 'publication-refused', revision)).status, 'accepted');
  assert.deepEqual(storedCommands(w.hosted), ['publication-refused succeeded']);
  assert.equal(w.work.length, 1); assert.equal(w.hosted.outcomes().length, 0);
  const database = w.hosted.harness.moduleDatabase(); assert.ok(database);
  const waiting = database.prepare('SELECT id FROM bunny_outbox ORDER BY seq').all();
  assert.ok(waiting.length >= 3, 'state, position and outcome remain durable with their original IDs');
  bus.refusing = false; await w.observe(sample(w.hosted.clock.now(), 2));
  for (const row of waiting) assert.equal(w.hosted.published.filter(message => message.id === row.id).length, 1);
  assert.deepEqual(w.hosted.outcomes().map(outcome => outcome.result), ['succeeded']);
  assert.equal(w.work.length, 1); assert.deepEqual(w.hosted.problems(), []);
});
