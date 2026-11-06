// The Pixoo module's scenarios (Hub #843, #999): Monitor following the core's sessions, a media command accepted then
// completed, a Now Playing card, and a start while the device is offline. Each runs the module with its simulated
// Pixoo. A disposable run of its own, `pixoo-migrated`, starts the shipped runtime on a migrated Pixoo library (Hub
// #931). The catalog collects this file.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {ArtState} from '@jimmie-potts/event-contracts/v2/art-state';
import {
  FAMILIES as PIXOO, SIMULATED_SECTION as PIXOO_SIMULATED, frameDigest, renderNowPlaying, schemaOf, writeSyntheticLibrary, type DisplayRecord,
  type PlaylistRecord, type RenditionRecord, type SimulatedPixooState,
} from '@jimmie-potts/pixoo';
import type {CommandDraft} from '@jimmie-potts/sdk';
import {runPixooMigration} from '../../../src/index.js';
import {migrationOf, stateDirOf} from '../../../verify/paths.js';
import {approvalPrompt, approvalResolved, sessionStarted} from '../../fixtures/agents.js';
import {pixooAnimation} from '../../fixtures/pixoo-animation.js';
import {
  CORE_FAMILIES, StepFailure, act, answered, answers, bodyOf, deviceState, dispatchOnce, expect, holds, logged, publish, refusedWith, running, show, type Follow, type Harness,
  type ModuleRun, type Outcome, type Scenario, type Seed, type Step,
} from '../framework.js';
import {PLAYBACK_SECTION} from './playback.js';

/** What the simulated Pixoo shows. */
export const pixooState = (h: Harness): SimulatedPixooState => deviceState<SimulatedPixooState>(h, 'pixoo');

export const PIXOO_ID = PIXOO_SIMULATED.config.device.id;
/** The Pixoo's section: the module's simulated section, which names the observed GIF profile, with a label. */
export const PIXOO_SECTION = {device: {...PIXOO_SIMULATED.config.device, label: 'Desk Pixoo'}} as const;
/** The Pixoo module's source: `device` is a shared family, so its reader names the owner it syncs from (Hub #967). */
const PIXOO_OWNER = 'bunny/modules/pixoo';
/** The Pixoo's families, which the reader copies from the Pixoo by name. */
export const PIXOO_FAMILIES: Follow = {owner: PIXOO_OWNER, families: ['device', PIXOO.display, PIXOO.rendition, PIXOO.playlist]};
/** A 1x1 red PNG, which the module renders to 64x64 in its media child process. */
const RED_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const pixooCommand = (family: string, verb: string, data: object): {key: string; draft: CommandDraft<object>} => ({
  key: `bunny.cmd.${family}.${PIXOO_ID}`, draft: {type: `org.bunny.${verb}.requested`, subject: PIXOO_ID, dataschema: schemaOf(family), data},
});
export const pixooMode = (mode: 'monitor' | 'media'): {key: string; draft: CommandDraft<object>} => pixooCommand('device-mode-set', 'device-mode.set', {mode});
export const pixooDevice = (h: Harness): DeviceRecord | undefined => h.reader.states<DeviceRecord>('device', PIXOO_OWNER).find(state => state.data.id === PIXOO_ID)?.data;
export const pixooDisplay = (h: Harness): DisplayRecord | undefined => h.reader.states<DisplayRecord>(PIXOO.display, PIXOO_OWNER).find(state => state.data.id === PIXOO_ID)?.data;
/** The reader heard the request's outcome as `result` with `evidence`. */
export const completedAs = (h: Harness, requestId: string, result: string, evidence: string): Outcome => {
  const outcome = h.reader.heard().find(message => message.kind === 'outcome' && (message.data as {requestId?: unknown}).requestId === requestId);
  const data = outcome?.data as {result?: string; evidence?: string} | undefined;
  return (data?.result === result && data.evidence === evidence) || `${requestId}'s outcome is ${show(data)}`;
};
const pixooAvailability = (h: Harness, availability: DeviceRecord['availability']): Outcome =>
  pixooDevice(h)?.availability === availability || `the reader's copy shows the Pixoo ${String(pixooDevice(h)?.availability)}`;
export const shownFrames = (h: Harness, frames: number): Outcome => pixooState(h).shown?.frames === frames || `the Pixoo shows ${show(pixooState(h).shown)}`;
/**
 * The Pixoo with the owners of what it follows: the core's sessions for Monitor, and the playback module's record for
 * Now Playing, as in the shipped list, so its syncs are served and a run's records show only what its scenario does.
 */
const PIXOO_SEED: Seed = {
  modules: ['core', 'playback', 'pixoo'], follows: [CORE_FAMILIES, PIXOO_FAMILIES], config: {playback: PLAYBACK_SECTION, pixoo: PIXOO_SECTION},
};
const PIXOO_MODULES = ['core', 'playback', 'pixoo'] as const;
/** The runtime's refusals of the Pixoo's own syncs, as `<pattern> <code>`. */
const pixooRefusals = (h: Harness): string[] => h.logs().map(({record}) => record)
  .filter(record => record.event_name === 'runtime.sync.refused' && record.attributes['bunny.participant'] === PIXOO_OWNER)
  .map(record => `${String(record.attributes['bunny.pattern'])} ${String(record.attributes['bunny.code'])}`);
