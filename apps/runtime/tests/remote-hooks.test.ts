import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {request as httpRequest} from 'node:http';
import {createServer} from 'node:https';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable, type Duplex} from 'node:stream';
import type {TestContext} from 'node:test';
import {getCACertificates, setDefaultCACertificates} from 'node:tls';
import {fileURLToPath} from 'node:url';
import {normalizeHook, type SourceConfiguration} from '@jimmie-potts/agent-state/providers';
import {DESKTOP_METADATA_SCHEMA, desktopFeedId, sessionEntityId, type DesktopFeed, type DesktopMetadataSnapshot, type LifecycleObservation, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {prepareMessage, publishOnce, traceFields} from '@jimmie-potts/sdk';
import {lifecycleMessage, observationOf, producerCredentialId, producerSource, runHook} from '../src/hook/index.js';
import {createCoreModule, revokeCredential, tokenDigest} from '../src/index.js';
import {edgeConfig, fixture, it, run, waitFor} from './support.js';

const HOOK = fileURLToPath(new URL('../../bin/monitor-hook.mjs', import.meta.url));
const CODEX_HOOK = fileURLToPath(new URL('../../bin/mac-codex-hook.mjs', import.meta.url));
const PROOF = 'private_SYNTHETIC566_abcdefghijklmnopqrstuvwxyz0123456789';
const CANARY = 'private_SYNTHETIC566_prompt_and_tool_content';
const sources: SourceConfiguration[] = ['pc-sim', 'mac-sim'].flatMap(hostId => [
  {provider: 'claude', client: 'code', hostId, sourceId: 'claude-code-hooks', hook: 'SessionStart'},
  {provider: 'codex', client: 'local', hostId, sourceId: 'codex-local-hooks', hook: 'SessionStart'},
]);

async function tlsEntry(context: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'remote-hook-')));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const key = join(directory, 'key.pem'), cert = join(directory, 'certificate.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-subj', '/CN=synthetic-hook', '-addext', 'subjectAltName=IP:127.0.0.1', '-days', '1'], {stdio: 'ignore'});
  const originalTrust = getCACertificates('default');
  setDefaultCACertificates([...originalTrust, await readFile(cert, 'utf8')]);
  context.after(() => setDefaultCACertificates(originalTrust));
  let upstream = '';
  let dropped = false;
  const calls: string[] = [];
  const sockets = new Set<Duplex>();
  const server = createServer({key: await readFile(key), cert: await readFile(cert)}, (request, response) => {
    let text = '';
    request.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; }).once('end', () => {
      calls.push(text);
      if (dropped) return;
      const forwarded = httpRequest(upstream + (request.url ?? ''), {method: request.method, headers: {
        ...request.headers, host: new URL(url).host, 'bunny-private-proxy': PROOF,
      }}, incoming => {
        response.writeHead(incoming.statusCode ?? 500, incoming.headers);
        incoming.pipe(response);
      });
      forwarded.on('error', () => { response.destroy(); });
      forwarded.end(text);
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  const url = `https://127.0.0.1:${address.port}`;
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    server.close(); await once(server, 'close');
  });
  return {directory, cert, url, calls, forwardTo: (value: string) => { upstream = value; }, drop: () => { dropped = true; }};
}

async function producerFile(directory: string, url: string, configuration: SourceConfiguration, token: string): Promise<string> {
  await mkdir(directory, {mode: 0o700});
  const endpoint = url + '/api/monitor/v1/events';
  const producer = {enabled: true, qualified: true, source: configuration, token, endpoint, transport: 'private-https'};
  const path = join(directory, 'producer.json');
  await writeFile(path, JSON.stringify(producer), {mode: 0o600});
  await writeFile(join(directory, 'receipt.json'), JSON.stringify({version: 1, state: 'installed', token,
    input: {directory, source: configuration, endpoint, qualified: true, transport: 'private-https'}}), {mode: 0o600});
  return path;
}

function observation(source: SourceConfiguration, hook = 'SessionStart'): LifecycleObservation {
  const envelope = normalizeHook({hook_event_name: hook, source: 'startup', session_id: 'same-session-id', turn_id: 'same-turn-id',
    prompt_id: 'same-turn-id', prompt: CANARY, tool_input: CANARY, tool_response: CANARY}, {...source, hook}, Date.now());
  assert.ok(envelope);
  const value = observationOf(envelope);
  assert.ok(value);
  return value;
}

