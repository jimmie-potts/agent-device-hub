// The Tidbyt module on the simulated cloud and a manual clock (Hub #930): both tiles from synced records, the write gate
// under bursts, the refresh, removal, an unavailable or lost copy, failed, uncertain and held writes, a cloud that does
// not answer at start, rendering in a worker and its end at stop, a restart, the device record and its diagnostics.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {deviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {InProcessBus} from '@jimmie-potts/sdk';
import {nowPlayingFrame, nowPlayingView} from '../src/nowplaying.js';
import {picture} from '../src/picture.js';
import {statusFrame, statusView} from '../src/status.js';
import {createTidbytModule} from '../src/module.js';
import {SIMULATED_API_KEY, SIMULATED_DEVICE, SimulatedCloud} from '../src/simulated.js';
import type {PlaybackState, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {
  MINUTE, SECOND, SECTION, STATUS_ONLY, StandIn, asking, calls, finished, flush, host, identity, notice, playback, records, session, shown, test, unavailablePlayback, until,
  working, type Hosted,
} from './support.js';

const STATUS = 'agentdevicehub';
const NOW_PLAYING = 'nowplaying';
const label = (value: string): NonNullable<SessionRecord['label']> => ({value, origin: 'user'});
const statusPicture = (sessions: readonly SessionRecord[], synced = true): string[] => picture(statusFrame(statusView({synced, sessions})).rgb);
function cardPicture(record: PlaybackState, following = true, lostForMs = 0): string[] {
  const view = nowPlayingView({record, following, lostForMs});
  assert.ok(view.card, 'the record shows a card');
  return picture(nowPlayingFrame(view).rgb);
}
/** Waits a little real time, so a render that should not start would have shown up. */
const quiet = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 150); });
const core = (h: Hosted): StandIn<SessionRecord> => {
  if (h.core === undefined) throw new Error('no core');
  return h.core;
};
const owner = (h: Hosted): StandIn<PlaybackState> => {
  if (h.playback === undefined) throw new Error('no playback owner');
  return h.playback;
};
const pushes = (h: Hosted, installation = STATUS): number => shown(h, installation).pushes;

test('the status tile shows the synced sessions, and the now-playing tile what plays, each in its own installation', async context => {
  const sessions = [asking({label: label('review-bot')}), working({label: label('hub-work')}), finished({label: label('docs')})];
  const h = await host(context, {sessions, playback: playback('playing')});
  await until(() => pushes(h) === 1 && pushes(h, NOW_PLAYING) === 1, 'both tiles');
  assert.deepEqual(shown(h, STATUS).picture, statusPicture(core(h).records()));
  assert.deepEqual(shown(h, NOW_PLAYING).picture, cardPicture(playback('playing')));
  assert.equal(h.cloud.state().refusedKeys, 0, 'the cloud took the API key from the secret file');
  const device = h.device();
  assert.equal(device.kind, 'tidbyt');
  assert.equal(device.availability, 'available');
  assert.ok(device.lastTransmission.status === 'known' && device.lastTransmission.operationIds[0] === 'push');
  assert.deepEqual(h.problems(), []);
});

test('a burst of changes within 15 s makes one later push of the latest state, and nothing more without a change', async context => {
  const h = await host(context, {sessions: [working({label: label('one')})], section: STATUS_ONLY});
  await until(() => pushes(h) === 1, 'the first push');
  for (const name of ['two', 'three', 'four']) {
    await h.advance(SECOND);
    await core(h).set(working({identity: identity(), label: label(name)}));
  }
  await h.advance(15 * SECOND - 3 * SECOND - 100);
  await quiet();
  assert.equal(pushes(h), 1, 'nothing inside the minimum interval');
  await h.advance(100);
  await until(() => pushes(h) === 2, 'the gated push');
  assert.deepEqual(shown(h, STATUS).picture, statusPicture(core(h).records()), 'the push shows the latest state');
  const [first = 0, second = 0] = shown(h, STATUS).pushedAtMs;
  assert.equal(second - first, 15 * SECOND);
  await h.advance(MINUTE);
  await quiet();
  assert.equal(pushes(h), 2, 'no further push without a change');
  assert.deepEqual(h.problems(), []);
});

test('an unchanged frame is pushed again only after 10 minutes', async context => {
  const h = await host(context, {sessions: [working()], section: STATUS_ONLY});
  await until(() => pushes(h) === 1, 'the first push');
  await h.advance(10 * MINUTE - SECOND, SECOND);
  await quiet();
  assert.equal(pushes(h), 1);
  await h.advance(SECOND, SECOND);
  await until(() => pushes(h) === 2, 'the refresh');
});

