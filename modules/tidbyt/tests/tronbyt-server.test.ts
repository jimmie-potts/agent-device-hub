// The optional compatibility check against a real Tronbyt server (Hub #23): it needs no device, and skips unless
// `TRONBYT_QUALIFY_URL`, `TRONBYT_QUALIFY_DEVICE` and `TRONBYT_QUALIFY_KEY` name a disposable server, whose device's
// installations and pin it changes. See "Compatibility record" in the module's README. Hosted CI runs it as skipped.
import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import {BRIGHTNESS_CEILING, MOMENT_INSTALLATION, TronbytConnection} from '../src/tronbyt.js';
import type {CloudFetch} from '../src/cloud.js';
import {SECOND, finished, host, notice, until} from './support.js';

const url = process.env.TRONBYT_QUALIFY_URL;
const device = process.env.TRONBYT_QUALIFY_DEVICE;
const key = process.env.TRONBYT_QUALIFY_KEY;
const deviceKey = process.env.TRONBYT_QUALIFY_KEY_KIND === 'device';
const skip = url === undefined || device === undefined || key === undefined ? 'no disposable server is named' : false;
const signal = (): AbortSignal => AbortSignal.timeout(5000);
const STATUS = 'qualifystatus';
const CARD = 'qualifycard';
const realFetch: CloudFetch = (target, init) => fetch(target, init);

async function server<T>(path = ''): Promise<T> {
  const response = await fetch(`${url ?? ''}/v0/devices/${device ?? ''}${path}`, {headers: {authorization: `Bearer ${key ?? ''}`}});
  assert.equal(response.status, 200);
  return await response.json() as T;
}
type Device = {brightness: number; pinnedApp: string | null};
type Installation = {id: string; pushed: boolean; pinned: boolean};
const installations = async (): Promise<Installation[]> => (await server<{installations: Installation[]}>('/installations')).installations;

const FRAME = Buffer.from('UklGRiIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=', 'base64');

void nodeTest('the connection\'s every call against a real server, with what the simulated server assumes', {skip, timeout: 60_000}, async () => {
  const connection = new TronbytConnection({url: url ?? '', deviceId: device ?? '', apiKey: key ?? '', installationId: STATUS, additionalInstallationIds: [CARD], fetch: realFetch});
  await connection.unpin(signal());
  await connection.remove(signal());
  await connection.remove(signal(), CARD);
  assert.deepEqual(await connection.list(signal()), {ok: true, present: false}, 'an installation it does not have');
  assert.deepEqual(await connection.remove(signal()), {outcome: 'sent'}, 'removing one that is gone');
  assert.deepEqual(await connection.pin(signal()), {outcome: 'failed', failure: 'invalid-request'}, 'pinning one that is gone');

  assert.deepEqual(await connection.push(FRAME, signal()), {outcome: 'sent'});
  assert.deepEqual(await connection.list(signal()), {ok: true, present: true}, 'found by the name a push chose');
  const first = await server<Installation>(`/installations/${STATUS}`);
  assert.ok(first.pushed && first.id !== STATUS, 'the server gives it its own ID');
  assert.ok((await installations()).every(entry => entry.id !== STATUS), 'the list carries only those IDs, so it cannot answer presence');

  assert.deepEqual(await connection.pin(signal()), {outcome: 'sent'});
  assert.equal((await server<Device>()).pinnedApp, first.id);
  assert.deepEqual(await connection.remove(signal()), {outcome: 'sent'});
  assert.equal((await server<Device>()).pinnedApp, first.id, 'deleting a pinned installation leaves the pin, which is why the module clears it');
  assert.deepEqual(await connection.unpin(signal()), {outcome: 'sent'});
  assert.equal((await server<Device>()).pinnedApp, null);

  assert.deepEqual(await connection.push(FRAME, signal(), CARD, true), {outcome: 'sent'}, 'an interrupting push with no device connected');
  const before = (await installations()).length;
  assert.deepEqual(await connection.push(FRAME, signal(), CARD, true), {outcome: 'sent'});
  assert.equal((await installations()).length, before, 'a named push replaces its own');
  await connection.remove(signal(), CARD);

  assert.deepEqual(await connection.setBrightness(100, signal()), {outcome: 'sent'});
  assert.equal((await server<Device>()).brightness, BRIGHTNESS_CEILING);
  const wrongKey = new TronbytConnection({url: url ?? '', deviceId: device ?? '', apiKey: 'wrong-key', installationId: STATUS, fetch: realFetch});
  assert.deepEqual(await wrongKey.push(FRAME, signal()), {outcome: 'failed', failure: 'unauthenticated'});
  const wrongDevice = new TronbytConnection({url: url ?? '', deviceId: 'nosuchdevice', apiKey: key ?? '', installationId: STATUS, fetch: realFetch});
  // A user key hears 404 for a device that does not exist, and a device key 403 for any device but its own.
  const refusal = {outcome: 'failed', failure: deviceKey ? 'forbidden' : 'unknown-device'};
  assert.deepEqual(await wrongDevice.push(FRAME, signal()), refusal);
  assert.deepEqual(await wrongDevice.remove(signal()), refusal, deviceKey ? 'a device key reaches only its device' : 'a missing device is not a missing installation');
});

