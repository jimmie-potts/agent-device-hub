import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import sharp from 'sharp';
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';
import {SimulatedTronbyt, TRONBYT_ORIGIN} from '../src/simulated-tronbyt.js';
import {SIMULATED_DEVICE} from '../src/simulated.js';
import {MAX_ART_COPIES} from '../src/art.js';
import {acquireLease, type Lease} from '../src/lease.js';
import {artStage, gifFrames} from './art-fixtures.js';
import {asking, flush, host, test, until, withWriteFailure, type Hosted} from './support.js';

const section = {id: 'tidbyt', backend: 'tronbyt', tronbyt: {url: TRONBYT_ORIGIN, deviceId: SIMULATED_DEVICE}, secrets: {token: '/nowhere/tronbyt-token'}};
export async function artRequest(h: Hosted, family: 'art-stage' | 'art-ambient-set', data: Record<string, unknown> & {requestId: string}, source = 'bunny/core') {
  const client = h.bus.connect(source);
  const type = family === 'art-stage' ? 'org.bunny.art.stage.requested' : 'org.bunny.art-ambient.set.requested';
  const result = await client.request(`bunny.cmd.${family}.tidbyt`, {type, subject: 'tidbyt', dataschema: `${SCHEMA_BASE}${family}/2.0`, data}, {timeoutMs: 5000, requestId: data.requestId});
  await client.close();
  return result.status === 'rejected' ? {status: result.status, code: result.error.error.code} : {status: result.status};
}
async function exactMoment(h: Hosted, requestId: string, extra: object = {}, source = 'bunny/core') {
  const client = h.bus.connect(source);
  const result = await client.request('bunny.cmd.moment-play.tidbyt', {type: 'org.bunny.moment.play.requested', subject: 'tidbyt', dataschema: `${SCHEMA_BASE}moment-play/2.1`, data: {
    requestId, momentId: requestId, mood: 'celebrate', art: {compositionId: artStage().compositionId}, durationMs: 40_000,
    priorityClass: 'event', coversStatus: true, startAtMs: h.wall(), toleranceMs: 10_000, ...extra,
  }}, {timeoutMs: 5000, requestId});
  await client.close();
  return result.status === 'rejected' ? {status: result.status, code: result.error.error.code} : {status: result.status};
}
async function ambientStatus(h: Hosted): Promise<{selected: {compositionId: string; sha256: string} | null; presence: string; transmitted: {compositionId: string; sha256: string; atMs: number} | null; held: boolean; suppressed: boolean; visible: string}> {
  const result = await h.content('art-status');
  assert.ok(result !== undefined && !('error' in result));
  return JSON.parse(Buffer.from(result.bytes).toString()) as Awaited<ReturnType<typeof ambientStatus>>;
}

test('staging validates and stores exact art without a display write, then remembers its receipt after reopen', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch}});
  await until(() => server.state().calls.some(call => call.method === 'PATCH'), 'initial pin reconciliation');
  const before = server.state().calls.length;
  const data = {...artStage(), requestId: 'stage-first'};
  assert.deepEqual(await artRequest(h, 'art-stage', data), {status: 'accepted'});
  assert.equal(server.state().calls.length, before, 'preparation has no display effect');
  const completed = () => [...new Map(h.published.filter(message => message.type === 'org.bunny.art.stage.completed').map(message => [message.id, message])).values()];
  assert.deepEqual(completed().at(-1)?.data, {requestId: data.requestId, result: 'succeeded', evidence: 'observed'});
  const preview = await h.content(`art.${data.compositionId}`);
  assert.ok(preview !== undefined && !('error' in preview));
  assert.equal(preview.type, 'image/webp');
  assert.deepEqual((await sharp(preview.bytes, {animated: true}).metadata()).delay, [200, 200]);
  const info = await h.content(`art-info.${data.compositionId}`);
  assert.ok(info !== undefined && !('error' in info));
  assert.deepEqual(JSON.parse(Buffer.from(info.bytes).toString()), {compositionId: data.compositionId, sourceSha256: data.sha256, expiresAtMs: h.wall() + data.lifetimeMs,
    width: 64, height: 32, frames: 2, durationMs: 400, delaysMs: [200, 200], bytes: preview.bytes.length, sha256: createHash('sha256').update(preview.bytes).digest('hex'), visible: 'unverified'});
  await h.restart();
  assert.deepEqual(await artRequest(h, 'art-stage', data), {status: 'accepted'});
  assert.equal(completed().length, 1, 'the committed request never runs twice');
  assert.deepEqual(await h.content(`art.${data.compositionId}`), preview, 'the exact output survives reopen');
  assert.deepEqual(h.problems(), []);
});

