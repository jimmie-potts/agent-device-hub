import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {MUSIC_PRODUCER_SOURCE, registerMusicCaptureFamilies, type CaptureFeatures, type CaptureProgress, type CaptureEndpointControl} from '@jimmie-potts/event-contracts/v2/music-capture';
import {connectRemote, InProcessBus, RemoteEdge} from '@jimmie-potts/sdk';
import {NativeCapture, nativeLauncher} from '../src/native.js';
import {MusicProducer} from '../src/producer.js';

void test('real SDK loopback and child pipes deliver only current numeric frames and stop on stream loss', {timeout: 10_000}, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'music-loopback-'));
  const helper = join(directory, 'synthetic-native');
  await writeFile(helper, await readFile(new URL('../../tests/fixtures/native-child.mjs', import.meta.url)), {mode: 0o700});
  const validator = new MessageValidator(); registerMusicCaptureFamilies(validator);
  const errors: unknown[] = [], bus = new InProcessBus({onError: error => {errors.push(error);}});
  const core = bus.connect('bunny/core');
  const edge = new RemoteEdge({bus, validator, grants: [{source: MUSIC_PRODUCER_SOURCE, token: 'synthetic-loopback-credential',
    calls: [], keys: [], publishes: [], endpoint: {respond: ['music-capture-work'],
      publish: ['music-capture-progress', 'music-capture-features'], request: ['music-capture-endpoint']}}]});
  const server = createServer(edge.handle);
  let producer: MusicProducer | undefined;
  context.after(async () => {
    await producer?.stop(); await core.close(); await edge.close(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => {if (error) reject(error); else resolve();}));
    await rm(directory, {recursive: true, force: true});
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address !== null && typeof address !== 'string');
  let endpoint = '';
  await core.respond<CaptureEndpointControl>('bunny.cmd.music-capture-endpoint.*', command => {
    endpoint = command.subject; return {status: 'accepted'};
  });
  const progress: Message<CaptureProgress>[] = [], features: Message<CaptureFeatures>[] = [];
  let onProgress = (_message: Message<CaptureProgress>): void => {}, onFeature = (): void => {};
  await core.subscribe<CaptureProgress>('bunny.event.music-capture-progress.*', message => {progress.push(message); onProgress(message);});
  await core.subscribe<CaptureFeatures>('bunny.event.music-capture-features.*', message => {features.push(message); onFeature();});
  const remote = await connectRemote({url: `http://127.0.0.1:${address.port}`, source: MUSIC_PRODUCER_SOURCE,
    token: 'synthetic-loopback-credential', maxQueued: 8, onError: error => {errors.push(error);}});
  const modes: string[] = [], launch = nativeLauncher(helper);
  producer = new MusicProducer({participant: remote, native: new NativeCapture({helper, launch: mode => {modes.push(mode); return launch(mode);}})});
  await producer.start(); assert.notEqual(endpoint, ''); assert.deepEqual(modes, []);
  const generation = randomUUID();
  const work = (action: 'start' | 'stop', selectedGeneration = generation) => core.request(`bunny.cmd.music-capture-work.${endpoint}`, {
    type: 'org.bunny.music-capture.work.requested', subject: endpoint, dataschema: 'https://bunny.invalid/events/music-capture-work/2.0',
    data: {requestId: randomUUID(), operationId: randomUUID(), generation: selectedGeneration, action, ...(action === 'start' ? {input: 'music'} : {})},
  }, {timeoutMs: 2000});
  const first = new Promise<void>(resolve => {onFeature = resolve;});
  assert.equal((await work('start')).status, 'accepted'); await first;
  assert.deepEqual(modes, ['--clock', '--capture']); assert.equal(progress[0]?.data.status, 'started');
  assert.equal(features[0]?.data.rms, 0.25); assert.equal(features[0]?.data.generation, generation);
  for (const message of [...features, ...progress]) assert.equal(validator.validate(message).ok, true);
  assert.equal(JSON.stringify(features).includes('pcm'), false);
  const stopped = new Promise<void>(resolve => {onProgress = message => {if (message.data.status === 'stopped') resolve();};});
  assert.equal((await work('stop')).status, 'accepted'); await stopped;
  const afterStop = features.length;
  const second = new Promise<void>(resolve => {onFeature = resolve;});
  assert.equal((await work('start', randomUUID())).status, 'accepted'); await second;
  assert.ok(features.length > afterStop); edge.disconnect(MUSIC_PRODUCER_SOURCE);
  assert.deepEqual(await producer.closed, {status: 'stopped'});
  assert.deepEqual(modes, ['--clock', '--capture', '--clock', '--capture']);
  assert.deepEqual(errors, []);
});
