// The Tidbyt module's scenarios (Hub #930, #999): agent status and now playing as two tiles in the Tidbyt's rotation, on
// a simulated cloud. The catalog collects this file.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord, PlaybackState, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {ArtState} from '@jimmie-potts/event-contracts/v2/art-state';
import {
  SIMULATED_API_KEY, SIMULATED_DEVICE, SIMULATED_SECTION as TIDBYT_SIMULATED_SECTION, nowPlayingFrame, nowPlayingView, picture, statusFrame, statusView,
  MOMENT_INSTALLATION, TRONBYT_SIMULATED_SECTION, type CloudState, type TronbytState,
} from '@jimmie-potts/tidbyt';
import {approvalPrompt, approvalResolved, sessionStarted, turnStarted} from '../../fixtures/agents.js';
import {CORE_FAMILIES, StepFailure, act, answers, bodyOf, deviceState, expect, holds, publish, recorded, refusedWith, running, show, waiting, type Harness, type Outcome, type Scenario} from '../framework.js';
import {PLAYBACK_SECTION, playbackShows} from './playback.js';
import {PIXOO_FAMILIES, PIXOO_ID, PIXOO_SECTION, pixooDevice, pixooState} from './pixoo.js';

/** What the simulated cloud shows. */
const cloudState = (h: Harness): CloudState => deviceState<CloudState>(h, 'tidbyt');

/** The Tidbyt section: its factory's simulated section, following the playback module's simulated record. */
export const TIDBYT_SECTION = TIDBYT_SIMULATED_SECTION;
/** The Tidbyt module's source, which a reader of the shared `device` family names as its copy's owner (#967). */
const TIDBYT_OWNER = 'bunny/modules/tidbyt';
const STATUS_TILE = TIDBYT_SECTION.statusInstallation;
const CARD_TILE = TIDBYT_SECTION.nowPlaying.installation;
/** The least time between two writes of one tile. */
const TILE_GATE_MS = 15_000;
const tidbytDevice = (h: Harness): DeviceRecord | undefined =>
  h.reader.states<DeviceRecord>('device', TIDBYT_OWNER).find(state => state.data.id === TIDBYT_SECTION.id)?.data;
/** What one installation of the simulated Tidbyt shows, and how often it was pushed, with each push's time. */
const tile = (h: Harness, installation: string): {picture: string[]; pushes: number; pushedAtMs: number[]} | undefined =>
  cloudState(h).installations[installation];
/** The status tile the reader's copy of the sessions calls for: the picture of the frame the module draws from them. */
const expectedStatus = (h: Harness): string[] =>
  picture(statusFrame(statusView({synced: true, sessions: h.reader.states<SessionRecord>('session').map(state => state.data)})).rgb);
/** Whether the status tile shows what the reader's sessions call for, after `pushes` pushes. */
function statusShown(h: Harness, pushes: number): Outcome {
  const shown = tile(h, STATUS_TILE);
  if (shown === undefined) return 'the status tile is not in the rotation';
  if (shown.pushes !== pushes) return `the status tile was pushed ${shown.pushes} times`;
  return show(shown.picture) === show(expectedStatus(h)) || `the status tile shows ${show(shown.picture)}`;
}
/** Whether the now-playing tile shows the reader's playback record as a card, after `pushes` pushes. */
function cardShown(h: Harness, pushes: number): Outcome {
  const record = h.reader.states<PlaybackState>('playback').find(state => state.data.id === TIDBYT_SECTION.nowPlaying.playback)?.data;
  const view = nowPlayingView({record, following: true, lostForMs: 0});
  if (!view.card) return 'the reader\'s playback record shows no card';
  const shown = tile(h, CARD_TILE);
  if (shown === undefined) return 'the now-playing tile is not in the rotation';
  if (shown.pushes !== pushes) return `the now-playing tile was pushed ${shown.pushes} times`;
  return show(shown.picture) === show(picture(nowPlayingFrame(view).rgb)) || `the now-playing tile shows ${show(shown.picture)}`;
}
/** Whether the now-playing tile was pushed once and never removed: its one write is the first push. */
function cardStood(h: Harness): Outcome {
  const writes = cloudState(h).calls.filter(call => call.installation === CARD_TILE && call.method !== 'GET').map(call => call.method);
  return (show(writes) === show(['POST']) && tile(h, CARD_TILE)?.pushes === 1) || `the now-playing tile's writes were ${show(writes)}`;
}
/** The times between one tile's pushes. */
const gaps = (h: Harness, installation: string): number[] => {
  const times = tile(h, installation)?.pushedAtMs ?? [];
  return times.slice(1).map((at, index) => at - (times[index] ?? at));
};