test('art identities, sender checks and malformed media refuse before changing the copy or display', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch}});
  const first = {...artStage(), requestId: 'identity-first'};
  assert.deepEqual(await artRequest(h, 'art-stage', first, 'bunny/modules/art'), {status: 'rejected', code: 'forbidden'});
  assert.deepEqual(await artRequest(h, 'art-stage', first), {status: 'accepted'});
  const preview = await h.content(`art.${first.compositionId}`);
  const changed = artStage(gifFrames([{index: 3, delay: 200}, {index: 2, delay: 200}]));
  assert.deepEqual(await artRequest(h, 'art-stage', {...changed, requestId: 'identity-conflict'}), {status: 'rejected', code: 'duplicate-conflict'});
  assert.deepEqual(await artRequest(h, 'art-stage', {...first, frames: 1, requestId: 'lying-repeat'}), {status: 'rejected', code: 'invalid-request'});
  assert.deepEqual(await artRequest(h, 'art-stage', {...first, requestId: 'identity-first', lifetimeMs: 60_000}), {status: 'rejected', code: 'duplicate-conflict'});
  const broken = Buffer.from(first.base64, 'base64').subarray(0, -1);
  assert.deepEqual(await artRequest(h, 'art-stage', {...artStage(broken, {compositionId: 'b'.repeat(64)}), requestId: 'malformed'}), {status: 'rejected', code: 'invalid-request'});
  assert.deepEqual(await artRequest(h, 'art-ambient-set', {compositionId: 'b'.repeat(64), requestId: 'missing'}), {status: 'rejected', code: 'not-found'});
  assert.deepEqual(await h.content(`art.${first.compositionId}`), preview);
  assert.equal(server.state().calls.filter(call => call.method === 'POST').length, 0);
  assert.deepEqual(h.problems(), []);
});

test('the cloud offers no art and rejects it without attempting a write', async context => {
  const h = await host(context, {sessions: [], playback: 'absent'});
  assert.deepEqual(await artRequest(h, 'art-stage', {...artStage(), requestId: 'cloud-stage'}), {status: 'rejected', code: 'unsupported-capability'});
  assert.deepEqual(await artRequest(h, 'art-ambient-set', {compositionId: null, requestId: 'cloud-select'}), {status: 'rejected', code: 'unsupported-capability'});
  assert.equal(await h.content(`art.${artStage().compositionId}`), undefined);
  assert.deepEqual(h.device().capabilities.moments, {supported: false});
  assert.deepEqual(h.problems(), []);
});

test('a failed private commit leaves neither a copy nor a receipt and the same request can later succeed', async context => {
  const server = new SimulatedTronbyt();
  let armed = false;
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch}, wrapDatabase: db => withWriteFailure(db, () => {
    if (!armed) return undefined;
    armed = false;
    return Object.assign(new Error('synthetic full disk'), {code: 'SQLITE_FULL'});
  })});
  await until(() => server.state().calls.some(call => call.method === 'PATCH'), 'initial reconciliation');
  armed = true;
  const stage = {...artStage(), requestId: 'failed-stage'};
  assert.deepEqual(await artRequest(h, 'art-stage', stage), {status: 'rejected', code: 'unavailable'});
  const missing = await h.content(`art.${stage.compositionId}`);
  assert.ok(missing !== undefined && 'error' in missing && missing.error.code === 'not-found');
  assert.equal(h.published.some(message => message.type === 'org.bunny.art.stage.completed'), false);
  assert.deepEqual(await artRequest(h, 'art-stage', stage), {status: 'accepted'});
  await h.restart();
  assert.deepEqual(await artRequest(h, 'art-stage', stage), {status: 'accepted'});
  assert.deepEqual(h.problems(), []);
});

