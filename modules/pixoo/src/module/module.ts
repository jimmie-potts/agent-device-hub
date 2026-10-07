// The Pixoo runtime module (Hub #843, ADR 0012). It wraps the Pixoo library, player and presentation as the module
// `pixoo`: its own SQLite file holds the library's catalog, the player's checkpoint, its settings and its outbox, and its
// private folder holds the media. It follows the core's `session/2.0` records for Monitor and the playback owner's
// `playback/2.0` record for Now Playing, by sync, and stores neither. It answers device, Media, player, playlist and catalog
// commands on `bunny.cmd.<family>.<device id>`: it refuses before acting with a typed refusal, or accepts, stores its
// own record of the work, replies, and reports the outcome through its outbox. It never sends a command again.
//
// Under policy A its start opens only local resources and never waits on the Pixoo: it reaches the device afterwards, on
// the runtime's scheduler, and turns the device's errors and timeouts into outcomes and an `unavailable` device record.
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {MessageValidator, errorBody, type ErrorBody, type ErrorCode, type ErrorDetail, type Message} from '@jimmie-potts/event-contracts/v2';
import {
  commandSupported, registerDeviceFamilies, type Capabilities, type CompletedOutcome, type DeviceCommand, type DeviceRecord,
} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies, type PlaybackState, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {
  DeviceAvailability, Outbox, SdkError, type AddMessage, type BunnyModule, type Cancel, type Command, type LogFields, type ModuleContext, type Reply, type Sdk,
  type Snapshot, type StateDraft, type SyncChange,
} from '@jimmie-potts/sdk';
import type {Clock as DeviceClock} from '../device/index.js';
import {Library} from '../library/index.js';
import {Player, LibraryPlaybackStore} from '../playback/index.js';
import {MonitorPresentation, defaultNowPlaying, defaultPresentation, monitorView, nowPlayingView, type DashboardLayout} from '../presentation/index.js';
import {SIMULATED_SECTION, configurePixoo, HOSTED_PROFILE, type PixooConfig} from './configuration.js';
import {OBSERVED, PixooControl, errorCompletion, type Completion, type MediaAction} from './control.js';
import type {RenderRequest} from './render-worker.js';
import {
  DEVICE_SCHEMA, FAMILIES, MAX_INLINE_BYTES, OUTCOME_SCHEMA, PIXOO_KIND, REMOVAL_SCHEMA, pixooOwnSchemas, schemaOf,
  type AssetChangeRequest, type DisplayRecord, type MonitorSetRequest, type NoticeDismissRequest, type NowPlayingSetRequest, type PlaylistChangeRequest,
  type PlaylistRecord, type RenditionRecord, type ShowRequest,
} from './schemas.js';
import {PixooStore} from './store.js';
import {SimulatedPixoo, httpPixooTransport, type OpenedDevice, type PixooTransport} from './transport.js';

export const PIXOO_MODULE = 'pixoo';
/** How often the presentation ticks: it pages Monitor, ends pop-ups and paints, as the Pixoo service's render timer did. */
export const TICK_MS = 100;
/** How long a reachability probe may take before the device counts as unavailable. */
export const REACH_MS = 2000;
/** How often an available device is probed, and the longest wait between probes of an unavailable one. */
export const PROBE_MS = 30_000;
/** The first wait before an unreachable device is probed again; each later wait doubles, up to `PROBE_MS`. */
export const FIRST_RETRY_MS = 1000;
/** How long a sync of the core's sessions or the playback record may take, and the longest wait before trying again. */
export const SYNC_MS = 5000;
export const SYNC_RETRY_MAX_MS = 60_000;
/** How long a render worker may take. */
export const RENDER_MS = 10_000;
/** How long the module waits for the core to answer a notice acknowledgment. */
export const ACKNOWLEDGE_MS = 5000;
/** The device kind's capability lists hold at most this many playlists and renditions. */
const MAX_LISTED = 256;
const MAX_DELAY_MS = 2_147_483_647;
const MEDIA_ACTIONS: readonly MediaAction[] = ['pause', 'resume', 'stop', 'next', 'previous', 'restart-with-changes', 'clear'];
const RENDER_WORKER = new URL('./render-worker.js', import.meta.url);
const NOTICE_ACKNOWLEDGE_SCHEMA = schemaOf('notice-acknowledge');
/** The consumer ID the core records the Pixoo's acknowledgments under, its source's last segment. */
const CONSUMER = 'pixoo';

/** The module's waits, in milliseconds. Tests shorten them; the runtime uses the defaults above. */
export type PixooTiming = {reachMs: number; probeMs: number; firstRetryMs: number; syncMs: number; syncRetryMaxMs: number};
const TIMING: PixooTiming = {reachMs: REACH_MS, probeMs: PROBE_MS, firstRetryMs: FIRST_RETRY_MS, syncMs: SYNC_MS, syncRetryMaxMs: SYNC_RETRY_MAX_MS};

export type PixooOptions = {
  /** How the module reaches its device: `httpPixooTransport()`, or `SimulatedPixoo` in tests and disposable runs. */
  transport: PixooTransport;
  /** Replaces the render worker's file, so a test can make every render fail. */
  renderWorker?: URL;
  /**
   * Follows the core's acknowledgments of this module's outcomes, so its outbox forgets them. The core's acknowledgment
   * belongs to Hub #782; until it exists, tests pass the module test kit's stand-in.
   */
  acknowledgments?: (sdk: Sdk, outbox: Pick<Outbox, 'acknowledge'>) => Promise<unknown>;
  /** Shorter waits for tests. */
  timing?: Partial<PixooTiming>;
};