async function invokeHook(context: TestContext, script: string, producer: string, certificate: string) {
  const started = performance.now();
  const child = spawn(process.execPath, [script, producer], {env: {...process.env, NODE_EXTRA_CA_CERTS: certificate}, stdio: ['pipe', 'pipe', 'pipe']});
  const bound = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
  context.after(() => { clearTimeout(bound); if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stdin.end(JSON.stringify({hook_event_name: 'SessionStart', source: 'startup', session_id: 'same-session-id', prompt: CANARY}));
  const result = await once(child, 'exit');
  clearTimeout(bound);
  assert.deepEqual(result, [0, null]);
  assert.equal(output, '');
  return performance.now() - started;
}

it('a granted legacy local producer keeps its complete source configuration identity', async context => {
  const source = sources[0]; assert.ok(source);
  const legacy = {...source, description: 'synthetic legacy extension'};
  const token = randomBytes(32).toString('base64url');
  const reader = randomBytes(32).toString('base64url');
  const files = await edgeConfig(context, [
    {id: producerCredentialId(legacy), source: producerSource(legacy), token, scopes: ['ingest']},
    {source: 'bunny/parts/reader', token: reader, scopes: ['read']},
  ]);
  const {runtime} = await run(context, {modules: [createCoreModule()], configFile: files.config, edge: {schemas: {}}});
  const producer = join(files.dir, 'producer.json');
  await writeFile(producer, JSON.stringify({enabled: true, qualified: true, source: legacy, token,
    endpoint: runtime.url + '/api/monitor/v1/events'}), {mode: 0o600});
  const result = await runHook({producer, deadline: performance.now() + 2900,
    input: Readable.from([Buffer.from(JSON.stringify({hook_event_name: 'SessionStart', session_id: 'legacy-session'}))])});
  assert.equal(result.status, 'published', 'released local configuration extensions must retain their granted source');
  await waitFor(async () => {
    const response = await fetch(runtime.url + '/api/v2/families/session', {headers: {authorization: 'Bearer ' + reader}});
    assert.equal(response.status, 200);
    const {records} = await response.json() as {records: SessionRecord[]};
    return records.length === 1 && records[0]?.identity.hostId === legacy.hostId;
  });
});

it('a private-ingress producer token cannot impersonate another host or provider inside its lifecycle payload', async context => {
  const entry = await tlsEntry(context);
  const source = sources[0];
  assert.ok(source);
  const token = randomBytes(32).toString('base64url');
  const files = await edgeConfig(context, [{id: producerCredentialId(source), source: producerSource(source), token, scopes: ['ingest']}]);
  await writeFile(files.config, JSON.stringify({schema: 'runtime-config/1.0', modules: {}, edge: {
    credentials: files.credentials, privateProxy: {origin: entry.url, tokenDigest: tokenDigest(PROOF)},
  }}), {mode: 0o600});
  const {runtime, logs} = await run(context, {modules: [createCoreModule()], configFile: files.config, edge: {schemas: {}}});
  entry.forwardTo(runtime.url);
  let lastTrace: string | undefined;
  const send = async (value: LifecycleObservation, sender = producerSource(source)) => {
    const {key, draft} = lifecycleMessage(value);
    const message = prepareMessage(sender, draft);
    lastTrace = traceFields(message)?.traceId;
    const result = await publishOnce({url: entry.url, source: sender, token, timeoutMs: 2000}, key, message);
    if (result.status === 'rejected') assert.equal(result.error.error.traceId, lastTrace, 'the publisher retains its own prepared-message correlation');
    return result;
  };
  const codex = sources[1]; assert.ok(codex);
  for (const other of [...sources.slice(1), {...source, sourceId: 'other-feed'}, {...codex, client: 'cli' as const}]) {
    const refused = await send(observation(other));
    assert.equal(refused.status, 'rejected', 'a valid producer must not publish another feed identity');
    if (refused.status === 'rejected') assert.equal(refused.error.error.code, 'forbidden');
  }
  const spoofedHeader = await send(observation(source), 'bunny/modules/codex-desktop');
  assert.equal(spoofedHeader.status, 'rejected');
  assert.equal(logs.filter(record => record.event_name === 'message.received').length, 0, 'refusal precedes core intake');
  const refused = logs.find(record => record.event_name === 'runtime.edge.refused' && record.attributes['bunny.code'] === 'forbidden');
  assert.ok(refused);
  assert.equal(refused.attributes['bunny.participant'], producerSource(source));
  assert.equal(refused.attributes['bunny.route'], 'publish');
  assert.equal(refused.trace_id, undefined, 'the established edge refusal record does not claim message trace correlation');
  assert.equal(refused.span_id, undefined);
  assert.deepEqual(await send(observation(source)), {status: 'published'}, 'the same credential retains its own feed');
  await waitFor(() => logs.some(record => record.event_name === 'message.received' && record.attributes['bunny.outcome'] === 'accepted' && record.trace_id === lastTrace));
});

it('four qualified HTTPS host/provider hooks stay independent, deduplicate and refuse revocation without content leakage', async context => {
  const entry = await tlsEntry(context);
  const tokens = sources.map(() => randomBytes(32).toString('base64url'));
  const reader = randomBytes(32).toString('base64url');
  const grants = sources.map((source, index) => ({id: producerCredentialId(source), source: producerSource(source), token: tokens[index] ?? '', scopes: ['ingest'] as const}));
  const files = await edgeConfig(context, [...grants, {source: 'bunny/parts/reader', token: reader, scopes: ['read']}]);
  await writeFile(files.config, JSON.stringify({schema: 'runtime-config/1.0', modules: {}, edge: {
    credentials: files.credentials, browserAccess: 'trusted-loopback', launcher: false, mcp: true,
    privateProxy: {origin: entry.url, tokenDigest: tokenDigest(PROOF)},
  }}), {mode: 0o600});
  const {runtime, logs} = await run(context, {modules: [createCoreModule()], configFile: files.config, edge: {schemas: {}}});
  entry.forwardTo(runtime.url);
  const paths = await Promise.all(grants.map((grant, index) => {
    const configuration = sources[index]; assert.ok(configuration);
    return producerFile(join(entry.directory, `feed-${index}`), entry.url, configuration, grant.token);
  }));
  for (const [index, producer] of paths.entries()) {
    const configuration = sources[index]; assert.ok(configuration);
    await invokeHook(context, configuration.provider === 'codex' ? CODEX_HOOK : HOOK, producer, entry.cert);
  }
  const read = async (): Promise<SessionRecord[]> => {
    const response = await fetch(runtime.url + '/api/v2/families/session', {headers: {authorization: 'Bearer ' + reader}});
    assert.equal(response.status, 200);
    return (await response.json() as {records: SessionRecord[]}).records;
  };
  await waitFor(async () => (await read()).length === 4);
  let records = await read();
  assert.equal(new Set(records.map(record => record.id)).size, 4);
  assert.deepEqual(records.map(record => record.identity.hostId + '/' + record.identity.provider).sort(), ['mac-sim/claude', 'mac-sim/codex', 'pc-sim/claude', 'pc-sim/codex']);
  const publishObservation = async (index: number, hook: string, sequence: number) => {
    const source = sources[index], grant = grants[index]; assert.ok(source && grant);
    const value = {...observation(source, hook), ordering: {status: 'known' as const, authority: source.sourceId, epoch: 'synthetic566', sequence}};
    const {key, draft} = lifecycleMessage(value);
    return publishOnce({url: entry.url, source: grant.source, token: grant.token, timeoutMs: 2000}, key, prepareMessage(grant.source, draft));
  };
  assert.deepEqual(await publishObservation(0, 'UserPromptSubmit', 8), {status: 'published'});
  assert.deepEqual(await publishObservation(0, 'PermissionRequest', 10), {status: 'published'});
  assert.deepEqual(await publishObservation(1, 'Stop', 10), {status: 'published'});
  await waitFor(async () => (await read()).some(record => record.identity.hostId === 'pc-sim' && record.identity.provider === 'codex' && record.notices.length === 1));
  records = await read();
  assert.equal(records.find(record => record.identity.hostId === 'pc-sim' && record.identity.provider === 'claude')?.attention.length, 1);
  assert.ok(records.filter(record => record.identity.hostId === 'mac-sim').every(record => record.activity === 'active' && record.attention.length === 0 && record.notices.length === 0));
  const staleBefore = logs.filter(record => record.event_name === 'message.received' && record.attributes['bunny.outcome'] === 'stale').length;
  assert.deepEqual(await publishObservation(0, 'Stop', 7), {status: 'published'});
  await waitFor(() => logs.filter(record => record.event_name === 'message.received' && record.attributes['bunny.outcome'] === 'stale').length > staleBefore);
  assert.deepEqual(await read(), records, 'late observations cannot finish another turn or clear attention');
  const call = entry.calls[0]; assert.ok(call !== undefined);
  const duplicate = JSON.parse(call) as {key: string; message: Parameters<typeof publishOnce>[2]};
  const first = grants[0]; assert.ok(first);
  assert.deepEqual(await publishOnce({url: entry.url, source: first.source, token: first.token, timeoutMs: 2000}, duplicate.key, duplicate.message), {status: 'published'});
  assert.deepEqual(await read(), records, 'duplicate delivery changes no session or notice');
  await revokeCredential(files.credentials, first.id);
  await runtime.reload();
  const revoked = await runHook({producer: paths[0] ?? '', deadline: performance.now() + 2900,
    input: Readable.from([Buffer.from(JSON.stringify({hook_event_name: 'Stop', session_id: 'same-session-id', turn_id: 'same-turn-id'}))])});
  assert.equal(revoked.status, 'rejected');
  if (revoked.status === 'rejected') assert.equal(revoked.code, 'unauthenticated');
  assert.deepEqual(await read(), records, 'revocation never fabricates completion');
  const collected = JSON.stringify({records, logs, calls: entry.calls});
  for (const secret of [...tokens, reader, PROOF, CANARY]) assert.equal(collected.includes(secret), false);
});

it('the actual remote hook process stays quiet and bounded when HTTPS takes a call but never answers', async context => {
  const entry = await tlsEntry(context);
  entry.drop();
  const source = sources[0]; assert.ok(source);
  const producer = await producerFile(join(entry.directory, 'dropped'), entry.url, source, randomBytes(32).toString('base64url'));
  const elapsedMs = await invokeHook(context, HOOK, producer, entry.cert);
  assert.equal(entry.calls.length, 1, 'one real TLS publication attempt and no retry');
  assert.ok(elapsedMs < 3100, 'the process retains its 2.9-second budget plus startup scheduling tolerance');
});

for (const [entrypoint, script, index] of [['monitor', HOOK, 0], ['codex', CODEX_HOOK, 1]] as const) it(`${entrypoint} hook ends a genuine stalled native DNS lookup at its own deadline`, async context => {
  if (process.platform !== 'linux') {
    context.skip('the delayed native resolver fixture requires Linux LD_PRELOAD');
    return;
  }
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'hook-dns-')));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const shim = join(directory, 'stalled-dns.so');
  execFileSync('cc', ['-shared', '-fPIC', '-o', shim, fileURLToPath(new URL('../../tests/fixtures/stalled-dns.c', import.meta.url)), '-ldl']);
  const source = sources[index]; assert.ok(source);
  for (const [name, origin] of [['ip-control', 'https://127.0.0.1:1'], ['stalled', 'https://stall.synthetic.invalid']] as const) {
    const selected = join(directory, `${index}-${name}`);
    const producer = await producerFile(selected, origin, source, randomBytes(32).toString('base64url'));
    const marker = join(selected, 'resolver-entered');
    let controllerKilled = false;
    const started = performance.now();
    const child = spawn(process.execPath, [script, producer], {env: {...process.env, LD_PRELOAD: shim, BUNNY_TEST_RESOLVER_MARKER: marker}, stdio: ['pipe', 'pipe', 'pipe']});
    const controller = setTimeout(() => { controllerKilled = true; child.kill('SIGKILL'); }, 6000);
    context.after(() => { clearTimeout(controller); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stdin.end(JSON.stringify({hook_event_name: 'SessionStart', source: 'startup', session_id: 'dns-session'}));
    const result = await once(child, 'exit');
    clearTimeout(controller);
    const elapsedMs = performance.now() - started;
    const entered = await readFile(marker, 'utf8').then(value => value === 'entered', () => false);
    assert.equal(output, '', `${index}/${name}`);
    assert.equal(controllerKilled, false, `${index}/${name}: the independent controller must not enforce the hook deadline`);
    if (name === 'stalled') {
      assert.equal(entered, true, 'a real getaddrinfo call entered the stalled native resolver');
      assert.deepEqual(result, [null, 'SIGKILL']);
      assert.ok(elapsedMs > 2500 && elapsedMs < 3100, `the hook ended at its own budget after ${Math.round(elapsedMs)} ms`);
    } else {
      assert.equal(entered, false, 'the literal-IP control bypasses DNS');
      assert.deepEqual(result, [0, null]);
      assert.ok(elapsedMs < 2000);
    }
  }
});

// Hub #567: a host-local collector publishes Codex Desktop metadata snapshots with its own ingest credential, derived
// from its feed and `feed: 'desktop-metadata'`, so it is distinct from the hook credential of the same feed.
const desktopFeed = (hostId: string): DesktopFeed => ({provider: 'codex', client: 'desktop', hostId, sourceId: 'codex-desktop'});
const collectorConfiguration = (feed: DesktopFeed) => ({...feed, feed: 'desktop-metadata'});
const COLLECTOR_REFUSAL = 'the producer credential does not own this Desktop feed';

function snapshotMessage(sender: string, feed: DesktopFeed): {key: string; message: Message} {
  const subject = desktopFeedId(feed);
  const data: DesktopMetadataSnapshot = {feed, observedAtMs: Date.now(), stamp: 'synthetic567:1', unread: ['thread-a'], archived: ['thread-b'],
    titles: [{id: 'thread-a', title: {value: 'Synthetic Desktop title', source: 'provider'}}]};
  return {key: `bunny.event.desktop-metadata.${subject}`,
    message: prepareMessage(sender, {kind: 'occurrence', type: 'org.bunny.desktop-metadata.observed', subject, dataschema: DESKTOP_METADATA_SCHEMA, data})};
}

it('only the derived collector credential of a Desktop feed publishes its snapshots, which the core ignores', async context => {
  const feed = desktopFeed('pc-sim');
  const collector = {id: producerCredentialId(collectorConfiguration(feed)), source: producerSource(collectorConfiguration(feed)), token: randomBytes(32).toString('base64url')};
  const hook = {id: producerCredentialId(feed), source: producerSource(feed), token: randomBytes(32).toString('base64url')};
  const reader = {source: 'bunny/parts/reader', token: randomBytes(32).toString('base64url')};
  assert.notEqual(collector.source, hook.source, 'the collector and hook credentials of one feed are distinct');
  const files = await edgeConfig(context, [{...collector, scopes: ['ingest']}, {...hook, scopes: ['ingest']}, {...reader, scopes: ['read']}]);
  const heard: Message[] = [];
  const listener = fixture('listener', async ({sdk}) => { await sdk.subscribe('bunny.event.desktop-metadata.*', message => { heard.push(message); }); });
  const {runtime, logs} = await run(context, {modules: [createCoreModule(), listener], configFile: files.config, edge: {schemas: {}}});
  const send = (credential: {source: string; token: string}, key: string, message: Message) =>
    publishOnce({url: runtime.url, source: credential.source, token: credential.token, timeoutMs: 2000}, key, message);
  const refusedAs = async (credential: {source: string; token: string}, sent: {key: string; message: Message}, detail?: string) => {
    const result = await send(credential, sent.key, sent.message);
    assert.equal(result.status, 'rejected');
    if (result.status !== 'rejected') return;
    assert.equal(result.error.error.code, 'forbidden');
    if (detail !== undefined) assert.equal(result.error.error.detail, detail);
  };

  const own = snapshotMessage(collector.source, feed);
  assert.deepEqual(await send(collector, own.key, own.message), {status: 'published'});
  await waitFor(() => heard.length === 1, 5000, 'the in-process subscriber hears the snapshot');
  assert.equal(heard[0]?.source, collector.source);
  assert.equal(heard[0]?.subject, desktopFeedId(feed));
  assert.deepEqual((heard[0]?.data as DesktopMetadataSnapshot).feed, feed);

  await refusedAs(collector, snapshotMessage(collector.source, desktopFeed('mac-sim')), COLLECTOR_REFUSAL);
  await refusedAs(collector, snapshotMessage(collector.source, {...feed, sourceId: 'other-feed'}), COLLECTOR_REFUSAL);
  await refusedAs(hook, snapshotMessage(hook.source, feed), COLLECTOR_REFUSAL);
  await refusedAs(reader, snapshotMessage(reader.source, feed));
  // The collector's ingest grant still publishes no other family, on its own key or any other.
  for (const key of [`bunny.event.desktop-metadata.wall`, 'bunny.event.moment-ended.wall']) {
    await refusedAs(collector, {key, message: prepareMessage(collector.source, {kind: 'occurrence', type: 'org.bunny.moment.ended', subject: 'wall',
      dataschema: 'https://bunny.invalid/events/moment-ended/2.0', data: {requestId: 'req-moment-1', momentId: 'moment-1', ending: 'preempted', endedAtMs: Date.now()}})});
  }
  await new Promise(resolve => { setTimeout(resolve, 50); });
  assert.equal(heard.length, 1, 'no refused message reaches a subscriber');

  const response = await fetch(runtime.url + '/api/v2/families/session', {headers: {authorization: 'Bearer ' + reader.token}});
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as {records: SessionRecord[]}).records, [], 'a snapshot changes no session');
  const received = logs.filter(record => record.event_name === 'message.received');
  assert.ok(received.every(record => record.attributes['bunny.operation'] !== 'lifecycle'), 'the core takes no snapshot in as a lifecycle observation');
  assert.ok(received.every(record => record.attributes['bunny.outcome'] === 'accepted'), 'the core refuses nothing it heard');
  assert.deepEqual(logs.filter(record => ['ERROR', 'FATAL'].includes(record.severity_text)), []);
  assert.ok(logs.filter(record => record.severity_text === 'WARN').every(record => record.event_name === 'runtime.edge.refused'));
  const collected = JSON.stringify(logs);
  for (const secret of [collector.token, hook.token, reader.token]) assert.equal(collected.includes(secret), false);
});

