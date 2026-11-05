// Moments on a Tronbyt server (Hub #337): the bounded takeover, what it yields to, what is left after a failure or a
// restart, and the seam that supplies its picture, on `SimulatedTronbyt`. The evidence stays a transmission throughout.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import type {MomentPlayRequest} from '@jimmie-potts/event-contracts/v2/families';
import type {CloudFetch} from '../src/cloud.js';
import {configureTidbyt} from '../src/configuration.js';
import {ControlStore, MOMENT_MAX_DURATION_MS, MOMENT_MIN_HOLD_MS, MOMENT_PICTURE_TIMEOUT_MS, PIN_RETRY_MS, REMEMBERED} from '../src/control.js';
import {MOMENT_MOODS, momentFrame, momentView} from '../src/moment-card.js';
import {picture} from '../src/picture.js';
import {FRAME_HEIGHT, FRAME_WIDTH, renderFrame} from '../src/render.js';
import {SimulatedTronbyt, TRONBYT_ORIGIN} from '../src/simulated-tronbyt.js';
import {SIMULATED_DEVICE} from '../src/simulated.js';
import {renderTile} from '../src/tiles.js';
import {MOMENT_INSTALLATION} from '../src/tronbyt.js';
import {SECOND, asking, finished, flush, host, playback, records, test, until, withWriteFailure, working, type Hosted, type HostOptions} from './support.js';

const STATUS = 'agentdevicehub';
const NOW_PLAYING = 'nowplaying';
const section = {
  id: 'tidbyt', backend: 'tronbyt', tronbyt: {url: TRONBYT_ORIGIN, deviceId: SIMULATED_DEVICE}, statusInstallation: STATUS,
  nowPlaying: {playback: 'living-room', installation: NOW_PLAYING}, secrets: {token: '/nowhere/tronbyt-token'},
};
const onServer = (server: SimulatedTronbyt): {section: object; module: {transport: CloudFetch}} => ({section, module: {transport: server.fetch}});
const operators = new WeakMap<Hosted, ReturnType<Hosted['bus']['connect']>>();

let sent = 0;
/** Plays a moment that starts now, unless told otherwise: an event that may cover status. */
async function play(h: Hosted, overrides: Partial<MomentPlayRequest> = {}): Promise<{status: string; code?: string}> {
  sent += 1;
  const data: MomentPlayRequest = {
    requestId: `moment-request-${String(sent)}`, momentId: `moment-${String(sent)}`, mood: 'celebrate', durationMs: 40 * SECOND, priorityClass: 'event',
    coversStatus: true, startAtMs: h.wall(), toleranceMs: 10 * SECOND, ...overrides,
  };
  return await request(h, 'moment-play', 'org.bunny.moment.play.requested', {...data});
}
async function request(h: Hosted, family: string, type: string, data: {requestId: string} & Record<string, unknown>): Promise<{status: string; code?: string}> {
  const client = operators.get(h) ?? h.bus.connect('bunny/parts/operator');
  operators.set(h, client);
  const result = await client.request(`bunny.cmd.${family}.tidbyt`, {type, subject: 'tidbyt', dataschema: `${SCHEMA_BASE}${family}/2.0`, data}, {timeoutMs: 5000, requestId: data.requestId});
  return result.status === 'rejected' ? {status: 'rejected', code: result.error.error.code} : {status: result.status};
}
const mode = (h: Hosted, requestId: string, value: string): Promise<{status: string; code?: string}> =>
  request(h, 'device-mode-set', 'org.bunny.device-mode.set.requested', {requestId, mode: value});

type Outcome = {requestId: string; result: string; evidence: string; error?: {code: string}};
const outcomes = (h: Hosted): Outcome[] =>
  [...new Map(h.published.filter((message: Message) => message.dataschema === `${SCHEMA_BASE}outcome/2.0` && message.type === 'org.bunny.moment.play.completed').map(message => [message.id, message.data as Outcome])).values()];
const momentCalls = (server: SimulatedTronbyt): string[] => server.state().calls
  .filter(call => call.path.endsWith(`/${MOMENT_INSTALLATION}`) || (call.path.endsWith('/push') && call.method === 'POST'))
  .map(call => `${call.method} ${call.path.endsWith('/push') ? 'push' : 'installation'}`);
