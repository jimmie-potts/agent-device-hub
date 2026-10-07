// The Tidbyt module (Hub #930, ADR 0012). It replaces the Tidbyt runner inside the old local controller host at the
// cutover (#840): it shows automatic agent status, from its synced copy of the core's sessions, and what plays, from its
// synced copy of the playback module's `playback` record, as two background installations in the Tidbyt's rotation.
// It is the one writer for the cloud device, behind its lease and its queue. Each tile pushes only when what it shows
// changes, at most once every 15 seconds, and pushes an unchanged frame again after 10 minutes. Frames render in a worker
// thread. The module publishes the Tidbyt's `device/2.0` record, with every control unsupported, and refuses every
// general command with `unsupported-capability`, as the old controller did.
//
// Under policy A (ADR 0012, "Failure isolation"), start opens only local resources: the database, the private folder
// with the lease, the API key's secret file and the bus. The module reaches the cloud afterwards, and the cloud's
// errors and timeouts become device state and records, never a module failure. Nothing it sends is a command, so it
// has no outcome to report: a write that failed is not sent again, and a later write is a fresh one for the current
// state.
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SCHEMA_BASE, errorBody, type ErrorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import type {Capabilities, DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {PlaybackState, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {
  DeviceAvailability, Outbox, SdkError, errorType, type BunnyModule, type Cancel, type LogFields, type ModuleContext, type StateDraft, type SyncChange,
  type SyncedCopy, type TraceContext,
} from '@jimmie-potts/sdk';
import {TidbytCloudConnection, type CloudFetch, type ListResult, type WriteResult} from './cloud.js';
import {API_KEY_SECRET, configureTidbyt, type TidbytConfig} from './configuration.js';
import {acquireLease, type Lease, type LeaseRefusal} from './lease.js';
import {PLAYBACK_LOST_MS, nowPlayingView} from './nowplaying.js';
import {SIMULATED_API_KEY, SIMULATED_DEVICE, SimulatedCloud} from './simulated.js';
import {statusView} from './status.js';
import type {TileRequest, TileReply} from './tiles.js';
import {CloudQueue, TileWriter, type NotSent, type TileCall, type TileMemory, type TileTarget} from './writer.js';

export const TIDBYT_MODULE = 'tidbyt';
export const DEVICE_SCHEMA = `${SCHEMA_BASE}device/2.0`;
/** The least time between two writes of one tile. */
export const MIN_INTERVAL_MS = 15_000;
/** An unchanged frame is pushed again after this long. */
export const REFRESH_MS = 600_000;
/** How often each tile looks at its copy when nothing changed, as the runner read its feeds. */
export const STATUS_POLL_MS = 30_000;
export const NOW_PLAYING_POLL_MS = 5000;
/** How long one cloud call may take before the module stops waiting for its answer. */
export const CALL_TIMEOUT_MS = 10_000;
/** How long one render may take in its worker thread. */
export const RENDER_TIMEOUT_MS = 5000;
/**
 * How long after its start each tile waits for what it shows to be known: for its copy's first sync, and, for the card,
 * for the playback module's first read, which follows the `unavailable` record that module publishes at each start.
 */
export const START_WINDOW_MS = PLAYBACK_LOST_MS;
/** How long one sync of a copy may take, and the waits before the module syncs again after a failure. */
export const SYNC_TIMEOUT_MS = 5000;
export const RESYNC_FIRST_MS = 1000;
export const RESYNC_MAX_MS = 60_000;
/** The general device commands (#918), each refused: the Tidbyt offers none of them. */
export const COMMAND_FAMILIES = [
  'power-set', 'brightness-set', 'scene-activate', 'zone-power-set', 'media-start', 'media-control', 'device-mode-set', 'moment-play',
] as const;
const RENDER_WORKER = new URL('./render-worker.js', import.meta.url);
const CORE = 'bunny/core';
const PLAYBACK = 'bunny/modules/playback';

const UNSUPPORTED = {supported: false} as const;
const UNKNOWN = {status: 'unknown'} as const;
/** Every capability unsupported, as the old controller declared every controller v1 capability. */
export const NO_CONTROLS: Capabilities = {
  power: UNSUPPORTED, brightness: UNSUPPORTED, modes: UNSUPPORTED, moments: UNSUPPORTED, media: UNSUPPORTED, scenes: UNSUPPORTED, zones: UNSUPPORTED,
  preview: UNSUPPORTED,
};
/** How a refused lease shows in the start's record. */
const LEASE_REASONS: Readonly<Record<LeaseRefusal, 'busy' | 'unauthorized' | 'unavailable'>> = {busy: 'busy', 'not-private': 'unauthorized', failed: 'unavailable'};
/** SQLite's result code for a full disk, from a node:sqlite error's `errcode`. */
const SQLITE_FULL = 13;
const SQLITE_BUSY = 5, SQLITE_LOCKED = 6;
/** A database refusal's registry code: `capacity` for a full disk, `unavailable` for a database another writer holds. */
function storageCode(error: unknown): ErrorCode {
  if (error instanceof SdkError) return error.body.error.code;
  const code = typeof error === 'object' && error !== null && 'errcode' in error ? error.errcode : undefined;
  return code === SQLITE_FULL ? 'capacity' : code === SQLITE_BUSY || code === SQLITE_LOCKED ? 'unavailable' : 'internal';
}

export type TidbytTiming = {minIntervalMs: number; refreshMs: number; statusPollMs: number; nowPlayingPollMs: number};
export type TidbytModuleOptions = {
  /** How the module reaches the cloud: `fetch` for the real one, a `SimulatedCloud`'s in tests and disposable runs. */
  transport: CloudFetch;
  /** How long one cloud call may take. Defaults to `CALL_TIMEOUT_MS`. */
  callTimeoutMs?: number;
  /** The render worker's file. A test passes one that never answers, or one that fails. */
  renderWorker?: URL;
  /** How long one render may take. Defaults to `RENDER_TIMEOUT_MS`. */
  renderTimeoutMs?: number;
  /** The gate, the refresh and the polls. Defaults to the runner's: 15 s, 10 minutes, 30 s and 5 s. */
  timing?: Partial<TidbytTiming>;
};

/** The routing key of the Tidbyt's device record. */
export const deviceKey = (id: string): string => `bunny.state.device.${id}`;

/** Creates the Tidbyt module with `transport`; its device, cloud device and installations come from its section (#919). */
export function createTidbytModule(options: TidbytModuleOptions): BunnyModule<TidbytConfig> {
  let run: TidbytRun | undefined;
  return {
    manifest: {name: TIDBYT_MODULE, apiVersion: '1.1', configure: configureTidbyt},
    async start(context) {
      // The runtime starts a module with `configure` only with what `configure` accepted.
      if (context.config === undefined) throw new Error('the Tidbyt module started without its configuration');
      run = new TidbytRun(context, context.config, options);
      await run.open();
    },
    async stop() {
      await run?.stop();
    },
  };
}

/** A copy of another owner's family, the module's view of it, and its recovery. */
type Copy = {
  /** The current copy, or the last one, which keeps its last records after it stopped following. */
  copy: SyncedCopy<object> | undefined;
  /** Whether the copy follows its owner now. */
  following: boolean;
  /** Whether the copy ever synced. */
  everSynced: boolean;
  /** Since when the copy has not followed its owner: the module's start before its first sync. */
  lostSinceMs: number;
  /** Whether a run of failed syncs has been logged. */
  down: boolean;
  resync: Cancel | undefined;
  resyncDelayMs: number;
};

type TileName = 'status' | 'now-playing';
/** One tile: its writer, its evaluation loop and what it last decided to show. */
type Tile = {
  readonly name: TileName;
  /** The diagnostic contract's `bunny.operation` for the tile's records and spans. */
  readonly operation: 'status' | 'playback';
  readonly installation: string;
  readonly writer: TileWriter;
  readonly poll: number;
  /** The message that asked for the next evaluation, which its records and spans continue. */
  trigger: TraceContext | undefined;
  requested: boolean;
  running: Promise<void> | undefined;
  timer: Cancel | undefined;
  /** The code logged for the current run of failed writes, or undefined outside one. */
  failing: ErrorCode | undefined;
  /** Whether a run of the module's own faults in this tile's evaluation has been logged. */
  faulting: boolean;
};

/** One start of the module, from `start` to `stop`. */
class TidbytRun {
  readonly #context: ModuleContext<TidbytConfig>;
  readonly #config: TidbytConfig;
  readonly #options: TidbytModuleOptions;
  readonly #timing: TidbytTiming;
  readonly #availability: DeviceAvailability;
  /** Work the module started on its own, which its stop waits for. */
  readonly #work = new Set<Promise<void>>();
  readonly #tiles: Tile[] = [];
  readonly #sessions: Copy;
  readonly #playback: Copy;
  /** The device's generation epoch for this start. The Tidbyt answers no command, so its generation never moves. */
  readonly #epoch = randomUUID();
  #queue: CloudQueue | undefined;
  #lease: Lease | undefined;
  /** The device record as last committed, which sync serves; undefined until the first commit. */
  #committed: DeviceRecord | undefined;
  /** What the record should say now, which the next commit stores. */
  #wanted: {availability: DeviceRecord['availability']; lastTransmission: DeviceRecord['lastTransmission']} = {availability: 'unknown', lastTransmission: UNKNOWN};
  /** The revision the next commit takes: one above the last committed, kept when a commit fails. */
  #nextRevision = 1;
  /** Commits run one after another, so revisions rise. */
  #committing: Promise<void> = Promise.resolve();
  /** Whether the last commit of the device record failed, so the next evaluation publishes it. */
  #dirty = false;
  /** When this start began, on the runtime's clock: the start of each tile's start window. */
  #startedAtMs: number;
  /** Whether a run of faults that escaped the module's own work has been logged. */
  #escaped = false;
  #closing = false;
  #storageDown: ErrorCode | undefined;
  #saveTile: ((installation: string, memory: TileMemory) => void) | undefined;

  constructor(context: ModuleContext<TidbytConfig>, config: TidbytConfig, options: TidbytModuleOptions) {
    this.#context = context;
    this.#config = config;
    this.#options = options;
    this.#timing = {
      minIntervalMs: MIN_INTERVAL_MS, refreshMs: REFRESH_MS, statusPollMs: STATUS_POLL_MS, nowPlayingPollMs: NOW_PLAYING_POLL_MS, ...options.timing,
    };
    this.#availability = new DeviceAvailability({log: context.log, clock: context.clock});
    const now = context.clock.now();
    const copy = (): Copy => ({
      copy: undefined, following: false, everSynced: false, lostSinceMs: now, down: false, resync: undefined, resyncDelayMs: RESYNC_FIRST_MS,
    });
    this.#sessions = copy();
    this.#playback = copy();
    this.#startedAtMs = now;
  }

  async open(): Promise<void> {
    const {sdk, log, clock, trace, database, files, secrets, signal} = this.#context;
    const {id} = this.#config;
    const db = database();
    db.exec(`CREATE TABLE IF NOT EXISTS tidbyt_records (id TEXT PRIMARY KEY, revision INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS tidbyt_tiles (
        installation TEXT PRIMARY KEY, frame_key TEXT, sent_at_ms INTEGER, last_write_at_ms INTEGER, presence TEXT NOT NULL) STRICT`);
    const outbox = new Outbox({sdk, database: db, clock, log, trace});
    const saveRevision = db.prepare('INSERT INTO tidbyt_records (id, revision) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET revision = excluded.revision');
    this.#publishRecord = (record, parent): Promise<boolean> => outbox.transaction(add => {
      saveRevision.run(id, record.revision);
      add(deviceKey(id), {kind: 'state', ...deviceState(record)}, parent === undefined ? undefined : {parent});
    }).then(() => true);
    const saveTile = db.prepare(`INSERT INTO tidbyt_tiles (installation, frame_key, sent_at_ms, last_write_at_ms, presence) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (installation) DO UPDATE SET frame_key = excluded.frame_key, sent_at_ms = excluded.sent_at_ms,
      last_write_at_ms = excluded.last_write_at_ms, presence = excluded.presence`);
    this.#saveTile = (installation, memory): void => {
      saveTile.run(installation, memory.key ?? null, memory.sentAtMs ?? null, memory.lastWriteAtMs ?? null, memory.presence);
    };
    signal.addEventListener('abort', () => { this.#close(); }, {once: true});

    log.info('outbox.republished', {'bunny.outbox.republished_count': await outbox.republish()});
    // The record as last committed. Each start publishes a new revision: unknown until the cloud answers.
    const stored = db.prepare('SELECT revision FROM tidbyt_records WHERE id = ?').get(id) as {revision: number} | undefined;
    const taken = acquireLease(join(files(), 'leases'), this.#config.cloudDeviceId);
    if (taken.status === 'held') this.#lease = taken.lease;
    else log.warn('operation.failed', {...this.#deviceField(), 'bunny.operation': 'startup', 'bunny.reason': LEASE_REASONS[taken.reason]});
    // The API key is read once, at start; a key replaced on disk takes effect at the next start.
    const key = await secrets.read(API_KEY_SECRET);
    this.#nextRevision = (stored?.revision ?? 0) + 1;
    await this.#change(this.#lease === undefined ? 'unavailable' : 'unknown', UNKNOWN, undefined);

    // Sync serves only what committed, so no reader holds a revision the database never stored.
    await sdk.serveSync(['device'], () => {
      if (this.#closing) return errorBody('unavailable', {detail: 'the Tidbyt module is stopping'});
      const committed = this.#committed;
      if (committed === undefined) return errorBody('unavailable', {detail: 'the Tidbyt module has not stored its device record yet'});
      return {revision: committed.revision, states: [deviceState(committed)]};
    });
    for (const family of COMMAND_FAMILIES) {
      await sdk.respond(`bunny.cmd.${family}.${id}`, (command): ErrorBody => command.subject === id ?
        errorBody('unsupported-capability', {detail: 'the Tidbyt offers no controls: it shows agent status and what plays'}) :
        errorBody('invalid-request', {detail: 'the command\'s subject is not the Tidbyt its key names'}));
    }
    // Without the lease another writer may hold the cloud device, so the module writes nothing (one writer per device).
    if (this.#lease === undefined) return;

    const {cloudDeviceId, statusInstallation, nowPlaying} = this.#config;
    const connection = new TidbytCloudConnection({
      deviceId: cloudDeviceId, apiKey: key, installationId: statusInstallation,
      additionalInstallationIds: nowPlaying === undefined ? [] : [nowPlaying.installation], fetch: this.#options.transport,
    });
    this.#queue = new CloudQueue({connection, scheduler: this.#context.scheduler, now: () => clock.now(), timeoutMs: this.#options.callTimeoutMs ?? CALL_TIMEOUT_MS});
    const remembered = new Map((db.prepare('SELECT installation, frame_key, sent_at_ms, last_write_at_ms, presence FROM tidbyt_tiles').all() as {
      installation: string; frame_key: string | null; sent_at_ms: number | null; last_write_at_ms: number | null; presence: string;
    }[]).map(row => [row.installation, {
      ...(row.frame_key === null ? {} : {key: row.frame_key}), ...(row.sent_at_ms === null ? {} : {sentAtMs: row.sent_at_ms}),
      ...(row.last_write_at_ms === null ? {} : {lastWriteAtMs: row.last_write_at_ms}),
      presence: row.presence === 'present' || row.presence === 'absent' ? row.presence : 'unknown',
    } satisfies TileMemory]));
    this.#tiles.push(this.#tile('status', statusInstallation, undefined, this.#timing.statusPollMs, remembered.get(statusInstallation)));
    if (nowPlaying !== undefined) {
      this.#tiles.push(this.#tile('now-playing', nowPlaying.installation, nowPlaying.installation, this.#timing.nowPlayingPollMs, remembered.get(nowPlaying.installation)));
    }
    // Both copies sync at once; each tile writes nothing until its copy first syncs, for at most the start window.
    await Promise.all([this.#follow('session'), ...(nowPlaying === undefined ? [] : [this.#follow('playback')])]);
    for (const tile of this.#tiles) this.#update(tile, undefined);
  }

  async stop(): Promise<void> {
    this.#close();
    while (this.#work.size > 0) await Promise.allSettled([...this.#work]);
    this.#lease?.release();
    this.#lease = undefined;
  }

  /** Stops writing: the queue ends the call in flight and sends nothing more, and no tile evaluates again. */
  #close(): void {
    if (this.#closing) return;
    this.#closing = true;
    this.#queue?.close();
    for (const copy of [this.#sessions, this.#playback]) this.#cancel(copy.resync);
    for (const tile of this.#tiles) this.#cancel(tile.timer);
  }

  #cancel(cancel: Cancel | undefined): void {
    try {
      cancel?.();
    } catch {
      // A timer the runtime already cancelled.
    }
  }

  // The device record

  #deviceField(): LogFields {
    return {'bunny.device.id': this.#config.id};
  }

  #deviceRecord(revision: number, availability: DeviceRecord['availability'], lastTransmission: DeviceRecord['lastTransmission']): DeviceRecord {
    return {
      id: this.#config.id, revision, kind: 'tidbyt', availability, configurationRevision: 0, generation: {epoch: this.#epoch, sequence: 0},
      capabilities: NO_CONTROLS, desired: {power: UNKNOWN, brightness: UNKNOWN, mode: UNKNOWN}, observed: UNKNOWN, pending: 0, pendingKinds: [],
      lastOutcome: UNKNOWN, lastTransmission, externalControl: UNKNOWN,
    };
  }

  #publishRecord: (record: DeviceRecord, parent: TraceContext | undefined) => Promise<boolean> = () => Promise.resolve(false);

  /**
   * Sets what the record should say, and commits and publishes a new revision when that differs from the record last
   * committed. A refusal never escapes: the record stays as committed, and the next evaluation tries again.
   */
  #change(availability: DeviceRecord['availability'], lastTransmission: DeviceRecord['lastTransmission'], parent: TraceContext | undefined): Promise<void> {
    this.#wanted = {availability, lastTransmission};
    return this.#commitWanted(parent);
  }

  #commitWanted(parent: TraceContext | undefined): Promise<void> {
    const next = this.#committing.then(async () => {
      if (this.#context.signal.aborted) return;
      const {availability, lastTransmission} = this.#wanted;
      const committed = this.#committed;
      if (committed !== undefined && availability === committed.availability && JSON.stringify(lastTransmission) === JSON.stringify(committed.lastTransmission)) {
        this.#dirty = false;
        return;
      }
      const record = this.#deviceRecord(this.#nextRevision, availability, lastTransmission);
      try {
        await this.#publishRecord(record, parent);
      } catch (error) {
        if (this.#context.signal.aborted) return;
        this.#dirty = true;
        this.#storageFailed(storageCode(error));
        return;
      }
      this.#committed = record;
      this.#nextRevision = record.revision + 1;
      this.#dirty = false;
      this.#storageWorked();
    });
    this.#committing = next.catch(() => undefined);
    return next;
  }

  /** One record per run of database refusals, not one per attempt. */
  #storageFailed(code: ErrorCode): void {
    if (this.#storageDown !== undefined) return;
    this.#storageDown = code;
    this.#context.log[code === 'internal' ? 'error' : 'warn']('operation.failed', {'bunny.operation': 'storage', 'bunny.code': code});
  }

  #storageWorked(): void {
    if (this.#storageDown === undefined) return;
    this.#storageDown = undefined;
    this.#context.log.info('operation.completed', {'bunny.operation': 'storage', 'bunny.outcome': 'succeeded'});
  }

  #remember(installation: string, memory: TileMemory): void {
    if (this.#context.signal.aborted) return;
    try {
      this.#saveTile?.(installation, memory);
      this.#storageWorked();
    } catch (error) {
      // What the tile sent stays in memory; a restart without it writes the current frame once more.
      this.#storageFailed(storageCode(error));
    }
  }

  // Copies of the sessions and the playback record

  async #follow(family: 'session' | 'playback'): Promise<void> {
    if (this.#closing) return;
    const copy = family === 'session' ? this.#sessions : this.#playback;
    copy.resync = undefined;
    let result;
    try {
      result = await this.#context.sdk.sync<object>([family], change => { this.#changed(family, change); }, {timeoutMs: SYNC_TIMEOUT_MS});
    } catch {
      // The module is stopping, and its participant refuses use.
      return;
    }
    if (this.#closing) return;
    if (result.status === 'rejected') {
      this.#lost(family, result.error.error.code);
      this.#updateFor(family, undefined);
      return;
    }
    const previous = copy.copy;
    copy.copy = result.copy;
    if (previous !== undefined && previous !== copy.copy) this.#track(previous.close());
    copy.following = true;
    copy.everSynced = true;
    copy.resyncDelayMs = RESYNC_FIRST_MS;
    if (copy.down) {
      copy.down = false;
      this.#context.log.info('operation.completed', {'bunny.operation': 'feed', 'bunny.participant': family === 'session' ? CORE : PLAYBACK, 'bunny.outcome': 'succeeded'});
    }
    this.#updateFor(family, result.message);
  }

  #changed(family: 'session' | 'playback', change: SyncChange<object>): void {
    const copy = family === 'session' ? this.#sessions : this.#playback;
    switch (change.type) {
      case 'updated':
      case 'synced':
        if (copy.following) this.#updateFor(family, change.message);
        return;
      case 'removed':
        if (copy.following) this.#updateFor(family, change.message);
        return;
      case 'failed':
        // The copy stopped following its owner and keeps its last records: the tile shows them as uncertain.
        this.#lost(family, change.error.error.code);
        this.#updateFor(family, undefined);
        return;
    }
  }

  #lost(family: 'session' | 'playback', code: ErrorCode): void {
    const copy = family === 'session' ? this.#sessions : this.#playback;
    if (copy.following) copy.lostSinceMs = this.#context.clock.now();
    copy.following = false;
    if (!copy.down) {
      copy.down = true;
      this.#context.log.warn('operation.failed', {'bunny.operation': 'feed', 'bunny.participant': family === 'session' ? CORE : PLAYBACK, 'bunny.code': code});
    }
    if (this.#closing || copy.resync !== undefined) return;
    const delayMs = copy.resyncDelayMs;
    copy.resyncDelayMs = Math.min(RESYNC_MAX_MS, delayMs * 2);
    try {
      copy.resync = this.#context.scheduler.after(delayMs, () => { this.#track(this.#follow(family)); });
    } catch {
      // The module is stopping.
    }
  }

  #updateFor(family: 'session' | 'playback', parent: TraceContext | undefined): void {
    const name: TileName = family === 'session' ? 'status' : 'now-playing';
    const tile = this.#tiles.find(entry => entry.name === name);
    if (tile !== undefined) this.#update(tile, parent);
  }

  // Tiles

  #tile(name: TileName, installation: string, target: string | undefined, poll: number, restored: TileMemory | undefined): Tile {
    const queue = this.#queue;
    if (queue === undefined) throw new Error('the Tidbyt queue is not open');
    const {clock, signal} = this.#context;
    const tile: Tile = {
      name, operation: name === 'status' ? 'status' : 'playback', installation, poll, trigger: undefined, requested: false, running: undefined, timer: undefined,
      failing: undefined, faulting: false,
      writer: new TileWriter({
        queue, installation: target, minIntervalMs: this.#timing.minIntervalMs, refreshMs: this.#timing.refreshMs, pollMs: poll, now: () => clock.now(),
        stopped: () => this.#closing || signal.aborted, render: request => this.#render(request), report: call => { this.#report(tile, call); },
        begin: call => this.#begin(tile, call),
        remember: memory => { this.#remember(installation, memory); }, ...(restored === undefined ? {} : {restored}),
      }),
    };
    return tile;
  }

  /** What the tile should show now, from its copy. */
  #target(tile: Tile): TileTarget {
    const now = this.#context.clock.now();
    // Times in the future, after the wall clock was set back, count as now.
    if (this.#startedAtMs > now) this.#startedAtMs = now;
    for (const copy of [this.#sessions, this.#playback]) if (copy.lostSinceMs > now) copy.lostSinceMs = now;
    // A start or a restart writes nothing before what the tile shows is known: until its copy first syncs, for at most
    // `START_WINDOW_MS`, so an owner that serves a moment after this module starts never makes it replace or remove a tile.
    const starting = now - this.#startedAtMs < START_WINDOW_MS;
    if (tile.name === 'status') {
      const copy = this.#sessions;
      if (!copy.everSynced && starting) return {kind: 'hold'};
      const view = statusView({synced: copy.following, sessions: (copy.copy?.states() ?? []).map(message => message.data as SessionRecord)});
      return view.idle ? {kind: 'remove'} : {kind: 'show', key: JSON.stringify(view), request: {tile: 'status', view}};
    }
    const copy = this.#playback;
    const lostForMs = copy.following ? 0 : Math.max(0, now - copy.lostSinceMs);
    if (!copy.everSynced && starting) return {kind: 'hold'};
    const wanted = this.#config.nowPlaying?.playback;
    const record = (copy.copy?.states() ?? []).map(message => message.data as PlaybackState).find(entry => entry.id === wanted);
    // The playback module publishes `unavailable`, with unknown playback, from each start until every speaker's first read
    // settles: the card waits for those reads, for at most the start window, and is never removed for want of them. Any
    // other record is followed, inside the window too.
    if (starting && (record === undefined || record.availability === 'unavailable')) return {kind: 'hold'};
    const view = nowPlayingView({record, following: copy.following, lostForMs});
    return view.card ? {kind: 'show', key: JSON.stringify(view), request: {tile: 'now-playing', view}} : {kind: 'remove'};
  }

  /** Asks for an evaluation of the tile. Requests made while one runs coalesce into one more. */
  #update(tile: Tile, parent: TraceContext | undefined): void {
    if (this.#closing) return;
    if (parent !== undefined) tile.trigger = parent;
    tile.requested = true;
    if (tile.running !== undefined) return;
    const running = this.#loop(tile).finally(() => {
      tile.running = undefined;
      // A request can arrive after the loop's last check but before this cleanup runs.
      if (tile.requested && !this.#closing) this.#update(tile, undefined);
    });
    tile.running = running;
    this.#track(running);
  }

  async #loop(tile: Tile): Promise<void> {
    while (tile.requested && !this.#closing) {
      tile.requested = false;
      let wakeMs = tile.poll;
      try {
        if (this.#dirty) await this.#commitWanted(undefined);
        wakeMs = await tile.writer.write(this.#target(tile));
        this.#healthy(tile);
      } catch (error) {
        // A fault of the module's own, never the cloud's: logged once per run, by type, and the tile tries again at its
        // next poll (ADR 0012, "Repetition").
        if (!tile.faulting) {
          tile.faulting = true;
          this.#context.log.error('operation.failed', {...this.#deviceField(), 'bunny.operation': tile.operation, 'bunny.code': 'internal', 'error.type': errorType(error)});
        }
      }
      if (this.#closing) return;
      this.#cancel(tile.timer);
      try {
        tile.timer = this.#context.scheduler.after(Math.max(1, Math.ceil(wakeMs)), () => {
          tile.timer = undefined;
          this.#update(tile, undefined);
        });
      } catch {
        // The module is stopping, and its timers refuse use.
        return;
      }
    }
  }

  /** Draws and encodes a frame in a worker thread, which the module's stop ends. */
  async #render(request: TileRequest): Promise<Uint8Array> {
    const reply = await this.#context.workers.call<TileReply>(this.#options.renderWorker ?? RENDER_WORKER, request, {
      timeoutMs: this.#options.renderTimeoutMs ?? RENDER_TIMEOUT_MS, signal: this.#context.signal,
    });
    if (typeof reply !== 'object' || reply === null || !reply.ok || !(reply.webp instanceof Uint8Array)) {
      throw new SdkError(errorBody('internal', {detail: 'the render worker answered without a frame'}));
    }
    return reply.webp;
  }

  /** Starts a cloud call's span, the trigger's child, and answers its end. The cloud never gets the trace context. */
  #begin(tile: Tile, call: 'push' | 'remove' | 'list'): (succeeded: boolean) => void {
    const span = this.#context.trace.start('bunny.device.call', {
      parent: tile.trigger, kind: 'client', attributes: {...this.#deviceField(), 'bunny.operation': tile.operation, 'bunny.operation.id': call},
    });
    return succeeded => { span.end(succeeded ? 'unset' : 'error'); };
  }

  /**
   * Turns one call's result into the device's availability, its last transmission, and the tile's records. An answer
   * from the cloud, a refusal included, means it was reached; no answer means it was not, and makes the Tidbyt
   * `unavailable`, logged once per outage (ADR 0012, "Repetition").
   */
  #report(tile: Tile, call: TileCall): void {
    if (this.#context.signal.aborted) return;
    const {log, clock} = this.#context;
    const parent = tile.trigger;
    const fields: LogFields = {...this.#deviceField(), 'bunny.operation': tile.operation, 'bunny.operation.id': call.call};
    if (call.call === 'render') {
      this.#failed(tile, fields, call.code, parent);
      return;
    }
    const {result} = call;
    // A hold refused it without a request, and the hold's start was logged; or the module stopped.
    if (isNotSent(result)) return;
    const answered = answeredOf(result);
    const device = this.#config.id;
    if (answered) this.#availability.reached(device, parent);
    else this.#availability.unreachable(device, 'outcome' in result && result.outcome === 'uncertain' ? 'uncertain-result' : 'unavailable', parent);
    let lastTransmission = this.#wanted.lastTransmission;
    if ('outcome' in result && result.outcome === 'sent') {
      lastTransmission = {status: 'known', transmittedAtMs: clock.now(), operationIds: [call.call]};
      tile.failing = undefined;
      log.info('operation.completed', {...fields, 'bunny.outcome': 'succeeded'}, parent);
      tile.trigger = undefined;
    } else if (answered && !('ok' in result && result.ok)) {
      this.#failed(tile, fields, codeOfResult(result), parent);
    }
    this.#track(this.#change(availabilityAfter(result, answered), lastTransmission, parent));
  }

  /**
   * A write the cloud refused, or a render that failed: logged once per run of failures of the tile, and again when the
   * cloud refuses the key or the device inside that run, which holds every later call.
   */
  #failed(tile: Tile, fields: LogFields, code: ErrorCode, parent: TraceContext | undefined): void {
    const holding = code === 'unauthenticated' || code === 'forbidden';
    if (tile.failing !== undefined && !(holding && tile.failing !== code)) return;
    tile.failing = code;
    this.#context.log.warn('operation.failed', {...fields, 'bunny.code': code}, parent);
  }

  /** An evaluation of the tile finished: a run of the module's own faults, if any, has ended. */
  #healthy(tile: Tile): void {
    if (!tile.faulting && !this.#escaped) return;
    tile.faulting = false;
    this.#escaped = false;
    this.#context.log.info('operation.completed', {...this.#deviceField(), 'bunny.operation': tile.operation, 'bunny.outcome': 'succeeded'});
  }

  /** Work the module runs on its own. An error that escapes it is the module's fault: it is logged once per run, by type. */
  #track(work: Promise<void>): void {
    const tracked = work.catch((error: unknown) => {
      if (this.#escaped) return;
      this.#escaped = true;
      this.#context.log.error('operation.failed', {'bunny.code': 'internal', 'error.type': errorType(error)});
    });
    this.#work.add(tracked);
    void tracked.finally(() => { this.#work.delete(tracked); });
  }
}

const isNotSent = (result: WriteResult | ListResult | NotSent): result is NotSent =>
  'outcome' in result && (result.outcome === 'held' || result.outcome === 'cancelled');

/** Whether the cloud answered: a success, a refusal, or a server error. A lost answer or a refused connection is none. */
function answeredOf(result: WriteResult | ListResult): boolean {
  if ('ok' in result) return result.ok || result.answered;
  switch (result.outcome) {
    case 'sent':
      return true;
    case 'failed':
      return result.failure !== 'transport-failure';
    case 'uncertain':
      return result.answered;
  }
}

/** The registry code of a call the cloud answered without success. */
function codeOfResult(result: WriteResult | ListResult): ErrorCode {
  const failure = 'ok' in result ? (result.ok ? undefined : result.failure) : result.outcome === 'failed' ? result.failure : 'uncertain';
  switch (failure) {
    case 'unauthenticated':
    case 'forbidden':
    case 'invalid-request':
    case 'capacity':
      return failure;
    case 'unknown-device':
      return 'not-found';
    case 'transport-failure':
      return 'unavailable';
    case 'uncertain':
      return 'uncertain-result';
    case undefined:
      return 'internal';
  }
}

/**
 * The Tidbyt's availability after one call, as the old controller's service health was: `available` once the cloud
 * accepted a write or listed the installations; `unavailable` when it cannot be reached or refuses the key or the
 * device; `degraded` when it is rate limited, refuses a request, or answers with a server error.
 */
function availabilityAfter(result: WriteResult | ListResult, answered: boolean): DeviceRecord['availability'] {
  if (!answered) return 'unavailable';
  if ('ok' in result) {
    if (result.ok) return 'available';
    return result.failure === 'capacity' || result.failure === 'transport-failure' || result.failure === 'invalid-request' ? 'degraded' : 'unavailable';
  }
  switch (result.outcome) {
    case 'sent':
      return 'available';
    case 'uncertain':
      return 'degraded';
    case 'failed':
      return result.failure === 'capacity' || result.failure === 'invalid-request' ? 'degraded' : 'unavailable';
  }
}

/** The state message that carries the Tidbyt's device record. */
export const deviceState = (record: DeviceRecord): StateDraft<DeviceRecord> =>
  ({type: 'org.bunny.device.updated', subject: record.id, dataschema: DEVICE_SCHEMA, data: structuredClone(record)});

/** Whether a message is a Tidbyt device record that reports it unavailable, for the module test kit's policy A check. */
export const reportsUnavailable = (message: Message): boolean =>
  message.dataschema === DEVICE_SCHEMA && message.source === `bunny/modules/${TIDBYT_MODULE}` &&
  (message.data as Partial<DeviceRecord>).availability === 'unavailable';

/**
 * A section that configures the module for the simulated cloud: the device `tidbyt`, the simulated cloud device, both
 * installations, and the now-playing tile following the playback module's simulated record, `living-room`. Its secret
 * file holds the synthetic token, which the simulated cloud takes as its key. Tests, the scenario catalog and disposable
 * runs of the shipped list use it.
 */
export const SIMULATED_SECTION = Object.freeze({
  id: 'tidbyt', cloudDeviceId: SIMULATED_DEVICE, statusInstallation: 'agentdevicehub', nowPlaying: Object.freeze({playback: 'living-room', installation: 'nowplaying'}),
});

/**
 * The shipped list's factory: the real cloud over `fetch`, or the simulated one under `--simulate`, with the section that
 * configures the simulated build and the one secret it names. It has the shape of the runtime's `ModuleFactory` without
 * importing the runtime, which a module may not do.
 */
export const tidbytFactory: {
  readonly name: string; readonly create: () => BunnyModule; readonly simulate: () => BunnyModule;
  readonly simulatedSection: {readonly config: Readonly<Record<string, unknown>>; readonly secrets: readonly string[]};
} = {
  name: TIDBYT_MODULE,
  create: () => createTidbytModule({transport: (url, init) => fetch(url, init)}),
  simulate: () => createTidbytModule({transport: new SimulatedCloud({key: SIMULATED_API_KEY}).fetch}),
  simulatedSection: {config: SIMULATED_SECTION, secrets: [API_KEY_SECRET]},
};
