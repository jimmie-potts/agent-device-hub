// The playback module's scenarios (Hub #929, #999): one owner for the HT-A9 and the Move, presenting the speaker the
// phone plays to. The catalog collects this file.
import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {SIMULATED_SECTION, controlPlayback, type SpeakersState} from '@jimmie-potts/playback';
import {
  CORE_FAMILIES, act, answered, deviceState, dispatchOnce, expect, holds, inboxOf, keep, logged, noToken, rawCommand, rawRequest, recorded,
  refusedWith, running, show, type Harness, type Outcome, type Scenario,
} from '../framework.js';

/** What the simulated speakers show. */
const speakerState = (h: Harness): SpeakersState => deviceState<SpeakersState>(h, 'playback');

/** The playback section: the factory's simulated section, the Move first, then the HT-A9. */
export const PLAYBACK_SECTION = SIMULATED_SECTION;
const playbackCommand = (action: 'play' | 'pause' | 'next' | 'previous') => controlPlayback(PLAYBACK_SECTION.id, action);
/** The reader's copy of the playback record, as `availability player "title" [controls]`. */
const playbackShown = (h: Harness): string => {
  const record = h.reader.states<PlaybackState>('playback').find(state => state.data.id === PLAYBACK_SECTION.id)?.data;
  if (record === undefined) return 'no playback record';
  const {playback} = record;
  return playback.status === 'unknown' ? `${record.availability} unknown` :
    `${record.availability} ${playback.player} ${JSON.stringify(playback.title ?? '')} [${playback.controls.join(',')}]`;
};
export const playbackShows = (h: Harness, expected: string): Outcome => playbackShown(h) === expected || `the reader's copy shows ${playbackShown(h)}`;
/** The actions each simulated speaker received, as `move [..] ht-a9 [..]`. */
const speakerCommands = (h: Harness): string => {
  const {sonos, sony} = speakerState(h);
  return `move [${sonos.commands.join(',')}] ht-a9 [${sony.commands.join(',')}]`;
};
const speakersGot = (h: Harness, expected: string): Outcome => speakerCommands(h) === expected || speakerCommands(h);
const playbackRecords = (h: Harness, event: string): string[] =>
  logged(h, 'playback', event).map(({record}) => `${record.severity_text} ${String(record.attributes['bunny.device.id'])}`);
/** No published message, reader copy or log record names a private speaker URL. */
function noSpeakerAddress(h: Harness): Outcome {
  const places: [string, unknown][] = [
    ['a published message', h.published()], ['the reader\'s copy', h.reader.states('playback')], ['a message the reader heard', h.reader.heard()],
  ];
  const addresses = PLAYBACK_SECTION.sources.map(source => new URL(source.endpoint).origin);
  const carrying = places.filter(([, value]) => addresses.some(address => JSON.stringify(value).includes(address))).map(([place]) => place);
  const logs = h.logs().some(({record}) => addresses.some(address => JSON.stringify(record).includes(address)));
  return (carrying.length === 0 && !logs) || `a speaker address appears in ${[...carrying, ...(logs ? ['a log record'] : [])].join(', ')}`;
}

/**
 * The playback module follows the speaker the phone plays to and controls it (Hub #929): the HT-A9 alone, then the Move
 * once the phone switches AirPlay to it; a pause goes to the presented speaker only; a Move that goes silent mid-song
 * turns the record stale with its song kept and commands refused, logs one degradation and one recovery, and a command
 * the Move never answers is uncertain, kept in the inbox and never sent again. Time is real in a run, so the 30-second step to
 * `unavailable` is left to the module's own tests.
 */