test('an idle start removes leftover tiles once, after the listing shows them, and leaves absent ones alone', async context => {
  const leftover = await host(context, {cloud: {installations: [STATUS, NOW_PLAYING]}});
  await until(() => calls(leftover).filter(call => call.startsWith('DELETE')).length === 2, 'both removals');
  assert.deepEqual(calls(leftover).sort(), ['DELETE agentdevicehub', 'DELETE nowplaying', 'GET list', 'GET list']);
  await leftover.advance(10 * MINUTE, SECOND);
  assert.equal(calls(leftover).length, 4, 'no repeated removal or listing while idle');
  assert.deepEqual(leftover.cloud.state().installations, {});

  const gone = await host(context);
  await until(() => calls(gone).length === 2, 'both listings');
  await gone.advance(10 * MINUTE, SECOND);
  assert.deepEqual(calls(gone), ['GET list', 'GET list'], 'an absent installation is not deleted');
});

test('the status tile is removed once nothing is working, waiting or unacknowledged', async context => {
  const done = finished({label: label('docs')});
  const h = await host(context, {sessions: [done], section: STATUS_ONLY});
  await until(() => pushes(h) === 1, 'DONE');
  await h.advance(20 * SECOND);
  await core(h).set({...done, notices: [notice(['pixoo'])]});
  await until(() => calls(h).includes('DELETE agentdevicehub'), 'the removal');
  assert.deepEqual(calls(h), ['POST default', 'DELETE agentdevicehub'], 'a present installation is deleted without a listing');
  await h.advance(5 * MINUTE, SECOND);
  assert.equal(calls(h).length, 2);
});

test('a copy that stops following its owner dims the last rows and never removes the tile; FEED ? before any sync', async context => {
  const h = await host(context, {sessions: [working({label: label('kept')})], section: STATUS_ONLY, maxQueued: 2});
  await until(() => pushes(h) === 1, 'the first push');
  core(h).refuse = true;
  // A burst the module's subscription cannot hold makes its copy sync again, which the core now refuses.
  for (let i = 0; i < 6; i += 1) void core(h).set(working({identity: identity(), label: label(`burst-${i}`)}));
  await flush();
  await until(() => records(h, 'operation.failed').includes('warn feed unavailable bunny/core'), 'the lost copy\'s record');
  await h.advance(15 * SECOND);
  await until(() => pushes(h) === 2, 'the dimmed frame');
  const dimmed = shown(h, STATUS).picture.join('');
  assert.match(dimmed, /[a-z]/, 'the rows are still drawn');
  assert.doesNotMatch(dimmed, /[A-Z]/, 'every row is dimmed as uncertain');
  await h.advance(5 * MINUTE, SECOND);
  assert.equal(calls(h).filter(call => call.startsWith('DELETE')).length, 0, 'an unavailable feed never removes the tile');

  const lost = await host(context, {sessions: 'absent', section: STATUS_ONLY});
  await until(() => pushes(lost) === 1, 'FEED ?');
  assert.deepEqual(shown(lost, STATUS).picture, statusPicture([], false));
  // The core comes up; the module syncs again after its backoff, and the next push waits for the 15 s gate.
  const later = new StandIn<SessionRecord>(lost.bus.connect('bunny/core'), 'session');
  await later.open([working({label: label('back')})]);
  await lost.advance(2 * SECOND);
  await lost.advance(13 * SECOND);
  await until(() => pushes(lost) === 2, 'the rows');
  assert.deepEqual(shown(lost, STATUS).picture, statusPicture(later.records()));
  assert.deepEqual(records(lost, 'operation.failed'), ['warn feed unavailable bunny/core']);
  assert.deepEqual(records(lost, 'operation.completed').filter(entry => entry.includes('feed')), ['info feed bunny/core']);
});

test('nothing is written before the first sync settles: a slow core holds the status tile', async context => {
  const h = await host(context, {sessions: [working()], section: STATUS_ONLY, cloud: {installations: [STATUS]}, holdCore: true});
  await h.advance(2 * SECOND);
  await quiet();
  assert.deepEqual(calls(h), [], 'no write, and no removal of the tile, while the shown state is unknown');
  core(h).release();
  await h.started;
  await until(() => pushes(h) === 1, 'the push once the sessions are known');
  assert.ok(!calls(h).some(call => call.startsWith('DELETE')));
});

