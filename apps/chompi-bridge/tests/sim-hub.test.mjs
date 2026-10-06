import assert from 'node:assert/strict';
import test from 'node:test';
import { ManualClock } from '../dist/clock.js';
import { createHubFeed, normalizeSnapshot } from '../dist/routing/feed.js';
import { SyntheticHub } from '../dist/sim/hub.js';
import { advance, lid, onCleanup, tid } from './routing-helpers.mjs';

const TOKEN = 'synthetic-run-token-0123456789';

function setup(t, token = TOKEN) {
  const clock = new ManualClock(1_700_000_000_000);
  const hub = new SyntheticHub({ token: TOKEN, clock });
  hub.addSession({ provider: 'codex', sessionId: tid(1), title: 'Synthetic Codex task 1' });
  hub.addSession({ provider: 'claude', sessionId: 'claude-session-2', hostSessionId: lid(2), title: 'Synthetic Claude task 2' });
  const feed = createHubFeed({ origin: 'http://127.0.0.1:9', tokenFile: 'unused', readToken: async () => token, clock, fetch: hub.fetch });
  const views = [];
  feed.subscribe(view => views.push(view));
  onCleanup(t, async () => { await feed.stop(); hub.close(); });
  return { clock, hub, feed, views };
}

test('the bridge feed client reads the synthetic Hub as it reads the Hub: snapshot 1.3, then the change stream', async t => {
  const { clock, hub, feed } = setup(t);
  feed.start();
  await advance(clock, 200);
  const view = feed.view();
  assert.equal(view.status, 'current');
  assert.equal(view.snapshotVersion, '1.3');
  assert.deepEqual(view.sessions.map(s => [s.identity.provider, s.title, s.hostSessionId]), [
    ['codex', 'Synthetic Codex task 1', null], ['claude', 'Synthetic Claude task 2', lid(2)],
  ]);
  hub.update(tid(1), { attention: ['approval'] });
  await advance(clock, 200);
  assert.deepEqual(feed.view().sessions[0].attention, ['approval'], 'a change notification refetches the whole snapshot');
  hub.endTurn(tid(1));
  await advance(clock, 200);
  const ended = feed.view().sessions[0];
  assert.deepEqual([ended.activity, ended.attention, ended.unacknowledgedNotices], ['idle', [], 1]);
  assert.ok(hub.requests.every(r => r.method === 'GET' && r.authorized));
  assert.ok(hub.requests.every(r => !JSON.stringify(r).includes(TOKEN)), 'the token is never recorded');
  await advance(clock, 6_000);
  assert.equal(feed.view().status, 'current', 'heartbeats keep the stream alive past the 5 s idle bound');
});

test('a dropped stream goes stale, reconnects and refetches a snapshot without replaying anything', async t => {
  const { clock, hub, feed, views } = setup(t);
  feed.start();
  await advance(clock, 200);
  const before = hub.requests.length;
  hub.dropStreams();
  await advance(clock, 100);
  assert.equal(feed.view().status, 'stale');
  await advance(clock, 2_500);
  assert.equal(feed.view().status, 'current');
  assert.ok(views.some(view => view.status === 'stale' && view.reason === 'stream-closed'));
  assert.deepEqual(hub.requests.slice(before).map(r => r.path), ['/api/monitor/v1/sessions', '/api/monitor/v1/changes']);
});

test('the synthetic Hub accepts only its own token and only the two read routes', async t => {
  const { clock, hub, feed } = setup(t, 'another-token-0123456789');
  feed.start();
  await advance(clock, 200);
  assert.equal(feed.view().status, 'unavailable');
  assert.equal(feed.view().reason, 'snapshot-http-401');
  assert.deepEqual(hub.requests.map(r => [r.authorized, r.status]), [[false, 401]]);
  const headers = { authorization: `Bearer ${TOKEN}` };
  assert.equal((await hub.fetch('http://127.0.0.1:9/api/monitor/v1/sessions', { method: 'POST', headers })).status, 405);
  assert.equal((await hub.fetch('http://127.0.0.1:9/api/hub/v1/health', { headers })).status, 404);
  assert.equal((await hub.fetch('http://127.0.0.1:9/api/monitor/v1/sessions?snapshotVersion=2.0', { headers })).status, 400);
  assert.equal(hub.authorizedRequests, 1, 'only the bad snapshot version passed authentication; a refused method or path did not');
});

test('a Hub without snapshot 1.3 serves 1.2 records without Claude Desktop IDs', async t => {
  const { hub } = setup(t);
  hub.only12 = true;
  const headers = { authorization: `Bearer ${TOKEN}` };
  assert.equal((await hub.fetch('http://127.0.0.1:9/api/monitor/v1/sessions?snapshotVersion=1.3', { headers })).status, 400);
  const body = await (await hub.fetch('http://127.0.0.1:9/api/monitor/v1/sessions?snapshotVersion=1.2', { headers })).json();
  const normalized = normalizeSnapshot(body);
  assert.equal(normalized.snapshotVersion, '1.2');
  assert.deepEqual(normalized.sessions.map(s => s.hostSessionId), [null, null]);
});
