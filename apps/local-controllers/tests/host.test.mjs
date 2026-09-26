import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest, createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validate } from '@jimmie-potts/device-contracts';
import { acquireWriterLease } from '@jimmie-potts/tidbyt-controller/runner';
import { loadHostConfig, startLocalControllers } from '@jimmie-potts/local-controllers';
import { createAgentState, MemoryStorage } from '@jimmie-potts/agent-state';
import { TOKENS, fakeHub, fakeLifx, fakeTidbyt, privateFiles, reads, settle, until, writes } from './helpers.mjs';

async function start(t, { host: change = h => h, settleMs, now } = {}) {
  const s = privateFiles(t, await fakeHub(t));
  const lifx = fakeLifx(), tidbyt = fakeTidbyt();
  const config = loadHostConfig(s.write('host.json', change(s.host)));
  const host = await startLocalControllers(config, {
    tidbyt: { connection: tidbyt.connection, leaseRoot: s.locks },
    lifx: { transportFactory: lifx.transportFactory, leaseRoot: s.locks, ...(now ? { now } : {}) },
    ...(settleMs === undefined ? {} : { settleMs }),
  });
  t.after(() => host.close());
  return { s, lifx, tidbyt, host, config };
}

/** One raw loopback request, so tests control every header including Host. */
function call(host, path, { method = 'GET', token = TOKENS.hub, body, headers = {} } = {}) {
  const url = new URL(path, host.url);
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload ? { 'content-type': 'application/json' } : {}), ...headers } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, text, body: text ? JSON.parse(text) : undefined }); });
    });
    req.on('error', reject);
    req.end(payload);
  });
}
const snapshot = async (host, deviceId, token) => (await call(host, `/controller/v1/snapshot?deviceId=${deviceId}`, { token })).body;
const lighting = async (host, deviceId) => (await call(host, `/controller/lifx-light/v1/snapshot?deviceId=${deviceId}`)).body;
function command(s, deviceId, kind, extra = {}) {
  return { apiVersion: '1.0', controllerId: s.identity.controllerId, deviceId, requestId: s.nextRequestId,
    expectedConfigurationRevision: s.configurationRevision, expectedGeneration: s.generation, command: { kind, ...extra } };
}
const post = (host, body, options = {}) => call(host, options.path ?? '/controller/v1/commands', { method: 'POST', body, ...options });
const profile = { profileId: 'lifx-light', profileVersion: '1.0.0' };

test('each configured device serves a valid v1 snapshot without private values', async t => {
  const { host, lifx, tidbyt } = await start(t);
  const tidbytSnapshot = await snapshot(host, 'tidbyt');
  assert.equal(validate('snapshot', tidbytSnapshot), true);
  assert.deepEqual([tidbytSnapshot.identity.controllerId, tidbytSnapshot.identity.deviceId], ['tidbyt-status', 'tidbyt']);
  assert.ok(Object.values(tidbytSnapshot.capabilities).every(c => c.supported === false));
  const desk = await snapshot(host, 'desk');
  assert.equal(validate('snapshot', desk), true);
  assert.deepEqual([desk.identity.controllerId, desk.identity.deviceId, desk.capabilities.power.supported, desk.capabilities.brightness.supported], ['lifx', 'desk', true, true]);
  assert.equal(desk.state.observation.status, 'unknown');
  const light = await lighting(host, 'shelf');
  assert.deepEqual(light.profile, profile);
  assert.equal(validate('snapshot', light.controller), true);
  assert.deepEqual(light.lighting.capabilities, { color: true, temperature: { minimum: 1500, maximum: 9000 }, effects: false });
  const everything = JSON.stringify([tidbytSnapshot, desk, light]);
  assert.doesNotMatch(everything, /192\.0\.2|sentinel|local-controllers-|"device"/);
  // Reads never write; each qualified bulb gets at most one on-demand read.
  await settle();
  assert.deepEqual(writes(lifx.log), []);
  assert.deepEqual([reads(lifx.log, 'desk').length, reads(lifx.log, 'shelf').length], [1, 1]);
  assert.ok(!tidbyt.calls.includes('push'));
});