const followsItsOwners = (): Step =>
  expect('the runtime refused none of the Pixoo\'s syncs: the core and the playback module serve what it follows', h =>
    pixooRefusals(h).length === 0 || `refused ${show(pixooRefusals(h))}`);

/** Monitor follows the core's sessions: a session that waits for approval pulses on the Pixoo, and calms once approved. */
const pixooMonitor: Scenario = {
  id: 'pixoo-monitor',
  title: 'the Pixoo\'s Monitor follows the agent sessions the core holds',
  seed: PIXOO_SEED,
  steps: [
    expect('the core, the playback module and the Pixoo are running', h => running(h, PIXOO_MODULES)),
    expect('the reader\'s copy shows the simulated Pixoo available', h => pixooAvailability(h, 'available')),
    act('the operator selects Monitor', h => dispatchOnce(h, 'operator', 'pixoo-monitor', pixooMode('monitor'), 'pixoo-monitor-1')),
    expect('Monitor\'s selection completes as the module\'s own observed state', h => completedAs(h, 'pixoo-monitor-1', 'succeeded', 'observed')),
    act('the hook observes a session start and an approval prompt', async h => {
      await publish(h, sessionStarted);
      await publish(h, approvalPrompt('approve-1'));
    }),
    expect('the reader\'s copy shows Monitor presenting one session that waits for a person', h => {
      const display = pixooDisplay(h);
      return (display?.mode === 'monitor' && display.participating && display.showing === 'dashboard' && display.monitor.matched === 1 && display.monitor.attention === 1) ||
        `display ${show(display)}`;
    }, 5000),
    expect('the Pixoo shows the session\'s dashboard, pulsing in two frames for the approval', h => shownFrames(h, 2), 5000),
    act('the hook observes the approval resolved', h => publish(h, approvalResolved('approve-1'))),
    expect('the Pixoo shows the calm dashboard in one frame', h => shownFrames(h, 1), 8000),
    expect('the core, the playback module and the Pixoo are still running', h => running(h, PIXOO_MODULES)),
    followsItsOwners(),
  ],
};

/** The operator imports a picture, creates a playlist and puts the picture in it, as a person would in the Pixoo pages. */
export const pixooPlaylist = (): Step[] => [
  act('the operator imports a picture', h => dispatchOnce(h, 'operator', 'pixoo-import',
    pixooCommand(PIXOO.assetChange, 'pixoo-asset.change', {change: {operation: 'import', name: 'Red', content: {inline: RED_PIXEL}}}), 'pixoo-import-1')),
  expect('the import completes, decoded in the module\'s media process', h => completedAs(h, 'pixoo-import-1', 'succeeded', 'observed'), 20_000),
  expect('the reader\'s copy of the catalog holds the rendition', h => h.reader.states<RenditionRecord>(PIXOO.rendition).length === 1 || 'no rendition'),
  act('the operator creates a playlist', h => dispatchOnce(h, 'operator', 'pixoo-playlist',
    pixooCommand(PIXOO.playlistChange, 'pixoo-playlist.change', {change: {operation: 'create', name: 'Desk'}}), 'pixoo-playlist-1')),
  expect('the reader\'s copy holds the playlist', h => h.reader.states<PlaylistRecord>(PIXOO.playlist).length === 1 || 'no playlist'),
  act('the operator puts the picture in the playlist', h => {
    const [rendition] = h.reader.states<RenditionRecord>(PIXOO.rendition), [list] = h.reader.states<PlaylistRecord>(PIXOO.playlist);
    if (rendition === undefined || list === undefined) throw new StepFailure('the catalog is missing');
    return dispatchOnce(h, 'operator', 'pixoo-items', pixooCommand(PIXOO.playlistChange, 'pixoo-playlist.change', {
      change: {operation: 'items', playlistId: list.data.id, revision: list.data.playlistRevision, items: [{renditionId: rendition.data.id}]},
    }), 'pixoo-items-1');
  }),
];
/** The operator starts the playlist the reader holds, as `requestId`. */
export const startPlaylist = (h: Harness, label: string, requestId: string): Promise<string> => {
  const [list] = h.reader.states<PlaylistRecord>(PIXOO.playlist);
  if (list === undefined) throw new StepFailure('no playlist');
  return h.dispatch('operator', label, pixooCommand('media-start', 'media.start', {playlistId: list.data.id}), requestId);
};

