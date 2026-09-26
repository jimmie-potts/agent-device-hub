import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createAgentState, MemoryStorage } from '@jimmie-potts/agent-state';
import { HubStatusFeed, hubOrigin, hubToken, HUB_ID } from '../dist/index.js';

test('feed reads a real shared snapshot and rejects a source switch', async t => {
  const owner = await createAgentState({ storage: new MemoryStorage(), ownerId: 'owner', consumers: [] });
  t.after(() => owner.shutdown());
  let ownerId = 'owner';
  const calls = [];
  const server = createServer((req, res) => {
    calls.push([req.method, req.url, req.headers.authorization]);
    res.end(JSON.stringify({ apiVersion: '1.0', ownerId, connection: 'current', snapshot: owner.snapshot() }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const feed = new HubStatusFeed({ hubUrl: `http://127.0.0.1:${server.address().port}`, ownerId: 'owner', token: 't'.repeat(43) });
  assert.equal((await feed.snapshot()).collector, 'running');
  assert.deepEqual(calls, [['GET', '/api/monitor/v1/sessions', 'Bearer ' + 't'.repeat(43)]]);
  ownerId = 'other';
  await assert.rejects(feed.snapshot(), /feed-unavailable/);
});

test('feed rejects incompatible, failed, redirected, oversized and stalled responses', async t => {
  let mode = 'version', redirectCalls = 0;
  const owner = await createAgentState({ storage: new MemoryStorage(), ownerId: 'owner', consumers: [] });
  t.after(() => owner.shutdown());
  const server = createServer((req, res) => {
    if (req.url === '/redirect') { redirectCalls++; res.end('{}'); return; }
    if (mode === 'timeout') { res.writeHead(200); res.write('{'); return; }
    if (mode === 'failed') { res.statusCode = 401; res.end('private-key-sentinel'); return; }
    if (mode === 'redirect') { res.writeHead(302, { Location: '/redirect' }); res.end(); return; }
    if (mode === 'oversized') { res.end(' '.repeat(1024 * 1024 + 1)); return; }
    const value = { apiVersion: '1.0', ownerId: 'owner', connection: 'current', snapshot: owner.snapshot() };
    if (mode === 'version') value.apiVersion = '2.0';
    if (mode === 'connection') value.connection = 'stale';
    if (mode === 'snapshot') value.snapshot = {};
    res.end(mode === 'malformed' ? 'not json' : JSON.stringify(value));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const feed = new HubStatusFeed({ hubUrl: `http://127.0.0.1:${server.address().port}`, ownerId: 'owner', token: 't'.repeat(43) });
  for (mode of ['version', 'connection', 'snapshot', 'malformed', 'failed', 'redirect', 'oversized', 'timeout']) {
    await assert.rejects(feed.snapshot(), { message: 'feed-unavailable' });
  }
  assert.equal(redirectCalls, 0);
  mode = 'good';
  assert.equal((await feed.snapshot()).collector, 'running');
});

test('hubOrigin and hubToken validate their shape without a network call', () => {
  assert.equal(hubOrigin('http://127.0.0.1:8788'), 'http://127.0.0.1:8788');
  for (const bad of ['https://127.0.0.1:8788', 'http://localhost:8788', 'http://127.0.0.1:8788/a', 'http://127.0.0.1:8788?x=1', 123, null]) {
    assert.throws(() => hubOrigin(bad), /invalid-runner-config/);
  }
  assert.equal(hubToken('t'.repeat(43)), 't'.repeat(43));
  for (const bad of ['short', 't'.repeat(44), 123, null]) assert.throws(() => hubToken(bad), /invalid-runner-config/);
});

test('HUB_ID matches a bounded neutral identifier only', () => {
  assert.equal(HUB_ID.test('owner-1'), true);
  assert.equal(HUB_ID.test(''), false);
  assert.equal(HUB_ID.test('a'.repeat(129)), false);
  assert.equal(HUB_ID.test('has space'), false);
});

test('an invalid owner ID is rejected before any request', () => {
  for (const ownerId of [null, true, 123, ['owner'], {}, '']) {
    assert.throws(() => new HubStatusFeed({ hubUrl: 'http://127.0.0.1:8788', ownerId, token: 't'.repeat(43) }), /invalid-runner-config/);
  }
});

test('an opted-in feed requests and validates title-bearing snapshot 1.2', async t => {
  const owner = await createAgentState({ storage: new MemoryStorage(), ownerId: 'owner', consumers: [] });
  t.after(() => owner.shutdown());
  const calls = [];
  const identity = { provider: 'claude', client: 'code', hostId: 'host', sourceId: 'source', sessionId: 'session' };
  assert.equal((await owner.ingest({ apiVersion: '1.1', identity, turn: { status: 'known', id: 'turn' },
    parent: { status: 'unknown' }, event: { kind: 'turn.started' }, observedAtMs: Date.now(),
    ordering: { status: 'unknown' }, title: { value: 'Launch review', source: 'provider' }, project: 'Device hub' })).ok, true);
  let snapshot = owner.snapshot('1.2');
  const server = createServer((req, res) => {
    calls.push(req.url);
    res.end(JSON.stringify({ apiVersion: '1.0', ownerId: 'owner', connection: 'current', snapshot }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const options = { hubUrl: `http://127.0.0.1:${server.address().port}`, ownerId: 'owner', token: 't'.repeat(43), snapshotVersion: '1.2' };
  const feed = new HubStatusFeed(options);
  const received = await feed.snapshot();
  assert.equal(received.apiVersion, '1.2');
  assert.equal(received.sessions[0].title.value, 'Launch review');
  assert.equal(received.sessions[0].project, 'Device hub');
  assert.deepEqual(calls, ['/api/monitor/v1/sessions?snapshotVersion=1.2']);
  snapshot = { ...snapshot, sessions: [{ ...snapshot.sessions[0], title: { value: 'x'.repeat(161), source: 'provider' } }] };
  await assert.rejects(feed.snapshot(), /feed-unavailable/);
  snapshot = owner.snapshot();
  await assert.rejects(feed.snapshot(), /feed-unavailable/);
  assert.throws(() => new HubStatusFeed({ ...options, snapshotVersion: '2.0' }), /invalid-runner-config/);
});