test('authentication, scope, device and browser checks reject before anything is reserved', async t => {
  const { host, lifx } = await start(t);
  const before = await snapshot(host, 'desk');
  const brightness = command(before, 'desk', 'brightness.set', { percent: 40 });
  const cases = [
    [{ token: null }, 401, 'unauthenticated'],
    [{ token: 'x'.repeat(43) }, 401, 'unauthenticated'],
    [{ token: 'short' }, 401, 'unauthenticated'],
    [{ token: TOKENS.reader }, 403, 'forbidden'],
    [{ token: TOKENS.tidbytOnly }, 403, 'forbidden'],
    [{ headers: { origin: host.url } }, 403, 'forbidden'],
    [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403, 'forbidden'],
    [{ headers: { host: 'localhost:' + new URL(host.url).port } }, 403, 'forbidden'],
  ];
  for (const [options, status, code] of cases) {
    const response = await post(host, brightness, options);
    assert.deepEqual([response.status, response.body], [status, { failure: { code } }], JSON.stringify(options));
  }
  assert.equal((await call(host, '/controller/v1/snapshot?deviceId=desk', { token: TOKENS.tidbytOnly })).status, 403);
  assert.equal((await call(host, '/controller/v1/snapshot?deviceId=desk', { headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await call(host, '/controller/v1/snapshot?deviceId=desk', { token: TOKENS.reader })).status, 200);
  assert.deepEqual((await snapshot(host, 'desk')).nextRequestId, before.nextRequestId);
  await settle();
  assert.deepEqual(lifx.log, [['desk', 101]], 'only the on-demand read of the first snapshot');
});

test('bounds, malformed requests and unknown routes are rejected before admission', async t => {
  const { host, lifx } = await start(t);
  const s = await snapshot(host, 'desk');
  const valid = command(s, 'desk', 'power.set', { on: true });
  let nested = {}; for (let i = 0; i < 40; i++) nested = { a: nested };
  const cases = [
    [post(host, { ...valid, padding: 'x'.repeat(70000) }), 429, 'capacity'],
    [post(host, { ...valid, nested }), 400, 'invalid-request'],
    [post(host, '{"deviceId":'), 400, 'invalid-request'],
    [post(host, []), 400, 'invalid-request'],
    [post(host, { ...valid, deviceId: 'no such/device' }), 400, 'invalid-request'],
    [post(host, { ...valid, address: '192.0.2.10' }), 400, 'invalid-request'],
    [post(host, valid, { path: '/controller/v1/commands?x=1' }), 400, 'invalid-request'],
    [call(host, '/controller/v1/snapshot?deviceId=desk&x=1'), 400, 'invalid-request'],
    [call(host, '/controller/v1/snapshot'), 400, 'invalid-request'],
    [call(host, '/controller/v1/commands'), 400, 'invalid-request'],
    [call(host, '/controller/v2/snapshot?deviceId=desk'), 400, 'invalid-request'],
    [call(host, '/'), 400, 'invalid-request'],
  ];
  for (const [pending, status, code] of cases) {
    const response = await pending;
    assert.deepEqual([response.status, response.body], [status, { failure: { code } }]);
  }
  // Nesting far past the bound, still under 64 KiB, is invalid: never a stack overflow answered as a transport failure.
  for (const body of ['['.repeat(30000) + '1' + ']'.repeat(30000), `{"deviceId":"desk","nested":${'['.repeat(20000)}1${']'.repeat(20000)}}`]) {
    assert.ok(Buffer.byteLength(body) < 65536);
    assert.deepEqual(await post(host, body).then(r => [r.status, r.body]), [400, { failure: { code: 'invalid-request' } }]);
  }
  // A chunked body declares no length and is cut off at the same limit.
  const chunked = await new Promise((resolve, reject) => {
    const req = httpRequest(new URL('/controller/v1/commands', host.url), { method: 'POST', headers: { authorization: `Bearer ${TOKENS.hub}`, 'transfer-encoding': 'chunked' } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve([res.statusCode, JSON.parse(Buffer.concat(chunks))]));
    });
    req.on('error', reject);
    const text = JSON.stringify({ ...valid, padding: 'x'.repeat(70000) });
    req.write(text.slice(0, 40000)); req.end(text.slice(40000));
  });
  assert.deepEqual(chunked, [429, { failure: { code: 'capacity' } }]);
  assert.deepEqual((await snapshot(host, 'desk')).nextRequestId, s.nextRequestId);
  await settle();
  assert.deepEqual(lifx.log, [['desk', 101]], 'only the on-demand read of the first snapshot');
});

test('Tidbyt is status only: v1 commands are retained as unsupported and frames are refused', async t => {
  const { host, tidbyt } = await start(t);
  const s = await snapshot(host, 'tidbyt');
  const response = await post(host, command(s, 'tidbyt', 'power.set', { on: false }));
  assert.equal(response.status, 422);
  assert.equal(validate('receipt', response.body), true);
  assert.deepEqual([response.body.outcome, response.body.failure.code, response.body.priorEffects], ['failed', 'unsupported-capability', 'none']);
  const replay = await post(host, command(s, 'tidbyt', 'power.set', { on: false }));
  assert.deepEqual([replay.status, replay.body], [422, response.body]);
  const next = await snapshot(host, 'tidbyt');
  const frame = { ...command(next, 'tidbyt', 'tidbyt.display'), command: { kind: 'tidbyt.display', frame: { width: 64, height: 32, encoding: 'rgb24-base64', data: Buffer.alloc(6144).toString('base64') } } };
  assert.deepEqual((await post(host, frame)).body, { failure: { code: 'invalid-request' } });
  assert.deepEqual((await post(host, { ...frame, command: { kind: 'tidbyt.remove' } })).body, { failure: { code: 'invalid-request' } });
  assert.deepEqual((await post(host, { ...command(next, 'tidbyt', 'lifx.color.set', { hue: 1, saturation: 1 }), profile }, { path: '/controller/lifx-light/v1/commands' })).body, { failure: { code: 'unknown-device' } });
  assert.equal((await call(host, '/controller/lifx-light/v1/snapshot?deviceId=tidbyt')).status, 404);
  assert.deepEqual((await snapshot(host, 'tidbyt')).nextRequestId, next.nextRequestId);
  assert.ok(!tidbyt.calls.includes('push') && !tidbyt.calls.includes('remove'));
});

test('LIFX v1 commands keep request tickets, guards and replay', async t => {
  const { host, lifx } = await start(t);
  const s = await snapshot(host, 'desk');
  const brightness = command(s, 'desk', 'brightness.set', { percent: 40 });
  const sent = await post(host, brightness);
  assert.equal(sent.status, 200);
  assert.equal(validate('receipt', sent.body), true);
  assert.deepEqual([sent.body.outcome, sent.body.priorEffects], ['sent', 'confirmed-transmission']);
  // The snapshot's on-demand read, then the command's own read-modify-write.
  assert.deepEqual(lifx.log, [['desk', 101], ['desk', 101], ['desk', 102]]);
  const traffic = lifx.log.length;
  // Object key order is immaterial for a replay.
  const reordered = Object.fromEntries(Object.entries(brightness).reverse());
  assert.deepEqual(await post(host, reordered).then(r => [r.status, r.body]), [200, sent.body]);
  assert.equal(lifx.log.length, traffic);
  assert.deepEqual((await post(host, { ...brightness, command: { kind: 'brightness.set', percent: 41 } })).body, { failure: { code: 'request-conflict' } });
  const after = await snapshot(host, 'desk');
  assert.equal(after.state.observation.status, 'known');
  const stale = await post(host, { ...command(after, 'desk', 'power.set', { on: false }), expectedConfigurationRevision: s.configurationRevision });
  assert.equal(stale.status, 409);
  assert.equal(validate('receipt', stale.body), true);
  assert.equal(stale.body.failure.code, 'revision-conflict');
  const latest = await snapshot(host, 'desk');
  assert.deepEqual((await post(host, command({ ...latest, nextRequestId: s.nextRequestId }, 'desk', 'power.set', { on: true }))).status, 409);
  assert.deepEqual((await post(host, command({ ...latest, nextRequestId: { ...latest.nextRequestId, sequence: 99 } }, 'desk', 'power.set', { on: true }))).body, { failure: { code: 'request-order' } });
  assert.deepEqual((await post(host, command({ ...latest, nextRequestId: { epoch: 'old-epoch', sequence: latest.nextRequestId.sequence } }, 'desk', 'power.set', { on: true }))).status, 410);
  assert.equal(lifx.log.length, traffic, 'rejections and fresh-observation snapshots send nothing');
  // The other bulb has its own queue and identities.
  const shelf = await snapshot(host, 'shelf');
  assert.equal((await post(host, command(shelf, 'shelf', 'power.set', { on: false }))).body.outcome, 'sent');
  assert.deepEqual(lifx.log.slice(traffic), [['shelf', 101], ['shelf', 21]]);
});

test('a command that does not settle in time answers its queued receipt', async t => {
  const { host, lifx } = await start(t, { settleMs: 5, host: h => ({ ...h, lifx: { ...h.lifx, timeoutMs: 500 } }) });
  lifx.mode.hang = true;
  const s = await snapshot(host, 'desk');
  const response = await post(host, command(s, 'desk', 'power.set', { on: true }));
  assert.equal(response.status, 202);
  assert.equal(validate('receipt', response.body), true);
  assert.equal(response.body.outcome, 'queued');
  assert.equal((await snapshot(host, 'desk')).state.pending.length, 1);
});

test('in-flight requests are bounded', async t => {
  const { host, lifx } = await start(t, { settleMs: 5000, host: h => ({ ...h, lifx: { ...h.lifx, timeoutMs: 5000 } }) });
  lifx.mode.hang = true;
  const s = await snapshot(host, 'desk');
  const held = command(s, 'desk', 'power.set', { on: true });
  // One admitted request and 31 joins of it hold every slot.
  const holders = Array.from({ length: 32 }, () => post(host, held).catch(() => undefined));
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual((await call(host, '/controller/v1/snapshot?deviceId=shelf')).body, { failure: { code: 'capacity' } });
  await host.close();
  await Promise.all(holders);
});

test('LIFX color and temperature use the lighting profile route and the same queue', async t => {
  const { host, lifx } = await start(t);
  const s = (await lighting(host, 'desk')).controller;
  const color = { ...command(s, 'desk', 'lifx.color.set', { hue: 200, saturation: 80 }), profile };
  const response = await post(host, color, { path: '/controller/lifx-light/v1/commands' });
  assert.equal(response.status, 200);
  assert.equal(validate('receipt', response.body), true);
  assert.equal(response.body.outcome, 'sent');
  assert.deepEqual(lifx.log, [['desk', 101], ['desk', 101], ['desk', 102]]);
  const next = await lighting(host, 'desk');
  assert.deepEqual(next.lighting.pending, []);
  assert.equal(next.lighting.observation.status, 'known');
  const temperature = { ...command(next.controller, 'desk', 'lifx.temperature.set', { kelvin: 2700 }), profile };
  assert.equal((await post(host, temperature, { path: '/controller/lifx-light/v1/commands' })).body.outcome, 'sent');
  const latest = (await lighting(host, 'desk')).controller;
  const path = '/controller/lifx-light/v1/commands';
  const invalid = [
    { ...command(latest, 'desk', 'lifx.color.set', { hue: 200, saturation: 80 }), profile: { ...profile, profileVersion: '2.0.0' } },
    { ...command(latest, 'desk', 'lifx.color.set', { hue: 361, saturation: 80 }), profile },
    { ...command(latest, 'desk', 'lifx.color.set', { hue: 1.5, saturation: 80 }), profile },
    { ...command(latest, 'desk', 'lifx.color.set', { hue: 1, saturation: 80, brightness: 10 }), profile },
    { ...command(latest, 'desk', 'lifx.temperature.set', { kelvin: 10000 }), profile },
    command(latest, 'desk', 'brightness.set', { percent: 10 }),
  ];
  for (const body of invalid) assert.deepEqual((await post(host, body, { path })).body, { failure: { code: 'invalid-request' } });
  // A profile request is not a v1 command.
  assert.deepEqual((await post(host, { ...command(latest, 'desk', 'lifx.color.set', { hue: 1, saturation: 1 }), profile })).body, { failure: { code: 'invalid-request' } });
  assert.deepEqual((await lighting(host, 'desk')).controller.nextRequestId, latest.nextRequestId);
  assert.deepEqual(writes(lifx.log), [['desk', 102], ['desk', 102]]);
  assert.equal(lifx.log.length, 5, 'one on-demand read and two read-modify-writes; invalid requests send nothing');
});

test('a second writer for any configured device fails before any request and releases what it took', async t => {
  const { s } = await start(t);
  const again = fakeLifx(), cloud = fakeTidbyt();
  const options = locks => ({ tidbyt: { connection: cloud.connection, leaseRoot: locks }, lifx: { transportFactory: again.transportFactory, leaseRoot: locks } });
  // The running host holds every lease.
  await assert.rejects(startLocalControllers(loadHostConfig(s.write('again.json', s.host)), options(s.locks)), { message: 'local-controllers-start-failed' });
  // Elsewhere only a standalone Tidbyt runner holds its lease; this attempt releases the bulb leases it took.
  const separate = privateFiles(t);
  const runner = acquireWriterLease('device', separate.locks);
  await assert.rejects(startLocalControllers(loadHostConfig(separate.write('both.json', separate.host)), options(separate.locks)), { message: 'local-controllers-start-failed' });
  runner();
  const lifxOnly = loadHostConfig(separate.write('lifx.json', { port: 0, credentials: [{ ...separate.host.credentials[0], devices: ['desk', 'shelf'] }], lifx: separate.host.lifx }));
  const host = await startLocalControllers(lifxOnly, options(separate.locks));
  t.after(() => host.close());
  // A second host for the same bulbs fails on the bulb leases alone.
  const second = await startLocalControllers(lifxOnly, options(separate.locks)).then(async other => { await other.close(); return 'started'; }, error => error.message);
  assert.equal(second, 'local-controllers-start-failed');
  await host.close();
  assert.deepEqual(again.log, []);
  assert.deepEqual(cloud.calls, []);
});

test('shutdown releases every lease and a restart replays nothing', async t => {
  const { s, host, lifx, config } = await start(t);
  const first = await snapshot(host, 'desk');
  assert.equal((await post(host, command(first, 'desk', 'power.set', { on: true }))).body.outcome, 'sent');
  await host.close();
  await host.close();
  await assert.rejects(fetch(host.url + '/controller/v1/snapshot?deviceId=desk'));
  const cloud = fakeTidbyt();
  const restarted = await startLocalControllers(config, { tidbyt: { connection: cloud.connection, leaseRoot: s.locks }, lifx: { transportFactory: lifx.transportFactory, leaseRoot: s.locks } });
  t.after(() => restarted.close());
  const second = await snapshot(restarted, 'desk');
  assert.notEqual(second.identity.controllerEpoch, first.identity.controllerEpoch);
  assert.deepEqual(second.nextRequestId.sequence, 0);
  assert.equal(second.state.lastOutcome.status, 'unknown');
  await settle();
  assert.deepEqual(writes(lifx.log), [['desk', 21]], 'the restart replays no write');
});

test('mode.set persists under the supplied lease root, not a package default', async t => {
  const { host, s } = await start(t);
  const before = await snapshot(host, 'desk');
  assert.deepEqual(before.capabilities.modes, { supported: true, values: ['Work', 'Quiet', 'Free'] });
  const response = await post(host, command(before, 'desk', 'mode.set', { mode: 'Quiet' }));
  assert.equal(response.body.outcome, 'sent');
  const path = join(s.locks, 'modes', createHash('sha256').update('desk').digest('hex') + '.json');
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { mode: 'Quiet' });
  assert.deepEqual((await snapshot(host, 'desk')).state.desired.mode, { status: 'known', value: 'Quiet' });
});