test('the now-playing tile follows pause, staleness and the end of playback, and writes nothing before what plays is known', async context => {
  const h = await host(context, {sessions: [], playback: playback('playing')});
  await until(() => pushes(h, NOW_PLAYING) === 1, 'the card');
  await h.advance(SECOND);
  await owner(h).set(playback('paused'));
  await h.advance(14 * SECOND);
  await until(() => pushes(h, NOW_PLAYING) === 2, 'the paused card');
  assert.deepEqual(shown(h, NOW_PLAYING).picture, cardPicture(playback('paused')));
  await owner(h).set(playback('paused', {availability: 'stale'}));
  await h.advance(15 * SECOND);
  await until(() => pushes(h, NOW_PLAYING) === 3, 'the stale card');
  assert.deepEqual(shown(h, NOW_PLAYING).picture, cardPicture(playback('paused', {availability: 'stale'})));
  assert.doesNotMatch(shown(h, NOW_PLAYING).picture.join(''), /[A-Z]/, 'a stale card is dimmed');
  await owner(h).set(unavailablePlayback());
  await h.advance(15 * SECOND);
  await until(() => calls(h).includes('DELETE nowplaying'), 'the removal');
  await h.advance(2 * MINUTE, SECOND);
  assert.equal(calls(h).filter(call => call === 'DELETE nowplaying').length, 1, 'removal happens once');

  // A playback module that starts a moment after the Tidbyt never makes it remove a playing card.
  const late = await host(context, {sessions: [], playback: 'absent', cloud: {installations: [NOW_PLAYING]}});
  await late.advance(5 * SECOND, SECOND);
  const started = new StandIn<PlaybackState>(late.bus.connect('bunny/modules/playback'), 'playback');
  await started.open([playback('playing')]);
  await late.advance(10 * SECOND, SECOND);
  await until(() => pushes(late, NOW_PLAYING) === 1, 'the card after the late sync');
  assert.equal(calls(late).filter(call => call.endsWith(NOW_PLAYING)).filter(call => call.startsWith('DELETE')).length, 0);

  // With no playback module at all, a leftover card is removed once 30 s have passed.
  const none = await host(context, {sessions: [], playback: 'absent', cloud: {installations: [NOW_PLAYING]}});
  await none.advance(29 * SECOND, SECOND);
  await quiet();
  assert.ok(!calls(none).includes('DELETE nowplaying'));
  await none.advance(6 * SECOND, SECOND);
  await until(() => calls(none).includes('DELETE nowplaying'), 'the leftover card\'s removal');
});

test('a playback copy that stops following keeps a dimmed card for 30 s, then removes it', async context => {
  const h = await host(context, {sessions: [], playback: playback('playing'), maxQueued: 2});
  await until(() => pushes(h, NOW_PLAYING) === 1, 'the card');
  owner(h).refuse = true;
  for (let i = 0; i < 6; i += 1) void owner(h).set(playback('playing', {}, {title: `Song ${i}`, artist: 'Band'}));
  await flush();
  await until(() => records(h, 'operation.failed', true).includes('warn feed unavailable bunny/modules/playback'), 'the lost copy');
  await h.advance(15 * SECOND, SECOND);
  await until(() => pushes(h, NOW_PLAYING) === 2, 'the dimmed card');
  assert.doesNotMatch(shown(h, NOW_PLAYING).picture.join(''), /[A-Z]/, 'the card is dimmed while the copy is lost');
  await h.advance(16 * SECOND, SECOND);
  await until(() => calls(h).includes('DELETE nowplaying'), 'the removal 30 s after the loss');
});