const speakerPlayback: Scenario = {
  id: 'speaker-playback',
  title: 'the playback module follows the speaker the phone plays to, pauses it, and turns a silent one stale',
  seed: {modules: ['core', 'playback'], follows: [CORE_FAMILIES, ['playback']], config: {playback: PLAYBACK_SECTION}},
  steps: [
    expect('the core and the playback module are running', h => running(h, ['core', 'playback'])),
    expect('the reader\'s copy shows the speakers available with nothing playing over AirPlay', h => playbackShows(h, 'available inactive "" []'), 5000),
    // A playback command goes through the core's dispatcher, so it is tracked: no grant requests it directly (#782).
    expect('the operator may not request a playback command directly at the SDK edge', async h => refusedWith(keep(h, await h.gateway(rawRequest('operator',
      `bunny.cmd.playback-control.${PLAYBACK_SECTION.id}`, rawCommand(h, 'bunny/parts/operator', playbackCommand('pause'), 'req-pb-direct', 'msg-pb-direct')))), 403, 'forbidden')),
    expect('the reader, whose grant may only read, may not command them', async h => refusedWith(keep(h, await h.gateway(rawRequest('reader',
      `bunny.cmd.playback-control.${PLAYBACK_SECTION.id}`, rawCommand(h, 'bunny/parts/reader', playbackCommand('pause'), 'req-pb-reader', 'msg-pb-reader')))), 403, 'forbidden')),
    act('the phone plays a song to the HT-A9', h => { h.simulate({device: 'playback', speaker: 'sony', action: 'play', title: 'HT-A9 Song'}); }),
    expect('the reader sees the HT-A9\'s song playing, with pause, next and previous', h => playbackShows(h, 'available playing "HT-A9 Song" [pause,next,previous]'), 5000),
    act('the operator pauses it as req-pb-pause, through the core\'s dispatcher', h => dispatchOnce(h, 'operator', 'pb-pause', playbackCommand('pause'), 'req-pb-pause')),
    expect('the pause went to the HT-A9 only, once', h => speakersGot(h, 'move [] ht-a9 [pause]')),
    expect('history holds req-pb-pause as succeeded, transmitted', async h => (await recorded(h, 'req-pb-pause', 'succeeded', 'transmitted'))),
    expect('the reader sees the HT-A9 paused, offering next and previous only', h => playbackShows(h, 'available paused "HT-A9 Song" [next,previous]'), 5000),
    act('the phone switches AirPlay to the Move: the HT-A9 leaves AirPlay and the Move plays another song', h => {
      h.simulate({device: 'playback', speaker: 'sony', action: 'other-input'});
      h.simulate({device: 'playback', speaker: 'sonos', action: 'play', title: 'Move Song'});
    }),
    expect('the reader sees the Move\'s song', h => playbackShows(h, 'available playing "Move Song" [pause,next,previous]'), 5000),
    act('the operator pauses again as req-pb-move', h => dispatchOnce(h, 'operator', 'pb-move', playbackCommand('pause'), 'req-pb-move')),
    expect('the pause went to the Move only', h => speakersGot(h, 'move [pause] ht-a9 [pause]')),
    expect('the reader sees the Move paused, offering play, next and previous', h => playbackShows(h, 'available paused "Move Song" [play,next,previous]'), 5000),
    act('the Move stops answering mid-song', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'silent'}); }),
    expect('the reader sees the record stale, still showing the Move\'s song', h => playbackShows(h, 'stale paused "Move Song" [play,next,previous]'), 9000),
    act('the operator asks the Move to play as req-pb-stale', h => h.dispatch('operator', 'pb-stale', playbackCommand('play'), 'req-pb-stale')),
    expect('req-pb-stale is refused unavailable, and no speaker heard it', h => answered(h, 'pb-stale', 'unavailable') === true ? speakersGot(h, 'move [pause] ht-a9 [pause]') : answered(h, 'pb-stale', 'unavailable')),
    expect('the playback module logged one degradation for the Move', h => show(playbackRecords(h, 'device.unavailable')) === show(['WARN living-room.sonos']) || show(playbackRecords(h, 'device.unavailable'))),
    act('the Move answers again', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'answer'}); }),
    expect('the reader sees the Move available again', h => playbackShows(h, 'available paused "Move Song" [play,next,previous]'), 6000),
    expect('the playback module logged one recovery, and no other degradation', h => {
      const [down, up] = [playbackRecords(h, 'device.unavailable'), playbackRecords(h, 'device.available')];
      return (show(down) === show(['WARN living-room.sonos']) && show(up) === show(['INFO living-room.sonos'])) || `${show(down)} then ${show(up)}`;
    }),
    act('the Move will never answer its next command', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'hang-next'}); }),
    // The module answers once the Move's call reaches its deadline, so the step does not wait for the answer.
    act('the operator asks the Move to play as req-pb-hang', h => { void h.dispatch('operator', 'pb-hang', playbackCommand('play'), 'req-pb-hang'); }),
    expect('req-pb-hang is accepted once the Move\'s call reaches its deadline', h => answered(h, 'pb-hang', 'accepted'), 5000),
    expect('history and the inbox hold req-pb-hang as uncertain', async h => {
      const items = inboxOf(h, 'req-pb-hang');
      const item = items[0];
      const inbox = (items.length === 1 && item?.kind === 'operation' && item.result === 'uncertain' && item.error?.code === 'uncertain-result') || `inbox ${show(items)}`;
      return (await recorded(h, 'req-pb-hang', 'uncertain', 'none')) === true ? inbox : (await recorded(h, 'req-pb-hang', 'uncertain', 'none'));
    }, 5000),
    act('the operator sends req-pb-hang again: the same action, which the core answers itself', h => dispatchOnce(h, 'operator', 'pb-again', playbackCommand('play'), 'req-pb-hang')),
    holds('the Move heard play once: an uncertain command is never sent again', h => speakersGot(h, 'move [pause,play] ht-a9 [pause]'), 500),
    holds('no message, reader copy or log record names a speaker\'s address, and nothing carries the token', h => {
      const address = noSpeakerAddress(h);
      return address === true ? noToken(h) : address;
    }, 100),
  ],
};


/** Real playback worker and SDK state, with fixture-only acquisition in every simulation factory. */
const artworkRecord = (h: Harness): PlaybackState | undefined =>
  h.reader.states<PlaybackState>('playback').find(state => state.data.id === PLAYBACK_SECTION.id)?.data;
