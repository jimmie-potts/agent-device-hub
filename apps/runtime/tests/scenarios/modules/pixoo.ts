// The Pixoo module's scenarios (Hub #843, #999): Monitor following the core's sessions, a media command accepted then
// completed, a Now Playing card, and a start while the device is offline. Each runs the module with its simulated
// Pixoo. A disposable run of its own, `pixoo-migrated`, starts the shipped runtime on a migrated Pixoo library (Hub
// #931). The catalog collects this file.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {
  FAMILIES as PIXOO, SIMULATED_SECTION as PIXOO_SIMULATED, frameDigest, renderNowPlaying, schemaOf, writeSyntheticLibrary, type DisplayRecord,
  type PlaylistRecord, type RenditionRecord, type SimulatedPixooState,
} from '@jimmie-potts/pixoo';
import type {CommandDraft} from '@jimmie-potts/sdk';
import {runPixooMigration} from '../../../src/index.js';
import {migrationOf, stateDirOf} from '../../../verify/paths.js';
import {approvalPrompt, approvalResolved, sessionStarted} from '../../fixtures/agents.js';
import {
  CORE_FAMILIES, StepFailure, act, answered, answers, bodyOf, deviceState, dispatchOnce, expect, holds, logged, publish, refusedWith, running, show, type Follow, type Harness,
  type ModuleRun, type Outcome, type Scenario, type Seed, type Step,
} from '../framework.js';
import {PLAYBACK_SECTION} from './playback.js';

/** What the simulated Pixoo shows. */
const pixooState = (h: Harness): SimulatedPixooState => deviceState<SimulatedPixooState>(h, 'pixoo');

const PIXOO_ID = PIXOO_SIMULATED.config.device.id;
/** The Pixoo's section: the module's simulated section, which names the observed GIF profile, with a label. */
export const PIXOO_SECTION = {device: {...PIXOO_SIMULATED.config.device, label: 'Desk Pixoo'}} as const;
/** The Pixoo module's source: `device` is a shared family, so its reader names the owner it syncs from (Hub #967). */
const PIXOO_OWNER = 'bunny/modules/pixoo';
/** The Pixoo's families, which the reader copies from the Pixoo by name. */
const PIXOO_FAMILIES: Follow = {owner: PIXOO_OWNER, families: ['device', PIXOO.display, PIXOO.rendition, PIXOO.playlist]};
/** A 1x1 red PNG, which the module renders to 64x64 in its media child process. */
const RED_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pixooCommand = (family: string, verb: string, data: object): {key: string; draft: CommandDraft<object>} => ({
  key: `bunny.cmd.${family}.${PIXOO_ID}`, draft: {type: `org.bunny.${verb}.requested`, subject: PIXOO_ID, dataschema: schemaOf(family), data},
});
const pixooMode = (mode: 'monitor' | 'media'): {key: string; draft: CommandDraft<object>} => pixooCommand('device-mode-set', 'device-mode.set', {mode});
const pixooDevice = (h: Harness): DeviceRecord | undefined => h.reader.states<DeviceRecord>('device', PIXOO_OWNER).find(state => state.data.id === PIXOO_ID)?.data;
const pixooDisplay = (h: Harness): DisplayRecord | undefined => h.reader.states<DisplayRecord>(PIXOO.display, PIXOO_OWNER).find(state => state.data.id === PIXOO_ID)?.data;
/** The reader heard the request's outcome as `result` with `evidence`. */
const completedAs = (h: Harness, requestId: string, result: string, evidence: string): Outcome => {
  const outcome = h.reader.heard().find(message => message.kind === 'outcome' && (message.data as {requestId?: unknown}).requestId === requestId);
  const data = outcome?.data as {result?: string; evidence?: string} | undefined;
  return (data?.result === result && data.evidence === evidence) || `${requestId}'s outcome is ${show(data)}`;
};
const pixooAvailability = (h: Harness, availability: DeviceRecord['availability']): Outcome =>
  pixooDevice(h)?.availability === availability || `the reader's copy shows the Pixoo ${String(pixooDevice(h)?.availability)}`;
const shownFrames = (h: Harness, frames: number): Outcome => pixooState(h).shown?.frames === frames || `the Pixoo shows ${show(pixooState(h).shown)}`;
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
const pixooPlaylist = (): Step[] => [
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
const startPlaylist = (h: Harness, label: string, requestId: string): Promise<string> => {
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

export const scenarios: readonly Scenario[] = [pixooMonitor, pixooMedia, pixooNowPlaying, pixooOffline, pixooPages];

export const runs: Readonly<Record<string, ModuleRun>> = {
  'pixoo-migrated': {
    description: 'The shipped runtime on a Pixoo library migrated from a synthetic library of the installed schema version 3, as the installer migrates it before the runtime starts (Hub #931)',
    prepare: migratePixoo,
  },
};