test('a failed push is not replayed, repeated failures back off, and an uncertain one makes presence unknown', async context => {
  const h = await host(context, {sessions: [working()], section: STATUS_ONLY, before: cloud => { cloud.answerNext(400); }});
  await until(() => calls(h).length === 1, 'the refused push');
  assert.deepEqual(records(h, 'operation.failed'), ['warn status push invalid-request']);
  assert.equal(h.device().availability, 'degraded');
  await h.advance(15 * SECOND - 100);
  await quiet();
  assert.equal(calls(h).length, 1, 'no new push within the minimum interval');
  await h.advance(100);
  await until(() => pushes(h) === 1, 'a fresh push for the current state');
  assert.equal(h.device().availability, 'available');

  // Every write refused: the waits double from 15 s up to the 10-minute refresh.
  const refused = await host(context, {sessions: [], section: STATUS_ONLY, cloud: {installations: [STATUS]}, before: cloud => { cloud.answerAlways(400); }});
  await until(() => calls(refused).includes('DELETE agentdevicehub'), 'the first removal');
  const at: number[] = [];
  let seen = calls(refused).filter(call => call === 'DELETE agentdevicehub').length;
  for (let second = 1; second <= 60 * 60; second += 1) {
    await refused.advance(SECOND, SECOND);
    const now = calls(refused).filter(call => call === 'DELETE agentdevicehub').length;
    if (now !== seen) {
      seen = now;
      at.push(second);
    }
  }
  assert.deepEqual(at.slice(0, 5), [15, 45, 105, 225, 465]);
  assert.equal(refused.devices().at(-1)?.availability, 'degraded');
  assert.equal(refused.devices().filter(device => device.availability === 'degraded').length, 1, 'repeated refusals publish no new revision');
  assert.ok(at.slice(6).every((second, i) => second - (at[i + 5] ?? 0) === 600), 'capped at the 10-minute refresh period');
  assert.deepEqual(records(refused, 'operation.failed'), ['warn status list invalid-request'], 'one record for the run of failures');

  // A push that may have taken effect makes presence unknown, so a later idle state reads the list before deleting.
  const uncertain = await host(context, {sessions: [working()], section: STATUS_ONLY, before: cloud => { cloud.answerNext(502); }});
  await until(() => calls(uncertain).length === 1, 'the uncertain push');
  const [only] = core(uncertain).records();
  if (only === undefined) throw new Error('no session');
  await uncertain.advance(SECOND);
  await core(uncertain).set({...only, activity: 'idle'});
  await uncertain.advance(14 * SECOND);
  await until(() => calls(uncertain).length === 2, 'the listing');
  assert.deepEqual(calls(uncertain), ['POST default', 'GET list'], 'nothing to delete: the uncertain push left nothing');
});

test('the gate runs from the moment a push goes out, so a slow render never brings the next push closer', async context => {
  const slow = new URL('./fixtures/slow-worker.js', import.meta.url);
  const h = await host(context, {sessions: [working({label: label('one')})], section: STATUS_ONLY, module: {renderWorker: slow}});
  await until(() => h.harness.runningWorkers() === 1, 'the slow render');
  // The clock moves on while the frame renders, so the push goes out 5 s after the decision to make it.
  h.clock.advance(5 * SECOND);
  await until(() => pushes(h) === 1, 'the first push');
  await h.advance(SECOND);
  await core(h).set(asking({label: label('two')}));
  await h.advance(14 * SECOND - 100);
  await quiet();
  assert.equal(pushes(h), 1, 'the gate counts from the push, not from the decision before the render');
  await h.advance(100);
  await until(() => pushes(h) === 2, 'the next push');
  const [first = 0, second = 0] = shown(h, STATUS).pushedAtMs;
  assert.ok(second - first >= 15 * SECOND, `the pushes went out ${second - first} ms apart`);
});

test('a refused key holds every later call, and a rate limit holds them for its Retry-After', async context => {
  const h = await host(context, {sessions: [working()], playback: playback('playing'), cloud: {key: 'another-key'}});
  await until(() => calls(h).length >= 1 && h.device().availability === 'unavailable', 'the refusal');
  await h.advance(10 * MINUTE, 10 * SECOND);
  await core(h).set(asking());
  await h.advance(10 * MINUTE, 10 * SECOND);
  assert.equal(calls(h).length, 1, 'no request under the authentication hold');
  assert.deepEqual(records(h, 'operation.failed').filter(entry => entry.includes('unauthenticated')).length, 1);

  const limited = await host(context, {sessions: [working()], section: STATUS_ONLY, before: cloud => { cloud.answerNext(429, '30'); }});
  await until(() => calls(limited).length === 1, 'the rate-limited push');
  assert.equal(limited.device().availability, 'degraded');
  assert.deepEqual(records(limited, 'operation.failed'), ['warn status push capacity']);
  await limited.advance(29 * SECOND, SECOND);
  await quiet();
  assert.equal(calls(limited).length, 1, 'held for Retry-After');
  await limited.advance(2 * SECOND, SECOND);
  await until(() => pushes(limited) === 1, 'the push after the hold');
  assert.equal(limited.device().availability, 'available');
});