const readyRecords = (h: Harness): PlaybackState[] => h.published().flatMap(({message}) => {
  if (message.type !== 'org.bunny.playback.updated') return [];
  const record = message.data as PlaybackState;
  return record.artwork?.status === 'ready' ? [record] : [];
});
const firstReadyGeneration = (h: Harness): string | undefined => readyRecords(h)[0]?.artwork?.generation;
const hasArtwork = (h: Harness, status: 'missing' | 'ready' | 'unsupported'): Outcome => {
  const record = artworkRecord(h);
  if (record?.artwork?.status !== status) return `the reader has artwork ${record?.artwork?.status ?? 'absent'}`;
  if (status !== 'ready') return true;
  const artwork = record.artwork;
  return artwork.status === 'ready' && artwork.mediaType === 'image/png' && artwork.width === 1 && artwork.height === 1 &&
    Buffer.from(artwork.base64, 'base64').byteLength <= 65536 || 'the worker did not return the bounded synthetic PNG';
};
const speakerArtwork: Scenario = {
  id: 'speaker-artwork',
  title: 'shared Sony artwork uses the real decoder and clears on an identical-title Sonos handoff',
  seed: {modules: ['core', 'playback'], follows: [CORE_FAMILIES, ['playback']], config: {playback: PLAYBACK_SECTION}},
  steps: [
    expect('the playback owner and core are running', h => running(h, ['core', 'playback'])),
    expect('the SDK reader starts with text-only inactive playback', h => playbackShows(h, 'available inactive "" []'), 5000),
    act('the phone plays the synthetic same-title track to Sony without artwork', h => {
      h.simulate({device: 'playback', speaker: 'sony', action: 'play', title: 'Same Track'});
    }),
    expect('the reader has playing metadata, controls and missing artwork', h =>
      playbackShows(h, 'available playing "Same Track" [pause,next,previous]') === true ? hasArtwork(h, 'missing') : playbackShows(h, 'available playing "Same Track" [pause,next,previous]'), 5000),
    act('the operator explicitly selects the synthetic Sony PNG fixture', h => {
      h.simulate({device: 'playback', speaker: 'sony', action: 'artwork'});
    }),
    expect('the real decoder makes the shared SDK artwork ready', h => hasArtwork(h, 'ready'), 8000),
    expect('artwork publication preserves the track, availability and controls', h =>
      playbackShows(h, 'available playing "Same Track" [pause,next,previous]')),
    act('the operator pauses the speaker through the existing dispatcher', h =>
      dispatchOnce(h, 'operator', 'art-pause', playbackCommand('pause'), 'req-art-pause')),
    expect('only Sony heard pause once', h => speakersGot(h, 'move [] ht-a9 [pause]')),
    expect('pause changes metadata but preserves the ready generation', h => {
      const text = playbackShows(h, 'available paused "Same Track" [next,previous]');
      return text === true ? artworkRecord(h)?.artwork?.generation === firstReadyGeneration(h) || 'pause changed the artwork generation' : text;
    }, 5000),
    act('Sony stops reporting metadata while the ready thumbnail is retained', h => {
      h.simulate({device: 'playback', speaker: 'sony', action: 'silent'});
    }),
    expect('metadata freshness still turns stale without changing the ready generation', h => {
      const text = playbackShows(h, 'stale paused "Same Track" [next,previous]');
      return text === true ? artworkRecord(h)?.artwork?.status === 'ready' && artworkRecord(h)?.artwork?.generation === firstReadyGeneration(h) || 'freshness changed the image association' : text;
    }, 9000),
    act('Sony answers metadata polls again', h => { h.simulate({device: 'playback', speaker: 'sony', action: 'answer'}); }),
    expect('playback returns to available with its existing ready image', h =>
      playbackShows(h, 'available paused "Same Track" [next,previous]') === true ? hasArtwork(h, 'ready') : playbackShows(h, 'available paused "Same Track" [next,previous]'), 6000),
    act('the phone hands the same reported title to Sonos', h => {
      h.simulate({device: 'playback', speaker: 'sony', action: 'other-input'});
      h.simulate({device: 'playback', speaker: 'sonos', action: 'play', title: 'Same Track'});
    }),
    expect('Sonos has the same title with unsupported artwork and a different generation', h => {
      const text = playbackShows(h, 'available playing "Same Track" [pause,next,previous]');
      if (text !== true) return text;
      const image = artworkRecord(h)?.artwork;
      return image?.status === 'unsupported' && image.generation !== firstReadyGeneration(h) || 'Sony artwork crossed the handoff';
    }, 5000),
    holds('shared state and logs expose no private source URL, secret or raw logged image', async h => {
      const address = noSpeakerAddress(h);
      if (address !== true) return address;
      const token = await noToken(h);
      if (token !== true) return token;
      const rawImages = readyRecords(h).flatMap(record => record.artwork?.status === 'ready' ? [record.artwork.base64] : []);
      return !h.logs().some(entry => rawImages.some(image => JSON.stringify(entry).includes(image))) || 'raw artwork entered a log';
    }, 100),
  ],
};

export const scenarios: readonly Scenario[] = [speakerPlayback, speakerArtwork];