/** The shared pages' authenticated reads and one tracked editor command, reused by both catalog adapters (#932). */
const pixooPages: Scenario = {
  id: 'pixoo-pages',
  title: 'Pixoo page reads stay passive and a permitted editor change reaches the tracked owner',
  seed: PIXOO_SEED,
  steps: [
    expect('the Pixoo contributes its React pages and read-only settings', answers({as: 'reader', method: 'GET', path: '/api/v2/modules'}, answer => {
      const module = bodyOf<{modules: {name: string; pages: {id: string; presentation?: string}[]; settings: boolean}[]}>(answer)?.modules.find(item => item.name === 'pixoo');
      return (answer.status === 200 && module?.settings === true && ['library', 'playlists', 'player', 'monitor', 'settings'].every(id =>
        module.pages.some(page => page.id === id && page.presentation === 'react'))) || 'the declared Pixoo pages are incomplete';
    })),
    ...pixooPlaylist(),
    expect('catalog and selected preview load by bounded references', async h => {
      const catalog = await h.gateway({as: 'reader', method: 'GET', path: '/modules/pixoo/content/catalog-media?limit=1'});
      const media = bodyOf<{items: {renditionId: string}[]}>(catalog)?.items[0];
      if (catalog.status !== 200 || Buffer.byteLength(catalog.text) > 256 * 1024 || media === undefined) return 'catalog read failed';
      const preview = await h.gateway({as: 'reader', method: 'GET', path: `/modules/pixoo/content/preview.${media.renditionId}`});
      return (preview.status === 200 && bodyOf<{renditionId: string}>(preview)?.renditionId === media.renditionId) || 'referenced preview read failed';
    }),
    expect('player, Monitor and settings reads do not start display output', async h => {
      for (const path of ['/modules/pixoo/content/player', '/modules/pixoo/content/monitor', '/api/v2/modules/pixoo/settings']) {
        const answer = await h.gateway({as: 'reader', method: 'GET', path});
        if (answer.status !== 200) return `${path} refused ${answer.status}`;
      }
      return pixooState(h).sent === 0 || 'a passive read sent display output';
    }),
    act('the editor explicitly saves a revised playlist name', h => {
      const list = h.reader.states<PlaylistRecord>(PIXOO.playlist)[0]?.data;
      if (list === undefined) throw new StepFailure('the playlist is missing');
      return dispatchOnce(h, 'operator', 'pixoo-page-rename', pixooCommand(PIXOO.playlistChange, 'pixoo-playlist.change', {
        change: {operation: 'rename', playlistId: list.id, revision: list.playlistRevision, name: 'Page edit'},
      }), 'pixoo-page-rename-1');
    }),
    expect('the command completes and the owner confirms the saved name', h =>
      completedAs(h, 'pixoo-page-rename-1', 'succeeded', 'observed') === true
      && h.reader.states<PlaylistRecord>(PIXOO.playlist)[0]?.data.name === 'Page edit' || 'the tracked name change is incomplete'),
    expect('a read-only caller cannot forge the editor change', async h => {
      const list = h.reader.states<PlaylistRecord>(PIXOO.playlist)[0]?.data;
      if (list === undefined) return 'the playlist is missing';
      return refusedWith(await h.gateway({as: 'reader', method: 'POST', path: '/api/v2/commands/pixoo-playlist-change', body: {
        target: PIXOO_ID, requestId: 'pixoo-page-forbidden', data: {change: {operation: 'rename', playlistId: list.id, revision: list.playlistRevision, name: 'Forbidden'}},
      }}), 403, 'forbidden');
    }),
    expect('the refused change and completed library edit leave the display alone', h =>
      pixooState(h).sent === 0 && h.reader.states<PlaylistRecord>(PIXOO.playlist)[0]?.data.name === 'Page edit' || 'unexpected owner or display change'),
    act('create saves a requested identity with its initial media atomically', h => {
      const media = h.reader.states<RenditionRecord>(PIXOO.rendition)[0]?.data;
      if (media === undefined) throw new StepFailure('the media is missing');
      return dispatchOnce(h, 'operator', 'pixoo-card-create', pixooCommand(PIXOO.playlistChange, 'pixoo-playlist.change', {
        change: {operation: 'create', playlistId: '123e4567-e89b-42d3-a456-426614174000', name: 'Card create', repeat: true, items: [{renditionId: media.id}]},
      }), 'pixoo-card-create-1');
    }),
    expect('the populated playlist is owner-confirmed without starting playback', h => {
      const list = h.reader.states<PlaylistRecord>(PIXOO.playlist).find(record => record.data.id === '123e4567-e89b-42d3-a456-426614174000')?.data;
      return completedAs(h, 'pixoo-card-create-1', 'succeeded', 'observed') === true && list?.name === 'Card create'
        && list.repeat && list.playlistRevision === 1 && list.items.length === 1 && pixooState(h).sent === 0 || 'populated creation did not commit atomically';
    }),
    act('a duplicate requested identity is refused', h => dispatchOnce(h, 'operator', 'pixoo-card-duplicate', pixooCommand(PIXOO.playlistChange, 'pixoo-playlist.change', {
      change: {operation: 'create', playlistId: '123e4567-e89b-42d3-a456-426614174000', name: 'Collision', items: []},
    }), 'pixoo-card-duplicate-1')),
    expect('a duplicate leaves the original playlist unchanged', h => completedAs(h, 'pixoo-card-duplicate-1', 'failed', 'none') === true
      && !h.reader.states<PlaylistRecord>(PIXOO.playlist).some(record => record.data.name === 'Collision') || 'duplicate creation changed the catalog'),
    act('invalid initial media is refused', h => dispatchOnce(h, 'operator', 'pixoo-card-invalid', pixooCommand(PIXOO.playlistChange, 'pixoo-playlist.change', {
      change: {operation: 'create', playlistId: '123e4567-e89b-42d3-a456-426614174001', name: 'Invalid initial media', items: [{renditionId: 'f'.repeat(64)}]},
    }), 'pixoo-card-invalid-1')),
    expect('invalid initial media leaves no empty playlist', h => completedAs(h, 'pixoo-card-invalid-1', 'failed', 'none') === true
      && !h.reader.states<PlaylistRecord>(PIXOO.playlist).some(record => record.data.id === '123e4567-e89b-42d3-a456-426614174001')
      && pixooState(h).sent === 0 || 'invalid creation left a partial playlist'),
    followsItsOwners(),
  ],
};