test('renewal extends a held copy, while an expired reference is refused and does not reveal preview bytes', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch}});
  const stage = {...artStage(undefined, {lifetimeMs: 60_000}), requestId: 'short-stage'};
  assert.deepEqual(await artRequest(h, 'art-stage', stage), {status: 'accepted'});
  await h.advance(40_000);
  assert.deepEqual(await artRequest(h, 'art-stage', {...stage, requestId: 'renew-stage'}), {status: 'accepted'});
  await h.advance(30_000);
  const current = await h.content(`art.${stage.compositionId}`);
  assert.ok(current !== undefined && !('error' in current));
  await h.advance(31_000);
  const expired = await h.content(`art.${stage.compositionId}`);
  assert.ok(expired !== undefined && 'error' in expired && expired.error.code === 'not-found');
  assert.deepEqual(await artRequest(h, 'art-ambient-set', {compositionId: stage.compositionId, requestId: 'expired-selection'}), {status: 'rejected', code: 'not-found'});
  assert.equal(server.state().calls.filter(call => call.method === 'POST').length, 0);
  assert.deepEqual(h.problems(), []);
});

test('ambient art joins background rotation in interrupt mode and leaves it for attention', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch}});
  await until(() => server.state().calls.some(call => call.method === 'PATCH'), 'initial reconciliation');
  const operator = h.bus.connect('bunny/parts/operator');
  await operator.request('bunny.cmd.device-mode-set.tidbyt', {type: 'org.bunny.device-mode.set.requested', subject: 'tidbyt', dataschema: `${SCHEMA_BASE}device-mode-set/2.0`, data: {requestId: 'interrupt', mode: 'interrupt'}}, {timeoutMs: 5000, requestId: 'interrupt'});
  await until(() => {const mode = h.device().desired.mode; return mode.status === 'known' && mode.value === 'interrupt';}, 'interrupt mode');
  assert.deepEqual(await artRequest(h, 'art-stage', {...artStage(), requestId: 'stage-ambient'}), {status: 'accepted'});
  assert.deepEqual(await artRequest(h, 'art-ambient-set', {compositionId: artStage().compositionId, requestId: 'select-ambient'}), {status: 'accepted'});
  await until(() => server.state().installations.bunnyart !== undefined, 'the separate ambient installation', 1000);
  assert.equal(server.state().installations.bunnyart?.immediate, 0);
  assert.equal(server.state().pinnedApp, null);
  const native = server.state().installations.bunnyart?.animation;
  assert.deepEqual(native?.delaysMs, [200, 200]);
  assert.notDeepEqual(native?.frames[0], native?.frames[1]);
  const status = await ambientStatus(h);
  assert.equal(status.presence, 'present');
  assert.equal(status.visible, 'unverified');
  assert.equal(status.transmitted?.compositionId, artStage().compositionId);
  await h.core?.set(asking());
  await h.advance(15_000);
  await until(() => server.state().installations.bunnyart === undefined, 'attention removes ambient art');
  assert.equal((await ambientStatus(h)).selected?.compositionId, artStage().compositionId, 'suppression preserves selection');
  assert.deepEqual(h.problems(), []);
});

test('missing, expired, cloud and untrusted art moments refuse without a mood picture or display write', async context => {
  const server = new SimulatedTronbyt();
  let moods = 0;
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch, momentPicture: () => {moods += 1; return Promise.resolve(new Uint8Array());}}});
  assert.deepEqual(await exactMoment(h, 'missing-art'), {status: 'rejected', code: 'not-found'});
  assert.deepEqual(await artRequest(h, 'art-stage', {...artStage(undefined, {lifetimeMs: 60_000}), requestId: 'short-exact'}), {status: 'accepted'});
  assert.deepEqual(await exactMoment(h, 'untrusted-art', {}, 'bunny/parts/operator'), {status: 'rejected', code: 'forbidden'});
  await h.advance(61_000);
  assert.deepEqual(await exactMoment(h, 'expired-art'), {status: 'rejected', code: 'not-found'});
  const cloud = await host(context, {sessions: [], playback: 'absent'});
  assert.deepEqual(await exactMoment(cloud, 'cloud-art'), {status: 'rejected', code: 'unsupported-capability'});
  assert.equal(moods, 0);
  assert.equal(server.state().calls.filter(call => call.method === 'POST').length, 0);
  assert.deepEqual(h.problems(), []);
});

