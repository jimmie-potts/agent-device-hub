// The playback module (Hub #929): the module test kit, the record it publishes, its commands and its speakers' failures.
// The command cases translate the old Hub's route tests in `apps/hub/tests/playback.test.mjs` at main 483d3a93: a command
// is now a `playback-control` request on the bus, answered with a reply and an outcome from the module's outbox.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness, moduleConformance} from '@jimmie-potts/sdk/testing';
import {PLAYBACK_SCHEMA, controlPlayback, createPlaybackModule} from '../src/module.js';
import {SimulatedSpeakers} from '../src/simulated.js';
import {httpSpeakers, type SpeakerTransport} from '../src/transport.js';
import {
  HeldBus, ID, SECTION, START_MS, airplay, fakeSonos, fakeSony, flush, hooked, host, lockDatabase, manualClock, playingInfo, reportsUnavailable, storedCommands, test,
  type Hosted,
} from './support.js';

const playing = (title: string) => ({input: 'airplay', status: 'playing', title, artist: 'Artist'}) as const;

// The kit's checks run on real time. The Move is configured first and is on another input; the HT-A9 plays, so it is
// presented once its first read answers, which start begins without waiting for it (policy A).
moduleConformance({
  create: () => createPlaybackModule({transport: new SimulatedSpeakers({sony: playing('Synthetic song')})}),
  config: SECTION,
  serves: ['playback'],
  accepted: controlPlayback(ID, 'pause'),
  refused: {...controlPlayback(ID, 'pause', 1_000_000), code: 'revision-conflict'},
  offline: {
    create: () => createPlaybackModule({transport: new SimulatedSpeakers({sony: {answering: false}, sonos: {answering: false}})}),
    unavailable: reportsUnavailable,
  },
});

const clean = (hosted: Hosted): void => { assert.deepEqual(hosted.problems(), [], 'every message follows profile 2.0, and nothing of the module failed'); };
const warnings = (hosted: Hosted) => hosted.logs().filter(record => record.level === 'warn').map(record => `${record.event} ${String(record.fields['bunny.device.id'] ?? '')}`);
const outcome = (hosted: Hosted, requestId: string) => hosted.outcomes().filter(data => data.requestId === requestId);
const shown = (hosted: Hosted) => {
  const {playback} = hosted.record();
  return playback.status === 'known' ? playback : undefined;
};
const answer = (result: Awaited<ReturnType<Hosted['send']>>): string => result.status === 'accepted' ? 'accepted' : result.error.error.code;
/** Each published record as `[revision, availability, player]`, with `unknown` for unknown playback. */
const revisions = (hosted: Hosted) => hosted.records().map(({revision, availability, playback}) =>
  [revision, availability, playback.status === 'known' ? playback.player : 'unknown']);
/** When the record at `index` was published, in milliseconds after the start. */
const publishedAt = (hosted: Hosted, index: number): number =>
  Date.parse(hosted.published.filter(message => message.dataschema === PLAYBACK_SCHEMA)[index]?.time ?? '') - START_MS;

test('the presented source is the playback record, with a new revision only when availability or playback changes', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('First song')});
  const hosted = await host(context, speakers);
  assert.deepEqual(hosted.records().map(record => [record.revision, record.availability]), [[1, 'unavailable'], [2, 'available']],
    'each start publishes an unavailable record, then the first read');
  const record = hosted.record();
  assert.deepEqual(record, {
    id: ID, revision: 2, availability: 'available', observedAtMs: record.observedAtMs,
    playback: {status: 'known', player: 'playing', title: 'First song', artist: 'Artist', controls: ['pause', 'next', 'previous']},
  });
  const message = hosted.published.filter(entry => entry.dataschema === PLAYBACK_SCHEMA).at(-1);
  assert.deepEqual([message?.type, message?.subject, message?.kind], ['org.bunny.playback.updated', ID, 'state']);
  await hosted.advance(10_000);
  assert.equal(hosted.records().length, 2, 'unchanged reads publish nothing');
  speakers.pause('sony');
  await hosted.advance(2000);
  assert.deepEqual(hosted.record().playback, {status: 'known', player: 'paused', title: 'First song', artist: 'Artist', controls: ['next', 'previous']});
  assert.equal(hosted.record().revision, 3);
  const text = JSON.stringify(hosted.published);
  assert.ok(!text.includes('192.168.1.') && !text.includes('sony') && !text.includes('sonos'), 'no speaker address and no source name in any message');
  clean(hosted);
});