void nodeTest('a moment\'s takeover against a real server: the read of the pin, the pin, and a release that clears only its own', {skip, timeout: 60_000}, async () => {
  const connection = new TronbytConnection({url: url ?? '', deviceId: device ?? '', apiKey: key ?? '', installationId: STATUS, additionalInstallationIds: [CARD], fetch: realFetch});
  await connection.unpin(signal());
  assert.deepEqual(await connection.releaseMoment(signal()), {outcome: 'sent'}, 'a release with nothing to release');
  assert.deepEqual(await connection.serverPin(signal()), {pinned: false});
  assert.deepEqual(await connection.pushMoment(FRAME, signal()), {outcome: 'sent'});
  assert.deepEqual(await connection.pinMoment(signal()), {outcome: 'sent'});
  const moment = await server<Installation>(`/installations/${MOMENT_INSTALLATION}`);
  assert.ok(moment.pinned);
  assert.equal((await server<Device>()).pinnedApp, moment.id);
  assert.deepEqual(await connection.serverPin(signal()), {pinned: true});
  assert.deepEqual(await connection.releaseMoment(signal()), {outcome: 'sent'});
  assert.equal((await server<Device>()).pinnedApp, null, 'its own pin goes with it');
  assert.ok((await installations()).every(entry => entry.id !== moment.id), 'and so does the installation');

  // A pin someone else holds stays through a release.
  assert.deepEqual(await connection.push(FRAME, signal()), {outcome: 'sent'});
  assert.deepEqual(await connection.pin(signal()), {outcome: 'sent'});
  const other = (await server<Device>()).pinnedApp;
  assert.deepEqual(await connection.pushMoment(FRAME, signal()), {outcome: 'sent'});
  assert.deepEqual(await connection.releaseMoment(signal()), {outcome: 'sent'});
  assert.equal((await server<Device>()).pinnedApp, other, 'a release never clears another installation\'s pin');
  await connection.unpin(signal());
  await connection.remove(signal());
});

void nodeTest('the module draws its status tile on a real server at a shorter gate, and its pin follows the tile', {skip, timeout: 60_000}, async context => {
  const done = finished();
  const section = {id: 'tidbyt', backend: 'tronbyt', tronbyt: {url, deviceId: device, minIntervalMs: 1000}, statusInstallation: STATUS, secrets: {token: '/nowhere'}};
  const h = await host(context, {sessions: [done], playback: 'absent', section, secret: key ?? '', module: {transport: realFetch}});
  const standing = async (installation: string): Promise<boolean> => (await fetch(`${url ?? ''}/v0/devices/${device ?? ''}/installations/${installation}`, {headers: {authorization: `Bearer ${key ?? ''}`}})).ok;
  for (let waited = 0; waited < 100 && !await standing(STATUS); waited += 1) await new Promise(resolve => { setTimeout(resolve, 100); });
  assert.ok(await standing(STATUS), 'the tile');
  await until(() => h.device().availability === 'available', 'the record of the first answer');

  // Writes one second apart, each answered: the shortest gate the section takes, qualified on the server alone.
  for (let index = 0; index < 5; index += 1) {
    await h.core?.set({...done, label: {value: `frame ${String(index)}`, origin: 'user'}});
    await h.advance(1100);
    await until(() => h.harness.runningWorkers() === 0, 'a render');
  }
  assert.equal(h.device().availability, 'available');
  // The stand-in core's fixture notices are its own; what the module published must conform.
  assert.deepEqual(h.problems().filter(problem => !problem.startsWith('org.bunny.session.')), []);

  const operator = h.bus.connect('bunny/parts/operator');
  context.after(() => operator.close());
  const accepted = await operator.request('bunny.cmd.device-mode-set.tidbyt', {
    type: 'org.bunny.device-mode.set.requested', subject: 'tidbyt', dataschema: 'https://bunny.invalid/events/device-mode-set/2.0', data: {mode: 'pin-status'},
  }, {timeoutMs: 5000});
  assert.equal(accepted.status, 'accepted');
  for (let waited = 0; waited < 50 && (await server<Device>()).pinnedApp === null; waited += 1) await new Promise(resolve => { setTimeout(resolve, 100); });
  const status = (await server<Installation>(`/installations/${STATUS}`)).id;
  assert.equal((await server<Device>()).pinnedApp, status);

  await h.core?.set({...done, notices: [notice(['pixoo'])]});
  await h.advance(2 * SECOND);
  for (let waited = 0; waited < 50 && (await server<Device>()).pinnedApp !== null; waited += 1) await new Promise(resolve => { setTimeout(resolve, 100); });
  assert.equal((await server<Device>()).pinnedApp, null, 'the pin leaves with the tile');
});