const cardStands = (server: SimulatedTronbyt): boolean => server.state().installations[MOMENT_INSTALLATION] !== undefined;
const taken = (server: SimulatedTronbyt): boolean => {
  const {installations, pinnedApp} = server.state();
  return pinnedApp !== null && installations[MOMENT_INSTALLATION]?.serverId === pinnedApp;
};
/** A module on an idle display, past its first evaluation. */
async function onIdle(context: Parameters<typeof host>[0], server: SimulatedTronbyt, options: HostOptions = {}): Promise<Hosted> {
  const h = await host(context, {sessions: [], playback: 'absent', ...onServer(server), ...options});
  await until(() => server.state().calls.some(call => call.method === 'PATCH'), 'the first selection\'s pin');
  return h;
}

test('the Tronbyt backend declares moments, and the cloud refuses them and declares none', async context => {
  const server = new SimulatedTronbyt();
  const h = await onIdle(context, server);
  assert.deepEqual(h.device().capabilities.moments, {supported: true, moods: [...MOMENT_MOODS], maxDurationMs: MOMENT_MAX_DURATION_MS, coversStatus: true, art: {formats: ['png', 'gif'], maxBytes: 163_840}});
  const onCloud = await host(context, {sessions: [], playback: 'absent'});
  assert.deepEqual(onCloud.device().capabilities.moments, {supported: false});
  assert.deepEqual(await play(onCloud), {status: 'rejected', code: 'unsupported-capability'});
  assert.deepEqual(onCloud.problems(), []);
});