test('a silent source turns stale after 5 s and unavailable after 30 s, when old titles are withheld', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Old title')});
  // The HT-A9 alone: with the Move answering too, the Move would be presented once the HT-A9 is unavailable.
  const hosted = await host(context, speakers, {section: {id: ID, sources: [SECTION.sources[1]]}});
  const before = hosted.records().length;
  speakers.silent('sony');
  await hosted.advance(6000);
  assert.equal(hosted.record().availability, 'stale');
  assert.equal(answer(await hosted.send('pause', 'r-stale')), 'unavailable', 'a stale speaker takes no command');
  assert.deepEqual(speakers.state().sony.commands, [], 'and hears nothing');
  await hosted.advance(34_000);
  const [stale, unavailable, ...more] = hosted.published.filter(message => message.dataschema === PLAYBACK_SCHEMA).slice(before);
  assert.equal(more.length, 0, 'two new revisions, not one per poll');
  const observedAtMs = hosted.records()[before - 1]?.observedAtMs ?? 0;
  assert.deepEqual(stale?.data, {
    id: ID, revision: 3, availability: 'stale', observedAtMs,
    playback: {status: 'known', player: 'playing', title: 'Old title', artist: 'Artist', controls: ['pause', 'next', 'previous']},
  }, 'a stale record keeps the last playback');
  assert.equal(Date.parse(stale?.time ?? '') - observedAtMs, 5000, 'stale exactly 5 s after the last observation');
  assert.deepEqual(unavailable?.data, {id: ID, revision: 4, availability: 'unavailable', observedAtMs, playback: {status: 'unknown'}},
    'unavailable withholds the old title, and nothing looks paused for lack of evidence');
  assert.equal(Date.parse(unavailable?.time ?? '') - observedAtMs, 30_000, 'unavailable exactly 30 s after the last observation');
  assert.deepEqual(warnings(hosted), [`device.unavailable ${ID}.sony`], 'one degradation for the whole outage, not a warning per poll');
  speakers.answer('sony');
  await hosted.advance(2000);
  assert.deepEqual([hosted.record().availability, hosted.record().revision], ['available', 5], 'the next answer recovers');
  const recoveries = hosted.logs().filter(record => record.event === 'device.available');
  assert.deepEqual(recoveries.map(record => [record.level, record.fields['bunny.device.id']]), [['info', `${ID}.sony`]], 'one recovery');
  assert.ok(Number(recoveries[0]?.fields['bunny.attempt_count']) > 10, 'it counts the failed polls it did not log');
  clean(hosted);
});

test('both speakers offline at start: the module runs, reports unavailable, refuses commands and logs one degradation each', async context => {
  const speakers = new SimulatedSpeakers({sony: {...playing('Song'), answering: false}, sonos: {answering: false}});
  const hosted = await host(context, speakers);
  assert.deepEqual(hosted.records().map(record => [record.revision, record.availability]), [[1, 'unavailable']]);
  await hosted.advance(20_000);
  assert.equal(hosted.records().length, 1, 'nothing changed, so nothing more is published');
  assert.deepEqual(warnings(hosted).sort(), [`device.unavailable ${ID}.sonos`, `device.unavailable ${ID}.sony`]);
  assert.equal(answer(await hosted.send('pause', 'r-offline')), 'unavailable');
  assert.deepEqual([speakers.state().sony.commands, speakers.state().sonos.commands], [[], []], 'a refusal reaches no speaker');
  speakers.answer('sony');
  speakers.answer('sonos');
  await hosted.advance(2000);
  assert.deepEqual([hosted.record().availability, shown(hosted)], ['available', {
    status: 'known', player: 'playing', title: 'Song', artist: 'Artist', controls: ['pause', 'next', 'previous'],
  }]);
  assert.equal(hosted.logs().filter(record => record.event === 'device.available').length, 2, 'one recovery each');
  clean(hosted);
});