/**
 * The Tidbyt module (Hub #930) on a simulated cloud: an idle start leaves the rotation alone; the status tile follows the
 * core's sessions, and a burst of changes inside the 15-second gate makes one later push of the latest state; the
 * now-playing tile follows the playback module's record through play and pause, each tile behind its own gate, and is
 * removed when the music stops. A restart while the card has stood past its gate, with the Move answering late, neither
 * removes nor pushes it, and brings the status rows back dimmed as uncertain. The reader holds the Tidbyt's device
 * record with no control, and neither the API key nor the cloud device appears anywhere.
 */
const tidbytTiles: Scenario = {
  id: 'tidbyt-tiles',
  title: 'the Tidbyt shows agent status and now playing, each tile pushed at most once every 15 seconds',
  seed: {
    modules: ['core', 'playback', 'tidbyt'], follows: [CORE_FAMILIES, ['playback'], {families: ['device'], owner: TIDBYT_OWNER}],
    config: {playback: PLAYBACK_SECTION, tidbyt: TIDBYT_SECTION},
  },
  steps: [
    expect('the core, the playback module and the Tidbyt module are running', h => running(h, ['core', 'playback', 'tidbyt'])),
    expect('the reader holds the Tidbyt available, with no control, once the cloud listed its installations', h => {
      const device = tidbytDevice(h);
      return (device?.availability === 'available' && Object.values(device.capabilities).every(capability => !capability.supported)) ||
        `the Tidbyt is ${String(device?.availability)}`;
    }, 5000),
    holds('an idle start pushes and removes nothing', h => {
      const writes = cloudState(h).calls.filter(call => call.method !== 'GET').length;
      return writes === 0 || `${writes} writes`;
    }, 500),
    act('the hook observes a session start and a turn', async h => {
      await publish(h, sessionStarted);
      await publish(h, turnStarted);
    }),
    // The start's listing counts against the tile's 15-second gate, as the runner's did, so the first push may wait for it.
    expect('the status tile shows the working session', h => statusShown(h, 1), 17_000),
    act('within the gate, the hook observes an approval prompt, its answer and a second prompt', async h => {
      await publish(h, approvalPrompt('approval-1'));
      await publish(h, approvalResolved('approval-1'));
      await publish(h, approvalPrompt('approval-2'));
    }),
    expect('the reader\'s session waits for the second approval', h => waiting(h, ['approval-2'])),
    holds('the burst pushes nothing more inside the gate', h => tile(h, STATUS_TILE)?.pushes === 1 || `${String(tile(h, STATUS_TILE)?.pushes)} pushes`, 9000),
    expect('once the gate opens, one push shows the latest state: the session asking', h => statusShown(h, 2), 9000),
    expect('the two pushes are at least 15 seconds apart', h => gaps(h, STATUS_TILE).every(gap => gap >= TILE_GATE_MS) || show(gaps(h, STATUS_TILE))),
    act('the phone plays a song to the Move', h => { void h.simulate({device: 'playback', speaker: 'sonos', action: 'play', title: 'Move Song'}); }),
    expect('the now-playing tile shows the song, behind its own gate', h => cardShown(h, 1), 8000),
    holds('the song plays on past the card\'s 15-second gate, and nothing more is written to it', h => cardStood(h), TILE_GATE_MS + 1000),
    // A restart while the song plays, with the Move answering late: the HT-A9, on another input, answers first. The
    // playback record waits for the Move's first read, so nothing tells the Tidbyt module the song stopped.
    act('the Move answers each call 400 ms late', h => { void h.simulate({device: 'playback', speaker: 'sonos', action: 'slow'}); }),
    act('the runtime restarts cleanly while the song plays', h => h.restart()),
    holds('through the restart and the Move\'s slow first read, the card is never removed or pushed again', h => cardStood(h), 3000),
    expect('the reader\'s playback record shows the song playing on the Move', h => playbackShows(h, 'available playing "Move Song" [pause,next,previous]')),
    act('the Move answers at once again', h => { void h.simulate({device: 'playback', speaker: 'sonos', action: 'answer'}); }),
    expect('once its gate opens, the status tile shows the session dimmed as uncertain after the restart', h => statusShown(h, 3), 18_000),
    act('the phone pauses the Move', h => { void h.simulate({device: 'playback', speaker: 'sonos', action: 'pause'}); }),
    expect('the reader\'s playback record shows the song paused', h => playbackShows(h, 'available paused "Move Song" [play,next,previous]'), 6000),
    expect('once its gate opens, the now-playing tile shows the pause marker', h => cardShown(h, 2), 18_000),
    act('the phone stops the Move', h => { void h.simulate({device: 'playback', speaker: 'sonos', action: 'stop'}); }),
    expect('the now-playing tile leaves the rotation, and the status tile stays', h =>
      (tile(h, CARD_TILE) === undefined && tile(h, STATUS_TILE) !== undefined) || `installations ${show(Object.keys(cloudState(h).installations))}`, 18_000),
    expect('every push of each tile was at least 15 seconds after the one before', h =>
      [STATUS_TILE, CARD_TILE].every(installation => gaps(h, installation).every(gap => gap >= TILE_GATE_MS)) || 'a push came early'),
    holds('neither the API key nor the cloud device appears in a log record, a message, health or a reader copy', async h => {
      const places = [h.logs(), h.published(), await h.health(), h.reader.heard(), ...h.reader.families().map(family => h.reader.states(family))];
      const leaked = places.some(value => JSON.stringify(value).includes(SIMULATED_API_KEY) || JSON.stringify(value).includes(SIMULATED_DEVICE));
      return (!leaked && cloudState(h).refusedKeys === 0) || 'the key or the device appears, or the cloud refused the key';
    }, 100),
  ],
};