test('a moment keeps its admitted bytes across expiry and restaging, and restart releases it without replay', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch}});
  const stage = artStage(undefined, {lifetimeMs: 60_000});
  assert.deepEqual(await artRequest(h, 'art-stage', {...stage, requestId: 'capture-stage'}), {status: 'accepted'});
  const preview = await h.content(`art.${stage.compositionId}`);
  assert.ok(preview !== undefined && !('error' in preview));
  const nativeHash = createHash('sha256').update(preview.bytes).digest('hex');
  assert.deepEqual(await exactMoment(h, 'capture-moment', {startAtMs: h.wall() + 50_000, durationMs: 60_000}), {status: 'accepted'});
  await h.advance(51_000);
  await until(() => server.state().installations.bunnymoment !== undefined, 'future exact moment');
  assert.equal(server.state().installations.bunnymoment?.animation?.sha256, nativeHash);
  await h.advance(10_000);
  const replacement = artStage(gifFrames([{index: 3, delay: 200}, {index: 2, delay: 200}]));
  assert.deepEqual(await artRequest(h, 'art-stage', {...replacement, requestId: 'replace-expired'}), {status: 'accepted'});
  assert.equal(server.state().installations.bunnymoment?.animation?.sha256, nativeHash);
  assert.equal(server.state().installations.bunnymoment?.pushes, 1);
  await h.restart();
  await until(() => server.state().installations.bunnymoment === undefined, 'restart release');
  assert.equal(server.state().calls.filter(call => call.method === 'POST').length, 1, 'restart never resumes a takeover');
  assert.deepEqual(await exactMoment(h, 'capture-moment', {startAtMs: h.wall() + 50_000, durationMs: 60_000}), {status: 'rejected', code: 'duplicate-conflict'});
  assert.deepEqual(h.problems(), []);
});

test('an art moment admits schema 2.1 and takes the exact staged copy without invoking its mood picture', async context => {
  const server = new SimulatedTronbyt();
  let moods = 0;
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch, momentPicture: () => {moods += 1; return Promise.reject(new Error('no mood fallback'));}}});
  await until(() => server.state().calls.some(call => call.method === 'PATCH'), 'initial reconciliation');
  assert.deepEqual(await artRequest(h, 'art-stage', {...artStage(), requestId: 'stage-moment'}), {status: 'accepted'});
  const client = h.bus.connect('bunny/core');
  const result = await client.request('bunny.cmd.moment-play.tidbyt', {type: 'org.bunny.moment.play.requested', subject: 'tidbyt', dataschema: `${SCHEMA_BASE}moment-play/2.1`, data: {
    requestId: 'exact-moment', momentId: 'exact-moment', mood: 'celebrate', art: {compositionId: artStage().compositionId}, durationMs: 40_000, priorityClass: 'event', coversStatus: true, startAtMs: h.wall(), toleranceMs: 10_000,
  }}, {timeoutMs: 5000, requestId: 'exact-moment'});
  assert.equal(result.status, 'accepted');
  await until(() => server.state().installations.bunnymoment !== undefined && server.state().pinnedApp !== null, 'exact takeover');
  assert.equal(moods, 0);
  await h.advance(41_000);
  await until(() => server.state().installations.bunnymoment === undefined, 'release');
  assert.deepEqual(h.problems(), []);
});

test('full staging capacity preserves every live copy and admits new work once copies expire', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch}});
  const stage = artStage(undefined, {lifetimeMs: 60_000});
  for (let index = 0; index < MAX_ART_COPIES; index += 1) {
    assert.deepEqual(await artRequest(h, 'art-stage', {...stage, compositionId: index.toString(16).padStart(64, '0'), requestId: `capacity-${index}`}), {status: 'accepted'});
  }
  const extra = {...stage, compositionId: 'f'.repeat(64), requestId: 'capacity-extra'};
  assert.deepEqual(await artRequest(h, 'art-stage', extra), {status: 'rejected', code: 'capacity'});
  const first = await h.content(`art.${'0'.repeat(64)}`);
  assert.ok(first !== undefined && !('error' in first), 'capacity does not evict an existing live copy');
  assert.equal(server.state().calls.filter(call => call.method === 'POST').length, 0);
  await h.advance(61_000);
  assert.deepEqual(await artRequest(h, 'art-stage', extra), {status: 'accepted'});
  const expired = await h.content(`art.${'0'.repeat(64)}`);
  assert.ok(expired !== undefined && 'error' in expired && expired.error.code === 'not-found');
  assert.deepEqual(h.problems(), []);
});