test('after a start, the record stays unavailable until every speaker\'s first read settles, so a fast speaker never stands in for a slow one', async context => {
  // The Move, configured first, plays; the HT-A9 is on another input and answers at once. The Move takes 400 ms a call,
  // so its first read, three calls, answers 1.2 s after the start, each call inside its 1.5 s deadline.
  const clock = manualClock();
  const speakers = new SimulatedSpeakers({sonos: playing('Move song')}, {scheduler: clock.scheduler});
  speakers.slow('sonos');
  const hosted = await host(context, speakers, {clock});
  await hosted.advance(1000);
  assert.deepEqual(revisions(hosted), [[1, 'unavailable', 'unknown']], 'the HT-A9 answered, but the record waits for the Move');
  assert.equal(answer(await hosted.send('pause', 'r-early')), 'unavailable', 'a command waits for every speaker too');
  assert.deepEqual([speakers.state().sonos.commands, speakers.state().sony.commands], [[], []], 'and reaches no speaker');
  await hosted.advance(300);
  assert.deepEqual(revisions(hosted), [[1, 'unavailable', 'unknown'], [2, 'available', 'playing']],
    'the first read published is the Move\'s song, never the HT-A9\'s other input');
  assert.equal(publishedAt(hosted, 1), 1200, 'published as the Move\'s first read answered');
  assert.equal(shown(hosted)?.title, 'Move song');
  assert.deepEqual(warnings(hosted), [], 'a slow speaker is not an unavailable one');
  clean(hosted);
});

test('a speaker that never answers at start releases the record at its read deadline, with what the others report', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song'), sonos: {answering: false}});
  const hosted = await host(context, speakers);
  await hosted.advance(1400);
  assert.deepEqual(revisions(hosted), [[1, 'unavailable', 'unknown']], 'the HT-A9 answered at once, but the Move\'s first read is still running');
  await hosted.advance(200);
  assert.deepEqual(revisions(hosted), [[1, 'unavailable', 'unknown'], [2, 'available', 'playing']]);
  assert.equal(publishedAt(hosted, 1), 1500, 'released exactly at the Move\'s 1.5 s read deadline');
  assert.equal(shown(hosted)?.title, 'Sony song');
  assert.deepEqual(warnings(hosted), [`device.unavailable ${ID}.sonos`], 'the Move\'s outage is logged once');
  clean(hosted);
});