const artState = (h: Harness): ArtState | undefined => h.reader.states<ArtState>('art', 'bunny/modules/art')[0]?.data;
const staged = (h: Harness): string | undefined => artState(h)?.candidates.find(candidate => candidate.target === 'tidbyt')?.compositionId;
const serverState = (h: Harness): TronbytState => deviceState<TronbytState>(h, 'tidbyt');
const nativeArt = (h: Harness) => serverState(h).installations.bunnyart;
const artCalls = (h: Harness) => deviceState<{imageCalls: number; ideaCalls: number}>(h, 'art');
const artSyncBeforeRestart = new WeakMap<Harness, number>();
const {nowPlaying: _card, ...ART_SECTION} = TRONBYT_SIMULATED_SECTION;

/** Real producer, tracker, worker and queue, through strict simulated transports and authenticated content. */
const tidbytArt: Scenario = {
  id: 'tidbyt-art', title: 'exact animated art is staged privately and joins the synthetic Tronbyt rotation without a takeover',
  seed: {modules: ['core', 'tidbyt', 'art'], config: {tidbyt: ART_SECTION}, sections: {art: {}}, follows: [CORE_FAMILIES, {owner: 'bunny/modules/art', families: ['art']}, {owner: TIDBYT_OWNER, families: ['device']}]},
  keepCapturePage: true,
  capture: async (context, harness) => {
    const compositionId = staged(harness);
    if (compositionId === undefined) throw new StepFailure('the exact Tidbyt preview is missing');
    const {captureTidbytArt} = await import('../../../verify/tidbyt-art-browser.js');
    await captureTidbytArt(context, harness, compositionId);
  },
  steps: [
    expect('the producer and exact-art Tidbyt are running', h => running(h, ['core', 'art', 'tidbyt'])),
    expect('the Tidbyt declares implemented art while visible output remains unknown', h => {
      const record = tidbytDevice(h);
      return record?.capabilities.moments.supported === true && record.capabilities.moments.art?.maxBytes === 163_840 && record.observed.status === 'unknown' || 'exact art capability or unknown visible status missing';
    }),
    expect('anonymous profile reads are refused', answers({as: 'anonymous', method: 'GET', path: '/modules/tidbyt/content/art-profile'}, answer => refusedWith(answer, 401, 'unauthenticated'))),
    expect('the producer has synchronized the available display owner', h => h.logs().some(({record}) => record.event_name === 'runtime.sync.served'
      && record.attributes['bunny.participant'] === 'bunny/modules/art' && record.attributes['bunny.pattern'] === 'sync device') || 'the producer has not yet resolved its display', 5000),
    act('the owner requests one synthetic ambient composition for Tidbyt', async h => {
      const answer = await h.gateway({as: 'browser', method: 'POST', path: '/api/v2/commands/art-request', body: {target: 'art', requestId: 'tidbyt-ambient-art', data: {
        action: 'start', purpose: 'ambient', origin: {kind: 'owner'}, targets: ['tidbyt'], text: 'SYNTHETIC_TIDBYT_MOON',
      }}});
      if (answer.status !== 200) throw new StepFailure(`art request returned ${answer.status}`);
    }),
    expect('the real producer receives confirmed staging', h => staged(h) !== undefined || `no confirmed staged candidate; jobs ${show(artState(h)?.jobs)}`, 15_000),
    expect('the owner request has its own durable observed admission', h => recorded(h, 'tidbyt-ambient-art', 'succeeded', 'observed')),
    expect('the native animation has eight preserved frames and delays, in the background', h => {
      const shown = nativeArt(h), animation = shown?.animation;
      return shown?.immediate === 0 && animation?.frames.length === 8 && animation.delaysMs.every(delay => delay === 200) && serverState(h).pinnedApp === null || 'the exact background animation is missing';
    }, 17_000),
    expect('authenticated metadata identifies exactly the WebP the server decoded', async h => {
      const response = await h.gateway({as: 'reader', method: 'GET', path: `/modules/tidbyt/content/art-info.${String(staged(h))}`});
      const info = bodyOf<{frames: number; delaysMs: number[]; sha256: string; bytes: number; visible: string}>(response), animation = nativeArt(h)?.animation;
      return response.status === 200 && info?.sha256 === animation?.sha256 && info?.bytes === animation?.byteLength && info?.frames === 8
        && show(info.delaysMs) === show(animation?.delaysMs) && info.visible === 'unverified' || 'metadata does not match the independently decoded native bytes';
    }),
    expect('the exact preview is authenticated and readable as WebP', async h => {
      const path = `/modules/tidbyt/content/art.${String(staged(h))}`;
      const denied = await h.gateway({as: 'anonymous', method: 'GET', path});
      if (refusedWith(denied, 401, 'unauthenticated') !== true) return 'anonymous exact preview was not refused';
      const allowed = await h.gateway({as: 'reader', method: 'GET', path});
      return allowed.status === 200 && allowed.headers['content-type']?.startsWith('image/webp') === true || 'authenticated exact preview was unreadable';
    }),
    act('the runtime restarts with its saved selection and private copy', async h => {
      artSyncBeforeRestart.set(h, h.reader.syncs('art', 'bunny/modules/art'));
      await h.restart();
    }),
    expect('the restarted art and display owners are running', h => running(h, ['core', 'art', 'tidbyt'])),
    expect('the reader has synchronized the restarted art owner before inspecting saved state', h =>
      h.reader.syncs('art', 'bunny/modules/art') > (artSyncBeforeRestart.get(h) ?? Number.POSITIVE_INFINITY) && staged(h) !== undefined
      || 'the restarted art copy has not completed its sync', 5000),
    expect('selection survives independently of server evidence', async h => {
      const response = await h.gateway({as: 'reader', method: 'GET', path: '/modules/tidbyt/content/art-status'});
      const status = bodyOf<{selected: {compositionId: string} | null; visible: string}>(response);
      return status?.selected?.compositionId === staged(h) && status?.visible === 'unverified' || 'saved selection or unknown visible status was lost';
    }),
    holds('restart neither regenerates nor repeats the completed ambient push', h => artCalls(h).imageCalls === 1 && nativeArt(h)?.pushes === 1 || 'generation or completed frame replayed', 500),
    act('an agent asks for attention', async h => {await publish(h, sessionStarted); await publish(h, turnStarted); await publish(h, approvalPrompt('tidbyt-art-attention'));}),
    expect('attention removes ambient art through the existing tile gate', h => nativeArt(h) === undefined || 'ambient art still stands', 18_000),
    expect('suppression keeps selection but does not claim visible art', async h => {
      const response = await h.gateway({as: 'reader', method: 'GET', path: '/modules/tidbyt/content/art-status'});
      const status = bodyOf<{selected: {compositionId: string} | null; presence: string; suppressed: boolean; visible: string}>(response);
      return status?.selected?.compositionId === staged(h) && status?.presence === 'absent' && status.suppressed && status.visible === 'unverified' || 'selection and effect evidence were conflated';
    }),
  ],
};

