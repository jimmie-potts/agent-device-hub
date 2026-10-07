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
import {httpSpeakers} from '../src/transport.js';
import {ID, SECTION, airplay, fakeSonos, fakeSony, flush, host, playingInfo, reportsUnavailable, test, type Hosted} from './support.js';

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

test('a speaker that refuses an action reports a failed outcome with no evidence of an effect', async context => {
  const speakers = new SimulatedSpeakers({sony: playing('Sony song')});
  const hosted = await host(context, speakers);
  speakers.nextCommand('sony', 'refuse');
  assert.equal(answer(await hosted.send('previous', 'r-refused')), 'accepted');
  assert.deepEqual(outcome(hosted, 'r-refused'), [{
    requestId: 'r-refused', result: 'failed', evidence: 'none', error: {code: 'invalid-state', retryable: false, detail: 'the speaker refused the action'},
  }]);
  assert.equal(answer(await hosted.send('previous', 'r-again')), 'accepted', 'the next command is answered again');
  assert.deepEqual(outcome(hosted, 'r-again'), [{requestId: 'r-again', result: 'succeeded', evidence: 'transmitted'}]);
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
  const harness = new ModuleHarness(createPlaybackModule({transport: httpSpeakers(), pollMs: 20, timeoutMs: 200}), {
    bus, stateDir, section: {id: ID, sources: [{kind: 'sonos', endpoint: sonos.endpoint}, {kind: 'sony', endpoint: sony.endpoint}]},
  });
  context.after(async () => {
    await harness.stop();
    await watcher.close();
    await rm(stateDir, {recursive: true, force: true});
  });
  await harness.start();
  await delay(300);
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