/** A media command: imported media in a playlist, started, accepted at once and completed once the media reached the Pixoo. */
const pixooMedia: Scenario = {
  id: 'pixoo-media',
  title: 'a media command to the Pixoo is accepted, then completed once the media reaches the device',
  seed: PIXOO_SEED,
  steps: [
    expect('the core, the playback module and the Pixoo are running', h => running(h, PIXOO_MODULES)),
    ...pixooPlaylist(),
    expect('the playlist is among the Pixoo\'s capabilities', h => {
      const media = pixooDevice(h)?.capabilities.media;
      return (media?.supported === true && media.playlistIds.length === 1) || `media ${show(media)}`;
    }),
    act('the operator starts the playlist', h => startPlaylist(h, 'pixoo-start', 'pixoo-start-1')),
    expect('the start is accepted at once', h => answered(h, 'pixoo-start', 'accepted')),
    expect('then completes, transmitted, once the media reached the Pixoo', h => completedAs(h, 'pixoo-start-1', 'succeeded', 'transmitted'), 8000),
    expect('the Pixoo shows the picture', h => shownFrames(h, 1)),
    expect('the reader\'s copy names the start as the device\'s last transmission', h => {
      const last = pixooDevice(h)?.lastTransmission;
      return (last?.status === 'known' && last.requestId === 'pixoo-start-1') || `last transmission ${show(last)}`;
    }),
    followsItsOwners(),
  ],
};

/** The song the presented speaker plays, and the card the Pixoo shows for it while it plays and is current. */
const PIXOO_SONG = 'Harvest Moon';
const playingCard = (): string => frameDigest(renderNowPlaying({card: true, status: 'playing', title: 'HARVEST MOON', artist: '', stale: false}));
const showsCard = (h: Harness): Outcome => pixooState(h).shown?.digests[0] === playingCard() || `the Pixoo shows ${show(pixooState(h).shown)}`;
/** The reader's copy offers the song's card, current and not dimmed. */
const currentCard = (h: Harness): Outcome => {
  const playing = pixooDisplay(h)?.nowPlaying;
  return (playing?.card === true && !playing.stale) || `now playing ${show(playing)}`;
};
/**
 * Now Playing follows the playback module's presented speaker. The playback module publishes only when the speaker
 * changes, so a song that plays on unchanged keeps its card current: it pops up over Monitor for ten seconds without
 * dimming, and in Media a whole takeover holds the card for as long as the song plays, more than thirty seconds here,
 * then gives the playlist back once the speaker stops.
 */
const pixooNowPlaying: Scenario = {
  id: 'pixoo-now-playing',
  title: 'the Pixoo shows the presented speaker\'s song over Monitor and Media for as long as it plays',
  seed: {
    modules: ['core', 'playback', 'pixoo'], follows: [CORE_FAMILIES, PIXOO_FAMILIES],
    config: {playback: PLAYBACK_SECTION, pixoo: {...PIXOO_SECTION, playback: PLAYBACK_SECTION.id}},
  },
  steps: [
    expect('the core, the playback module and the Pixoo are running', h => running(h, ['core', 'playback', 'pixoo'])),
    act('the operator selects Monitor', h => dispatchOnce(h, 'operator', 'pixoo-monitor', pixooMode('monitor'), 'pixoo-monitor-2')),
    act('the hook observes a session start', h => publish(h, sessionStarted)),
    expect('the Pixoo shows the session\'s dashboard', h => (pixooState(h).shown !== null && pixooDisplay(h)?.showing === 'dashboard') || `display ${show(pixooDisplay(h))}`, 5000),
    act('the phone plays a song to the HT-A9', h => { h.simulate({device: 'playback', speaker: 'sony', action: 'play', title: PIXOO_SONG}); }),
    expect('the Pixoo shows the song\'s card', h => showsCard(h), 6000),
    expect('the reader\'s copy shows the card as a pop-up over Monitor', h => {
      const display = pixooDisplay(h);
      return (display?.showing === 'card' && display.nowPlaying.card && display.nowPlaying.takeover === null) || `display ${show(display)}`;
    }),
    holds('the card stays bright through the pop-up while the song plays on unchanged', h => showsCard(h), 7000),
    expect('after ten seconds Monitor shows the dashboard again', h => pixooDisplay(h)?.showing === 'dashboard' || `display ${show(pixooDisplay(h))}`, 5000),
    act('the operator asks for a whole takeover in Media', h => dispatchOnce(h, 'operator', 'pixoo-whole',
      pixooCommand(PIXOO.nowPlaying, 'pixoo-now-playing.set', {media: 'whole'}), 'pixoo-whole-1')),
    expect('the setting completes', h => completedAs(h, 'pixoo-whole-1', 'succeeded', 'observed')),
    ...pixooPlaylist(),
    act('the operator starts the playlist while the song plays on', h => startPlaylist(h, 'pixoo-start', 'pixoo-start-2')),
    // The takeover pauses the playlist for the card at once, so the start's selection, committed, is its evidence.
    expect('the start completes succeeded, observed: the playlist is selected and waits behind the card', h => completedAs(h, 'pixoo-start-2', 'succeeded', 'observed'), 8000),
    expect('Media hands the Pixoo to the song\'s card', h => {
      const display = pixooDisplay(h);
      return (display?.mode === 'media' && display.nowPlaying.takeover === 'whole' && showsCard(h) === true) || `display ${show(display)}, ${show(showsCard(h))}`;
    }, 8000),
    holds('the whole takeover keeps the current card for more than thirty seconds while the song plays on unchanged', h => {
      const card = currentCard(h), shown = showsCard(h);
      return (card === true && shown === true && pixooDisplay(h)?.nowPlaying.takeover === 'whole') || `${show(card)}, ${show(shown)}, takeover ${show(pixooDisplay(h)?.nowPlaying.takeover)}`;
    }, 31_000),
    act('the phone stops the song', h => { h.simulate({device: 'playback', speaker: 'sony', action: 'stop'}); }),
    expect('the takeover ends and Media shows the picture again', h => {
      const display = pixooDisplay(h);
      return (display?.nowPlaying.takeover === null && display.nowPlaying.card === false && pixooState(h).shown?.digests[0] !== playingCard()) || `display ${show(display)}`;
    }, 8000),
  ],
};