const missedTargets = [
  {target: PIXOO_ID, owner: 'bunny/modules/pixoo', detail: 'the moment missed its start window'},
  {target: TIDBYT_SECTION.id, owner: TIDBYT_OWNER, detail: "the moment's start window has passed"},
] as const;
const missedRequest = (target: string): string => `missed-window-${target}`;
const missedOperation = (h: Harness, target: string): OperationRecord | undefined =>
  h.reader.states<OperationRecord>('operation').find(state => state.data.requestId === missedRequest(target))?.data;
const missedDecisions = (h: Harness, target: string): string[] => h.logs().map(({record}) => record)
  .filter(record => record.event_name.startsWith('runtime.command.') && record.attributes['bunny.request.id'] === missedRequest(target))
  .map(record => `${record.event_name} ${record.severity_text} ${String(record.attributes['bunny.code'] ?? '')}`.trim());
const missedRecords = (h: Harness): string => show(missedTargets.map(({target}) => ({operation: missedOperation(h, target), decisions: missedDecisions(h, target)})));
const beforeDuplicate = new WeakMap<Harness, string>();
const noMissedWrites = (h: Harness): Outcome => {
  const server = serverState(h);
  return pixooState(h).sent === 0 && server.pinWrites === 0 && server.anonymous === 0
    && !server.calls.some(call => call.method !== 'GET' && (call.path.endsWith(`/${MOMENT_INSTALLATION}`) || call.path.endsWith('/push')))
    || 'a refused moment uploaded, pinned or removed display content';
};
async function sendMissed(h: Harness): Promise<void> {
  const failures: string[] = [];
  for (const {target, detail} of missedTargets) {
    const answer = await h.gateway({as: 'operator', method: 'POST', path: '/api/v2/commands/moment-play', body: {
      target, requestId: missedRequest(target), data: {momentId: `missed-${target}`, mood: 'celebrate', durationMs: 8000,
        priorityClass: 'event', coversStatus: true, startAtMs: 1, toleranceMs: 1000},
    }});
    const refusal = refusedWith(answer, 409, 'invalid-state');
    if (refusal !== true || bodyOf<{error: {detail?: string}}>(answer)?.error.detail !== detail) {
      failures.push(`${target}: ${refusal === true ? 'the missed-window detail changed' : refusal}`);
    }
  }
  if (failures.length > 0) throw new StepFailure(failures.join('; '));
}