test('commands go once to the source presented at admission, and are never redirected', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  const hosted = await host(context, speakers);
  const sent = () => [speakers.state().sonos.commands, speakers.state().sony.commands];
  assert.equal(answer(await hosted.send('next', 'r1')), 'accepted');
  assert.deepEqual(sent(), [[], ['next']], 'Sony alone: the Move answers another input');
  speakers.play('sonos', {title: 'Move song'});
  await hosted.advance(2000);
  assert.equal(shown(hosted)?.title, 'Move song', 'grouped: the Move is configured first');
  assert.equal(answer(await hosted.send('pause', 'r2')), 'accepted');
  assert.deepEqual(sent(), [['pause'], ['next']], 'pause goes to the Move only');
  await hosted.advance(2000);
  assert.deepEqual(shown(hosted)?.controls, ['play', 'next', 'previous']);
  assert.equal(answer(await hosted.send('play', 'r3')), 'accepted');
  assert.deepEqual(sent(), [['pause', 'play'], ['next']], 'play goes to the Move only');
  assert.deepEqual(['r1', 'r2', 'r3'].map(requestId => outcome(hosted, requestId)),
    ['r1', 'r2', 'r3'].map(requestId => [{requestId, result: 'succeeded', evidence: 'transmitted'}]), 'each outcome is reported once, from the outbox');
  // A client read the Move's controls; then the Move switches input and the Sony is presented.
  const read = hosted.record().revision;
  speakers.otherInput('sonos');
  await hosted.advance(2000);
  assert.equal(shown(hosted)?.title, 'Sony song');
  assert.equal(answer(await hosted.send('play', 'r4')), 'unsupported-capability', 'the Sony never offers play');
  assert.equal(answer(await hosted.send('pause', 'r5', read)), 'revision-conflict', 'a client may insist on the record it read');
  assert.deepEqual(sent(), [['pause', 'play'], ['next']], 'a command checked after the presented source changed is not redirected');
  const other = await hosted.requester.request('bunny.cmd.playback-control.kitchen', controlPlayback('kitchen', 'next').draft, {timeoutMs: 5000});
  assert.equal(answer(other), 'unavailable', 'another playback ID has no owner');
  assert.deepEqual(sent(), [['pause', 'play'], ['next']]);
  const logged = hosted.logs().filter(record => record.event === 'command.executing').map(record => [record.fields['bunny.device.id'], record.fields['bunny.request.id']]);
  assert.deepEqual(logged, [[`${ID}.sony`, 'r1'], [`${ID}.sonos`, 'r2'], [`${ID}.sonos`, 'r3']], 'the module records each command that reached a speaker');
  clean(hosted);
});

test('a command in flight stays with its source when another takes over, and its uncertain result is never retried', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song'), sonos: playing('Move song')});
  const hosted = await host(context, speakers);
  speakers.nextCommand('sonos', 'hang');
  const pending = hosted.send('pause', 'r-hang');
  await hosted.advance(500);
  // Meanwhile the Move leaves AirPlay, and its next read presents the Sony while the command still waits for the Move.
  speakers.otherInput('sonos');
  await hosted.advance(2000);
  assert.equal(answer(await pending), 'accepted');
  assert.equal(shown(hosted)?.title, 'Sony song', 'the Sony took over');
  assert.deepEqual(outcome(hosted, 'r-hang'), [{
    requestId: 'r-hang', result: 'uncertain', evidence: 'none',
    error: {code: 'uncertain-result', retryable: false, detail: 'the speaker did not answer the action'},
  }]);
  assert.deepEqual([speakers.state().sonos.commands, speakers.state().sony.commands], [['pause'], []], 'sent once to the Move, never redirected to the Sony');
  assert.equal(answer(await hosted.send('pause', 'r-hang')), 'accepted', 'the same request again is accepted');
  assert.equal(answer(await hosted.send('next', 'r-hang')), 'duplicate-conflict', 'another command under the same requestId is refused');
  await hosted.advance(4000);
  assert.deepEqual([speakers.state().sonos.commands, speakers.state().sony.commands], [['pause'], []], 'and nothing is sent again');
  assert.equal(outcome(hosted, 'r-hang').length, 1, 'its outcome went out once');
  const published = hosted.logs().filter(record => record.event === 'outcome.published').map(record => [record.level, record.fields['bunny.outcome']]);
  assert.deepEqual(published, [['warn', 'uncertain']], 'an uncertain outcome is a warning');
  clean(hosted);
});