/**
 * A moment through the core's dispatcher, over Monitor and over Media (Hub #1287): it shows on the simulated Pixoo, ends
 * on its own, and gives back the base it covered, without a mode change. Attention ends one at once.
 */
const momentOf = (h: Harness, id: string, patch: object = {}): {key: string; draft: CommandDraft<object>} => ({
  key: `bunny.cmd.moment-play.${PIXOO_ID}`,
  draft: {type: 'org.bunny.moment.play.requested', subject: PIXOO_ID, dataschema: 'https://bunny.invalid/events/moment-play/2.0',
    data: {momentId: id, mood: 'celebrate', durationMs: 2000, priorityClass: 'event', coversStatus: true, startAtMs: h.now(), toleranceMs: 10_000, ...patch}},
});
const momentEnding = (h: Harness, requestId: string, ending: string): Outcome => {
  const data = h.reader.heard().find(message => message.type === 'org.bunny.moment.ended' && (message.data as {requestId?: unknown}).requestId === requestId)?.data as {ending?: string} | undefined;
  return data?.ending === ending || `${requestId} ended ${show(data)}`;
};
const pixooMoment: Scenario = {
  id: 'pixoo-moment',
  title: 'a moment plays over Monitor and over Media and gives back what it covered',
  seed: PIXOO_SEED,
  steps: [
    expect('the core, the playback module and the Pixoo are running', h => running(h, PIXOO_MODULES)),
    expect('the Pixoo declares its moods and whether it can cover status', h => {
      const moments = pixooDevice(h)?.capabilities.moments;
      return (moments?.supported === true && moments.coversStatus && moments.moods.includes('celebrate')) || `moments ${show(moments)}`;
    }),
    act('the operator selects Monitor', h => dispatchOnce(h, 'operator', 'pixoo-monitor', pixooMode('monitor'), 'pixoo-moment-mode')),
    act('the hook observes a session start', h => publish(h, sessionStarted)),
    expect('the Pixoo shows the session\'s dashboard', h => (pixooState(h).shown !== null && pixooDisplay(h)?.showing === 'dashboard') || `display ${show(pixooDisplay(h))}`, 5000),
    act('a moment the hub allows to cover status arrives', h => dispatchOnce(h, 'operator', 'moment-monitor', momentOf(h, 'moment-monitor'), 'moment-monitor-1')),
    expect('the moment takes the display and Monitor stays selected', h => {
      const display = pixooDisplay(h);
      return (display?.showing === 'moment' && display.mode === 'monitor' && display.participating) || `display ${show(display)}`;
    }, 5000),
    expect('it completes with a transmission and a completed ending', h => {
      const done = completedAs(h, 'moment-monitor-1', 'succeeded', 'transmitted');
      return done === true ? momentEnding(h, 'moment-monitor-1', 'completed') : done;
    }, 8000),
    expect('Monitor shows the dashboard again', h => (pixooDisplay(h)?.showing === 'dashboard' && pixooDisplay(h)?.moments?.playing === null) || `display ${show(pixooDisplay(h))}`, 5000),
    act('a second moment starts', h => dispatchOnce(h, 'operator', 'moment-attention', momentOf(h, 'moment-attention', {durationMs: 10_000}), 'moment-attention-1')),
    expect('the moment takes the display', h => pixooDisplay(h)?.showing === 'moment' || `display ${show(pixooDisplay(h))}`, 5000),
    act('the hook observes an approval prompt', h => publish(h, approvalPrompt('approve-moment'))),
    expect('attention ends it at once with a preempted ending', h => momentEnding(h, 'moment-attention-1', 'preempted'), 5000),
    expect('Monitor shows the session that needs attention', h => (pixooDisplay(h)?.showing === 'dashboard' && pixooDisplay(h)?.monitor.attention === 1) || `display ${show(pixooDisplay(h))}`, 5000),
    act('the approval resolves', h => publish(h, approvalResolved('approve-moment'))),
    act('the operator selects Media', h => dispatchOnce(h, 'operator', 'pixoo-media', pixooMode('media'), 'pixoo-moment-media')),
    act('a flourish arrives with nothing playing', h => dispatchOnce(h, 'operator', 'moment-idle', momentOf(h, 'moment-idle', {priorityClass: 'flourish', coversStatus: false}), 'moment-idle-1')),
    expect('the moment shows without changing the mode or the player', h => {
      const display = pixooDisplay(h);
      return (display?.showing === 'moment' && display.mode === 'media' && display.player.state !== 'playing') || `display ${show(display)}`;
    }, 5000),
    expect('it completes and nothing starts playing', h => {
      const display = pixooDisplay(h), done = momentEnding(h, 'moment-idle-1', 'completed');
      return done === true ? (display?.showing === 'none' && display.player.state !== 'playing') || `display ${show(display)}` : done;
    }, 8000),
    ...pixooPlaylist(),
    act('the operator starts the playlist', h => startPlaylist(h, 'pixoo-start', 'pixoo-moment-start')),
    expect('the start completes', h => completedAs(h, 'pixoo-moment-start', 'succeeded', 'transmitted'), 8000),
    expect('the playlist plays', h => pixooDisplay(h)?.player.state === 'playing' || `display ${show(pixooDisplay(h))}`, 8000),
    act('a flourish arrives over Media', h => dispatchOnce(h, 'operator', 'moment-media', momentOf(h, 'moment-media', {priorityClass: 'flourish', coversStatus: false}), 'moment-media-1')),
    expect('the moment pauses the playlist for the display without changing the mode', h => {
      const display = pixooDisplay(h);
      return (display?.showing === 'moment' && display.mode === 'media' && display.player.intent === 'paused') || `display ${show(display)}`;
    }, 5000),
    expect('it ends and the playlist resumes', h => {
      const display = pixooDisplay(h), done = momentEnding(h, 'moment-media-1', 'completed');
      return done === true ? display?.player.intent === 'active' || `display ${show(display)}` : done;
    }, 8000),
    act('the operator stops the playlist', h => h.dispatch('operator', 'pixoo-stop', pixooCommand('media-control', 'media.control', {action: 'stop'}), 'pixoo-moment-stop')),
    expect('the stop completes', h => completedAs(h, 'pixoo-moment-stop', 'succeeded', 'observed'), 8000),
    act('a flourish arrives over the stopped item', h => dispatchOnce(h, 'operator', 'moment-stopped', momentOf(h, 'moment-stopped', {priorityClass: 'flourish', coversStatus: false}), 'moment-stopped-1')),
    expect('the moment shows and the item stays stopped', h => {
      const display = pixooDisplay(h);
      return (display?.showing === 'moment' && display.player.intent === 'stopped') || `display ${show(display)}`;
    }, 5000),
    expect('it completes and the player stays stopped', h => {
      const display = pixooDisplay(h), done = momentEnding(h, 'moment-stopped-1', 'completed');
      return done === true ? display?.player.intent === 'stopped' || `display ${show(display)}` : done;
    }, 8000),
    followsItsOwners(),
  ],
};