test('a cloud that does not answer at start never delays the start, makes the Tidbyt unavailable and logs one degradation and one recovery', async context => {
  const started = performance.now();
  const h = await host(context, {sessions: [working()], section: STATUS_ONLY, cloud: {online: false}, module: {callTimeoutMs: 2000}});
  assert.ok(performance.now() - started < 1000, 'start opens only local resources');
  await until(() => calls(h).length === 1, 'the push that hangs');
  await h.advance(2 * SECOND);
  await until(() => h.device().availability === 'unavailable', 'the device unavailable');
  for (let minute = 0; minute < 10; minute += 1) await h.advance(MINUTE, SECOND);
  assert.ok(calls(h).length > 3, 'the module kept trying, with backoff');
  const down = records(h, 'device.unavailable');
  assert.equal(down[0], 'warn uncertain-result 1');
  assert.ok(down.slice(1).every(entry => entry.startsWith('debug')), 'later failures are summarized at DEBUG');
  h.cloud.online();
  await h.advance(10 * MINUTE, SECOND);
  await until(() => pushes(h) === 1, 'the push once the cloud answers');
  assert.equal(h.device().availability, 'available');
  assert.equal(records(h, 'device.available').length, 1, 'one recovery');
  assert.equal(records(h, 'device.unavailable').filter(entry => entry.startsWith('warn')).length, 1, 'one degradation');
  assert.deepEqual(h.problems(), []);
});

test('rendering runs in a worker thread, which the module\'s stop ends, and nothing is pushed after the stop', async context => {
  const hang = new URL('./fixtures/hang-worker.js', import.meta.url);
  const h = await host(context, {sessions: [working()], section: STATUS_ONLY, module: {renderWorker: hang}});
  await until(() => h.harness.runningWorkers() === 1, 'the render in its worker');
  await h.stop();
  assert.equal(h.harness.runningWorkers(), 0, 'the stop ended the render');
  await quiet();
  assert.deepEqual(calls(h), [], 'nothing was pushed');
  assert.deepEqual(h.problems(), []);
  assert.deepEqual(records(h, 'operation.failed'), [], 'a render cancelled by the stop is no failure');

  const failing = await host(context, {sessions: [working()], section: STATUS_ONLY, module: {renderWorker: new URL('./fixtures/fail-worker.js', import.meta.url)}});
  await until(() => records(failing, 'operation.failed').length === 1, 'the failed render');
  assert.deepEqual(records(failing, 'operation.failed'), ['warn status render uncertain-result']);
  await failing.advance(15 * SECOND);
  await until(() => failing.harness.runningWorkers() === 0, 'the second render');
  await quiet();
  assert.deepEqual(calls(failing), [], 'a failed render sends nothing');
  assert.equal(records(failing, 'operation.failed').length, 1, 'one record for the run of failed renders');
  assert.deepEqual(failing.problems(), []);
});

test('a restart writes nothing while the tile stands, keeps the 15 s gate, and the record\'s revision keeps rising', async context => {
  const h = await host(context, {sessions: [working({label: label('kept')})], section: STATUS_ONLY});
  await until(() => pushes(h) === 1, 'the first push');
  const before = h.device().revision;
  await h.advance(5 * SECOND);
  await h.restart();
  await quiet();
  assert.equal(pushes(h), 1, 'an unchanged tile is not pushed again at restart');
  assert.ok(h.device().revision > before, 'the revision rises across the restart');
  await core(h).set(asking({label: label('asks')}));
  await h.advance(9 * SECOND);
  await quiet();
  assert.equal(pushes(h), 1, 'the gate holds across the restart');
  await h.advance(SECOND);
  await until(() => pushes(h) === 2, 'the change after the gate');
  const [first = 0, second = 0] = shown(h, STATUS).pushedAtMs;
  assert.equal(second - first, 15 * SECOND);
  assert.deepEqual(h.problems(), []);
});