/** Each refusal code's level, as ADR 0012's "Levels" sets it: domain refusals are INFO, refusals a correct caller never gets WARN. */
const WARNED: readonly ErrorCode[] = ['unauthenticated', 'forbidden', 'too-large', 'duplicate-conflict', 'capacity', 'unavailable', 'expired', 'uncertain-result'];
const known = <T>(value: T): {status: 'known'; value: T} => ({status: 'known', value});
const UNKNOWN = {status: 'unknown'} as const;
const requestField = (requestId: string): LogFields => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId) ? {'bunny.request.id': requestId} : {};

/** The Pixoo module. Its manifest's `configure` checks its section of the runtime's configuration file. */
export function createPixooModule(options: PixooOptions): BunnyModule<PixooConfig> {
  let running: PixooRuntime | undefined;
  return {
    manifest: {name: PIXOO_MODULE, apiVersion: '1.1', configure: section => configurePixoo(section, {simulated: options.transport.simulated})},
    async start(context) {
      // The runtime starts a module that declares `configure` only with what `configure` accepted.
      const {config} = context;
      if (config === undefined) throw new Error('the Pixoo started without its configuration');
      running = new PixooRuntime(context, config, options);
      await running.start();
    },
    async stop() {
      await running?.stop();
    },
  };
}

/**
 * The runtime's factory for the shipped list: the real HTTP transport, or a simulated Pixoo under `--simulate`. The edge
 * registers the general device families itself, so `schemas` holds the module's own. Tests and disposable runs of the
 * shipped list configure the simulated build with `simulatedSection`.
 */
export const pixooFactory = {
  name: PIXOO_MODULE,
  create: (): BunnyModule<PixooConfig> => createPixooModule({transport: httpPixooTransport()}),
  simulate: (): BunnyModule<PixooConfig> => createPixooModule({transport: new SimulatedPixoo()}),
  schemas: pixooOwnSchemas,
  simulatedSection: SIMULATED_SECTION,
};

/** A copy of another owner's records, and whether a warning about it is outstanding. */
type Copy<T> = {state: 'current' | 'stale' | 'unavailable'; revision: number | null; records: Map<string, T>; warned: boolean};
type Catalog = {renditions: Omit<RenditionRecord, 'revision'>[]; playlists: Omit<PlaylistRecord, 'revision'>[]};
type Shown = {json: string; revision: number};

/** One start of the module: everything it holds until it stops. */
class PixooRuntime {
  readonly #context: ModuleContext<PixooConfig>;
  readonly #config: PixooConfig;
  readonly #options: PixooOptions;
  readonly #timing: PixooTiming;
  readonly #device: string;
  /** The epoch of the device's generation ticket: a new one at each start. */
  readonly #epoch = randomUUID();
  readonly #validator = new MessageValidator();
  readonly #availability: DeviceAvailability;
  readonly #deviceClock: DeviceClock;
  readonly #sessions: Copy<SessionRecord> = {state: 'unavailable', revision: null, records: new Map(), warned: false};
  readonly #playback: Copy<PlaybackState> = {state: 'unavailable', revision: null, records: new Map(), warned: false};
  /** The JSON and revision of each record last served or published, by `<family>/<id>`. */
  readonly #shown = new Map<string, Shown>();
  readonly #timers = new Set<Cancel>();
  #store: PixooStore | undefined;
  #library: Library | undefined;
  #outbox: Outbox | undefined;
  #opened: OpenedDevice | undefined;
  #player: Player | undefined;
  #monitor: MonitorPresentation | undefined;
  #control: PixooControl | undefined;
  #catalog: Catalog = {renditions: [], playlists: []};
  /** The catalog's records as JSON, by `<family>/<id>`, built once per read of the catalog rather than at every change. */
  #catalogRecords = new Map<string, string>();
  /** The Now Playing view last given to the presentation, so an unchanged one is not given again. */
  #nowPlaying = '';
  #ticks = 0;
  #catalogTail: Promise<unknown> = Promise.resolve();
  #lastTransmission: DeviceRecord['lastTransmission'] = UNKNOWN;
  #publishing = false;
  #renderFailing = false;
  #stopping = false;