it('on the private entry the collector credential publishes its snapshot and owns no lifecycle identity of its feed', async context => {
  const entry = await tlsEntry(context);
  const feed = desktopFeed('pc-sim');
  const collector = {id: producerCredentialId(collectorConfiguration(feed)), source: producerSource(collectorConfiguration(feed)), token: randomBytes(32).toString('base64url')};
  const hook = {id: producerCredentialId(feed), source: producerSource(feed), token: randomBytes(32).toString('base64url')};
  const files = await edgeConfig(context, [{...collector, scopes: ['ingest']}, {...hook, scopes: ['ingest']}]);
  await writeFile(files.config, JSON.stringify({schema: 'runtime-config/1.0', modules: {}, edge: {
    credentials: files.credentials, privateProxy: {origin: entry.url, tokenDigest: tokenDigest(PROOF)},
  }}), {mode: 0o600});
  const heard: Message[] = [];
  const listener = fixture('listener', async ({sdk}) => { await sdk.subscribe('bunny.event.desktop-metadata.*', message => { heard.push(message); }); });
  const {runtime} = await run(context, {modules: [createCoreModule(), listener], configFile: files.config, edge: {schemas: {}}});
  entry.forwardTo(runtime.url);
  const send = (credential: {source: string; token: string}, key: string, message: Message) =>
    publishOnce({url: entry.url, source: credential.source, token: credential.token, timeoutMs: 2000}, key, message);
  const own = snapshotMessage(collector.source, feed);
  assert.deepEqual(await send(collector, own.key, own.message), {status: 'published'});
  await waitFor(() => heard.length === 1, 5000, 'the private-entry snapshot reaches the subscriber');
  const hooked = snapshotMessage(hook.source, feed);
  const refused = await send(hook, hooked.key, hooked.message);
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'forbidden', 'a hook credential publishes no snapshot');
  const value: LifecycleObservation = {identity: {...feed, sessionId: 'thread-a'}, turn: {status: 'unknown'}, parent: {status: 'top-level'},
    event: {kind: 'session-started'}, observedAtMs: Date.now(), ordering: {status: 'unknown'}};
  const {key, draft} = lifecycleMessage(value);
  const lifecycle = await send(collector, key, prepareMessage(collector.source, draft));
  assert.equal(lifecycle.status === 'rejected' && lifecycle.error.error.code, 'forbidden', 'the collector owns no lifecycle identity of its feed');
  assert.deepEqual(await send(hook, key, prepareMessage(hook.source, draft)), {status: 'published'}, 'the hook credential keeps its lifecycle identity');
});