test('a moment interrupts at once, holds its pin for its time, returns to the rotation and claims only a transmission', async context => {
  const server = new SimulatedTronbyt();
  const session = finished();
  const h = await host(context, {sessions: [session], playback: playback('playing'), ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().installations[NOW_PLAYING]?.pushes === 1, 'both tiles');
  await until(() => h.device().availability === 'available', 'the record of the first answer');
  const revision = h.device().configurationRevision;
  assert.deepEqual(await play(h, {durationMs: 45 * SECOND}), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  const card = server.state().installations[MOMENT_INSTALLATION];
  assert.equal(card?.pushes, 1);
  assert.equal(card?.immediate, 1, 'the push interrupts the display');
  assert.deepEqual(h.device().pendingKinds, ['moment-play']);
  assert.deepEqual(card?.picture, picture(momentFrame(momentView({mood: 'celebrate'})).rgb, FRAME_WIDTH, FRAME_HEIGHT), 'the mood card');

  // What the rotation should show moves on during the hold, in the background, and the takeover stands.
  await h.core?.set({...session, label: {value: 'moved on', origin: 'user'}});
  await h.advance(44 * SECOND, SECOND);
  assert.ok(taken(server), 'it stands until its time');
  assert.equal(outcomes(h).length, 0, 'the outcome follows the release');
  assert.equal(server.state().installations[STATUS]?.pushes, 2);
  assert.equal(server.state().installations[STATUS]?.immediate, 0, 'a tile takes its turn in the background');

  await h.advance(2 * SECOND);
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.deepEqual(outcomes(h)[0], {requestId: outcomes(h)[0]?.requestId, result: 'succeeded', evidence: 'transmitted'});
  assert.equal(server.state().pinnedApp, null);
  assert.ok(!cardStands(server), 'the card leaves the rotation');
  assert.ok(server.state().installations[STATUS] !== undefined && server.state().installations[NOW_PLAYING] !== undefined, 'the tiles stay');
  const device = h.device();
  assert.deepEqual(device.observed, {status: 'unknown'}, 'the server never says what the panel shows');
  assert.deepEqual(device.desired.mode, {status: 'known', value: 'rotation'}, 'a moment changes no mode');
  assert.equal(device.configurationRevision, revision);
  assert.equal(device.pending, 0);
  assert.equal(server.state().anonymous, 0);
  // The stand-in core's fixture notices are its own; what the module published must conform.
  assert.deepEqual(h.problems().filter(problem => !problem.startsWith('org.bunny.session.')), []);
});

test('the bounds: a short moment holds the floor, a long one is refused, and a window is kept', async context => {
  const server = new SimulatedTronbyt();
  const h = await onIdle(context, server);
  assert.deepEqual(await play(h, {durationMs: MOMENT_MAX_DURATION_MS + 1}), {status: 'rejected', code: 'unsupported-capability'});
  assert.deepEqual(await play(h, {mood: 'unknown-mood'}), {status: 'rejected', code: 'unsupported-capability'});
  assert.deepEqual(await play(h, {startAtMs: h.wall() - 11 * SECOND}), {status: 'rejected', code: 'expired'});
  assert.deepEqual(momentCalls(server), [], 'a refusal sends nothing');

  assert.deepEqual(await play(h, {durationMs: 3 * SECOND}), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  await h.advance(MOMENT_MIN_HOLD_MS - SECOND, SECOND);
  assert.ok(taken(server), 'a moment of a few seconds holds the floor');
  await h.advance(2 * SECOND);
  await until(() => outcomes(h).length === 1 && !cardStands(server), 'the end');

  // A later start waits for its time.
  assert.deepEqual(await play(h, {startAtMs: h.wall() + 20 * SECOND}), {status: 'accepted'});
  await h.advance(19 * SECOND, SECOND);
  assert.ok(!cardStands(server), 'nothing before the start');
  await h.advance(2 * SECOND);
  await until(() => taken(server), 'the later start');
  assert.deepEqual(h.problems(), []);
});

test('attention keeps a moment off the display, and ends one at once', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [asking()], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1, 'the tile');
  assert.deepEqual(await play(h), {status: 'rejected', code: 'invalid-state'}, 'attention already stands');
  assert.deepEqual(momentCalls(server).filter(call => call !== 'POST push'), []);

  for (const record of h.core?.records() ?? []) await h.core?.set({...record, attention: []});
  await h.advance(SECOND);
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  await h.core?.set(asking());
  await until(() => !cardStands(server) && server.state().pinnedApp === null, 'the release at once, without any time passing');
  await until(() => outcomes(h).length === 1, 'the outcome');
  const [ended] = outcomes(h);
  assert.equal(ended?.result, 'failed');
  assert.equal(ended?.evidence, 'transmitted', 'it was transmitted before it yielded');
  assert.equal(ended?.error?.code, 'cancelled');
  assert.equal(server.state().installations[MOMENT_INSTALLATION], undefined);
  assert.deepEqual(h.problems().filter(problem => !problem.startsWith('org.bunny.session.')), []);
});

test('in the interrupt mode a tile waits out a takeover, and the attention that ends one interrupts', async context => {
  const server = new SimulatedTronbyt();
  const session = working();
  const h = await host(context, {sessions: [session], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the tile');
  assert.deepEqual(await mode(h, 'interrupt', 'interrupt'), {status: 'accepted'});
  await h.advance(SECOND);
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  await h.core?.set({...session, label: {value: 'moved on', origin: 'user'}});
  await h.advance(16 * SECOND, SECOND);
  await until(() => server.state().installations[STATUS]?.pushes === 2, 'the tile\'s push behind the moment');
  assert.equal(server.state().installations[STATUS]?.immediate, 0);
  await h.core?.set({...asking(), identity: session.identity, id: session.id});
  await h.advance(16 * SECOND, SECOND);
  await until(() => server.state().installations[STATUS]?.pushes === 3, 'the attention');
  assert.equal(server.state().installations[STATUS]?.immediate, 1);
  assert.ok(!cardStands(server));
});

test('attention during a moment\'s wait for its start ends it with nothing written', async context => {
  const server = new SimulatedTronbyt();
  const h = await onIdle(context, server);
  assert.deepEqual(await play(h, {startAtMs: h.wall() + 20 * SECOND}), {status: 'accepted'});
  await h.core?.set(asking());
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.equal(outcomes(h)[0]?.result, 'failed');
  assert.equal(outcomes(h)[0]?.evidence, 'none');
  assert.equal(outcomes(h)[0]?.error?.code, 'invalid-state');
  await h.advance(21 * SECOND, SECOND);
  assert.equal(server.state().installations[MOMENT_INSTALLATION], undefined);
});

test('sessions the module cannot follow refuse a moment and end one', async context => {
  const server = new SimulatedTronbyt();
  const h = await onIdle(context, server, {maxQueued: 2});
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  // Messages the copy cannot queue stop it following its owner, with no time passing.
  const core = h.core;
  assert.ok(core !== undefined);
  core.refuse = true;
  for (let index = 0; index < 6; index += 1) void core.set(working({label: {value: `burst ${String(index)}`, origin: 'user'}}));
  await until(() => !cardStands(server) && outcomes(h).length === 1, 'the release');
  assert.equal(outcomes(h)[0]?.error?.code, 'cancelled');
  assert.deepEqual(await play(h), {status: 'rejected', code: 'invalid-state'}, 'nothing plays while attention is unknown');
});

test('a pin the owner set wins: its mode refuses a moment, and one set by hand is never cleared', async context => {
  const server = new SimulatedTronbyt();
  const session = finished();
  const h = await host(context, {sessions: [session], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the tile');

  assert.deepEqual(await mode(h, 'pin', 'pin-status'), {status: 'accepted'});
  await until(() => server.state().pinnedApp !== null, 'the owner\'s pin');
  await h.advance(SECOND);
  const pinned = server.state().pinnedApp;
  assert.deepEqual(await play(h), {status: 'rejected', code: 'invalid-state'}, 'the mode');
  assert.deepEqual(await mode(h, 'free', 'rotation'), {status: 'accepted'});
  await until(() => server.state().pinnedApp === null, 'back to the rotation');
  await h.advance(SECOND);

  // A pin set on the server's own page: the module learns of it only by reading.
  server.pinByHand(STATUS);
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => outcomes(h).length === 1, 'the moment yields');
  assert.equal(outcomes(h)[0]?.result, 'failed');
  assert.equal(outcomes(h)[0]?.evidence, 'none');
  assert.equal(outcomes(h)[0]?.error?.code, 'invalid-state');
  assert.equal(server.state().pinnedApp, pinned, 'that pin stands');
  assert.equal(server.state().installations[MOMENT_INSTALLATION], undefined, 'nothing was written');
  assert.deepEqual(h.problems().filter(problem => !problem.startsWith('org.bunny.session.')), []);
});

test('a pin set by hand during a moment survives its release', async context => {
  const server = new SimulatedTronbyt();
  const session = finished();
  const h = await host(context, {sessions: [session], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the tile');
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  server.pinByHand(STATUS);
  const pinned = server.state().pinnedApp;
  await h.advance(41 * SECOND, SECOND);
  await until(() => outcomes(h).length === 1, 'the end');
  assert.equal(server.state().pinnedApp, pinned);
  assert.ok(!cardStands(server));
});

test('any other command ends a moment, and its own write stands', async context => {
  const server = new SimulatedTronbyt();
  const session = finished();
  const h = await host(context, {sessions: [session], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the tile');
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  assert.deepEqual(await mode(h, 'pin', 'pin-status'), {status: 'accepted'});
  await until(() => outcomes(h).length === 1 && !cardStands(server), 'the release');
  assert.equal(outcomes(h)[0]?.error?.code, 'cancelled');
  assert.equal(server.state().pinnedApp, server.state().installations[STATUS]?.serverId, 'the owner\'s pin stands');
  assert.deepEqual(h.device().desired.mode, {status: 'known', value: 'pin-status'});

  assert.deepEqual(await mode(h, 'free', 'rotation'), {status: 'accepted'});
  await until(() => server.state().pinnedApp === null, 'back to the rotation');
  assert.deepEqual(await play(h, {startAtMs: h.wall() + 5 * SECOND}), {status: 'accepted'});
  assert.deepEqual(await request(h, 'brightness-set', 'org.bunny.brightness.set.requested', {requestId: 'dim', percent: 10}), {status: 'accepted'});
  await until(() => outcomes(h).length === 2, 'a moment that had not started');
  assert.equal(outcomes(h)[1]?.error?.code, 'cancelled');
  assert.equal(outcomes(h)[1]?.evidence, 'none');
  await h.advance(6 * SECOND);
  assert.ok(!cardStands(server));
});

test('a flourish never covers status, and an event may', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [working()], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1, 'the tile');
  assert.deepEqual(await play(h, {priorityClass: 'flourish', coversStatus: false}), {status: 'rejected', code: 'invalid-state'});
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => taken(server), 'the event');
  await h.advance(41 * SECOND, SECOND);
  await until(() => outcomes(h).length === 1, 'its end');
  assert.equal(outcomes(h)[0]?.result, 'succeeded');
});

test('a flourish over nothing plays, and yields when an agent starts', async context => {
  const server = new SimulatedTronbyt();
  const h = await onIdle(context, server);
  assert.deepEqual(await play(h, {priorityClass: 'flourish', coversStatus: false}), {status: 'accepted'});
  await until(() => taken(server), 'the flourish');
  await h.core?.set(working());
  await until(() => outcomes(h).length === 1 && !cardStands(server), 'its end');
  assert.equal(outcomes(h)[0]?.error?.code, 'cancelled');
});

test('one moment at a time, each moment once, and a repeat of a request changes nothing', async context => {
  const server = new SimulatedTronbyt();
  const h = await onIdle(context, server);
  const data = {requestId: 'r-1', momentId: 'm-1'};
  assert.deepEqual(await play(h, data), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  assert.deepEqual(await play(h), {status: 'rejected', code: 'capacity'}, 'another while it holds');
  await h.advance(41 * SECOND, SECOND);
  await until(() => outcomes(h).length === 1 && !cardStands(server), 'its end');
  assert.deepEqual(await play(h, {momentId: 'm-1'}), {status: 'rejected', code: 'invalid-state'}, 'a moment ID plays once');
  const repeated = {requestId: 'r-2', momentId: 'm-2', startAtMs: h.wall()};
  assert.deepEqual(await play(h, repeated), {status: 'accepted'});
  assert.deepEqual(await play(h, repeated), {status: 'accepted'}, 'a repeat of the request is answered as before');
  assert.deepEqual(await play(h, {...repeated, durationMs: 31 * SECOND}), {status: 'rejected', code: 'duplicate-conflict'});
  await until(() => taken(server), 'its one takeover');
  await h.advance(41 * SECOND, SECOND);
  await until(() => outcomes(h).length === 2 && !cardStands(server), 'its end');
  assert.equal(momentCalls(server).filter(call => call === 'POST push').length, 2, 'one push for each moment');
  assert.ok(!cardStands(server));
});

test('nothing replays after a restart: a takeover a stop left is released, and the moment is reported, never run again', async context => {
  const server = new SimulatedTronbyt();
  const h = await onIdle(context, server);
  assert.deepEqual(await play(h, {requestId: 'r-held', momentId: 'm-held'}), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  await h.stop();
  assert.ok(taken(server), 'a stop cannot reach the server');
  const pushes = momentCalls(server).filter(call => call === 'POST push').length;
  await h.start();
  await until(() => !cardStands(server) && server.state().pinnedApp === null, 'the release at the next start');
  await until(() => outcomes(h).length === 1, 'the report');
  assert.equal(outcomes(h)[0]?.result, 'uncertain');
  assert.equal(outcomes(h)[0]?.error?.code, 'uncertain-result');
  await h.advance(61 * SECOND, SECOND);
  assert.equal(momentCalls(server).filter(call => call === 'POST push').length, pushes, 'no second push');
  assert.deepEqual(await play(h, {requestId: 'r-again', momentId: 'm-held'}), {status: 'rejected', code: 'invalid-state'}, 'its ID stays spent');
  assert.deepEqual(h.problems(), []);
});

test('a stop before a moment\'s start writes nothing, then or later', async context => {
  const server = new SimulatedTronbyt();
  const h = await onIdle(context, server);
  assert.deepEqual(await play(h, {startAtMs: h.wall() + 30 * SECOND}), {status: 'accepted'});
  await h.restart();
  await until(() => outcomes(h).length === 1, 'the report');
  assert.equal(outcomes(h)[0]?.result, 'failed');
  assert.equal(outcomes(h)[0]?.error?.code, 'cancelled');
  await h.advance(31 * SECOND, SECOND);
  assert.deepEqual(momentCalls(server), []);
});

test('a push that goes unanswered is never sent again, and is released', async context => {
  const server = new SimulatedTronbyt();
  let lose = false;
  const transport: CloudFetch = async (url, init) => {
    if (lose && init.method === 'POST') {
      lose = false;
      server.loseNextAnswer();
    }
    return await server.fetch(url, init);
  };
  const h = await onIdle(context, server, {module: {transport}});
  lose = true;
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => momentCalls(server).length === 1, 'the push');
  assert.equal(outcomes(h).length, 0);
  await h.advance(11 * SECOND);
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.equal(outcomes(h)[0]?.result, 'uncertain');
  assert.equal(outcomes(h)[0]?.evidence, 'none');
  assert.equal(momentCalls(server).filter(call => call === 'POST push').length, 1, 'one push');
  assert.equal(server.state().pinnedApp, null);
  assert.ok(!cardStands(server), 'a fresh release removes what the push may have left');
  assert.deepEqual(h.problems(), []);
});

test('a pin the server refuses ends the moment at once, transmitted', async context => {
  const server = new SimulatedTronbyt();
  const h = await onIdle(context, server);
  server.answerNextPatch(400);
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.equal(outcomes(h)[0]?.result, 'failed');
  assert.equal(outcomes(h)[0]?.evidence, 'transmitted');
  assert.ok(!cardStands(server), 'the frame it took is released');
});

test('a release that fails is a fresh one later, and no moment plays until it is answered', async context => {
  const server = new SimulatedTronbyt();
  const h = await onIdle(context, server);
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  server.answerNextPatch(500);
  await h.advance(41 * SECOND, SECOND);
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.equal(outcomes(h)[0]?.result, 'uncertain');
  assert.equal(outcomes(h)[0]?.evidence, 'transmitted');
  assert.ok(cardStands(server), 'it may still stand');
  assert.deepEqual(await play(h), {status: 'rejected', code: 'unavailable'});
  const failed = (): string[] => records(h, 'operation.failed').filter(record => record.includes(' moment '));
  assert.equal(failed().length, 1, 'the failure is on record');
  server.answerNextPatch(500);
  await h.advance(PIN_RETRY_MS + 31 * SECOND, SECOND);
  assert.ok(cardStands(server), 'a second failure');
  assert.equal(failed().length, 1, 'one record per run of failures');
  assert.equal(records(h, 'operation.completed').filter(record => record.includes(' moment')).length, 0);
  await h.advance(PIN_RETRY_MS + 31 * SECOND, SECOND);
  await until(() => !cardStands(server) && server.state().pinnedApp === null, 'the release');
  assert.equal(records(h, 'operation.completed').filter(record => record.includes(' moment')).length, 1, 'and its recovery');
  assert.deepEqual(await play(h), {status: 'accepted'}, 'the display is free again');
  assert.equal(outcomes(h).length, 1, 'the release reports no second outcome');
});

test('a refused key ends the moment with nothing written, and holds later writes', async context => {
  const server = new SimulatedTronbyt();
  const h = await onIdle(context, server);
  server.answerNext(401);
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.equal(outcomes(h)[0]?.error?.code, 'unauthenticated');
  assert.equal(outcomes(h)[0]?.evidence, 'none');
  assert.ok(!cardStands(server));
  const heard = server.state().calls.length;
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => outcomes(h).length === 2, 'the next moment\'s outcome');
  assert.equal(outcomes(h)[1]?.error?.code, 'unauthenticated');
  assert.equal(server.state().calls.length, heard, 'the hold keeps it from going out');
});

test('a push the server refuses leaves nothing standing, so the next moment plays', async context => {
  const server = new SimulatedTronbyt();
  let refuse = false;
  const transport: CloudFetch = async (url, init) => {
    if (refuse && init.method === 'POST') {
      refuse = false;
      server.answerNext(400);
    }
    return await server.fetch(url, init);
  };
  const h = await onIdle(context, server, {module: {transport}});
  refuse = true;
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.equal(outcomes(h)[0]?.result, 'failed');
  assert.equal(outcomes(h)[0]?.evidence, 'none');
  assert.equal(outcomes(h)[0]?.error?.code, 'invalid-request');
  assert.deepEqual(momentCalls(server), ['POST push'], 'no pin and no release');
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => taken(server), 'the next moment');
});

test('a release that fails with its outcome refused by the database is still sent again', async context => {
  const server = new SimulatedTronbyt();
  let refusing = false;
  const h = await onIdle(context, server, {wrapDatabase: database => withWriteFailure(database, () => refusing ? Object.assign(new Error('database or disk is full'), {code: 'ERR_SQLITE_ERROR', errcode: 13}) : undefined)});
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  server.answerNextPatch(500);
  refusing = true;
  await h.advance(41 * SECOND, SECOND);
  await until(() => records(h, 'operation.failed').some(record => record.includes('storage')), 'the refused outcome');
  assert.ok(cardStands(server), 'it may still stand');
  refusing = false;
  await h.advance(PIN_RETRY_MS + 31 * SECOND, SECOND);
  await until(() => !cardStands(server) && server.state().pinnedApp === null, 'the fresh release, with the command still pending');
  assert.equal(h.device().pending, 1, 'the outcome waits for the next start');
  await h.restart();
  await until(() => outcomes(h).length === 1, 'the report at the next start');
  assert.equal(outcomes(h)[0]?.result, 'uncertain');
});

test('what arrives during the pin read keeps the frame from going out', async context => {
  const server = new SimulatedTronbyt();
  let before: (() => Promise<void>) | undefined;
  const transport: CloudFetch = async (url, init) => {
    if (init.method === 'GET' && url.endsWith(`/v0/devices/${SIMULATED_DEVICE}`)) await before?.();
    return await server.fetch(url, init);
  };
  const h = await onIdle(context, server, {module: {transport}});
  before = async () => {
    before = undefined;
    await h.core?.set(asking());
  };
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.equal(outcomes(h)[0]?.result, 'failed');
  assert.equal(outcomes(h)[0]?.evidence, 'none');
  assert.equal(outcomes(h)[0]?.error?.code, 'invalid-state');
  assert.deepEqual(momentCalls(server), []);
});

test('what arrives during the push keeps the frame from being pinned, and it is released at once', async context => {
  const server = new SimulatedTronbyt();
  let during: (() => Promise<void>) | undefined;
  const transport: CloudFetch = async (url, init) => {
    if (init.method === 'POST') await during?.();
    return await server.fetch(url, init);
  };
  const h = await onIdle(context, server, {module: {transport}});
  const pins = server.state().pinWrites;
  during = async () => {
    during = undefined;
    await h.core?.set(asking());
  };
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.equal(outcomes(h)[0]?.evidence, 'transmitted');
  assert.equal(outcomes(h)[0]?.error?.code, 'cancelled');
  assert.equal(server.state().pinWrites, pins, 'no pin went out');
  assert.ok(!cardStands(server));
});

test('a command during the release does not make a moment that held its time one that ended early', async context => {
  const server = new SimulatedTronbyt();
  let during: (() => Promise<void>) | undefined;
  const transport: CloudFetch = async (url, init) => {
    if (init.method === 'PATCH' && init.body === '{"pinned":false}') await during?.();
    return await server.fetch(url, init);
  };
  const h = await onIdle(context, server, {module: {transport}});
  during = async () => {
    during = undefined;
    await request(h, 'brightness-set', 'org.bunny.brightness.set.requested', {requestId: 'dim', percent: 10});
  };
  assert.deepEqual(await play(h), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  await h.advance(41 * SECOND, SECOND);
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.equal(outcomes(h)[0]?.result, 'succeeded');
});

test('a window that passes while a moment waits for its turn sends nothing', async context => {
  const server = new SimulatedTronbyt();
  const session = working();
  const h = await host(context, {sessions: [session], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the tile');
  await h.advance(16 * SECOND, SECOND);
  // A tile's call that hangs holds the queue until its deadline.
  server.offline();
  await h.core?.set({...session, label: {value: 'moved on', origin: 'user'}});
  await until(() => server.state().calls.at(-1)?.method === 'POST', 'the tile\'s call in flight');
  assert.deepEqual(await play(h, {toleranceMs: 2 * SECOND}), {status: 'accepted'});
  await flush();
  server.online();
  await h.advance(11 * SECOND, SECOND);
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.equal(outcomes(h)[0]?.error?.code, 'expired');
  assert.equal(outcomes(h)[0]?.evidence, 'none');
  assert.ok(!cardStands(server));
});

test('a hidden status tile does not keep a flourish off the display, and attention still does', async context => {
  const server = new SimulatedTronbyt();
  const h = await host(context, {sessions: [working()], playback: 'absent', ...onServer(server)});
  await until(() => server.state().installations[STATUS]?.pushes === 1 && server.state().calls.some(call => call.method === 'PATCH'), 'the tile');
  assert.deepEqual(await mode(h, 'hide', 'hide-status'), {status: 'accepted'});
  await until(() => h.device().desired.mode.status === 'known' && h.device().pending === 0, 'the mode');
  assert.deepEqual(await play(h, {priorityClass: 'flourish', coversStatus: false}), {status: 'accepted'});
  await until(() => taken(server), 'the flourish');
  await h.core?.set(asking());
  await until(() => !cardStands(server), 'its end');
});

test('a picture that never answers cannot hold a moment or the stop', async context => {
  const server = new SimulatedTronbyt();
  const signals: AbortSignal[] = [];
  const h = await onIdle(context, server, {module: {transport: server.fetch, momentPicture: (_moment, signal) => {
    signals.push(signal);
    return new Promise(() => {});
  }}});
  assert.deepEqual(await play(h), {status: 'accepted'});
  await h.advance(MOMENT_PICTURE_TIMEOUT_MS + SECOND, SECOND);
  await until(() => outcomes(h).length === 1, 'the outcome');
  assert.equal(outcomes(h)[0]?.result, 'failed');
  assert.equal(outcomes(h)[0]?.evidence, 'none');
  assert.equal(signals[0]?.aborted, true);
  assert.deepEqual(momentCalls(server), []);

  assert.deepEqual(await play(h), {status: 'accepted'});
  await flush();
  await h.stop();
  assert.equal(signals[1]?.aborted, true, 'the stop finished without it');
});

test('forgetting old moments keeps one that may still stand', () => {
  const database = new DatabaseSync(':memory:');
  const store = new ControlStore(database);
  store.rememberMoment('standing');
  store.markMomentWritten('standing');
  for (let index = 0; index < REMEMBERED + 2; index += 1) store.rememberMoment(`moment-${String(index)}`);
  assert.ok(store.momentMayStand());
  assert.ok(store.momentSeen('standing'));
  assert.ok(!store.momentSeen('moment-0'), 'the oldest of the rest are forgotten');
  store.momentReleased();
  assert.ok(!store.momentMayStand());
  database.close();
});

test('the picture seam: a supplied frame is what goes out, and one that cannot be made sends nothing', async context => {
  const server = new SimulatedTronbyt();
  const rgb = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT * 3).fill(120);
  const rendered = renderFrame({width: FRAME_WIDTH, height: FRAME_HEIGHT, rgb});
  assert.ok(rendered.ok);
  const seen: MomentPlayRequest[] = [];
  const h = await onIdle(context, server, {module: {transport: server.fetch, momentPicture: moment => {
    seen.push(moment);
    return Promise.resolve(rendered.webp);
  }}});
  assert.deepEqual(await play(h, {palette: ['#112233']}), {status: 'accepted'});
  await until(() => taken(server), 'the takeover');
  assert.deepEqual(server.state().installations[MOMENT_INSTALLATION]?.picture, picture(rgb, FRAME_WIDTH, FRAME_HEIGHT));
  assert.deepEqual(seen.map(moment => moment.palette), [['#112233']], 'the seam hears the accepted request');

  const other = new SimulatedTronbyt();
  const failing = await onIdle(context, other, {module: {transport: other.fetch, momentPicture: () => Promise.reject(new Error('no such art'))}});
  assert.deepEqual(await play(failing), {status: 'accepted'});
  await until(() => outcomes(failing).length === 1, 'the outcome');
  assert.equal(outcomes(failing)[0]?.result, 'failed');
  assert.equal(outcomes(failing)[0]?.evidence, 'none');
  assert.equal(outcomes(failing)[0]?.error?.code, 'internal');
  assert.deepEqual(momentCalls(other), []);
});

test('each mood has a card, drawn in a palette or its own, through the worker\'s render', () => {
  const frames = MOMENT_MOODS.map(mood => momentFrame(momentView({mood})));
  assert.equal(new Set(frames.map(frame => Buffer.from(frame.rgb).toString('hex'))).size, MOMENT_MOODS.length);
  const painted = momentFrame(momentView({mood: 'celebrate', palette: ['#102030']})).rgb;
  assert.deepEqual([...painted.slice(0, 3)], [0x10, 0x20, 0x30]);
  for (const mood of MOMENT_MOODS) assert.equal(renderTile({tile: 'moment', view: momentView({mood})}).ok, true);
  assert.deepEqual(renderTile({tile: 'moment'}), {ok: false});
});

test('no tile may take the moment\'s installation', () => {
  const secrets = {token: '/secret'};
  const tronbyt = {url: TRONBYT_ORIGIN, deviceId: SIMULATED_DEVICE};
  assert.ok('error' in configureTidbyt({id: 'tidbyt', backend: 'tronbyt', tronbyt, statusInstallation: MOMENT_INSTALLATION, secrets}));
  assert.ok('error' in configureTidbyt({id: 'tidbyt', backend: 'tronbyt', tronbyt, nowPlaying: {playback: 'living-room', installation: MOMENT_INSTALLATION}, secrets}));
});
