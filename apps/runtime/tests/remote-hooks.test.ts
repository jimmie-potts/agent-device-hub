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
import type {LifecycleObservation, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {prepareMessage, publishOnce} from '@jimmie-potts/sdk';
import {lifecycleMessage, observationOf, producerCredentialId, producerSource, runHook} from '../src/hook/index.js';
import {createCoreModule, revokeCredential, tokenDigest} from '../src/index.js';
import {edgeConfig, it, run, waitFor} from './support.js';

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

it('a producer token cannot impersonate another host or provider inside its lifecycle payload', async context => {
  const source = sources[0];
  assert.ok(source);
  const token = randomBytes(32).toString('base64url');
  const files = await edgeConfig(context, [{id: producerCredentialId(source), source: producerSource(source), token, scopes: ['ingest']}]);
  const {runtime, logs} = await run(context, {modules: [createCoreModule()], configFile: files.config, edge: {schemas: {}}});
  const send = (value: LifecycleObservation, sender = producerSource(source)) => {
    const {key, draft} = lifecycleMessage(value);
    return publishOnce({url: runtime.url, source: sender, token, timeoutMs: 2000}, key, prepareMessage(sender, draft));
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
  assert.deepEqual(await send(observation(source)), {status: 'published'}, 'the same credential retains its own feed');
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