test('a speaker that refuses an action reports a failed outcome, with evidence that the command reached it', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  const hosted = await host(context, speakers);
  speakers.nextCommand('sony', 'refuse');
  assert.equal(answer(await hosted.send('previous', 'r-refused')), 'accepted');
  // The speaker answered with a refusal, so the command reached it: evidence `none` would claim nothing did.
  assert.deepEqual(outcome(hosted, 'r-refused'), [{
    requestId: 'r-refused', result: 'failed', evidence: 'transmitted', error: {code: 'invalid-state', retryable: false, detail: 'the speaker refused the action'},
  }]);
  assert.equal(answer(await hosted.send('previous', 'r-again')), 'accepted', 'the next command is answered again');
  assert.deepEqual(outcome(hosted, 'r-again'), [{requestId: 'r-again', result: 'succeeded', evidence: 'transmitted'}]);
  clean(hosted);
});

test('the module stores a command\'s intent before the speaker hears it', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  const heard: string[][] = [];
  let stateDir = '';
  const hosted = await host(context, speakers, {transport: hooked(speakers, () => { heard.push(storedCommands(stateDir)); })});
  stateDir = hosted.stateDir;
  assert.equal(answer(await hosted.send('next', 'r-intent')), 'accepted');
  assert.deepEqual(heard, [['r-intent pending']], 'when the speaker heard next, the module had stored the command without an outcome');
  assert.deepEqual(storedCommands(stateDir), ['r-intent succeeded']);
  clean(hosted);
});

test('the reply comes once the outcome is committed and published, so a requester that hears accepted finds the outcome', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  let held: HeldBus | undefined;
  const hosted = await host(context, speakers, {bus: options => held = new HeldBus(options)});
  const bus = held;
  if (bus === undefined) throw new Error('the host built no bus');
  bus.hold();
  let answered: string | undefined;
  const pending = hosted.send('next', 'r-held').then(result => { answered = answer(result); });
  await hosted.advance(1000);
  assert.deepEqual(speakers.state().sony.commands, ['next'], 'the speaker heard the command');
  assert.equal(answered, undefined, 'no reply while the outcome waits to be published');
  assert.deepEqual(storedCommands(hosted.stateDir), ['r-held succeeded'], 'the outcome is committed');
  bus.release();
  await pending;
  await flush();
  assert.equal(answered, 'accepted');
  assert.equal(outcome(hosted, 'r-held').length, 1);
  clean(hosted);
});

test('stopping during a speaker call ends the call at once, keeps its outcome uncertain and leaves nothing behind', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  const transport = hooked(speakers, () => {});
  const hosted = await host(context, speakers, {transport});
  speakers.nextCommand('sony', 'hang');
  void hosted.send('pause', 'r-stop');
  await hosted.advance(500);
  assert.equal(transport.inFlight(), 1, 'the speaker is still silent on pause');
  const started = performance.now();
  await hosted.stop();
  assert.ok(performance.now() - started < 2000, 'the stop does not wait for the call');
  assert.deepEqual(hosted.harness.failures, [], 'nothing outlasted its stop deadline');
  assert.equal(hosted.harness.pendingTimers(), 0, 'no timer is left');
  await flush();
  assert.equal(transport.inFlight(), 0, 'no call is left');
  assert.deepEqual(storedCommands(hosted.stateDir), ['r-stop uncertain'], 'its outcome is stored as uncertain');
  await hosted.start();
  assert.deepEqual(outcome(hosted, 'r-stop').at(-1), {
    requestId: 'r-stop', result: 'uncertain', evidence: 'none', error: {code: 'uncertain-result', retryable: false, detail: 'the speaker did not answer the action'},
  }, 'and goes out at the next start at the latest');
  assert.deepEqual(speakers.state().sony.commands, ['pause'], 'it was sent once');
  clean(hosted);
});

