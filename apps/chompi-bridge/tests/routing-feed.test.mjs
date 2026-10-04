import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHubFeed, normalizeSnapshot, readTokenFile, FeedConfigError } from '../dist/routing/feed.js';
import { ManualClock } from '../dist/clock.js';
import { FakeHub, advance, claudeTask, codexTask, envelope, hubSession, lid, settle, tempDir, tid } from './routing-helpers.mjs';

const TOKEN = 'feed-secret-token-0123456789';
const ORIGIN = 'http://127.0.0.1:8788';

function setup(t, options = {}) {
  const clock = new ManualClock(1_000_000);
  const hub = new FakeHub();
  const views = [];
  const feed = createHubFeed({ origin: ORIGIN, tokenFile: '/unused', readToken: async () => TOKEN, clock, fetch: hub.fetch, ...options });
  feed.subscribe(view => views.push(view));
  t.after(() => feed.stop());
  return { clock, hub, feed, views };
}

test('normalizeSnapshot keeps only the fields routing needs and skips malformed sessions', () => {
  const result = normalizeSnapshot(envelope([
    codexTask(1, { activity: 'active', attention: ['approval'], notices: [[], ['dashboard']], read: 'unread' }),
    claudeTask(2, { parent: { status: 'unknown' } }),
    hubSession({ provider: 'claude', sessionId: 'child', parent: { status: 'known', identity: { provider: 'claude', client: 'code', hostId: 'pc', sourceId: 'claude-code', sessionId: 'claude-session-2' } } }),
    { identity: { provider: 'codex' } },
    claudeTask(3, { hostSessionId: 'local_bad/../id' }),
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.skipped, 1);
  const [codex, claude, child, malformedHost] = result.sessions;
  assert.deepEqual(codex, {
    identity: { provider: 'codex', client: 'desktop', hostId: 'pc', sourceId: 'codex-desktop', sessionId: tid(1) },
    root: true, activity: 'active', attention: ['approval'], unacknowledgedNotices: 1, read: 'unread', freshness: 'current',
    restartUncertain: false, title: 'Task 1', hostSessionId: null, lastEvidenceAtMs: 1000,
  });
  assert.equal(claude.root, true, 'unknown parentage is not evidence of a child');
  assert.equal(claude.hostSessionId, lid(2));
  assert.equal(child.root, false);
  assert.equal(malformedHost.hostSessionId, null, 'a malformed Desktop ID is dropped, never used in a link');
  assert.equal(result.revision, 1);
  assert.equal(result.snapshotVersion, '1.3');
  assert.equal(normalizeSnapshot({ apiVersion: '1.0' }).ok, false);
  assert.equal(normalizeSnapshot(envelope([], { version: '1.0' })).ok, false, 'routing needs titles: snapshot 1.2 or later');
});

test('the origin must be a numeric loopback HTTP origin with a port', () => {
  for (const origin of ['https://127.0.0.1:8788', 'http://localhost:8788', 'http://192.168.1.5:8788', 'http://127.0.0.1', 'http://127.0.0.1:8788/api', 'http://user:pw@127.0.0.1:8788', 'nonsense']) {
    assert.throws(() => createHubFeed({ origin, tokenFile: '/x', readToken: async () => TOKEN }), FeedConfigError, origin);
  }
  assert.doesNotThrow(() => createHubFeed({ origin: 'http://127.0.0.1:8788/', tokenFile: '/x', readToken: async () => TOKEN }));
});

test('the feed reads snapshot 1.3 with the bearer token, follows changes and only ever sends GETs', async t => {
  const { hub, feed, views } = setup(t);
  hub.sessions = [codexTask(1)];
  feed.start();
  await settle();
  assert.equal(feed.view().status, 'current');
  assert.equal(feed.view().sessions[0].identity.sessionId, tid(1));
  const [snapshot, changes] = hub.requests;
  assert.deepEqual([snapshot.method, snapshot.path, snapshot.search], ['GET', '/api/monitor/v1/sessions', '?snapshotVersion=1.3']);
  assert.equal(snapshot.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(snapshot.host, '127.0.0.1:8788');
  assert.deepEqual([changes.method, changes.path, changes.search], ['GET', '/api/monitor/v1/changes', '']);
  assert.equal(changes.headers.authorization, `Bearer ${TOKEN}`);
  assert.ok(views.length >= 1);
  assert.ok(!JSON.stringify(views).includes(TOKEN), 'the token never appears in a view');
  for (const request of hub.requests) {
    assert.equal(request.method, 'GET');
    assert.ok(['/api/monitor/v1/sessions', '/api/monitor/v1/changes'].includes(request.path));
    assert.equal(request.headers['x-pixoo-request'], undefined, 'never a mutation');
  }
});

test('a change notification refetches the snapshot instead of replaying, coalescing bursts', async t => {
  const { hub, feed } = setup(t);
  hub.sessions = [codexTask(1)];
  feed.start();
  await settle();
  assert.equal(hub.snapshotsRead(), 1);
  hub.sessions = [codexTask(1), codexTask(2)];
  hub.revision = 2;
  hub.notify('state');
  hub.notify('state');
  hub.notify('state');
  await settle();
  assert.ok(hub.snapshotsRead() <= 3, `burst fetched ${hub.snapshotsRead()} snapshots`);
  assert.equal(feed.view().revision, 2);
  assert.equal(feed.view().sessions.length, 2);
  hub.revision = 3;
  hub.notify('resync');
  await settle();
  assert.equal(feed.view().revision, 3, 'resync also refetches');
  hub.heartbeat();
  const before = hub.snapshotsRead();
  await settle();
  assert.equal(hub.snapshotsRead(), before, 'a heartbeat is liveness only');
});

test('a silent stream makes the feed stale, keeps the last sessions and reconnects', async t => {
  const { clock, hub, feed } = setup(t);
  hub.sessions = [codexTask(1)];
  feed.start();
  await settle();
  await advance(clock, 4000, 500);
  hub.heartbeat();
  await advance(clock, 4000, 500);
  assert.equal(feed.view().status, 'current', 'heartbeats keep the stream alive');
  await advance(clock, 1500, 100);
  assert.equal(feed.view().status, 'stale');
  assert.equal(feed.view().reason, 'stream-silent');
  assert.equal(feed.view().sessions.length, 1, 'the last snapshot stays for display');
  await advance(clock, 2500, 100);
  assert.equal(feed.view().status, 'current');
  assert.equal(hub.streams.length, 2);
});

test('failed, hung, oversized and collector-faulted snapshots are stale, never healthy empty state', async t => {
  const { clock, hub, feed } = setup(t, { timing: { maxSnapshotBytes: 4096, streamIdleMs: 60_000 } });
  hub.sessions = [codexTask(1)];
  feed.start();
  await settle();
  hub.snapshotStatus = 503;
  hub.notify();
  await settle();
  assert.equal(feed.view().status, 'stale');
  assert.equal(feed.view().reason, 'snapshot-http-503');
  assert.equal(feed.view().sessions.length, 1);

  hub.snapshotStatus = 200;
  hub.hangSnapshots = true;
  await advance(clock, 2500, 100);
  hub.notify();
  await advance(clock, 3200, 100);
  assert.equal(feed.view().status, 'stale');
  assert.equal(feed.view().reason, 'snapshot-timeout');

  hub.hangSnapshots = false;
  hub.sessions = Array.from({ length: 40 }, (_, i) => codexTask(i + 1));
  await advance(clock, 2500, 100);
  assert.equal(feed.view().reason, 'snapshot-too-large');

  hub.sessions = [codexTask(1)];
  hub.collector = 'faulted';
  await advance(clock, 2500, 100);
  assert.equal(feed.view().status, 'stale');
  assert.equal(feed.view().reason, 'collector-faulted');

  hub.collector = 'running';
  await advance(clock, 2500, 100);
  assert.equal(feed.view().status, 'current');
});

test('before any snapshot the feed is unavailable', async t => {
  const { hub, feed } = setup(t);
  hub.snapshotStatus = 401;
  assert.equal(feed.view().status, 'unavailable');
  feed.start();
  await settle();
  assert.equal(feed.view().status, 'unavailable');
  assert.equal(feed.view().reason, 'snapshot-http-401');
  assert.deepEqual(feed.view().sessions, []);
});

test('a Hub without snapshot 1.3 falls back to 1.2, where no session carries a Desktop ID', async t => {
  const { hub, feed } = setup(t);
  hub.version13 = false;
  hub.sessions = [claudeTask(1)];
  feed.start();
  await settle();
  assert.equal(feed.view().status, 'current');
  assert.equal(feed.view().snapshotVersion, '1.2');
  assert.equal(feed.view().sessions[0].hostSessionId, null);
  assert.deepEqual(hub.requests.filter(r => r.path.endsWith('/sessions')).map(r => r.search), ['?snapshotVersion=1.3', '?snapshotVersion=1.2']);
});

test('after a 1.2 fallback the feed retries snapshot 1.3 periodically and on every reconnect', async t => {
  const { clock, hub, feed } = setup(t, { timing: { streamIdleMs: 10_000_000 } });
  hub.version13 = false;
  hub.sessions = [claudeTask(1)];
  feed.start();
  await settle();
  assert.equal(feed.view().snapshotVersion, '1.2');
  hub.version13 = true; // the Hub is upgraded in place
  await advance(clock, 290_000, 10_000);
  assert.equal(feed.view().snapshotVersion, '1.2', 'no retry before the interval');
  await advance(clock, 20_000, 10_000);
  assert.equal(feed.view().snapshotVersion, '1.3');
  assert.equal(feed.view().sessions[0].hostSessionId, lid(1), 'Claude Desktop IDs arrive without a bridge restart');

  const second = setup(t, { timing: { streamIdleMs: 10_000_000 } });
  second.hub.version13 = false;
  second.feed.start();
  await settle();
  assert.equal(second.feed.view().snapshotVersion, '1.2');
  second.hub.version13 = true;
  second.hub.stream.end();
  await advance(second.clock, 2500, 100);
  assert.equal(second.feed.view().snapshotVersion, '1.3', 'a reconnect asks for 1.3 again');
});

test('an overlong SSE line drops the stream', async t => {
  const { hub, feed } = setup(t, { timing: { maxLineBytes: 128 } });
  hub.sessions = [codexTask(1)];
  feed.start();
  await settle();
  hub.stream.send(`data: ${'x'.repeat(256)}`);
  await settle();
  assert.equal(feed.view().status, 'stale');
  assert.equal(feed.view().reason, 'stream-line-too-long');
});

test('stop aborts the stream and schedules nothing more', async t => {
  const { clock, hub, feed } = setup(t);
  feed.start();
  await settle();
  await feed.stop();
  const requests = hub.requests.length;
  await advance(clock, 10_000, 1000);
  assert.equal(hub.requests.length, requests);
  assert.equal(clock.pending, 0, 'no timers left behind');
});

test('the token file must be private, bounded and a single token', async t => {
  const dir = tempDir(t);
  const path = join(dir, 'token');
  // POSIX mode checks need a POSIX file system; NTFS reports 0o666 whatever mode was asked for.
  const posix = process.platform !== 'win32';
  const host = posix ? 'linux' : 'win32';
  writeFileSync(path, `${TOKEN}\n`, { mode: 0o600 });
  assert.equal(await readTokenFile(path, host), TOKEN);
  if (posix) {
    chmodSync(path, 0o640);
    await assert.rejects(readTokenFile(path, 'linux'), error => error.message === 'token-file-not-private' && !error.message.includes(TOKEN));
    assert.equal(await readTokenFile(path, 'win32'), TOKEN, 'Windows privacy is the user profile ACL, not POSIX mode bits');
    chmodSync(path, 0o600);
  }
  writeFileSync(path, 'two tokens');
  await assert.rejects(readTokenFile(path, host), /token-file-invalid/);
  writeFileSync(path, 'x'.repeat(5000));
  await assert.rejects(readTokenFile(path, host), /token-file-invalid/);
  await assert.rejects(readTokenFile(join(dir, 'missing'), host), /token-file-unreadable/);
});

test('a token that cannot be read leaves the feed unavailable without contacting the Hub', async t => {
  const { hub, feed } = setup(t, { readToken: async () => { throw new Error('token-file-not-private'); } });
  feed.start();
  await settle();
  assert.equal(feed.view().status, 'unavailable');
  assert.equal(feed.view().reason, 'token-file-not-private');
  assert.equal(hub.requests.length, 0);
});