const stagedArt = (h: Harness) => h.reader.states<ArtState>('art', 'bunny/modules/art')[0]?.data.candidates.find(candidate => candidate.target === 'pixoo');
/** The producer resolves its target kind to the configured device ID through that owner's live SDK copy. */
const pixooArt: Scenario = {
  id: 'pixoo-art', title: 'the real art owner stages exact private Pixoo frames without replacing the display',
  keepCapturePage: true,
  seed: {modules: ['core', 'playback', 'pixoo', 'art'], follows: [...(PIXOO_SEED.follows), {owner: 'bunny/modules/art', families: ['art']}],
    config: {playback: PLAYBACK_SECTION, pixoo: PIXOO_SECTION}, sections: {art: {}}},
  capture: async (context, harness) => {const {capturePixooArt} = await import('../../../verify/pixoo-art-browser.js'); await capturePixooArt(context, harness);},
  steps: [
    expect('the real core, art owner and simulated display are running', h => running(h, ['core', 'playback', 'pixoo', 'art'])),
    expect('the art owner has completed its initial device sync', h => h.logs().some(({record}) => record.event_name === 'runtime.sync.served'
      && record.attributes['bunny.participant'] === 'bunny/modules/art' && record.attributes['bunny.pattern'] === 'sync device') || 'the art owner has no current device copy', 5000),
    act('the owner requests a synthetic scene for Pixoo', async h => {
      const answer = await h.gateway({as: 'browser', method: 'POST', path: '/api/v2/commands/art-request', body: {target: 'art', requestId: 'pixoo-art-create',
        data: {action: 'start', purpose: 'request', origin: {kind: 'owner'}, targets: ['pixoo'], text: 'SYNTHETIC_PIXOO_MOON'}}});
      if (answer.status !== 200) throw new StepFailure(`art request returned ${answer.status}`);
    }),
    expect('the core confirms staging and the producer offers the exact composition', h => stagedArt(h) !== undefined || 'no successfully staged Pixoo candidate', 20_000),
    expect('an authenticated reader sees all eight effective frames and their 200 ms timing', async h => {
      const compositionId = stagedArt(h)?.compositionId;
      if (compositionId === undefined) return 'no composition';
      const answer = await h.gateway({as: 'reader', method: 'GET', path: `/modules/pixoo/content/art-preview.${compositionId}`});
      const manifest = bodyOf<{compositionId: string; width: number; height: number; frameCount: number; durationMs: number; frames: {delayMs: number; ref: string}[]}>(answer);
      if (answer.status !== 200 || manifest?.compositionId !== compositionId || manifest.width !== 64 || manifest.height !== 64 || manifest.frameCount !== 8
        || manifest.durationMs !== 1600 || manifest.frames.length !== 8 || manifest.frames.some(frame => frame.delayMs !== 200)) return 'effective art manifest differs';
      for (const frame of manifest.frames) {
        const png = await h.gateway({as: 'reader', method: 'GET', path: `/modules/pixoo/content/${frame.ref}`});
        if (png.status !== 200 || png.headers['content-type'] !== 'image/png') return 'an effective frame is unreadable';
      }
      return true;
    }),
    expect('anonymous reads cannot retrieve private art', async h => refusedWith(await h.gateway({as: 'anonymous', method: 'GET',
      path: `/modules/pixoo/content/art-preview.${stagedArt(h)?.compositionId ?? 'missing'}`}), 401, 'unauthenticated')),
    expect('staging and preview neither import a permanent library entry nor send a display command', h =>
      pixooState(h).uploads === 0 && h.reader.states<RenditionRecord>(PIXOO.rendition).length === 0 || 'staging changed display or permanent library'),
    act('the runtime restarts with its private staged copy', h => h.restart()),
    expect('the same composition remains readable after restart without a replay', async h => {
      const compositionId = stagedArt(h)?.compositionId;
      if (compositionId === undefined) return 'the producer lost its staged candidate';
      const answer = await h.gateway({as: 'reader', method: 'GET', path: `/modules/pixoo/content/art-preview.${compositionId}`});
      return answer.status === 200 && pixooState(h).uploads === 0 || 'the retained copy is unreadable or replayed';
    }),
  ],
};

