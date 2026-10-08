// The Tidbyt module's scenarios (Hub #930, #999): agent status and now playing as two tiles in the Tidbyt's rotation, on
// a simulated cloud. The catalog collects this file.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {PlaybackState, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {
  SIMULATED_API_KEY, SIMULATED_DEVICE, SIMULATED_SECTION as TIDBYT_SIMULATED_SECTION, nowPlayingFrame, nowPlayingView, picture, statusFrame, statusView,
  type CloudState,
} from '@jimmie-potts/tidbyt';
import {approvalPrompt, approvalResolved, sessionStarted, turnStarted} from '../../fixtures/agents.js';
import {CORE_FAMILIES, act, deviceState, expect, holds, publish, running, show, waiting, type Harness, type Outcome, type Scenario} from '../framework.js';
import {PLAYBACK_SECTION, playbackShows} from './playback.js';

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
    act('the phone plays a song to the Move', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'play', title: 'Move Song'}); }),
    expect('the now-playing tile shows the song, behind its own gate', h => cardShown(h, 1), 8000),
    holds('the song plays on past the card\'s 15-second gate, and nothing more is written to it', h => cardStood(h), TILE_GATE_MS + 1000),
    // A restart while the song plays, with the Move answering late: the HT-A9, on another input, answers first. The
    // playback record waits for the Move's first read, so nothing tells the Tidbyt module the song stopped.
    act('the Move answers each call 400 ms late', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'slow'}); }),
    act('the runtime restarts cleanly while the song plays', h => h.restart()),
    holds('through the restart and the Move\'s slow first read, the card is never removed or pushed again', h => cardStood(h), 3000),
    expect('the reader\'s playback record shows the song playing on the Move', h => playbackShows(h, 'available playing "Move Song" [pause,next,previous]')),
    act('the Move answers at once again', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'answer'}); }),
    expect('once its gate opens, the status tile shows the session dimmed as uncertain after the restart', h => statusShown(h, 3), 18_000),
    act('the phone pauses the Move', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'pause'}); }),
    expect('the reader\'s playback record shows the song paused', h => playbackShows(h, 'available paused "Move Song" [play,next,previous]'), 6000),
    expect('once its gate opens, the now-playing tile shows the pause marker', h => cardShown(h, 2), 18_000),
    act('the phone stops the Move', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'stop'}); }),
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

export const scenarios: readonly Scenario[] = [tidbytTiles];