test('a qualified bulb is read on demand, at most once per 30 seconds and only while something reads', async t => {
  let clock = 1000;
  const unqualified = h => ({ ...h, lifx: { ...h.lifx, bulbs: [h.lifx.bulbs[0], { deviceId: 'shelf', address: '192.0.2.11' }] } });
  const { host, lifx } = await start(t, { now: () => clock, host: unqualified });
  await settle();
  assert.deepEqual(lifx.log, [], 'nothing is read while nothing reads');
  const first = await snapshot(host, 'desk');
  assert.equal(first.state.observation.status, 'unknown', 'the snapshot answers from memory at once');
  await until(() => lifx.log.length === 1);
  assert.deepEqual(lifx.log, [['desk', 101]]);
  const read = await snapshot(host, 'desk');
  assert.equal(validate('snapshot', read), true);
  assert.deepEqual([read.state.observation.status, read.state.observation.power], ['known', { status: 'known', value: true }]);
  assert.deepEqual([read.nextRequestId, read.configurationRevision, read.generation], [first.nextRequestId, first.configurationRevision, first.generation], 'a read reserves nothing');
  clock += 29_999;
  await snapshot(host, 'desk'); await lighting(host, 'desk'); await settle();
  assert.equal(lifx.log.length, 1, 'no second read within 30 s, on either route');
  clock += 1;
  await lighting(host, 'desk');
  await until(() => lifx.log.length === 2);
  for (let i = 0; i < 3; i++) { await snapshot(host, 'shelf'); await lighting(host, 'shelf'); clock += 60_000; }
  await settle();
  assert.deepEqual(reads(lifx.log, 'shelf'), [], 'an unqualified bulb is never read');
  assert.deepEqual(writes(lifx.log), [], 'reads never write');
});