test('a queued command whose deadline passes while it waits for the read ahead is not sent, and gets a definitive outcome', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  // After the HT-A9 answers a command, its reads never answer, so the next admission waits for the read ahead to time out.
  let silentReads = false;
  const silence = (signal: AbortSignal): Promise<never> => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { reject(new Error('the speaker did not answer')); }, {once: true});
  });
  const transport: SpeakerTransport = {
    sony: async (endpoint, method, version, signal) => {
      if (method === 'getPlayingContentInfo') return silentReads ? silence(signal) : speakers.sony(endpoint, method, version, signal);
      const reply = await speakers.sony(endpoint, method, version, signal);
      silentReads = true;
      return reply;
    },
    sonos: (endpoint, action, args, signal) => speakers.sonos(endpoint, action, args, signal),
  };
  const hosted = await host(context, speakers, {transport});
  const first = hosted.send('next', 'e-1');
  const second = hosted.send('previous', 'e-2', undefined, 1000);
  await hosted.advance(2000);
  assert.deepEqual([answer(await first), answer(await second)], ['accepted', 'uncertain-result'], 'the SDK answered e-2 at its deadline');
  assert.deepEqual(speakers.state().sony.commands, ['next'], 'e-2 reached no speaker after its deadline');
  assert.deepEqual(outcome(hosted, 'e-2'), [{
    requestId: 'e-2', result: 'failed', evidence: 'none',
    error: {code: 'expired', retryable: false, detail: 'the command\'s deadline passed before it reached the speaker'},
  }], 'a definitive outcome follows the uncertain answer');
  assert.deepEqual(storedCommands(hosted.stateDir), ['e-1 succeeded', 'e-2 failed']);
  silentReads = false;
  await hosted.advance(2000);
  assert.equal(answer(await hosted.send('previous', 'e-2', undefined, 1000)), 'accepted', 'the same request again sends nothing');
  assert.deepEqual(speakers.state().sony.commands, ['next']);
  clean(hosted);
});

test('an outcome the database refuses while the module stops is reported uncertain at the next start, and never sent again', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  let release: (() => void) | undefined;
  let stateDir = '';
  const hosted = await host(context, speakers, {transport: hooked(speakers, () => { release ??= lockDatabase(stateDir); })});
  stateDir = hosted.stateDir;
  speakers.nextCommand('sony', 'hang');
  void hosted.send('pause', 'r-locked');
  await hosted.advance(500);
  // The stop ends the call while the database still refuses: the outcome cannot commit, and no retry may be scheduled.
  await hosted.stop();
  assert.deepEqual(hosted.problems(), [], 'no handler, timer or stop of the module failed');
  assert.equal(hosted.harness.pendingTimers(), 0, 'no retry is left behind');
  assert.deepEqual(storedCommands(stateDir), ['r-locked pending'], 'the intent stays without an outcome');
  release?.();
  await hosted.start();
  assert.deepEqual(outcome(hosted, 'r-locked'), [{
    requestId: 'r-locked', result: 'uncertain', evidence: 'none',
    error: {code: 'uncertain-result', retryable: false, detail: 'the module restarted before the speaker answered'},
  }], 'the next start reports it uncertain, once');
  assert.deepEqual(speakers.state().sony.commands, ['pause'], 'and nothing is sent again');
  clean(hosted);
});

const storage = (hosted: Hosted): string[] => hosted.logs().filter(record => record.fields['bunny.operation'] === 'storage')
  .map(record => `${record.level} ${record.event} ${String(record.fields['bunny.code'] ?? record.fields['bunny.outcome'])}`);

test('a command whose intent the database cannot store is refused capacity, with one warning per run of refusals and one recovery', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  const hosted = await host(context, speakers);
  const release = lockDatabase(hosted.stateDir);
  assert.equal(answer(await hosted.send('next', 'r-busy-1')), 'capacity');
  assert.equal(answer(await hosted.send('next', 'r-busy-2')), 'capacity');
  assert.deepEqual(speakers.state().sony.commands, [], 'a refused command reaches no speaker');
  assert.deepEqual(storage(hosted), ['warn operation.failed unavailable'], 'one warning for the run of refusals');
  release();
  assert.equal(answer(await hosted.send('next', 'r-busy-3')), 'accepted');
  assert.deepEqual(speakers.state().sony.commands, ['next']);
  assert.deepEqual(storage(hosted), ['warn operation.failed unavailable', 'info operation.completed succeeded'], 'and one recovery');
  clean(hosted);
});