it('a lifecycle observation or Desktop snapshot published on the other family\'s key is refused, however many subjects it names', async context => {
  const feed = desktopFeed('pc-sim');
  const collector = {id: producerCredentialId(collectorConfiguration(feed)), source: producerSource(collectorConfiguration(feed)), token: randomBytes(32).toString('base64url')};
  const hook = {id: producerCredentialId(feed), source: producerSource(feed), token: randomBytes(32).toString('base64url')};
  const reader = {source: 'bunny/parts/reader', token: randomBytes(32).toString('base64url')};
  const files = await edgeConfig(context, [{...collector, scopes: ['ingest']}, {...hook, scopes: ['ingest']}, {...reader, scopes: ['read']}]);
  const heard: Message[] = [];
  const listener = fixture('listener', async ({sdk}) => {
    await sdk.subscribe('bunny.event.desktop-metadata.*', message => { heard.push(message); });
    await sdk.subscribe('bunny.event.lifecycle.*', message => { heard.push(message); });
  });
  const {runtime, logs} = await run(context, {modules: [createCoreModule(), listener], configFile: files.config, edge: {schemas: {}}});
  const send = (credential: {source: string; token: string}, key: string, message: Message) =>
    publishOnce({url: runtime.url, source: credential.source, token: credential.token, timeoutMs: 2000}, key, message);
  const KEY_REFUSAL = 'a lifecycle observation or Desktop snapshot must use its own family\'s routing key';
  const refused = async (credential: {source: string; token: string}, key: string, message: Message, what: string) => {
    const result = await send(credential, key, message);
    assert.equal(result.status, 'rejected', what);
    if (result.status === 'rejected') assert.deepEqual([result.error.error.code, result.error.error.detail], ['forbidden', KEY_REFUSAL], what);
  };
  const observation = (sessionId: string): LifecycleObservation => ({identity: {...feed, sessionId}, turn: {status: 'unknown'}, parent: {status: 'top-level'},
    event: {kind: 'session-started'}, observedAtMs: Date.now(), ordering: {status: 'unknown'}});

  const {draft} = lifecycleMessage(observation('thread-a'));
  await refused(hook, `bunny.event.desktop-metadata.${draft.subject}`, prepareMessage(hook.source, draft), 'a lifecycle observation on a Desktop key');
  const own = snapshotMessage(collector.source, feed);
  await refused(collector, `bunny.event.lifecycle.${desktopFeedId(feed)}`, own.message, 'a Desktop snapshot on a lifecycle key');
  // A hook credential cannot spread observations over Desktop subjects, which would exhaust a consumer's refusal budget.
  for (let index = 0; index < 50; index += 1) {
    const sessionId = `thread-${index}`;
    const message = prepareMessage(hook.source, lifecycleMessage(observation(sessionId)).draft);
    await refused(hook, `bunny.event.desktop-metadata.${sessionEntityId({...feed, sessionId})}`, message, `Desktop subject ${index}`);
  }
  await new Promise(resolve => { setTimeout(resolve, 50); });
  assert.deepEqual(heard, [], 'no cross-published message reaches a subscriber');
  const sessions = async (): Promise<SessionRecord[]> => {
    const response = await fetch(runtime.url + '/api/v2/families/session', {headers: {authorization: 'Bearer ' + reader.token}});
    assert.equal(response.status, 200);
    return (await response.json() as {records: SessionRecord[]}).records;
  };
  assert.deepEqual(await sessions(), [], 'nor the core');
  assert.equal(logs.filter(record => record.event_name === 'message.received').length, 0);
  assert.equal(logs.filter(record => record.event_name === 'runtime.edge.refused' && record.attributes['bunny.code'] === 'forbidden').length > 0, true);

  // Each family still travels on its own key.
  assert.deepEqual(await send(collector, own.key, own.message), {status: 'published'});
  const {key} = lifecycleMessage(observation('thread-a'));
  assert.deepEqual(await send(hook, key, prepareMessage(hook.source, draft)), {status: 'published'});
  await waitFor(() => heard.length === 2, 5000, 'both own-key publications reach the subscriber');
  await waitFor(async () => (await sessions()).length === 1, 5000, 'the core takes in the hook\'s own observation');
});
