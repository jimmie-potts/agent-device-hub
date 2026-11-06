import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {copyFile, chmod, mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {MUSIC_PLAYBACK_OWNER, MUSIC_PLAYBACK_SOURCE, registerMusicPlaybackFamilies, type MusicPlaybackEndpoint,
  type MusicPlaybackObservation, type MusicPlaybackResult} from '@jimmie-potts/event-contracts/v2/music-playback';
import {connectRemote, InProcessBus, RemoteEdge} from '@jimmie-potts/sdk';
import {MusicPlaybackNative, playbackLauncher} from '../src/playback-native.js';
import {MusicPlaybackProducer} from '../src/playback-producer.js';

void test('real playback SDK endpoint and synthetic child carry qualified observations and one pinned control', {timeout: 10_000}, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'music-playback-loopback-')), helper = join(directory, 'synthetic-native');
  await copyFile(new URL('../../tests/fixtures/playback-child.mjs', import.meta.url), helper); await chmod(helper, 0o700);
  const validator = new MessageValidator(); registerMusicPlaybackFamilies(validator);
  const errors: unknown[] = [], bus = new InProcessBus({onError: error => {errors.push(error);}}), owner = bus.connect(MUSIC_PLAYBACK_OWNER);
  const edge = new RemoteEdge({bus, validator, grants: [{source: MUSIC_PLAYBACK_SOURCE, token: 'synthetic-playback-credential',
    calls: [], keys: [], publishes: [], endpoint: {respond: ['music-playback-work'],
      publish: ['music-playback-observation', 'music-playback-result'], request: ['music-playback-endpoint']}}]});
  const server = createServer(edge.handle); let producer: MusicPlaybackProducer | undefined;
  context.after(async () => {
    await producer?.stop(); await owner.close(); await edge.close(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => {if (error) reject(error); else resolve();}));
    await rm(directory, {recursive: true, force: true});
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address !== null && typeof address !== 'string');
  let endpoint = '', registration = false;
  await owner.respond<MusicPlaybackEndpoint>('bunny.cmd.music-playback-endpoint.*', command => {
    endpoint = command.subject; registration = true; return {status: 'accepted'};
  });
  let observed: (message: Message<MusicPlaybackObservation>) => void = () => {};
  const first = new Promise<Message<MusicPlaybackObservation>>(resolve => {observed = resolve;});
  await owner.subscribe<MusicPlaybackObservation>('bunny.event.music-playback-observation.*', message => observed(message));
  const results: Message<MusicPlaybackResult>[] = []; let completed = () => {};
  const resultSeen = new Promise<void>(resolve => {completed = resolve;});
  await owner.subscribe<MusicPlaybackResult>('bunny.event.music-playback-result.*', message => {results.push(message); completed();});
  const remote = await connectRemote({url: `http://127.0.0.1:${address.port}`, source: MUSIC_PLAYBACK_SOURCE,
    token: 'synthetic-playback-credential', maxQueued: 8, onError: error => {errors.push(error);}});
  const launches: string[] = [], launch = playbackLauncher(helper);
  producer = new MusicPlaybackProducer({participant: remote, libraryScopeId: 'synthetic-library', native: new MusicPlaybackNative({helper,
    launch: request => {assert.equal(registration, true); launches.push(request.mode); return launch(request);}})});
  assert.deepEqual(launches, []); await producer.start(); const observation = await first;
  assert.equal(validator.validate(observation).ok, true); assert.ok(observation.data.status === 'sample');
  assert.equal(JSON.stringify(observation).includes('sourceInstance'), false);
  assert.equal(JSON.stringify(observation).includes('startedMonotonicMs'), false);
  const answer = await owner.request(`bunny.cmd.music-playback-work.${endpoint}`, {type: 'org.bunny.music-playback.work.requested',
    subject: endpoint, dataschema: 'https://bunny.invalid/events/music-playback-work/2.0', data: {requestId: randomUUID(), operationId: randomUUID(),
      processEpoch: observation.data.processEpoch, action: 'pause'}}, {timeoutMs: 2000});
  assert.equal(answer.status, 'accepted'); await resultSeen;
  assert.equal(results.length, 1); assert.equal(results[0]?.data.status, 'sent'); assert.equal(validator.validate(results[0]).ok, true);
  assert.equal(launches.filter(mode => mode === 'control').length, 1);
  edge.disconnect(MUSIC_PLAYBACK_SOURCE); assert.deepEqual(await producer.closed, {status: 'stopped'});
  const count = launches.length; await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(launches.length, count);
  assert.deepEqual(errors, []);
});