test('an outcome the database cannot store after the speaker heard the command is committed later, and the module keeps running', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  let release: (() => void) | undefined;
  let stateDir = '';
  // The database refuses commits from the moment the speaker hears the command: the intent is stored, the outcome is not.
  const hosted = await host(context, speakers, {transport: hooked(speakers, () => { release ??= lockDatabase(stateDir); })});
  stateDir = hosted.stateDir;
  assert.equal(answer(await hosted.send('next', 'r-late')), 'accepted', 'the answer never claims the command had no effect');
  assert.deepEqual(outcome(hosted, 'r-late'), [], 'the outcome waits');
  assert.deepEqual(storedCommands(stateDir), ['r-late pending']);
  await hosted.advance(5000);
  assert.deepEqual(storage(hosted), ['warn operation.failed unavailable'], 'one warning while the retries fail');
  release?.();
  await hosted.advance(10_000);
  assert.deepEqual(outcome(hosted, 'r-late'), [{requestId: 'r-late', result: 'succeeded', evidence: 'transmitted'}], 'a retry commits and publishes it');
  assert.deepEqual(storedCommands(stateDir), ['r-late succeeded']);
  assert.deepEqual(storage(hosted), ['warn operation.failed unavailable', 'info operation.completed succeeded']);
  assert.equal(answer(await hosted.send('next', 'r-after')), 'accepted', 'the module keeps running');
  assert.deepEqual(speakers.state().sony.commands, ['next', 'next']);
  clean(hosted);
});

test('a queued command is admitted against what the speaker reports after the command ahead of it', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  const hosted = await host(context, speakers);
  const [first, second] = await Promise.all([hosted.send('pause', 'q-1'), hosted.send('pause', 'q-2')]);
  assert.deepEqual([answer(first), answer(second)], ['accepted', 'unsupported-capability'], 'the HT-A9 paused, so a second pause is not offered');
  assert.deepEqual(speakers.state().sony.commands, ['pause']);
  speakers.otherInput('sony');
  speakers.play('sonos', {title: 'Move song'});
  await hosted.advance(2000);
  const [pause, play] = await Promise.all([hosted.send('pause', 'q-3'), hosted.send('play', 'q-4')]);
  assert.deepEqual([answer(pause), answer(play)], ['accepted', 'accepted'], 'the Move paused, so play is offered');
  assert.deepEqual(speakers.state().sonos.commands, ['pause', 'play']);
  clean(hosted);
});

test('commands run one at a time, each against the source presented at its own admission', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  const hosted = await host(context, speakers);
  speakers.nextCommand('sony', 'hang');
  const first = hosted.send('pause', 'r-first');
  const second = hosted.send('next', 'r-second');
  await hosted.advance(1000);
  assert.deepEqual(speakers.state().sony.commands, ['pause'], 'the second waits while the first is in progress');
  await hosted.advance(1000);
  assert.deepEqual([answer(await first), answer(await second)], ['accepted', 'accepted']);
  assert.deepEqual(speakers.state().sony.commands, ['pause', 'next']);
  assert.deepEqual([outcome(hosted, 'r-first')[0]?.result, outcome(hosted, 'r-second')[0]?.result], ['uncertain', 'succeeded']);
  clean(hosted);
});

test('handled commands stay bounded at 64, and a remembered one is never sent again', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  const hosted = await host(context, speakers);
  for (let index = 0; index < 65; index += 1) assert.equal(answer(await hosted.send('next', `r${index}`)), 'accepted');
  assert.equal(answer(await hosted.send('next', 'r1')), 'accepted');
  assert.equal(speakers.state().sony.commands.length, 65, 'a remembered request is answered without sending it again');
  assert.equal(answer(await hosted.send('next', 'r0')), 'accepted');
  assert.equal(speakers.state().sony.commands.length, 66, 'the oldest of 65 was forgotten');
  clean(hosted);
});