  constructor(context: ModuleContext<PixooConfig>, config: PixooConfig, options: PixooOptions) {
    this.#context = context;
    this.#config = config;
    this.#options = options;
    this.#timing = {...TIMING, ...options.timing};
    this.#device = config.device.id;
    this.#availability = new DeviceAvailability({log: context.log, clock: context.clock});
    registerCoreFamilies(this.#validator);
    registerDeviceFamilies(this.#validator);
    for (const [dataschema, schema] of Object.entries(pixooOwnSchemas)) this.#validator.register(dataschema, schema);
    const {clock, scheduler, signal} = context;
    // The device writer and the player run on the runtime's clock and scheduler, so their evidence times are the
    // runtime's and their timers stop with the module.
    this.#deviceClock = {
      now: () => clock.now(),
      schedule: (delayMs, callback) => {
        if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('Delay must be finite and nonnegative');
        if (signal.aborted) return () => {};
        return scheduler.after(Math.min(MAX_DELAY_MS, Math.ceil(delayMs)), callback);
      },
    };
  }

  async start(): Promise<void> {
    const {sdk, database, files, clock, log, trace} = this.#context;
    const db = database();
    const library = this.#library = await Library.attach({database: db, directory: files()});
    const store = this.#store = new PixooStore(db);
    store.prune(clock.now());
    const outbox = this.#outbox = new Outbox({sdk, database: db, clock, log, trace});
    // Follow the core's acknowledgments first, so one of a resent outcome is not missed, then send what is still stored.
    await this.#options.acknowledgments?.(sdk, outbox);
    const republished = await outbox.republish();
    log.info('outbox.republished', {'bunny.outbox.republished_count': republished});

    const {device, hostedGif} = this.#config;
    const simulated = this.#options.transport.simulated;
    // A device configuration's playback, as the Pixoo service ran it: an observed device holds a still frame 500 ms and
    // pauses on an uncertain write; the simulator holds 100 ms and does not.
    const stillDelayMs = simulated ? 100 : 500;
    this.#opened = await this.#options.transport.open({
      address: device.address, profile: device.profile, clock: this.#deviceClock, ...(hostedGif === undefined ? {} : {hostedGif}),
    });
    const player = this.#player = await Player.open({
      store: new LibraryPlaybackStore(library, {profile: device.profile, stillDelayMs}), device: this.#opened.adapter, clock: this.#deviceClock,
      pauseOnUncertain: !simulated, operationTimeoutMs: device.profile.name === HOSTED_PROFILE ? 15_000 : 5000,
    });
    const monitor = this.#monitor = new MonitorPresentation(player, {
      configuration: store.presentation() ?? this.#config.presentation ?? defaultPresentation,
      nowPlaying: store.nowPlaying() ?? this.#config.nowPlaying ?? defaultNowPlaying,
      save: value => {
        store.savePresentation(value);
        return Promise.resolve();
      },
      saveNowPlaying: value => {
        store.saveNowPlaying(value);
        return Promise.resolve();
      },
      clock: () => clock.now(),
      renderDashboard: layout => this.#render({kind: 'dashboard', layout}),
      renderCard: view => this.#render({kind: 'card', view}).then(([frame]) => frame ?? new Uint8Array(12288)),
    });
    this.#control = new PixooControl({player, monitor, library, profile: device.profile});
    this.#setCatalog(await this.#readCatalog());
    // Everything the module serves at its start carries the revision it starts at; each later change raises it.
    for (const [key, json] of this.#records()) this.#shown.set(key, {json, revision: store.revision});

    // Commands left from before this start are reported, never run again (ADR 0012, "accepted").
    await this.#reportUnfinished();
    await this.#serve();
    await this.#respond();
    player.subscribe(() => { this.#changed(); });
    monitor.onChange = () => { this.#changed(); };
    // The copies of the core's sessions and of the playback record, rebuilt by sync and never stored.
    await this.#follow(['session'], this.#sessions, 'feed', () => { this.#sessionsChanged(); });
    await this.#follow(['playback'], this.#playback, 'playback', () => { this.#playbackChanged(); });
    // Owner decision on divoom-app-upgrade#77: a device's start restores a saved Monitor selection; the simulator's stays
    // passive. Restoring pauses the player and reaches no device.
    if (!simulated) await monitor.restore();
    this.#after(0, () => this.#tick());
    this.#after(0, () => this.#probe(0));
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    for (const cancel of this.#timers) cancel();
    this.#timers.clear();
    this.#control?.close();
    try {
      await this.#monitor?.close();
      await this.#player?.close();
    } finally {
      try {
        await this.#opened?.close();
      } finally {
        await this.#library?.close();
      }
    }
  }

  /**
   * Serves the Pixoo's records through sync: the general `device` family (#918) with its own families. Today the SDK lets
   * one owner serve each family, so while another module already serves `device`, the Pixoo serves only its own
   * families, still publishes its device record live, and logs one ERROR record. Hub #967 makes sync owner-addressed,
   * keyed by source and family; then every device module serves `device`, a reader names `bunny/modules/pixoo` as the
   * owner, and this fallback never runs.
   */
  async #serve(): Promise<void> {
    const {sdk, log} = this.#context;
    const own = [FAMILIES.display, FAMILIES.rendition, FAMILIES.playlist];
    const provider = (request: Message<{families: string[]}>): Snapshot => this.#snapshot(request.data.families);
    try {
      await sdk.serveSync(['device', ...own], provider);
    } catch (error) {
      if (!(error instanceof SdkError) || error.body.error.code !== 'invalid-state' || this.#stopping) throw error;
      log.error('operation.failed', {'bunny.device.id': this.#device, 'bunny.operation': 'snapshot', 'bunny.code': 'invalid-state'});
      await sdk.serveSync(own, provider);
    }
  }

  // Timers

  /** A timer on the runtime's scheduler that the module's stop cancels. */
  #after(delayMs: number, callback: () => void | Promise<void>): void {
    if (this.#stopping) return;
    const cancel = this.#context.scheduler.after(delayMs, async () => {
      this.#timers.delete(cancel);
      if (!this.#stopping) await callback();
    });
    this.#timers.add(cancel);
  }

  /** Ticks the presentation, brings the Now Playing card's age up to date each second, and comes back. */
  #tick(): void {
    this.#ticks += 1;
    if (this.#ticks % 10 === 0) this.#playbackChanged();
    this.#monitor?.tick();
    this.#after(TICK_MS, () => { this.#tick(); });
  }

  /**
   * Probes the device on the runtime's scheduler. A probe that answers marks it available and comes back in `PROBE_MS`;
   * one that fails or times out marks it unavailable and comes back after a doubling wait. One failure is one warning:
   * later ones are summarized, and the recovery is one record.
   */
  async #probe(failures: number): Promise<void> {
    const player = this.#player;
    if (player === undefined) return;
    let reached: boolean;
    let code: ErrorCode = 'unavailable';
    const call = this.#context.trace.start('bunny.device.call', {kind: 'client', attributes: {'bunny.device.id': this.#device, 'bunny.operation': 'status'}});
    try {
      const result = await player.probe({timeoutMs: this.#timing.reachMs});
      reached = result.ok;
      if (!result.ok && (result.code === 'cancelled' || result.code === 'stale-generation')) {
        // A newer write took the device's writer: no evidence either way.
        call.end();
        this.#after(this.#timing.firstRetryMs, () => this.#probe(failures));
        return;
      }
      if (!result.ok && result.code === 'device-error') code = 'invalid-state';
    } catch {
      // The player closed as the module stops.
      call.end();
      return;
    }
    call.end(reached ? 'unset' : 'error');
    if (this.#stopping) return;
    if (reached) {
      this.#availability.reached(this.#device);
      this.#after(this.#timing.probeMs, () => this.#probe(0));
    } else {
      this.#availability.unreachable(this.#device, code);
      this.#after(Math.min(this.#timing.probeMs, this.#timing.firstRetryMs * 2 ** Math.min(failures, 16)), () => this.#probe(failures + 1));
    }
    this.#changed();
  }

  // Rendering

  /**
   * Draws a dashboard or a card in a worker thread. A failed render is no evidence about the device: the presentation
   * keeps its last picture and tries again. One record reports a run of failures, and one its end.
   */
  async #render(request: RenderRequest): Promise<Uint8Array[]> {
    const {workers, signal, log} = this.#context;
    try {
      const frames = await workers.call<Uint8Array[]>(this.#options.renderWorker ?? RENDER_WORKER, request, {timeoutMs: RENDER_MS, signal});
      if (this.#renderFailing) {
        this.#renderFailing = false;
        log.info('operation.completed', {'bunny.device.id': this.#device, 'bunny.operation': 'feed', 'bunny.outcome': 'succeeded'});
      }
      return frames;
    } catch (error) {
      if (!this.#renderFailing && !signal.aborted) {
        this.#renderFailing = true;
        log.warn('operation.failed', {'bunny.device.id': this.#device, 'bunny.operation': 'feed', 'bunny.code': error instanceof SdkError ? error.body.error.code : 'internal'});
      }
      throw error;
    }
  }

  // Copies of other owners' state

  /**
   * Keeps a copy of one owner's families. The first sync runs in start; a refusal, or a later sync the owner cannot
   * serve, leaves the copy unavailable or stale and tries again after a doubling wait. A copy that followed its owner
   * and lost it is one warning at once. An owner that has not answered since the start, as one that starts later or is
   * not shipped, is a warning only once the wait has grown to its longest; until then each attempt is DEBUG. A recovery
   * after a warning is one record.
   */
  async #follow<T extends {id: string}>(families: string[], copy: Copy<T>, operation: 'feed' | 'playback', changed: () => void, failures = 0): Promise<void> {
    if (this.#stopping) return;
    const {sdk, log} = this.#context;
    const fields = {'bunny.device.id': this.#device, 'bunny.operation': operation};
    const retry = (code: ErrorCode): void => {
      const delay = Math.min(this.#timing.syncRetryMaxMs, this.#timing.firstRetryMs * 2 ** Math.min(failures, 16));
      if (!copy.warned && (copy.state === 'stale' || delay >= this.#timing.syncRetryMaxMs)) {
        copy.warned = true;
        log.warn('operation.failed', {...fields, 'bunny.code': code, 'bunny.attempt_count': failures + 1});
      } else {
        log.debug('operation.failed', {...fields, 'bunny.code': code, 'bunny.attempt_count': failures + 1});
      }
      this.#after(delay, () => this.#follow(families, copy, operation, changed, failures + 1));
    };
    // This attempt's records replace the copy's at its first sync, so an entity the owner no longer has disappears.
    const records = new Map<string, T>();
    const handle = (change: SyncChange<T>): void => {
      switch (change.type) {
        case 'updated':
          records.set(change.entity.id, change.message.data);
          copy.revision = Math.max(copy.revision ?? 0, (change.message.data as {revision?: number}).revision ?? 0);
          break;
        case 'removed':
          records.delete(change.entity.id);
          break;
        case 'synced':
          copy.records = records;
          copy.state = 'current';
          copy.revision = Math.max(copy.revision ?? 0, change.message.data.revision);
          break;
        case 'failed':
          copy.state = 'stale';
          failures = 0;
          retry(change.error.error.code);
          break;
      }
      changed();
    };
    let result;
    try {
      result = await sdk.sync<T>(families, handle, {timeoutMs: this.#timing.syncMs});
    } catch (error) {
      // Only a module that is stopping is refused the call itself.
      if (this.#stopping) return;
      throw error;
    }
    if (result.status === 'rejected') {
      retry(result.error.error.code);
      return;
    }
    if (copy.warned) {
      copy.warned = false;
      log.info('operation.completed', {...fields, 'bunny.outcome': 'succeeded', 'bunny.attempt_count': failures});
    } else if (failures > 0) {
      log.debug('operation.completed', {...fields, 'bunny.outcome': 'succeeded', 'bunny.attempt_count': failures});
    }
    changed();
  }

  #sessionsChanged(): void {
    this.#monitor?.submit(monitorView({state: this.#sessions.state, revision: this.#sessions.revision, sessions: [...this.#sessions.records.values()]}));
  }

  /** The playback record Now Playing follows: the configured one, or else the first by ID. */
  #playbackChanged(): void {
    const records = [...this.#playback.records.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const chosen = this.#config.playback === undefined ? records[0] : this.#playback.records.get(this.#config.playback);
    const current = this.#playback.state === 'current';
    const status = {source: this.#playback.state, view: nowPlayingView(chosen, {current, nowMs: this.#context.clock.now()})};
    // A record that changed nothing the card shows, as at most ticks, is not given to the presentation again.
    const shown = JSON.stringify(status);
    if (shown === this.#nowPlaying) return;
    this.#nowPlaying = shown;
    this.#monitor?.submitPlayback(status);
  }

  // Records

  #capabilities(): Capabilities {
    return {
      power: {supported: true}, brightness: {supported: true, minimum: 0, maximum: 100}, modes: {supported: true, values: ['monitor', 'media']},
      moments: {supported: false},
      media: {
        supported: true, actions: [...MEDIA_ACTIONS], playlistIds: this.#catalog.playlists.slice(0, MAX_LISTED).map(item => item.id),
        renditionIds: this.#catalog.renditions.slice(0, MAX_LISTED).map(item => item.id),
      },
      scenes: {supported: false}, zones: {supported: false}, preview: {supported: false},
    };
  }

  #generation(): {epoch: string; sequence: number} {
    return {epoch: this.#epoch, sequence: this.#player?.getState().generation ?? 0};
  }

  /** The device record without its revision: the general `device/2.0` family (#918). */
  #deviceRecord(): Omit<DeviceRecord, 'revision'> {
    const player = this.#player, store = this.#store;
    const state = player?.getState(), evidence = player?.getDisplayEvidence();
    const mode = this.#monitor?.status().configuration.mode;
    const brightness = evidence?.brightness.observed ?? null, screen = evidence?.screen.observed ?? null;
    const times = [brightness?.atMs, screen?.atMs].filter((value): value is number => value !== undefined);
    const pending = store?.pending() ?? [];
    const outcome = store?.lastOutcome() as CompletedOutcome | undefined;
    // Keep the own paints' and commands' sends as the last transmission, never a probe, which only reads.
    const transport = evidence?.transport;
    if (transport?.ok === true && transport.source !== 'probe') {
      const last = this.#lastTransmission;
      if (last.status !== 'known' || transport.atMs > last.transmittedAtMs) {
        this.#lastTransmission = {status: 'known', transmittedAtMs: transport.atMs, operationIds: [transport.source === 'upload' ? 'media' : transport.source]};
      }
    }
    return {
      id: this.#device, kind: PIXOO_KIND, ...(this.#config.device.label === undefined ? {} : {label: this.#config.device.label}),
      availability: state?.availability === 'available' ? 'available' : state?.availability === 'offline' ? 'unavailable' : 'unknown',
      configurationRevision: store?.configurationRevision ?? 0, generation: this.#generation(), capabilities: this.#capabilities(),
      desired: {
        power: evidence === undefined ? UNKNOWN : known(evidence.requestedScreenOn),
        brightness: evidence?.requestedBrightness === null || evidence === undefined ? UNKNOWN : known(evidence.requestedBrightness),
        mode: mode === undefined ? UNKNOWN : known(mode),
      },
      observed: times.length === 0 ? UNKNOWN : {
        status: 'known', observedAtMs: Math.min(...times), power: screen === null ? UNKNOWN : known(screen.value), brightness: brightness === null ? UNKNOWN : known(brightness.value),
      },
      pending: pending.length, pendingKinds: [...new Set(pending.map(command => command.family))],
      lastOutcome: outcome === undefined ? UNKNOWN : {status: 'known', outcome},
      lastTransmission: structuredClone(this.#lastTransmission), externalControl: UNKNOWN,
    };
  }

  #displayRecord(): Omit<DisplayRecord, 'revision'> | undefined {
    const monitor = this.#monitor, player = this.#player;
    if (monitor === undefined || player === undefined) return undefined;
    const status = monitor.status(), playing = monitor.nowPlayingStatus(), state = player.getState();
    const layout: DashboardLayout | undefined = monitor.rendition().rendition?.layout;
    const item = player.getSession()?.playlist.items.find(entry => entry.id === state.itemId);
    const {filter, cadenceMs, mode} = status.configuration;
    return {
      id: this.#device, mode, participating: status.participating, pendingMode: status.pendingMode, showing: playing.showing,
      monitor: {
        filter, cadenceMs, connection: status.sourceConnection, sessions: layout?.total ?? 0, matched: layout?.matched ?? 0,
        attention: layout?.attentionTotal ?? 0, page: layout?.page ?? 0, pages: layout?.pages ?? 1,
      },
      nowPlaying: {media: playing.setting.media, card: playing.view.card, stale: playing.view.card && playing.view.stale, takeover: playing.takeover},
      player: {
        state: state.state, intent: state.intent, playlistId: state.playlistId, itemId: state.itemId, renditionId: item?.renditionId ?? null,
        lastError: state.lastError?.code ?? null,
      },
    };
  }

  /** Every record the module serves, as JSON without its revision, by `<family>/<id>`. */
  #records(): Map<string, string> {
    const records = new Map<string, string>();
    records.set(`device/${this.#device}`, JSON.stringify(this.#deviceRecord()));
    const display = this.#displayRecord();
    if (display !== undefined) records.set(`${FAMILIES.display}/${this.#device}`, JSON.stringify(display));
    for (const [key, json] of this.#catalogRecords) records.set(key, json);
    return records;
  }

  /** A state draft for one record, from its family, its JSON and its revision. */
  #state(key: string, json: string, revision: number): {key: string; draft: StateDraft} {
    const slash = key.indexOf('/'), family = key.slice(0, slash), id = key.slice(slash + 1);
    const type = family === 'device' ? 'org.bunny.device.updated' : `org.bunny.${family}.updated`;
    const dataschema = family === 'device' ? DEVICE_SCHEMA : schemaOf(family);
    return {key: `bunny.state.${family}.${id}`, draft: {type, subject: id, dataschema, data: {...JSON.parse(json) as object, id, revision}}};
  }

  /** Serves a sync of the families asked for: the current records at the module's revision. */
  #snapshot(families: readonly string[]): Snapshot {
    const store = this.#store;
    if (store === undefined) return {revision: 0, states: []};
    const states: StateDraft[] = [];
    for (const [key, shown] of this.#shown) {
      if (families.includes(key.slice(0, key.indexOf('/')))) states.push(this.#state(key, shown.json, shown.revision).draft);
    }
    return {revision: store.revision, states};
  }

  /**
   * Publishes, in one transaction, every record that changed since it was last served, at a new revision, and a removal
   * for each catalog entry that is gone. `work` runs first in the same transaction, such as a command's completion, and
   * may add its own messages after the records. Ticks and polls that change nothing publish nothing.
   */
  async #publish(work?: {before: () => void; add: (add: AddMessage) => void; parent?: Message<unknown>}): Promise<void> {
    const outbox = this.#outbox, store = this.#store;
    if (outbox === undefined || store === undefined) return;
    const changes = (): {changed: [string, string][]; removed: string[]} => {
      const records = this.#records();
      return {changed: [...records].filter(([key, json]) => this.#shown.get(key)?.json !== json), removed: [...this.#shown.keys()].filter(key => !records.has(key))};
    };
    if (work === undefined) {
      const {changed, removed} = changes();
      if (changed.length === 0 && removed.length === 0) return;
    }
    await outbox.transaction(add => {
      work?.before();
      const {changed, removed} = changes();
      const parent = work?.parent === undefined ? {} : {parent: work.parent};
      if (changed.length > 0 || removed.length > 0) {
        const revision = store.nextRevision();
        for (const [key, json] of changed) {
          const {key: routing, draft} = this.#state(key, json, revision);
          add(routing, {kind: 'state', ...draft}, parent);
          this.#shown.set(key, {json, revision});
        }
        for (const key of removed) {
          const slash = key.indexOf('/'), family = key.slice(0, slash), id = key.slice(slash + 1);
          add(`bunny.state.${family}.${id}`, {
            kind: 'removal', type: `org.bunny.${family}.removed`, subject: id, dataschema: REMOVAL_SCHEMA,
            data: {entity: {family, id}, revision, reason: 'deleted'},
          }, parent);
          this.#shown.delete(key);
        }
      }
      work?.add(add);
    });
  }

  /** A change somewhere in the player or the presentation: publishes what changed, once, after the current turn. */
  #changed(): void {
    if (this.#publishing || this.#stopping) return;
    this.#publishing = true;
    queueMicrotask(() => {
      this.#publishing = false;
      if (this.#stopping) return;
      void this.#publish().catch((error: unknown) => { this.#failedWrite(error); });
    });
  }

  /** A storage failure while the module runs: one ERROR record; the change waits for the next one. */
  #failedWrite(error: unknown): void {
    if (this.#stopping) return;
    this.#context.log.error('operation.failed', {
      'bunny.device.id': this.#device, 'bunny.operation': 'storage', 'bunny.code': 'internal', 'error.type': error instanceof Error ? error.name : 'unknown',
    });
  }

  #setCatalog(catalog: Catalog): void {
    this.#catalog = catalog;
    this.#catalogRecords = new Map([
      ...catalog.renditions.map((rendition): [string, string] => [`${FAMILIES.rendition}/${rendition.id}`, JSON.stringify(rendition)]),
      ...catalog.playlists.map((playlist): [string, string] => [`${FAMILIES.playlist}/${playlist.id}`, JSON.stringify(playlist)]),
    ]);
  }

  /** The library's catalog, as the module serves it: every rendition and playlist, with compatibility for the device's profile. */
  async #readCatalog(): Promise<Catalog> {
    const library = this.#library;
    if (library === undefined) return {renditions: [], playlists: []};
    const {profile} = this.#config.device;
    const stillDelayMs = this.#options.transport.simulated ? 100 : 500;
    const renditions: Catalog['renditions'] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await library.queryMedia({q: '', offset, limit: 100}, profile, stillDelayMs);
      for (const item of page.items) {
        renditions.push({id: item.renditionId, assetId: item.assetId, name: item.name, format: item.format, frameCount: item.frameCount, durationMs: item.durationMs, compatible: item.compatible});
      }
      if (page.items.length < 100) break;
    }
    const playlists = (await library.listPlaylists()).map(playlist => ({
      id: playlist.id, name: playlist.name, playlistRevision: playlist.revision, repeat: playlist.repeat, shuffle: playlist.shuffle,
      items: playlist.items.map(item => ({id: item.id, renditionId: item.renditionId, playback: item.playback})),
    }));
    return {renditions, playlists};
  }

  // Commands

  async #respond(): Promise<void> {
    const {sdk} = this.#context;
    const key = (family: string): string => `bunny.cmd.${family}.${this.#device}`;
    const control = (): PixooControl => {
      if (this.#control === undefined) throw new Error('the Pixoo has no control');
      return this.#control;
    };
    await sdk.respond<{playlistId: string}>(key('media-start'), command =>
      this.#admit(command, 'media-start', {family: 'media-start', data: command.data}, () => control().start(command.data.playlistId)));
    await sdk.respond<{action: MediaAction}>(key('media-control'), command =>
      this.#admit(command, 'media-control', {family: 'media-control', data: command.data}, () => control().control(command.data.action), () => {
        const {action} = command.data;
        if ((action === 'resume' || action === 'restart-with-changes') && this.#player?.getSession() === null) return errorBody('invalid-state', {detail: 'nothing is selected to resume'});
        return undefined;
      }));
    await sdk.respond<{mode: string}>(key('device-mode-set'), command =>
      this.#admit(command, 'device-mode-set', {family: 'device-mode-set', data: command.data},
        () => control().present({operation: 'mode', mode: command.data.mode === 'monitor' ? 'monitor' : 'media'})));
    await sdk.respond<{percent: number}>(key('brightness-set'), command =>
      this.#admit(command, 'brightness-set', {family: 'brightness-set', data: command.data}, () => control().brightness(command.data.percent)));
    await sdk.respond<{on: boolean}>(key('power-set'), command =>
      this.#admit(command, 'power-set', {family: 'power-set', data: command.data}, () => control().power(command.data.on)));
    await sdk.respond<ShowRequest>(key(FAMILIES.show), command =>
      this.#admit(command, FAMILIES.show, undefined, () => control().show(command.data.renditionId, command.data.playback), () =>
        this.#catalog.renditions.some(item => item.id === command.data.renditionId) ? undefined : errorBody('not-found', {detail: 'no such rendition'})));
    await sdk.respond<MonitorSetRequest>(key(FAMILIES.monitor), command =>
      this.#admit(command, FAMILIES.monitor, undefined, () => control().present({operation: 'view', filter: command.data.filter, cadenceMs: command.data.cadenceMs})));
    await sdk.respond<NowPlayingSetRequest>(key(FAMILIES.nowPlaying), command =>
      this.#admit(command, FAMILIES.nowPlaying, undefined, () => control().nowPlaying(command.data.media)));
    await sdk.respond<PlaylistChangeRequest>(key(FAMILIES.playlistChange), command =>
      this.#admit(command, FAMILIES.playlistChange, undefined, () => control().playlist(command.data.change), undefined, true));
    await sdk.respond<AssetChangeRequest>(key(FAMILIES.assetChange), command =>
      this.#admit(command, FAMILIES.assetChange, undefined, () => this.#asset(command.data.change), undefined, true));
    await sdk.respond<NoticeDismissRequest>(key(FAMILIES.dismiss), command =>
      this.#admit(command, FAMILIES.dismiss, undefined, () => this.#dismiss(command), () => {
        const session = this.#sessions.records.get(command.data.session);
        return session?.notices.some(notice => notice.id === command.data.noticeId) === true ? undefined : errorBody('not-found', {detail: 'no such notice'});
      }));
  }

  /**
   * Admits one command. It refuses, before acting, a command that breaks its schema, names a stale configuration or
   * generation, asks for what the device does not offer, or fails its own check. A repeated request is accepted again
   * and changes nothing. Otherwise it stores its own record of the work and the device's new pending count in one
   * transaction, replies accepted, and runs the work; its outcome follows through the outbox.
   */
  #admit(
    command: Command<object>, family: string, general: DeviceCommand | undefined, work: () => Promise<Completion>,
    check?: () => ErrorBody | undefined, catalog = false,
  ): Reply {
    const {log, clock} = this.#context;
    const {requestId} = command.data;
    const fields: LogFields = {'bunny.device.id': this.#device, ...requestField(requestId)};
    const refuse = (body: ErrorBody): ErrorBody => {
      const level = body.error.code === 'internal' ? 'error' : WARNED.includes(body.error.code) ? 'warn' : 'info';
      log[level]('command.rejected', {...fields, 'bunny.outcome': 'rejected', 'bunny.code': body.error.code}, command);
      return body;
    };
    const store = this.#store;
    if (store === undefined || this.#stopping) return refuse(errorBody('unavailable', {detail: 'the Pixoo is stopping'}));
    const checked = this.#validator.validate(command, {nowMs: clock.now()});
    if (!checked.ok) return refuse(errorBody(checked.error.code, {detail: 'the command does not follow its schema'}));
    if (store.known(command.source, requestId)) {
      log.info('command.completed', {...fields, 'bunny.outcome': 'duplicate'}, command);
      return {status: 'accepted'};
    }
    const guards = command.data as {expectedConfigurationRevision?: number; expectedGeneration?: {epoch: string; sequence: number}};
    if (guards.expectedConfigurationRevision !== undefined && guards.expectedConfigurationRevision !== store.configurationRevision) {
      return refuse(errorBody('revision-conflict', {detail: 'the configuration revision has moved on'}));
    }
    const generation = this.#generation();
    if (guards.expectedGeneration !== undefined && (guards.expectedGeneration.epoch !== generation.epoch || guards.expectedGeneration.sequence !== generation.sequence)) {
      return refuse(errorBody('revision-conflict', {detail: 'the device generation has moved on'}));
    }
    if (general !== undefined && !commandSupported(this.#capabilities(), general)) return refuse(errorBody('unsupported-capability', {detail: 'the Pixoo does not offer that'}));
    const refusal = check?.();
    if (refusal !== undefined) return refuse(refusal);
    log.info('command.executing', fields, command);
    try {
      // The record of the work commits before the reply, with the device's new pending count.
      store.accept({source: command.source, requestId, family, type: command.type, traceparent: command.traceparent, acceptedAtMs: clock.now()});
    } catch {
      return refuse(errorBody('capacity', {detail: 'the Pixoo could not store the command'}));
    }
    this.#changed();
    void this.#run(command, family, work, catalog);
    return {status: 'accepted'};
  }

  /** Runs an accepted command's work and reports its outcome. A failure to store the outcome leaves it for the next start. */
  async #run(command: Command<object>, family: string, work: () => Promise<Completion>, catalog: boolean): Promise<void> {
    const call = this.#context.trace.start('bunny.device.call', {
      parent: command, kind: 'client', attributes: {'bunny.device.id': this.#device, ...requestField(command.data.requestId)},
    });
    let completion: Completion;
    try {
      completion = await work();
    } catch (error) {
      completion = errorCompletion(error);
    }
    call.end(completion.result === 'succeeded' ? 'unset' : 'error');
    if (this.#stopping) return;
    try {
      if (catalog) await this.#refreshCatalog();
      await this.#complete(command, family, completion);
    } catch (error) {
      this.#failedWrite(error);
    }
  }

  /** Reads the catalog again after a library change, one refresh at a time. */
  async #refreshCatalog(): Promise<void> {
    const next = this.#catalogTail.then(async () => { this.#setCatalog(await this.#readCatalog()); });
    this.#catalogTail = next.catch(() => undefined);
    await next;
  }

  /** Stores a command's outcome with every changed record, publishes them, and logs the completion. */
  async #complete(command: {source: string; type: string; subject?: string; traceparent: string; data: {requestId: string}}, family: string, completion: Completion): Promise<void> {
    const store = this.#store;
    if (store === undefined) return;
    const {requestId} = command.data;
    const {clock, log} = this.#context;
    const outcome = {requestId, result: completion.result, evidence: completion.evidence, ...(completion.error === undefined ? {} : {error: completion.error})};
    if (completion.transmission !== undefined) {
      this.#lastTransmission = {status: 'known', requestId, ...completion.transmission};
    }
    // The outcome commits with the device's new pending count, last outcome and last transmission, and any catalog change.
    await this.#publish({
      parent: command as Message<unknown>,
      before: () => {
        store.complete(command.source, requestId, clock.now());
        store.saveLastOutcome(outcome);
      },
      add: add => {
        add(`bunny.event.${family}.${this.#device}`, {
          kind: 'outcome', type: command.type.replace(/\.requested$/, '.completed'), subject: this.#device, dataschema: OUTCOME_SCHEMA, data: outcome,
        }, {parent: command});
      },
    });
    log.info('command.completed', {
      'bunny.device.id': this.#device, ...requestField(requestId), 'bunny.outcome': completion.result,
      ...(completion.error === undefined ? {} : {'bunny.code': completion.error.code}),
    }, command);
  }

  /** Reports each command accepted before this start and never completed: uncertain, since its work may have begun. */
  async #reportUnfinished(): Promise<void> {
    const store = this.#store;
    if (store === undefined) return;
    for (const command of store.pending()) {
      const error: ErrorDetail = errorBody('uncertain-result', {detail: 'the Pixoo restarted before it reported this command'}).error;
      await this.#complete({...command, data: {requestId: command.requestId}}, command.family, {result: 'uncertain', evidence: 'none', error});
    }
  }

  /** One media change. An import's content comes inline, or as a file staged in the module's private folder. */
  async #asset(change: AssetChangeRequest['change']): Promise<Completion> {
    const control = this.#control;
    if (control === undefined) return errorCompletion(new Error('no control'));
    const {signal, files} = this.#context;
    switch (change.operation) {
      case 'import': {
        const bytes = await this.#content(change.content, files());
        if (!(bytes instanceof Uint8Array)) return bytes;
        return control.asset({operation: 'import', name: change.name, bytes}, signal);
      }
      case 'render': return control.asset(change.transform === undefined ? {operation: 'render', assetId: change.assetId} : {operation: 'render', assetId: change.assetId, transform: change.transform}, signal);
      case 'delete': return control.asset({operation: 'delete', assetId: change.assetId}, signal);
    }
  }

  /**
   * An import's bytes. Inline content is base64 of at most `MAX_INLINE_BYTES`. Staged content is a file in the module's
   * `incoming` folder named by its SHA-256, which the uploader put there; its size and hash must match.
   */
  async #content(content: {inline: string} | {staged: {file: string; bytes: number}}, folder: string): Promise<Uint8Array | Completion> {
    const refused = (code: ErrorCode, detail: string): Completion => ({result: 'failed', evidence: 'none', error: errorBody(code, {detail}).error});
    if ('inline' in content) {
      const bytes = Buffer.from(content.inline, 'base64');
      return bytes.length > MAX_INLINE_BYTES ? refused('too-large', 'inline media is limited to 160 KiB') : bytes;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(join(folder, 'incoming', content.staged.file));
    } catch {
      return refused('not-found', 'no such staged file');
    }
    if (bytes.length !== content.staged.bytes || createHash('sha256').update(bytes).digest('hex') !== content.staged.file) {
      return refused('invalid-request', 'the staged file does not match its size and hash');
    }
    return bytes;
  }

  /**
   * Dismisses a finished turn on the Pixoo only: the module acknowledges the notice for its own consumer ID, `pixoo`,
   * and the core records it for this consumer alone (#918). The core commits before it replies, and the session's state
   * at its new revision is the evidence.
   */
  async #dismiss(command: Command<NoticeDismissRequest>): Promise<Completion> {
    const {session, noticeId} = command.data;
    const result = await this.#context.sdk.request(`bunny.cmd.notice-acknowledge.${session}`, {
      type: 'org.bunny.notice.acknowledge.requested', subject: session, dataschema: NOTICE_ACKNOWLEDGE_SCHEMA, data: {consumerId: CONSUMER, noticeId},
    }, {timeoutMs: ACKNOWLEDGE_MS, parent: command});
    switch (result.status) {
      case 'accepted': return OBSERVED;
      case 'rejected': return {result: 'failed', evidence: 'none', error: errorBody(result.error.error.code, {detail: 'the core refused the acknowledgment'}).error};
      case 'uncertain': return {result: 'uncertain', evidence: 'none', error: errorBody('uncertain-result', {detail: 'the core did not answer the acknowledgment'}).error};
    }
  }
}