/** The Pixoo module's records of `event` at `level` from the runtime's `from`th start on. */
const pixooLogged = (h: Harness, event: string, level: string, from: number): number =>
  logged(h, 'pixoo', event, from).filter(({record}) => record.severity_text === level).length;
/** A start while the Pixoo is offline: the module runs, the device is unavailable with one warning, and it recovers once. */
const pixooOffline: Scenario = {
  id: 'pixoo-offline',
  title: 'the Pixoo module starts while its device is offline, reports it unavailable, and recovers once it answers',
  seed: PIXOO_SEED,
  steps: [
    expect('the core, the playback module and the Pixoo are running', h => running(h, PIXOO_MODULES)),
    act('the Pixoo goes offline, and the runtime restarts', async h => {
      h.simulate({device: 'pixoo', action: 'offline'});
      await h.restart();
    }),
    expect('the Pixoo module runs, though its device does not answer', h => running(h, ['core', 'pixoo'])),
    expect('the reader\'s copy shows the Pixoo unavailable', h => pixooAvailability(h, 'unavailable'), 5000),
    holds('it stays unavailable, and the module keeps running', async h => (pixooAvailability(h, 'unavailable') === true && await running(h, ['pixoo']) === true) || 'changed', 4000),
    expect('the module logged one degradation, not a warning per probe', h => pixooLogged(h, 'device.unavailable', 'WARN', 2) === 1 || `${pixooLogged(h, 'device.unavailable', 'WARN', 2)} warnings`),
    act('the Pixoo comes back online', h => { h.simulate({device: 'pixoo', action: 'online'}); }),
    expect('the reader\'s copy shows the Pixoo available', h => pixooAvailability(h, 'available'), 35_000),
    expect('the module logged one recovery', h => pixooLogged(h, 'device.available', 'INFO', 2) === 1 || `${pixooLogged(h, 'device.available', 'INFO', 2)} recoveries`),
    followsItsOwners(),
  ],
};