test('polling that changes nothing publishes nothing, and the device record offers no control', async context => {
  const h = await host(context, {sessions: [working()], section: STATUS_ONLY});
  await until(() => pushes(h) === 1 && h.device().availability === 'available', 'the first push');
  const published = h.devices().length;
  await h.advance(5 * MINUTE, SECOND);
  assert.equal(h.devices().length, published, 'no new revision');
  const device = h.device();
  assert.ok(Object.values(device.capabilities).every(capability => !capability.supported), 'every control unsupported');
  assert.deepEqual([device.pending, device.pendingKinds, device.observed, device.lastOutcome], [0, [], {status: 'unknown'}, {status: 'unknown'}]);
  const requester = h.bus.connect('bunny/parts/operator');
  context.after(() => requester.close());
  const draft = {type: 'org.bunny.power.set.requested', subject: 'tidbyt', dataschema: 'https://bunny.invalid/events/power-set/2.0', data: {on: true}};
  const refused = await requester.request('bunny.cmd.power-set.tidbyt', draft, {timeoutMs: 5000});
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'unsupported-capability');
  const wrong = await requester.request('bunny.cmd.power-set.tidbyt', {...draft, subject: 'other'}, {timeoutMs: 5000});
  assert.equal(wrong.status === 'rejected' && wrong.error.error.code, 'invalid-request');
  // `device` is a family several modules serve, so a reader names this module as its owner (#967). An SDK without
  // owner-addressed sync ignores the name and routes to the family's one owner.
  const owned = {timeoutMs: 5000, owner: 'bunny/modules/tidbyt'};
  const sync = await requester.sync(['device'], () => {}, owned);
  assert.equal(sync.status, 'synced');
  if (sync.status === 'synced') assert.deepEqual(sync.copy.states().map(state => state.data), [h.device()]);
  assert.ok(deviceFamilies.length > 0);
});

test('neither the API key nor the cloud device ID appears in any message, record or span', async context => {
  const h = await host(context, {sessions: [asking(), working()], playback: playback('playing')});
  await until(() => pushes(h) === 1 && pushes(h, NOW_PLAYING) === 1, 'both tiles');
  const text = JSON.stringify([h.published, h.logs(), h.spans.spans]);
  assert.ok(!text.includes(SIMULATED_API_KEY), 'no API key');
  assert.ok(!text.includes(SIMULATED_DEVICE), 'no cloud device ID');
});

test('a second writer for the same cloud device is refused its lease, writes nothing and reports the Tidbyt unavailable', async context => {
  const h = await host(context, {sessions: [working()], section: STATUS_ONLY});
  await until(() => pushes(h) === 1, 'the first writer\'s push');
  const cloud = new SimulatedCloud();
  const second = new ModuleHarness(createTidbytModule({transport: cloud.fetch}), {
    bus: new InProcessBus(), stateDir: h.stateDir, section: SECTION, secrets: {token: SIMULATED_API_KEY},
  });
  context.after(() => second.stop());
  await second.start();
  await quiet();
  assert.deepEqual(second.logs.filter(entry => entry.event === 'operation.failed').map(entry => [entry.level, entry.fields['bunny.reason']]), [['warn', 'busy']]);
  assert.deepEqual(cloud.state().calls, [], 'the second writer reached no cloud');
});

test('a database that refuses commits is logged once per run, and the device record is published once it works again', async context => {
  const h = await host(context, {sessions: [working()], section: STATUS_ONLY});
  await until(() => pushes(h) === 1 && h.device().availability === 'available', 'the first push');
  const revision = h.device().revision;
  const lock = new DatabaseSync(join(h.stateDir, 'tidbyt.sqlite'));
  lock.exec('BEGIN IMMEDIATE');
  await core(h).set(asking());
  await h.advance(15 * SECOND);
  await until(() => pushes(h) === 2, 'the push while the database is locked');
  await until(() => records(h, 'operation.failed').length === 1, 'the refused commit');
  assert.deepEqual(records(h, 'operation.failed'), ['warn storage unavailable']);
  assert.equal(h.device().revision, revision, 'nothing was published that did not commit');
  lock.exec('ROLLBACK');
  lock.close();
  await h.advance(30 * SECOND, SECOND);
  await until(() => h.device().revision > revision, 'the record once the database works');
  assert.deepEqual(records(h, 'operation.completed').filter(entry => entry.includes('storage')), ['info storage']);
  assert.deepEqual(h.problems(), []);
});

test('session records the copy does not show are left out: a child session, and one with nothing outstanding', async context => {
  const parent = working({label: label('parent')});
  const h = await host(context, {sessions: [parent, working({identity: identity(), parent: {status: 'known', identity: {...parent.identity, sessionId: 'child'}}}), session()], section: STATUS_ONLY});
  await until(() => pushes(h) === 1, 'the push');
  assert.deepEqual(shown(h, STATUS).picture, statusPicture([parent]));
});