/** Refused after delivery, before admission: both owners must remain distinguishable from an undelivered command. */
const missedMomentStart: Scenario = {
  id: 'missed-moment-start', title: 'both displays report a delivered moment refused for its missed start, without replay or device writes',
  seed: {modules: ['core', 'playback', 'pixoo', 'tidbyt'], config: {playback: PLAYBACK_SECTION, pixoo: PIXOO_SECTION, tidbyt: TRONBYT_SIMULATED_SECTION},
    follows: [CORE_FAMILIES, {owner: 'bunny/core', families: ['operation']}, PIXOO_FAMILIES, {owner: TIDBYT_OWNER, families: ['device']}]},
  steps: [
    expect('both real display owners are running with their declared moment capability', h => {
      const devices = [pixooDevice(h), tidbytDevice(h)];
      return devices.every(device => device?.availability === 'available' && device.capabilities.moments.supported) || 'a moment owner is unavailable';
    }),
    act('the operator sends a missed moment through the authenticated gateway to each display', sendMissed),
    expect('each declared owner replied after delivery, with a tracked missed-window refusal and no effect', h => {
      for (const {target, owner, detail} of missedTargets) {
        const record = missedOperation(h, target);
        if (record?.status !== 'rejected' || record.result !== 'failed' || record.evidence !== 'none'
          || record.target !== target || record.reply !== 'invalid-state' || record.requestedBy !== 'bunny/parts/operator'
          || record.error?.code !== 'invalid-state' || record.error.detail !== detail) {
          return `${target}: ${show(record)}`;
        }
        if (!h.reader.states<DeviceRecord>('device', owner).some(state => state.data.id === target)) return `${target}: its declared owner is missing`;
        const decisions = missedDecisions(h, target);
        if (show(decisions) !== show(['runtime.command.admitted INFO', 'runtime.command.replied INFO invalid-state'])) return `${target}: ${show(decisions)}`;
      }
      return true;
    }),
    act('the operator repeats each identical request after its refusal', async h => {beforeDuplicate.set(h, missedRecords(h)); await sendMissed(h);}),
    holds('duplicates retain the same refusal records and send no native display command', h => {
      if (missedRecords(h) !== beforeDuplicate.get(h)) return 'a duplicate changed its saved operation';
      return noMissedWrites(h);
    }, 2000),
  ],
};

export const scenarios: readonly Scenario[] = [tidbytTiles, tidbytArt, missedMomentStart];