test('stopping a stage in its worker commits no late copy or receipt and restart never replays it', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch, renderWorker: new URL('./fixtures/hang-worker.js', import.meta.url)}});
  const stage = {...artStage(), requestId: 'stop-stage'};
  const requesting = artRequest(h, 'art-stage', stage);
  await until(() => h.harness.runningWorkers() === 1, 'stage worker');
  await h.stop();
  assert.notEqual((await requesting).status, 'accepted');
  await h.start();
  const absent = await h.content(`art.${stage.compositionId}`);
  assert.ok(absent !== undefined && 'error' in absent && absent.error.code === 'not-found');
  assert.equal(h.harness.runningWorkers(), 0);
  assert.equal(h.published.some(message => message.type === 'org.bunny.art.stage.completed'), false);
  assert.deepEqual(h.problems(), []);
});

test('a manual pin holds ambient removal; lost session knowledge suppresses the saved selection after reopen', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch}});
  const stage = artStage();
  await artRequest(h, 'art-stage', {...stage, requestId: 'pin-stage'});
  await artRequest(h, 'art-ambient-set', {compositionId: stage.compositionId, requestId: 'pin-select'});
  await until(() => server.state().installations.bunnyart !== undefined, 'ambient art');
  server.pinByHand('bunnyart');
  await h.core?.set(asking());
  await h.advance(16_000);
  assert.ok(server.state().installations.bunnyart !== undefined, 'attention cannot delete a manually pinned tile');
  assert.equal((await ambientStatus(h)).held, true);
  assert.equal((await ambientStatus(h)).suppressed, true);
  server.pinByHand('missing');
  await h.advance(6000);
  await until(() => server.state().installations.bunnyart === undefined, 'removal after the owner releases the pin');
  for (const record of h.core?.records() ?? []) await h.core?.set({...record, attention: []});
  await h.advance(16_000);
  await until(() => server.state().installations.bunnyart !== undefined, 'saved selection returns');
  assert.ok(h.core !== undefined);
  h.core.refuse = true;
  await h.restart();
  await h.advance(16_000);
  await until(() => server.state().installations.bunnyart === undefined, 'unknown attention suppresses art');
  assert.equal((await ambientStatus(h)).selected?.compositionId, stage.compositionId);
  assert.equal((await ambientStatus(h)).suppressed, true);
  assert.deepEqual(h.problems(), []);
});

test('a superseded selection waiting on the pin read never resurrects after attention', async context => {
  const server = new SimulatedTronbyt();
  let hold = false, entered = false, artPushes = 0;
  let release: () => void = () => {};
  const wait = new Promise<void>(resolve => {release = resolve;});
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: async (url, init) => {
    if (init.method === 'POST' && (JSON.parse(init.body ?? '{}') as {installationID?: string}).installationID === 'bunnyart') artPushes += 1;
    if (hold && init.method === 'GET' && url.endsWith(`/devices/${SIMULATED_DEVICE}`)) {hold = false; entered = true; await wait;}
    return server.fetch(url, init);
  }}});
  const stage = artStage();
  await artRequest(h, 'art-stage', {...stage, requestId: 'queued-stage'});
  hold = true;
  await artRequest(h, 'art-ambient-set', {compositionId: stage.compositionId, requestId: 'queued-select'});
  await until(() => entered, 'held server pin read');
  await h.core?.set(asking());
  await artRequest(h, 'art-ambient-set', {compositionId: null, requestId: 'supersede-selection'});
  release(); await flush(); await h.advance(16_000);
  assert.equal(server.state().installations.bunnyart, undefined);
  assert.equal((await ambientStatus(h)).selected, null);
  assert.equal(artPushes, 0, 'the superseded composition never reached the server');
  for (const record of h.core?.records() ?? []) await h.core?.set({...record, attention: []});
  await h.advance(16_000);
  assert.equal(server.state().installations.bunnyart, undefined, 'clearing attention cannot revive a superseded selection');
  assert.equal(artPushes, 0);
  assert.deepEqual(h.problems(), []);
});

