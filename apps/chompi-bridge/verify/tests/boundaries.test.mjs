// Hub #853: each boundary check of a CHOMPI bridge verification run passes on a correct run and fails when the
// run crosses its boundary. The crossing runs are real: the server starts the bridge CLI without --simulate,
// without --desktop sim, or pointed at the installed Hub's port. The module guard and the run's fetch refuse
// each attempt before it reaches hardware, the desktop or a service, and the check reports it.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { blockedModules } from '../guard.mjs';
import { checkNoDesktopCalls, checkNoHid, checkOwnFeedOnly } from '../boundaries.mjs';
import { RUN_SCENARIOS, seedRun, startServer } from '../server.mjs';
import plugin from '../plugin.mjs';

const hooks = () => Object.assign(new EventEmitter(), { exit() {} });
const shortTmp = () => (tmpdir().length <= 60 ? tmpdir() : '/tmp');

async function run(t, scenario) {
  const dataDir = await mkdtemp(join(shortTmp(), 'cb-'));
  await seedRun(dataDir, scenario);
  const server = await startServer({ dataDir, processHooks: hooks() });
  t.after(async () => { await server.close(); await rm(dataDir, { recursive: true, force: true }); });
  // Give the bridge time to open its transport and the feed.
  await new Promise(resolve => setTimeout(resolve, 1500));
  return server;
}

/** The plug-in's own boundary checks against a running server. */
async function checks(server) {
  const context = { url: server.url, signal: AbortSignal.timeout(5000) };
  return Object.fromEntries(await Promise.all(plugin.checks.filter(c => c.id !== 'build-current').map(async c => [c.id, await c.run(context)])));
}

const report = (overrides = {}) => ({
  hid: { simulated: true, transportsCreated: 0, simulatorConnections: 1, blockedModules: [], ...overrides.hid },
  desktop: { simulated: true, platformAdaptersCreated: 0, blockedModules: [], ...overrides.desktop },
  feed: { origin: 'http://127.0.0.1:40000', requests: [{ origin: 'http://127.0.0.1:40000', path: '/api/monitor/v1/sessions' }], refused: [], unauthorized: 0, authorized: 1, lockInRun: true, ...overrides.feed },
});

test('each check passes on a clean report and fails on each way of crossing its boundary', () => {
  const url = 'http://127.0.0.1:40000/';
  assert.deepEqual([checkNoHid(report()), checkNoDesktopCalls(report()), checkOwnFeedOnly(report(), url)].map(c => c.outcome), ['passed', 'passed', 'passed']);
  for (const hid of [{ simulated: false }, { transportsCreated: 1 }, { blockedModules: ['node-hid'] }]) assert.equal(checkNoHid(report({ hid })).outcome, 'failed', JSON.stringify(hid));
  for (const desktop of [{ simulated: false }, { platformAdaptersCreated: 1 }, { blockedModules: ['koffi'] }]) assert.equal(checkNoDesktopCalls(report({ desktop })).outcome, 'failed', JSON.stringify(desktop));
  for (const feed of [
    { origin: 'http://127.0.0.1:8788' }, { refused: ['http://127.0.0.1:8788'] }, { requests: [{ origin: 'http://127.0.0.1:41000', path: '/' }] },
    { unauthorized: 1 }, { lockInRun: false },
  ]) assert.equal(checkOwnFeedOnly(report({ feed }), url).outcome, 'failed', JSON.stringify(feed));
  assert.match(checkOwnFeedOnly(report({ feed: { refused: ['http://127.0.0.1:8788'] } }), url).reason, /installed service's port was targeted: http:\/\/127\.0\.0\.1:8788/);
});

test('the module guard refuses koffi and node-hid before any native code loads, and records each attempt', async () => {
  const before = blockedModules.length;
  await assert.rejects(import('koffi'), /blocked-by-verification-run: koffi/);
  await assert.rejects(import('node-hid'), /blocked-by-verification-run: node-hid/);
  await assert.rejects(import('@koromix/koffi-linux-x64'), /blocked-by-verification-run/);
  assert.deepEqual(blockedModules.slice(before), ['koffi', 'node-hid', '@koromix/koffi-linux-x64']);
  blockedModules.splice(before);
});

test('a correct run passes all three boundary checks', async t => {
  const server = await run(t, 'desk-basic');
  const outcomes = await checks(server);
  assert.deepEqual(outcomes, { 'no-hid-device': { outcome: 'passed' }, 'no-desktop-calls': { outcome: 'passed' }, 'own-feed-only': { outcome: 'passed' } });
  const boundaries = server.boundaries();
  assert.ok(boundaries.hid.simulatorConnections >= 1, 'the bridge opened the simulator');
  assert.ok(boundaries.feed.authorized >= 2, 'the bridge read the run\'s own feed with its token');
});

test('a run without --simulate fails no-hid-device: the HID transport is created and node-hid is refused', async t => {
  const before = blockedModules.length;
  const server = await run(t, 'control-hid-device');
  const outcomes = await checks(server);
  assert.equal(outcomes['no-hid-device'].outcome, 'failed');
  assert.match(outcomes['no-hid-device'].reason, /not on the simulated controller.*HID transport was created.*refused a load of node-hid/);
  assert.equal(outcomes['no-desktop-calls'].outcome, 'passed');
  blockedModules.splice(before);
});

test('a run without --desktop sim fails no-desktop-calls: the platform adapter is created', async t => {
  const server = await run(t, 'control-desktop-calls');
  const outcomes = await checks(server);
  assert.equal(outcomes['no-desktop-calls'].outcome, 'failed');
  assert.match(outcomes['no-desktop-calls'].reason, /not the simulated desktop.*platform OS adapter was created 1 time/);
  assert.equal(outcomes['no-hid-device'].outcome, 'passed');
});

test('a run pointed at the installed Hub fails own-feed-only, and the request is refused before it is sent', async t => {
  const server = await run(t, 'control-installed-hub');
  const outcomes = await checks(server);
  assert.equal(outcomes['own-feed-only'].outcome, 'failed');
  assert.match(outcomes['own-feed-only'].reason, /pointed at http:\/\/127\.0\.0\.1:8788.*installed service's port was targeted/);
  assert.equal(server.hub.authorizedRequests, 0, 'the run\'s own feed was never read');
  assert.ok(server.state && (await server.state()).log.some(entry => entry.line.type === 'feed' && entry.line.reason === 'snapshot-unreachable'), 'the bridge saw the request fail locally');
});

test('the plug-in offers exactly the server\'s scenarios', () => {
  assert.deepEqual(Object.keys(plugin.scenarios).sort(), Object.keys(RUN_SCENARIOS).sort());
});