test('a failed read keeps the previous observation and is not retried within 30 seconds', async t => {
  let clock = 1000;
  const { host, lifx } = await start(t, { now: () => clock });
  await snapshot(host, 'desk');
  await until(() => lifx.log.length === 1);
  const observed = (await snapshot(host, 'desk')).state.observation;
  assert.equal(observed.status, 'known');
  clock += 30_000;
  lifx.mode.fail = true;
  await snapshot(host, 'desk');
  await until(() => lifx.log.length === 2);
  await settle();
  const after = (await snapshot(host, 'desk')).state.observation;
  assert.deepEqual([after.status, after.power, after.clock.sampledAtMs], ['known', observed.power, observed.clock.sampledAtMs]);
  await snapshot(host, 'desk'); await settle();
  assert.equal(lifx.log.length, 2, 'a failed read still waits 30 s');
});

/** A loopback hub serving a real, mutable shared owner, so a test can drive real state transitions through the running host. */
async function statusHub(t) {
  const owner = await createAgentState({ storage: new MemoryStorage(), ownerId: 'owner', consumers: [] });
  const server = createServer((_req, res) => res.end(JSON.stringify({ apiVersion: '1.0', ownerId: 'owner', connection: 'current', snapshot: owner.snapshot() })));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); server.close(); await owner.shutdown(); });
  return { url: `http://127.0.0.1:${server.address().port}`, owner };
}
test('the LIFX status publisher paints a bulb configured with a status block through the running host', async t => {
  const hub = await statusHub(t);
  const s = privateFiles(t, hub.url);
  const lifx = fakeLifx(), tidbyt = fakeTidbyt();
  const withStatus = h => ({
    ...h,
    lifx: {
      ...h.lifx,
      status: { hubUrl: hub.url, ownerId: 'owner', tokenFile: s.write('lifx-status-token', 't'.repeat(43)) },
      // Only 'desk' opts in with a custom brightness cap; 'shelf' stays unconfigured for status and must never paint.
      bulbs: [{ ...h.lifx.bulbs[0], status: { brightnessCapPercent: 40 } }, h.lifx.bulbs[1]],
    },
  });
  const config = loadHostConfig(s.write('host.json', withStatus(s.host)));
  const host = await startLocalControllers(config, {
    tidbyt: { connection: tidbyt.connection, leaseRoot: s.locks },
    // A dedicated, test-scoped mode directory: never the real default under the user's home.
    lifx: { transportFactory: lifx.transportFactory, leaseRoot: s.locks, modeStateRoot: join(s.dir, 'lifx-modes') },
  });
  t.after(() => host.close());
  const before = await snapshot(host, 'desk');
  assert.deepEqual(before.capabilities.modes, { supported: true, values: ['Work', 'Quiet', 'Free'] });
  assert.deepEqual(before.state.desired.mode, { status: 'known', value: 'Free' }, 'no recorded mode starts Free');
  await post(host, command(before, 'desk', 'mode.set', { mode: 'Work' }));
  await until(() => writes(lifx.log).some(([id, type]) => id === 'desk' && type === 102));
  const paint = writes(lifx.log).find(([id, type]) => id === 'desk' && type === 102);
  assert.ok(paint, 'entering Work paints the current (idle) state once');
  assert.deepEqual(reads(lifx.log, 'shelf'), [], "shelf has no status block and is never painted, even though it is qualified");
  assert.equal(writes(lifx.log).filter(([id, type]) => id === 'desk' && type === 102).length, 1);
  await host.close();
  // Closing stops the publisher cleanly; the shared cadence/transition/mode/failure/cap
  // semantics are covered thoroughly at the controllers/lifx level (status-publisher.test.mjs)
  // with fake timers and payload capture, so this integration test only confirms the host
  // wires private configuration to a running, per-bulb-opt-in publisher.
});
