import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {
  MUSIC_PRODUCER_SOURCE, type CaptureEndpointControl, type CaptureFeatures, type CaptureLost, type CaptureProgress, type CaptureWork,
} from '@jimmie-potts/event-contracts/v2/music-capture';
import {connectRemote, prepareMessage, REMOTE_SCHEMA, SdkError, type Command, type Reply} from '@jimmie-potts/sdk';
import {CREDENTIALS_SCHEMA, revokeCredential, tokenDigest} from '../src/credentials.js';
import {contextOf, deferred, edgeConfig, fixture, flush, it, run, waitFor} from './support.js';

const TOKEN = 'tok_SYNTHETIC721_music_producer';
const ORDINARY_TOKEN = 'tok_SYNTHETIC721_ordinary';
const ORDINARY_SOURCE = 'bunny/parts/gateway-test';
const GENERATION = '00000000-0000-4000-8000-000000000721';
const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;
const schema = (family: string): string => `https://bunny.invalid/events/${family}/2.0`;
const progress = () => ({
  kind: 'occurrence' as const, type: 'org.bunny.music-capture.progress.observed', dataschema: schema('music-capture-progress'),
  data: {operationId: 'capture-operation', generation: GENERATION, status: 'started' as const} satisfies CaptureProgress,
});
const enable = () => ({
  type: 'org.bunny.music-capture.endpoint.requested', dataschema: schema('music-capture-endpoint'),
  data: {requestId: 'capture-enable', action: 'enable' as const, input: 'music' as const} satisfies CaptureEndpointControl,
});
function features(): CaptureFeatures {
  const observedAtMs = Date.now();
  return {
    generation: GENERATION, input: 'music', sequence: 1, sampleRateHz: 48_000, channels: 2, frameCount: 4800,
    startMonotonicMs: 1000, endMonotonicMs: 1100, emittedMonotonicMs: 1102, observedAtMs, validUntilMs: observedAtMs + 400,
    rms: 0.1, peak: 0.4, clippedFraction: 0, bands: {bass: 0.1, mid: 0.05, treble: 0.02},
    onset: {strength: 0.3, confidence: 0.5}, discontinuity: false,
  };
}

async function world(context: TestContext) {
  const controls: Command<CaptureEndpointControl>[] = [], receivedProgress: Message<CaptureProgress>[] = [];
  const receivedFeatures: Message<CaptureFeatures>[] = [], lost: Message<CaptureLost>[] = [];
  const deviceCommands: Command<object>[] = [];
  // This fixture tests gateway admission, not the capture owner's session lifecycle.
  const core = fixture('core', async ({sdk}) => {
    await sdk.respond<CaptureEndpointControl>('bunny.cmd.music-capture-endpoint.*', command => {
      controls.push(command); return {status: 'accepted'};
    });
    await sdk.subscribe<CaptureProgress>('bunny.event.music-capture-progress.*', message => {receivedProgress.push(message);});
    await sdk.subscribe<CaptureFeatures>('bunny.event.music-capture-features.*', message => {receivedFeatures.push(message);});
    await sdk.subscribe<CaptureLost>('bunny.event.music-capture-lost.*', message => {lost.push(message);});
    await sdk.respond('bunny.cmd.power-set.synthetic-device', command => {deviceCommands.push(command); return {status: 'accepted'};});
  });
  const files = await edgeConfig(context, [], {credentials: JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: [
    {id: 'music-producer', source: MUSIC_PRODUCER_SOURCE, digest: tokenDigest(TOKEN), scopes: [], role: 'music-producer'},
    {id: 'ordinary', source: ORDINARY_SOURCE, digest: tokenDigest(ORDINARY_TOKEN), scopes: ['read', 'control', 'ingest', 'admin']},
  ]})});
  const {runtime, logs} = await run(context, {modules: [core], configFile: files.config, edge: {schemas: {}}});
  const sdk = contextOf(core).sdk;
  const producer = await connectRemote({url: runtime.url, source: MUSIC_PRODUCER_SOURCE, token: TOKEN});
  context.after(() => producer.close());
  const work = (id: string) => sdk.request(`bunny.cmd.music-capture-work.${id}`, {
    type: 'org.bunny.music-capture.work.requested', subject: id, dataschema: schema('music-capture-work'),
    data: {requestId: 'capture-start', operationId: 'capture-operation', generation: GENERATION, action: 'start', input: 'music'} satisfies CaptureWork,
  }, {timeoutMs: 1000, requestId: 'capture-start'});
  return {runtime, logs, files, producer, controls, receivedProgress, receivedFeatures, lost, deviceCommands, work};
}