test('a command admitted before a crash is reported uncertain at the next start and never sent again', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  const hosted = await host(context, speakers);
  await hosted.stop();
  // The crash left the stored intent with no outcome: the speaker may have heard it.
  const database = new DatabaseSync(join(hosted.stateDir, 'playback.sqlite'));
  database.prepare('INSERT INTO playback_commands (source, request_id, body) VALUES (?, ?, ?)')
    .run('bunny/parts/operator', 'r-crash', JSON.stringify({action: 'pause', expectedRevision: null}));
  database.close();
  await hosted.start();
  assert.deepEqual(outcome(hosted, 'r-crash'), [{
    requestId: 'r-crash', result: 'uncertain', evidence: 'none',
    error: {code: 'uncertain-result', retryable: false, detail: 'the module restarted before the speaker answered'},
  }]);
  assert.equal(answer(await hosted.send('pause', 'r-crash')), 'accepted');
  assert.deepEqual(speakers.state().sony.commands, [], 'nothing is sent again');
  await hosted.restart();
  assert.equal(outcome(hosted, 'r-crash').length, 2, 'unacknowledged, the outcome goes out again at the next start, unchanged');
  assert.deepEqual(speakers.state().sony.commands, []);
  clean(hosted);
});

test('the revision keeps rising across restarts', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  const hosted = await host(context, speakers);
  await hosted.restart();
  assert.deepEqual(hosted.records().map(record => [record.revision, record.availability]),
    [[1, 'unavailable'], [2, 'available'], [3, 'unavailable'], [4, 'available']]);
  clean(hosted);
});

test('over HTTP, each speaker is polled on its cadence without overlapping reads, and stopping ends the polling', async context => {
  const sony = await fakeSony();
  const sonos = await fakeSonos();
  context.after(async () => { await Promise.all([sony.close(), sonos.close()]); });
  sony.set(async () => {
    await delay(60);
    return playingInfo([airplay()]);
  });
  sonos.state.uri = 'x-rincon-queue:RINCON_000E58FFFFFF01400#0';
  const bus = new InProcessBus();
  const watcher = bus.connect('bunny/parts/watcher');
  const records: unknown[] = [];
  await watcher.subscribe('bunny.state.playback.*', message => { records.push(message.data); });
  const stateDir = await mkdtemp(join(tmpdir(), 'playback-http-'));
  const harness = new ModuleHarness(createPlaybackModule({transport: httpSpeakers(), pollMs: 20, timeoutMs: 1000}), {
    bus, stateDir, section: {id: ID, sources: [{kind: 'sonos', endpoint: sonos.endpoint}, {kind: 'sony', endpoint: sony.endpoint}]},
  });
  context.after(async () => {
    await harness.stop();
    await watcher.close();
    await rm(stateDir, {recursive: true, force: true});
  });
  await harness.start();
  const polled = (): boolean => sony.calls.length >= 3 && sonos.calls.length >= 6 &&
    records.some(record => (record as {availability?: unknown}).availability === 'available');
  for (let waited = 0; !polled() && waited < 10_000; waited += 20) await delay(20);
  assert.ok(sony.calls.length >= 3, 'the Sony is polled again and again');
  assert.ok(sonos.calls.length >= 6, 'the Move is polled again and again');
  assert.equal(sony.peak(), 1, 'Sony reads never overlap');
  assert.equal(sonos.peak(), 1, 'Move calls never overlap');
  assert.ok(records.some(record => (record as {availability?: unknown}).availability === 'available'), 'the record shows the Sony available');
  await harness.stop();
  await flush();
  const calls = sony.calls.length + sonos.calls.length;
  await delay(80);
  assert.equal(sony.calls.length + sonos.calls.length, calls, 'stopping ends the polling');
  assert.deepEqual(harness.failures, []);
});