const animationName = (count: number): string => `Synthetic ${count}-frame animation`;
function animationRecord(h: Harness, count: number): RenditionRecord | undefined {
  return h.reader.states<RenditionRecord>(PIXOO.rendition, PIXOO_OWNER).find(({data}) => data.name === animationName(count))?.data;
}
const importAnimation = (count: number): Step[] => [
  act(`the operator imports all ${count} frames`, async h => {
    const delays = Array<number>(count).fill(100);
    if (count === 1001) delays[count - 1] = 900;
    const gif = await pixooAnimation(delays);
    const query = new URLSearchParams({family: PIXOO.assetChange, target: PIXOO_ID, requestId: `import-${count}`, name: animationName(count)});
    const answer = await h.gateway({as: 'browser', method: 'POST', path: `/api/v2/modules/pixoo/upload?${query}`, body: gif});
    if (answer.status !== 200) throw new StepFailure(`upload of ${count} frames returned HTTP ${answer.status}`);
  }),
  expect(`the catalog reports ${count} frames and their compatibility with direct playback`, h => {
    const record = animationRecord(h, count);
    return (record?.frameCount === count && record.compatible === (count < 60) &&
      completedAs(h, `import-${count}`, 'succeeded', 'observed') === true) ||
      `catalog frame count ${String(record?.frameCount)}, direct compatibility ${String(record?.compatible)}`;
  }, 30_000),
];
function showAnimation(count: number): Step {
  return act(`the operator requests the ${count}-frame animation on the configured direct route`, h => {
    const record = animationRecord(h, count);
    if (record === undefined) throw new StepFailure('the synthetic animation is missing');
    return dispatchOnce(h, 'operator', `show-${count}`, pixooCommand(PIXOO.show, 'pixoo-media.show', {
      renditionId: record.id, playback: {mode: 'duration', durationMs: 120_000},
    }), `show-${count}`);
  });
}
const pixooCommandLimits: Scenario = {
  id: 'pixoo-command-limits', title: 'direct playback admits 59 frames while the library preserves longer animations',
  seed: PIXOO_SEED, keepCapturePage: true,
  capture: async context => {
    const {capturePixooCommandLimits} = await import('../../../verify/pixoo-command-limits-browser.js');
    await capturePixooCommandLimits(context);
  },
  steps: [
    expect('the configured Pixoo and its owners are running', h => running(h, PIXOO_MODULES)),
    ...[21, 59, 60, 1001].flatMap(importAnimation),
    expect('the final library frame and all source delays are readable with no display output', async h => {
      const record = animationRecord(h, 1001);
      if (record === undefined) return 'missing long animation';
      const path = '/modules/pixoo/content/';
      const answer = await h.gateway({as: 'reader', method: 'GET', path: `${path}preview.${record.id}`});
      const preview = bodyOf<{frameCount: number; frames: {index: number; delayMs: number}[]}>(answer);
      if (answer.status !== 200 || preview?.frameCount !== 1001 || preview.frames.length !== 1001 ||
        !preview.frames.every((frame, index) => frame.index === index && frame.delayMs === (index === 1000 ? 900 : 100))) return 'preview timing or order changed';
      const last = await h.gateway({as: 'reader', method: 'GET', path: `${path}frame.${record.id}.1000`});
      return (last.status === 200 && last.headers['content-type'] === 'image/png' && pixooState(h).sent === 0) || 'missing final PNG or an unexpected display write';
    }),
    ...[21, 59].flatMap((count, index) => [
      showAnimation(count),
      expect(`the simulated writer received all ${count} frames at one speed`, h => {
        const state = pixooState(h);
        return (completedAs(h, `show-${count}`, 'succeeded', 'transmitted') === true && state.uploads === index + 1 &&
          state.shown?.frames === count && state.shown.delaysMs.every(delay => delay === 100)) || `uploads ${state.uploads}, shown frames ${String(state.shown?.frames)}`;
      }, 8000),
    ]),
    ...[60, 1001].flatMap(count => [
      showAnimation(count),
      expect(`the direct route refuses ${count} frames before another writer call`, h => {
        const outcome = h.reader.heard().filter(message => message.kind === 'outcome')
          .map(message => message.data as {requestId: string; error?: {code: string; detail?: string}})
          .find(data => data.requestId === `show-${count}`);
        const state = pixooState(h);
        return (completedAs(h, `show-${count}`, 'failed', 'none') === true && outcome?.error?.code === 'unsupported-capability' &&
          /Draw\/SendHttpGif.*59/.test(outcome.error.detail ?? '') && state.sent === 2 && state.shown?.frames === 59) ||
          `refusal ${show(outcome?.error)}, writer calls ${state.sent}, shown frames ${String(state.shown?.frames)}`;
      }),
    ]),
  ],
};

/** Where the `pixoo-migrated` run keeps its synthetic Pixoo library, `<data>/pixoo-library` (Hub #931). */
export const pixooLibraryOf = (dataDir: string): string => join(dataDir, 'pixoo-library');

/**
 * Writes a synthetic Pixoo library of the installed schema version and runs the migration tool's `migrate` and `verify`
 * on it into the run's state directory, as the installer will before the runtime's first start at the cutover (#840).
 * Keeps each one's line in `<data>/migration/{migrate,verify}.json`, and fails the seed unless both exit 0.
 */
async function migratePixoo(dataDir: string): Promise<void> {
  await writeSyntheticLibrary(pixooLibraryOf(dataDir));
  await mkdir(migrationOf(dataDir), {mode: 0o700});
  for (const operation of ['migrate', 'verify'] as const) {
    let line = '';
    const exit = await runPixooMigration([operation, '--library', pixooLibraryOf(dataDir), '--state-dir', stateDirOf(dataDir)], {write: text => { line += text; }});
    await writeFile(join(migrationOf(dataDir), `${operation}.json`), line, {mode: 0o600});
    if (exit !== 0) throw new Error(`the Pixoo library migration's ${operation} exited ${exit}`);
  }
}

export const scenarios: readonly Scenario[] = [pixooMonitor, pixooMedia, pixooCommandLimits, pixooNowPlaying, pixooMoment, pixooArt, pixooOffline, pixooPages];

export const runs: Readonly<Record<string, ModuleRun>> = {
  'pixoo-migrated': {
    description: 'The shipped runtime on a Pixoo library migrated from a synthetic library of the installed schema version 3, as the installer migrates it before the runtime starts (Hub #931)',
    prepare: migratePixoo,
  },
};