test('a lost removal reply keeps presence unknown; restart reads absence and never replays the old art', async context => {
  const server = new SimulatedTronbyt();
  let loseRemoval = false;
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: (url, init) => {
    if (loseRemoval && init.method === 'DELETE' && url.endsWith('/bunnyart')) {loseRemoval = false; server.loseNextAnswer();}
    return server.fetch(url, init);
  }}});
  const stage = artStage();
  await artRequest(h, 'art-stage', {...stage, requestId: 'uncertain-stage'});
  await artRequest(h, 'art-ambient-set', {compositionId: stage.compositionId, requestId: 'uncertain-select'});
  await until(() => server.state().installations.bunnyart !== undefined, 'ambient art');
  loseRemoval = true;
  assert.deepEqual(await artRequest(h, 'art-ambient-set', {compositionId: null, requestId: 'uncertain-remove'}), {status: 'accepted'});
  await h.advance(26_000);
  await until(() => server.state().installations.bunnyart === undefined, 'server processed removal');
  assert.equal((await ambientStatus(h)).presence, 'unknown', 'a committed selection does not turn an unanswered removal into success');
  assert.equal((await ambientStatus(h)).selected, null);
  const removes = () => server.state().calls.filter(call => call.method === 'DELETE' && call.path.endsWith('/bunnyart')).length;
  assert.equal(removes(), 1);
  await h.restart(); await h.advance(16_000);
  assert.equal((await ambientStatus(h)).presence, 'absent');
  assert.equal(removes(), 1, 'the list settles absence without a repeat delete');
  assert.equal(server.state().calls.filter(call => call.method === 'POST').length, 1, 'nothing replays the removed composition');
  assert.deepEqual(h.problems(), []);
});

test('an expired ambient identity cannot show replacement bytes until explicitly selected again', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch}});
  const stage = artStage(undefined, {lifetimeMs: 60_000});
  await artRequest(h, 'art-stage', {...stage, requestId: 'expiring-ambient'});
  await artRequest(h, 'art-ambient-set', {compositionId: stage.compositionId, requestId: 'select-expiring'});
  await until(() => server.state().installations.bunnyart !== undefined, 'ambient art');
  await h.advance(61_000);
  await until(() => server.state().installations.bunnyart === undefined, 'expired copy leaves rotation');
  const replacement = artStage(gifFrames([{index: 3, delay: 200}, {index: 2, delay: 200}]));
  await artRequest(h, 'art-stage', {...replacement, requestId: 'new-bytes-same-id'});
  await h.advance(16_000);
  assert.equal(server.state().installations.bunnyart, undefined, 'staging new bytes cannot revive an old saved selection');
  assert.equal(server.state().calls.filter(call => call.method === 'POST').length, 1);
  assert.equal((await ambientStatus(h)).selected?.sha256, stage.sha256);
  await artRequest(h, 'art-ambient-set', {compositionId: stage.compositionId, requestId: 'select-new-bytes'});
  await until(() => server.state().installations.bunnyart !== undefined, 'explicit replacement selection');
  assert.equal((await ambientStatus(h)).selected?.sha256, replacement.sha256);
  assert.deepEqual(h.problems(), []);
});

test('another writer lease prevents staging, selection and exact moments before private mutation', async context => {
  let held: Lease | undefined;
  context.after(() => {held?.release();});
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [], playback: 'absent', section, module: {transport: server.fetch}, before: (_cloud, stateDir) => {
    const taken = acquireLease(join(stateDir, 'tidbyt', 'leases'), `tronbyt/${SIMULATED_DEVICE}`);
    assert.equal(taken.status, 'held');
    if (taken.status === 'held') held = taken.lease;
  }});
  assert.deepEqual(await artRequest(h, 'art-stage', {...artStage(), requestId: 'lease-stage'}), {status: 'rejected', code: 'unavailable'});
  assert.deepEqual(await artRequest(h, 'art-ambient-set', {compositionId: null, requestId: 'lease-select'}), {status: 'rejected', code: 'unavailable'});
  assert.deepEqual(await exactMoment(h, 'lease-moment'), {status: 'rejected', code: 'unavailable'});
  assert.deepEqual(server.state().calls, []);
  const missing = await h.content(`art.${artStage().compositionId}`);
  assert.ok(missing !== undefined && 'error' in missing && missing.error.code === 'not-found');
  assert.deepEqual(h.problems(), []);
});