async function call(url: string, path: string, body?: object) {
  const response = await fetch(new URL(path, url), {
    method: body === undefined ? 'GET' : 'POST', headers: {authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const answer: unknown = await response.json();
  return {status: response.status, body: answer};
}

async function rawStream(context: TestContext, url: string): Promise<{connection: string; endpoint: string}> {
  const response = await fetch(new URL('/api/sdk/v1/stream', url), {headers: {authorization: `Bearer ${TOKEN}`}});
  assert.equal(response.status, 200); assert.ok(response.body);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  context.after(() => reader.cancel());
  let text = '';
  for (;;) {
    const {value, done} = await reader.read(); assert.equal(done, false);
    text += decoder.decode(value, {stream: true});
    const ready = /event: ready\ndata: (.*)\n\n/.exec(text)?.[1];
    if (ready === undefined) continue;
    const frame: unknown = JSON.parse(ready);
    assert.ok(typeof frame === 'object' && frame !== null && 'connection' in frame && 'endpointCapability' in frame);
    assert.equal(typeof frame.connection, 'string'); assert.equal(typeof frame.endpointCapability, 'string');
    if (typeof frame.connection !== 'string' || typeof frame.endpointCapability !== 'string') throw new Error('invalid ready frame');
    return {connection: frame.connection, endpoint: frame.endpointCapability};
  }
}

it('a Music producer advertises Music, answers work and publishes derived features through its one gateway endpoint', async context => {
  const g = await world(context), commands: Command<CaptureWork>[] = [];
  const endpoint = await g.producer.openEndpoint<CaptureWork>({family: 'music-capture-work', respond: command => {
    commands.push(command); return {status: 'accepted'};
  }});
  await assert.rejects(g.producer.openEndpoint({family: 'music-capture-work', respond: () => ({status: 'accepted'})}), refused('invalid-state'));
  assert.equal((await endpoint.request('music-capture-endpoint', enable(), {timeoutMs: 1000, requestId: 'capture-enable'})).status, 'accepted');
  assert.deepEqual(g.controls.map(({source, subject, data}) => ({source, subject, data})), [
    {source: MUSIC_PRODUCER_SOURCE, subject: endpoint.id, data: enable().data},
  ]);
  assert.equal((await g.work(endpoint.id)).status, 'accepted');
  const command = commands[0]; assert.ok(command);
  assert.equal(command.source, 'bunny/core'); assert.equal(command.subject, endpoint.id);
  assert.deepEqual(command.data, {requestId: 'capture-start', operationId: 'capture-operation', generation: GENERATION, action: 'start', input: 'music'});
  await endpoint.publish('music-capture-progress', progress(), {parent: command});
  const data = features();
  await endpoint.publish('music-capture-features', {
    kind: 'occurrence', type: 'org.bunny.music-capture.features.observed', dataschema: schema('music-capture-features'), data,
  }, {parent: command});
  await waitFor(() => g.receivedProgress.length === 1 && g.receivedFeatures.length === 1);
  assert.deepEqual(g.receivedProgress.map(({source, subject, data}) => ({source, subject, data})), [
    {source: MUSIC_PRODUCER_SOURCE, subject: endpoint.id, data: progress().data},
  ]);
  assert.deepEqual(g.receivedFeatures.map(({source, subject, data}) => ({source, subject, data})), [
    {source: MUSIC_PRODUCER_SOURCE, subject: endpoint.id, data},
  ]);
  assert.equal(JSON.stringify({controls: g.controls, progress: g.receivedProgress, features: g.receivedFeatures, logs: g.logs}).includes(TOKEN), false);
});

it('the Music producer credential grants no general reads, device commands or other endpoint families', async context => {
  const g = await world(context);
  for (const path of ['/api/v2/modules', '/api/v2/families/session', '/api/v2/snapshot?families=session']) {
    const answer = await call(g.runtime.url, path);
    assert.equal(answer.status, 403, path); assert.partialDeepStrictEqual(answer.body, {error: {code: 'forbidden'}});
  }
  const device = await call(g.runtime.url, '/api/v2/commands/power-set', {target: 'synthetic-device', requestId: 'forbidden-power', data: {on: true}});
  assert.equal(device.status, 403); assert.partialDeepStrictEqual(device.body, {error: {code: 'forbidden'}});
  await assert.rejects(g.producer.subscribe('bunny.state.session.*', () => {}), refused('forbidden'));
  await assert.rejects(g.producer.sync(['session'], () => {}, {timeoutMs: 1000}), refused('forbidden'));
  await assert.rejects(g.producer.respond('bunny.cmd.music-capture-work.*', () => ({status: 'accepted'})), refused('forbidden'));
  const endpoint = await g.producer.openEndpoint({family: 'music-capture-work', respond: () => ({status: 'accepted'})});
  await assert.rejects(g.producer.publish(`bunny.event.music-capture-progress.${endpoint.id}`, {...progress(), subject: endpoint.id}), refused('forbidden'));
  for (const family of ['coding-progress', 'companion-speech-playback', 'music-capture-lost']) {
    await assert.rejects(endpoint.publish(family, progress()), refused('forbidden'));
  }
  const power = {type: 'org.bunny.power.set.requested', dataschema: schema('power-set'), data: {requestId: 'forbidden-power', on: true}};
  const direct = await g.producer.request('bunny.cmd.power-set.synthetic-device', {...power, subject: 'synthetic-device'}, {timeoutMs: 1000});
  assert.equal(direct.status, 'rejected'); if (direct.status === 'rejected') assert.equal(direct.error.error.code, 'forbidden');
  const other = await endpoint.request('power-set', power, {timeoutMs: 1000});
  assert.equal(other.status, 'rejected'); if (other.status === 'rejected') assert.equal(other.error.error.code, 'forbidden');
  const ordinary = await connectRemote({url: g.runtime.url, source: ORDINARY_SOURCE, token: ORDINARY_TOKEN});
  context.after(() => ordinary.close());
  await assert.rejects(ordinary.openEndpoint({family: 'music-capture-work', respond: () => ({status: 'accepted'})}), refused('forbidden'));
  await assert.rejects(connectRemote({url: g.runtime.url, source: ORDINARY_SOURCE, token: TOKEN}), refused('forbidden'));
  assert.deepEqual([g.controls, g.receivedProgress, g.receivedFeatures, g.lost, g.deviceCommands], [[], [], [], [], []]);
});

it('Music endpoint calls cannot spoof a source, subject, stream capability or another endpoint identity over HTTP', async context => {
  const g = await world(context), first = await rawStream(context, g.runtime.url), second = await rawStream(context, g.runtime.url);
  const id = `${first.connection}-1`, otherId = `${second.connection}-1`;
  const post = (route: string, body: object) => call(g.runtime.url, `/api/sdk/v1/${route}`, {schema: REMOTE_SCHEMA, ...body});
  const register = {id, pattern: `bunny.cmd.music-capture-work.${id}`};
  for (const binding of [{connection: first.connection}, {...first, endpoint: second.endpoint}, {...second, endpoint: first.endpoint}, second]) {
    assert.equal((await post('respond', {...binding, ...register})).status, 403);
  }
  for (const family of ['coding-work', 'companion-speech-output', 'power-set']) {
    assert.equal((await post('respond', {...first, id, pattern: `bunny.cmd.${family}.${id}`})).status, 403);
  }
  assert.equal((await post('respond', {...first, id, pattern: 'bunny.cmd.music-capture-work.*'})).status, 403);
  assert.equal((await post('respond', {...first, ...register})).status, 200);
  assert.equal((await post('respond', {...first, id: `${first.connection}-2`, pattern: `bunny.cmd.music-capture-work.${first.connection}-2`})).status, 409);
  assert.equal((await post('respond', {...second, id: otherId, pattern: `bunny.cmd.music-capture-work.${otherId}`})).status, 200);
  const message = prepareMessage(MUSIC_PRODUCER_SOURCE, {...progress(), subject: id});
  const publication = {key: `bunny.event.music-capture-progress.${id}`, message};
  for (const binding of [{connection: first.connection}, {...first, endpoint: second.endpoint}, second]) {
    assert.equal((await post('publish', {...binding, ...publication})).status, 403);
  }
  assert.equal((await post('publish', {...first, ...publication, message: {...message, source: 'bunny/core'}})).status, 403);
  const wrongSubject = await post('publish', {...first, ...publication, message: {...message, subject: otherId}});
  assert.equal(wrongSubject.status, 400); assert.partialDeepStrictEqual(wrongSubject.body, {error: {code: 'invalid-message'}});
  assert.equal((await post('publish', {...first, ...publication, key: `bunny.event.music-capture-progress.${otherId}`})).status, 403);
  const forgedLoss = prepareMessage(MUSIC_PRODUCER_SOURCE, {
    kind: 'occurrence', type: 'org.bunny.music-capture.endpoint-lost', subject: id, dataschema: schema('music-capture-lost'), data: {id},
  });
  assert.equal((await post('publish', {...first, ...publication, message: forgedLoss})).status, 403);
  assert.equal((await post('publish', {...first, ...publication})).status, 200);
  assert.equal((await post('close', {...second, id})).status, 403);
  assert.equal((await post('close', {connection: first.connection, id})).status, 403);
  await waitFor(() => g.receivedProgress.length === 1);
  assert.deepEqual(g.receivedProgress.map(({source, subject}) => ({source, subject})), [{source: MUSIC_PRODUCER_SOURCE, subject: id}]);
  assert.equal(g.lost.length, 0);
  assert.equal((await post('close', {...first, id})).status, 200);
  await waitFor(() => g.lost.length === 1);
  assert.equal((await post('respond', {...first, ...register})).status, 403, 'a retired endpoint identity cannot be registered again');
  assert.equal((await post('publish', {...first, ...publication})).status, 403);
  assert.deepEqual(g.lost.map(({source, subject, data}) => ({source, subject, data})), [
    {source: 'bunny/runtime/gateway', subject: id, data: {id}},
  ]);
  for (const secret of [TOKEN, first.endpoint, second.endpoint]) {
    assert.equal(JSON.stringify({progress: g.receivedProgress, lost: g.lost, logs: g.logs}).includes(secret), false);
  }
});

it('another Music connection cannot forge the active endpoint reply to a work command', async context => {
  const g = await world(context), alternate = await rawStream(context, g.runtime.url), held = deferred<Reply>();
  const alternateId = `${alternate.connection}-1`;
  assert.equal((await call(g.runtime.url, '/api/sdk/v1/respond', {schema: REMOTE_SCHEMA, ...alternate,
    id: alternateId, pattern: `bunny.cmd.music-capture-work.${alternateId}`})).status, 200);
  let received: Command<CaptureWork> | undefined, settled = false;
  const endpoint = await g.producer.openEndpoint<CaptureWork>({family: 'music-capture-work', respond: command => {
    received = command; return held.promise;
  }});
  const pending = g.work(endpoint.id).then(answer => {settled = true; return answer;});
  try {
    await waitFor(() => received !== undefined);
    assert.ok(received);
    const answer = await call(g.runtime.url, '/api/sdk/v1/reply', {schema: REMOTE_SCHEMA, ...alternate,
      responder: endpoint.id, command: received.id, requestId: received.data.requestId, reply: {status: 'accepted'}});
    assert.equal(answer.status, 403); assert.partialDeepStrictEqual(answer.body, {error: {code: 'forbidden'}});
    assert.equal(settled, false, 'a reply from another connection cannot settle the work');
  } finally {held.resolve({status: 'accepted'});}
  assert.equal((await pending).status, 'accepted');
});

for (const reason of ['close', 'disconnect', 'revocation'] as const) {
  it(`Music endpoint ${reason} emits a runtime-owned loss and retires the producer handle`, async context => {
    const g = await world(context); let closed = 0, commands = 0;
    const endpoint = await g.producer.openEndpoint({family: 'music-capture-work', respond: () => {commands++; return {status: 'accepted'};}, onClosed: () => {closed++;}});
    assert.equal((await endpoint.request('music-capture-endpoint', enable(), {timeoutMs: 1000})).status, 'accepted');
    if (reason === 'close') await endpoint.close();
    else if (reason === 'disconnect') await g.producer.close();
    else {
      assert.equal(await revokeCredential(g.files.credentials, 'music-producer'), true);
      await g.runtime.reload();
      assert.equal((await call(g.runtime.url, '/api/sdk/v1/stream')).status, 401);
    }
    await waitFor(() => g.lost.length === 1 && closed === 1);
    assert.deepEqual(g.lost.map(({kind, type, dataschema, source, subject, data}) => ({kind, type, dataschema, source, subject, data})), [{
      kind: 'occurrence', type: 'org.bunny.music-capture.endpoint-lost', dataschema: schema('music-capture-lost'),
      source: 'bunny/runtime/gateway', subject: endpoint.id, data: {id: endpoint.id},
    }]);
    await assert.rejects(endpoint.publish('music-capture-progress', progress()), refused('unavailable'));
    assert.equal((await g.work(endpoint.id)).status, 'rejected');
    await endpoint.close(); await flush();
    assert.equal(commands, 0); assert.equal(closed, 1); assert.equal(g.lost.length, 1);
    assert.equal(JSON.stringify({lost: g.lost, logs: g.logs}).includes(TOKEN), false);
  });
}
