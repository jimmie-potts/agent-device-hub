// The Nanoleaf module's running state (Hub #844): one instance per start. It follows the core's sessions through the
// SDK's sync, answers the wall's commands, runs one supervised worker per controller on the runtime's clock, scheduler
// and stop signal, observes each controller's power, and publishes each controller's state.
//
// Concurrency rules, for review and tests:
// - One connection: every transaction is synchronous (`Synchronous<R>`) and none spans an await or a device request, so
//   transactions on the module's one connection take turns by construction, the outbox's included, and no writer ever
//   waits inside SQLite on the event loop.
// - One writer per device: one supervisor per controller (`#supervisors`), and its worker's lock file in the module's
//   private folder, which also excludes a second runtime on the same state.
// - Admission (`admitCommand`, mode commands, edits) runs inside the outbox's transaction, so each accepted command's
//   journal row and each outcome commit with the change they report.
// - Generations: the session feed carries the shared-input generation it last saw; a step with another one changes
//   nothing (`SessionFeed`). Inside one runtime the feed's generation moves synchronously with each projection, so the
//   guard is defensive there; a second runtime on the same state is kept out by the workers' lock files.
// - Editor ownership: machine edits guard on the device's configuration revision (`edits.ts`).
// - Policy A: a scheduler callback never throws. A store or device failure is logged once per run of failures and tried
//   again on the scheduler: a publication, a projection, a worker that ended on a store failure.
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {commandSupported, type DeviceCommand} from '@jimmie-potts/event-contracts/v2/devices';
import {sessionEntityId, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {
  DeviceAvailability, errorType, fullDisk, Outbox, SdkError, type AddMessage, type Cancel, type Command, type ModuleContext, type Snapshot, type StateDraft,
  type SyncChange,
} from '@jimmie-potts/sdk';
import {admitCommand, Refused as PortRefused} from '../controls.js';
import {initialize} from '../database.js';
import {favoriteEdit, Failure, validFavoriteEdit} from '../favorites.js';
import {writeJson} from '../jsonfile.js';
import {expireQueued, finish, holdOf, journal, recoverAttempts, type Outcome, type Report, type Transact} from '../journal.js';
import {changeMode} from '../modes.js';
import {Metadata} from '../project-map.js';
import {presented} from '../shared-input.js';
import {execute, first, rows, text, type Db, type Synchronous} from '../sqlite.js';
import {controlState} from '../store.js';
import {HttpError, type LightRequest} from '../transport.js';
import {superviseWorker, type SupervisorEnd} from '../worker.js';
import {registryFile, type DeviceSection, type NanoleafConfig} from './config.js';
import {
  applyEdit, bumpRevision, checkEdit, CommandRefused, editOf, processMachineEdits, queuedEdits, refusePendingWallEdit, type MapEdit,
} from './edits.js';
import {CONSUMER, LINES, SessionFeed, sharedConfig, waitsForComet} from './feed.js';
import {DeviceLink, DeviceUnreachable, LinkStopped, refusesToken, type CommandWrite, type Transmission} from './link.js';
import {NANOLEAF_FAMILIES, OUTCOME_SCHEMA} from './schemas.js';
import {
  animationsView, capabilities, configurationRevision, deviceRecord, MODULE_TABLES, nextTransmission, savedLayout, savedTransmission, STATE_TYPES, storeEpoch,
  wallView, type Presence, type ShownTransmission,
} from './views.js';

/** How often each controller's power is read while it answers, and the longest wait between reads while it does not. */
export const OBSERVE_MS = 5000;
export const OBSERVE_MAX_MS = 30_000;
/** The session sync's deadline, and the longest wait between attempts while the core does not serve it. */
export const SYNC_TIMEOUT_MS = 5000;
export const SYNC_RETRY_MAX_MS = 30_000;
/** How often a waiting machine edit looks again for its comet's end. */
export const EDIT_POLL_MS = 250;
/** How long the module's request to the core for a notice acknowledgment may take. */
export const ACKNOWLEDGE_MS = 5000;
/** The first wait before a worker that ended on a failure starts again, doubling to the longest. */
export const RESTART_MS = 1000;
export const RESTART_MAX_MS = 30_000;
/** How long a restarted worker must keep running before its device counts as presented again. */
export const RESTARTED_MS = 5000;
/** The wait before a publication the store refused is tried again. */
export const PUBLISH_RETRY_MS = 1000;
/**
 * How often a device record's `lastTransmission` may change for the module's own paints alone, so a painting wall does
 * not republish its record with every paint; a later paint shows with the first device request after the interval.
 */
export const TRANSMISSION_MS = 5000;

/** The general device families a Nanoleaf controller answers, the port's command kind for each, and its outcome type. */
const NATIVE = {
  'device-mode-set': {kind: 'mode.set', completed: 'org.bunny.device-mode.set.completed'},
  'power-set': {kind: 'power.set', completed: 'org.bunny.power.set.completed'},
  'brightness-set': {kind: 'brightness.set', completed: 'org.bunny.brightness.set.completed'},
  'scene-activate': {kind: 'scene.activate', completed: 'org.bunny.scene.activate.completed'},
} as const;
type NativeFamily = keyof typeof NATIVE;
/** The general device families a Nanoleaf controller does not offer; moments are codex-nanoleaf#158. */
const UNSUPPORTED = ['zone-power-set', 'media-start', 'media-control', 'moment-play'] as const;
const completedType = (requested: string): string => requested.replace(/\.requested$/, '.completed');
const OUTCOME_TYPES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(NATIVE).map(([family, {completed}]) => [family, completed])),
  ...Object.fromEntries(Object.values(NANOLEAF_FAMILIES).filter(family => family.kind === 'command').map(family => [family.family, completedType(family.type)])),
};
const SERVED = ['device', NANOLEAF_FAMILIES.wall.family, NANOLEAF_FAMILIES.animations.family] as const;
/**
 * The commands that are device writes, whose transmitted evidence is a write to the device, and the operation each write
 * is. A mode command is not one: it completes as its mode commits, and the worker's paints that follow are its own.
 */
const WRITE_OPERATIONS: Readonly<Record<string, string>> = {
  'power-set': 'power', 'brightness-set': 'brightness', 'scene-activate': 'media', [NANOLEAF_FAMILIES.animationPlay.family]: 'media',
};

type Accepted = {status: 'accepted'};
type Reply = Accepted | ErrorBody;
type Guards = {requestId: string; expectedConfigurationRevision?: number; expectedGeneration?: {epoch: string; sequence: number}};
/** A failing run of something the module retries, so it logs the first failure, then a summary a minute, then the recovery. */
type Run = {sinceMs: number; failed: number; unsummarized: number; summarizedAtMs: number};
/** A device whose worker ended on a failure: how often it was started again since, and when the run began. */
type Restarts = {sinceMs: number; attempts: number};
const SUMMARY_MS = 60_000;
const ACCEPTED: Accepted = {status: 'accepted'};

export class NanoleafRuntime {
  readonly #context: ModuleContext<NanoleafConfig>;
  readonly #config: NanoleafConfig;
  readonly #directory: string;
  readonly #db: Db;
  readonly #outbox: Outbox;
  readonly #availability: DeviceAvailability;
  readonly #links = new Map<string, DeviceLink>();
  readonly #feed: SessionFeed;
  readonly #ids: string[];
  readonly #supervisors = new Map<string, Promise<void>>();
  readonly #runs = new Map<string, Run>();
  /** Devices whose worker ended on a failure and has not yet run long enough again. */
  readonly #restarts = new Map<string, Restarts>();
  /** The one pending start of each such device's worker, cancelled when its worker starts any other way. */
  readonly #restartTimers = new Map<string, Cancel>();
  /** Devices a hold after an uncertain write stops, as last published, so each hold is logged once each way. */
  readonly #holds = new Set<string>();
  /**
   * The last write that reached each device, as written or saved, and whether a command's write reached it since its
   * record last chose a transmission. Only a write changes it.
   */
  readonly #written = new Map<string, {latest: Transmission; commandWritten: boolean}>();
  /** The last transmission each device record shows, and when it was chosen, to coalesce the module's own paints. */
  readonly #transmissions = new Map<string, ShownTransmission>();
  /** A run of publications the store refused, if one is going on. */
  #publishing: {sinceMs: number; failed: number} | undefined;
  /** The last record published per entity, without its revision, to publish only what changed. */
  readonly #published = new Map<string, {family: string; id: string; text: string; data: Record<string, unknown>}>();
  readonly #dirty = new Set<string>();
  #flush: Cancel | undefined;
  #revision = 0;
  /** The session copy's changes since the last projection: whether a sync completed among them. */
  #projection: {resync: boolean} | undefined;
  #syncAttempts = 0;
  #feedFailing = false;
  readonly #edits = new Map<string, Cancel>();
  /** Each device's status read while it waits out a backoff: when it is due, and how to cancel it. */
  readonly #backoffs = new Map<string, {atMs: number; cancel: Cancel}>();

  private constructor(context: ModuleContext<NanoleafConfig>, config: NanoleafConfig, directory: string, db: Db) {
    this.#context = context;
    this.#config = config;
    this.#directory = directory;
    this.#db = db;
    this.#ids = config.devices.map(device => device.id);
    const {sdk, clock, log, trace} = context;
    this.#outbox = new Outbox({sdk, database: db, clock, log, trace});
    this.#availability = new DeviceAvailability({log, clock});
    const metadata = config.codexMetadata === undefined ? null
      : new Metadata({metadata_path: config.codexMetadata.path, ...(config.codexMetadata.titleIndexPath === undefined ? {} : {title_index_path: config.codexMetadata.titleIndexPath})});
    this.#feed = new SessionFeed({database: () => db, now: () => clock.now() / 1000, targets: this.#ids, metadata});
  }

  /**
   * Opens the module's local resources only, then reaches its controllers on the scheduler (policy A): its store, its
   * private folder and the registry file the port reads there, its token files, its responders and its sync owner, and
   * the core's sessions, which the core serves before it awaits anything.
   */
  static async start(context: ModuleContext<NanoleafConfig>, config: NanoleafConfig, transport: LightRequest): Promise<NanoleafRuntime> {
    const db = context.database();
    const directory = context.files();
    initialize(db, () => context.clock.now() / 1000);
    db.exec(MODULE_TABLES);
    execute(db, "INSERT OR IGNORE INTO nanoleaf_module VALUES ('epoch', ?)", randomBytes(16).toString('hex'));
    for (const device of config.devices) execute(db, 'INSERT OR IGNORE INTO nanoleaf_devices (device) VALUES (?)', device.id);
    writeJson(join(directory, 'config.json'), registryFile(config));
    const tokens = new Map<string, string>();
    for (const device of config.devices) if (!tokens.has(device.secret)) tokens.set(device.secret, await context.secrets.read(device.secret));
    const runtime = new NanoleafRuntime(context, config, directory, db);
    for (const device of config.devices) {
      const saved = savedTransmission(db, device.id);
      if (saved !== undefined) runtime.#written.set(device.id, {latest: saved, commandWritten: false});
    }
    for (const device of config.devices) runtime.#link(device, tokens.get(device.secret) ?? '', transport);
    await runtime.#begin();
    return runtime;
  }

  #link(device: DeviceSection, token: string, transport: LightRequest): void {
    const {clock, scheduler, signal, log, trace} = this.#context;
    this.#links.set(device.id, new DeviceLink({device: device.id, address: device.address, token, transport, clock, scheduler, signal, log, trace,
      availability: this.#availability, commandWrite: id => this.#commandWrite(id), onWrite: (id, write) => { this.#wrote(id, write); },
      onSettled: id => { this.#answered(id); this.#changed(id); }}));
  }

  /**
   * A write reached the device: it is the device's last transmission, saved so a restart keeps it. A store that refuses
   * the save keeps it in memory for this run; the next write is saved again.
   */
  #wrote(device: string, write: Transmission): void {
    this.#written.set(device, {latest: write, commandWritten: write.requestId !== undefined || this.#written.get(device)?.commandWritten === true});
    try {
      execute(this.#db, 'INSERT OR REPLACE INTO nanoleaf_transmissions VALUES (?,?,?)', device, write.atMs, write.requestId ?? null);
    } catch {
      // The store is busy or full: the record still shows the write.
    }
  }

  /** The command whose write the device's worker is making, from the journal row it marked attempting; none on a store failure. */
  #commandWrite(device: string): CommandWrite | undefined {
    try {
      const row = first(this.#db, `SELECT c.id,c.traceparent,c.family FROM control_journal j JOIN nanoleaf_commands c ON c.id=j.id
        WHERE j.device=? AND j.phase='attempting' ORDER BY j.seq DESC LIMIT 1`, device);
      const operation = row === undefined ? undefined : WRITE_OPERATIONS[text(row, 2)];
      return row === undefined || operation === undefined ? undefined : {requestId: text(row, 0), traceparent: text(row, 1), operation};
    } catch {
      // The span is optional; the write goes on without it.
      return undefined;
    }
  }

  async #begin(): Promise<void> {
    const {sdk, log} = this.#context;
    // What a crash kept from going out, and every outcome the core has not acknowledged, goes out again. The outbox
    // follows the core's acknowledgments first (Hub #782), so it forgets each outcome the core recorded.
    try {
      const count = await this.#outbox.republish();
      log.info('outbox.republished', {'bunny.outbox.republished_count': count});
    } catch (error) {
      log.warn('outbox.deferred', {'bunny.code': error instanceof SdkError ? error.body.error.code : 'internal'});
    }
    await this.#endStoredCommands();
    this.#feed.configure(sharedConfig(this.#config.qualifiedSources));
    for (const device of this.#ids) this.#changed(device);
    this.#flushNow();
    await sdk.serveSync([...SERVED], request => this.#snapshot(request.data.families));
    for (const id of this.#ids) await this.#respond(id);
    await this.#follow();
    for (const id of this.#ids) {
      this.#ensureSupervisor(id);
      this.#context.scheduler.after(0, () => this.#observe(id, 0));
    }
  }

  /** Stops following, ends each supervisor at its next wait, and waits for them. */
  async stop(): Promise<void> {
    this.#flush?.();
    await Promise.allSettled([...this.#supervisors.values()]);
  }

  // Transactions and outcomes

  /** The outbox's transaction with the port's report: each outcome and scene change commits with the change it reports. */
  readonly #transact: Transact = <R>(work: (report: Report) => Synchronous<R>): Promise<R> =>
    this.#outbox.transaction(add => work(this.#reporter(add)));

  #reporter(add: AddMessage): Report {
    return message => {
      if (message.type === 'scenes') {
        this.#changed(message.device);
        return;
      }
      this.#report(add, message);
    };
  }

  /** Stores one outcome in the current transaction, in its command's trace, and records it as the device's last. */
  #report(add: AddMessage, outcome: Outcome): void {
    const db = this.#db;
    const row = first(db, 'SELECT family,traceparent FROM nanoleaf_commands WHERE id=?', outcome.requestId);
    const family = row === undefined ? 'device-command' : text(row, 0);
    const data = {requestId: outcome.requestId, result: outcome.result, evidence: outcome.evidence,
      ...(outcome.error === undefined ? {} : {error: {...outcome.error, requestId: outcome.requestId}})};
    add(`bunny.event.${family}.${outcome.device}`, {
      kind: 'outcome', type: OUTCOME_TYPES[family] ?? 'org.bunny.device.command.completed', subject: outcome.device, dataschema: OUTCOME_SCHEMA, data,
    }, row === undefined ? {} : {parent: {traceparent: text(row, 1)}});
    execute(db, 'DELETE FROM nanoleaf_commands WHERE id=?', outcome.requestId);
    // The last transmission is the link's to keep: an outcome changes it only through the write it made, if any.
    execute(db, 'UPDATE nanoleaf_devices SET last_outcome=? WHERE device=?', JSON.stringify({outcome: data}), outcome.device);
    this.#changed(outcome.device);
  }

  /**
   * Stored intent is responsibility, never a queue (ADR 0012): each command accepted before this start that has no
   * outcome ends now and never runs. An attempt without a result is uncertain, and a native one holds its device; a
   * queued command proves no effect began, so it fails `cancelled`, and a power or brightness command's desired state
   * goes with it (`finish`). A restart replays no comet.
   */
  #endStoredCommands(): Promise<void> {
    return this.#transact(report => {
      const db = this.#db;
      for (const device of this.#ids) {
        recoverAttempts(db, device, report, this.#context.clock.now());
        for (const row of journal(db, device, "AND phase='queued'")) finish(db, row, {kind: 'refused', code: 'cancelled'}, report);
      }
      for (const [id, device] of rows(db, 'SELECT id,device FROM nanoleaf_machine_edits').map(row => [text(row, 0), text(row, 1)] as const)) {
        report({type: 'outcome', device, requestId: id, result: 'failed', evidence: 'none', error: errorBody('cancelled').error});
      }
      execute(db, 'DELETE FROM nanoleaf_machine_edits');
      // What is left is an acknowledgment whose request may have reached the core.
      for (const [id, device] of rows(db, 'SELECT id,device FROM nanoleaf_commands').map(row => [text(row, 0), text(row, 1)] as const)) {
        report({type: 'outcome', device, requestId: id, result: 'uncertain', evidence: 'none', error: errorBody('uncertain-result').error});
      }
      execute(db, 'DELETE FROM comets');
    });
  }

  // Publication

  /** Marks a device's state, or every device's, for publication at the next turn of the scheduler. */
  #changed(device?: string): void {
    const {scheduler, signal} = this.#context;
    if (signal.aborted) return;
    for (const id of device === undefined ? this.#ids : [device]) this.#dirty.add(id);
    if (this.#flush !== undefined) return;
    try {
      this.#flush = scheduler.after(0, () => {
        this.#flush = undefined;
        this.#flushNow();
      });
    } catch {
      // The module is stopping: nothing is published any more.
    }
  }

  /**
   * Publishes each marked device's record, wall view and, for the Lines, animation options, where they changed. A store
   * that refuses the reads is logged once per run and tried again on the scheduler; it never fails the module.
   */
  #flushNow(): void {
    const {signal, log, clock, scheduler} = this.#context;
    if (signal.aborted) return;
    const devices = [...this.#dirty];
    this.#dirty.clear();
    try {
      this.#publishDevices(devices);
    } catch (error) {
      for (const id of devices) this.#dirty.add(id);
      if (this.#publishing === undefined) {
        this.#publishing = {sinceMs: clock.now(), failed: 1};
        log.warn('operation.failed', {'bunny.operation': 'snapshot', 'error.type': errorType(error)});
      } else {
        this.#publishing.failed += 1;
      }
      try {
        this.#flush = scheduler.after(PUBLISH_RETRY_MS, () => {
          this.#flush = undefined;
          this.#flushNow();
        });
      } catch {
        // The module is stopping: nothing is published any more.
      }
      return;
    }
    const run = this.#publishing;
    if (run === undefined) return;
    this.#publishing = undefined;
    log.info('operation.completed', {'bunny.operation': 'snapshot', 'bunny.attempt_count': run.failed,
      'bunny.duration_ms': Math.min(86_400_000, Math.max(0, clock.now() - run.sinceMs))});
  }

  #publishDevices(devices: readonly string[]): void {
    const db = this.#db;
    const epoch = storeEpoch(db);
    for (const id of devices) {
      const link = this.#links.get(id);
      const section = this.#config.devices.find(device => device.id === id);
      if (link === undefined || section === undefined) continue;
      const presence = this.#presence(id);
      this.#publish('device', id, deviceRecord(db, link, epoch, presence, this.#transmission(id)));
      this.#publish(NANOLEAF_FAMILIES.wall.family, id, wallView(db, this.#feed.copy, this.#directory, id, section.kind, presence));
      if (id === LINES) this.#publish(NANOLEAF_FAMILIES.animations.family, id, animationsView(db, this.#directory));
      this.#noteHold(id, presence.hold !== undefined);
    }
  }

  /**
   * The last transmission the device record shows (`nextTransmission`): a change that includes a command's write at once,
   * a change from the module's own paints at most once per `TRANSMISSION_MS`. The record is built again as each device
   * request settles, so a paint inside the interval shows with the first request after it, which the poll bounds.
   */
  #transmission(device: string): Transmission | undefined {
    const written = this.#written.get(device);
    const now = this.#context.clock.now();
    const next = nextTransmission(this.#transmissions.get(device), written?.latest, written?.commandWritten === true, now, TRANSMISSION_MS);
    if (next.chosen && next.transmission !== undefined) {
      this.#transmissions.set(device, {transmission: next.transmission, chosenAtMs: now});
      if (written !== undefined) written.commandWritten = false;
    }
    return next.transmission;
  }

  /**
   * Whether the module presents the device now: a hold after an uncertain write stops its writes, named by the operation
   * it waits on, or no worker runs for it.
   */
  #presence(device: string): Presence {
    return {hold: holdOf(this.#db, controlState(this.#db, device).revision, device),
      workerDown: this.#restarts.has(device) && !this.#supervisors.has(device)};
  }

  /** A hold is logged once as it begins and once as an explicit choice releases it. */
  #noteHold(device: string, holding: boolean): void {
    if (holding === this.#holds.has(device)) return;
    const {log} = this.#context;
    if (holding) {
      this.#holds.add(device);
      log.warn('operation.failed', {'bunny.device.id': device, 'bunny.operation': 'status', 'bunny.code': 'uncertain-result', 'bunny.write.possible': true});
      return;
    }
    this.#holds.delete(device);
    log.info('operation.completed', {'bunny.device.id': device, 'bunny.operation': 'status', 'bunny.outcome': 'current'});
  }

  #publish(family: keyof typeof STATE_TYPES, id: string, data: Record<string, unknown>): void {
    const key = `${family}/${id}`;
    const encoded = JSON.stringify(data);
    if (this.#published.get(key)?.text === encoded) return;
    // Revisions follow the runtime's clock, so they keep rising across restarts without a write per publication.
    this.#revision = Math.max(this.#revision + 1, Math.floor(this.#context.clock.now()));
    const record = {...data, revision: this.#revision};
    this.#published.set(key, {family, id, text: encoded, data: record});
    const {type, dataschema} = STATE_TYPES[family];
    this.#context.sdk.publish(`bunny.state.${family}.${id}`, {kind: 'state', type, subject: id, dataschema, data: record}).catch(() => {
      // A refused publish of a state changes nothing: a consumer that missed it syncs.
    });
  }

  /**
   * The current records of the families a sync asks for, as published, and no other: a reader may sync any one family
   * the module serves, and the SDK refuses a snapshot that holds another (Hub #970). Serving a sync writes nothing.
   */
  #snapshot(families: readonly string[]): Snapshot {
    const states: StateDraft[] = [...this.#published.values()].filter(({family}) => families.includes(family)).map(({family, id, data}) => {
      const {type, dataschema} = STATE_TYPES[family as keyof typeof STATE_TYPES];
      return {type, subject: id, dataschema, data: data as StateDraft['data']};
    });
    return {revision: this.#revision, states};
  }

  // The core's sessions

  /** Starts a copy of the core's sessions; a sync the core does not serve is tried again with capped backoff. */
  async #follow(): Promise<void> {
    const {sdk, scheduler, signal} = this.#context;
    if (signal.aborted) return;
    this.#feed.restart();
    let result;
    try {
      result = await sdk.sync<SessionRecord>(['session'], change => { this.#heard(change); }, {timeoutMs: SYNC_TIMEOUT_MS});
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
    if (result.status === 'synced') return;
    if (signal.aborted) return;
    this.#feedFailure(result.error.error.code);
    this.#syncAttempts += 1;
    scheduler.after(Math.min(SYNC_RETRY_MAX_MS, 1000 * 2 ** Math.min(5, this.#syncAttempts - 1)), () => this.#follow());
  }

  #heard(change: SyncChange<SessionRecord>): void {
    const {scheduler, signal} = this.#context;
    if (signal.aborted) return;
    switch (change.type) {
      case 'updated':
        this.#feed.records.set(change.entity.id, change.message.data);
        break;
      case 'removed':
        this.#feed.records.delete(change.entity.id);
        break;
      case 'synced':
        break;
      case 'failed':
        // The copy stopped following the core: the tasks freeze and its comets go until a new sync completes.
        this.#feedFailure(change.error.error.code);
        try {
          this.#feed.failed();
        } catch {
          // The store refused; the next sync's projection starts fresh.
        }
        this.#changed();
        this.#syncAttempts = 1;
        scheduler.after(1000, () => this.#follow());
        return;
    }
    // A sync's changes arrive one after another; one projection after the last of them sees the whole copy.
    this.#projectLater(change.type === 'synced', 0);
  }

  /** Projects the copy once after `delayMs`, as a resync when any change before it asked for one. */
  #projectLater(resync: boolean, delayMs: number): void {
    if (this.#projection !== undefined) {
      this.#projection.resync ||= resync;
      return;
    }
    this.#projection = {resync};
    this.#context.scheduler.after(delayMs, () => { this.#project(); });
  }

  #project(): void {
    const pendingProjection = this.#projection;
    this.#projection = undefined;
    if (pendingProjection === undefined || this.#context.signal.aborted) return;
    let outcome;
    try {
      // A selection is a fresh start of every device's configuration, as the old ledger's source generation was: the
      // revision moves in the selection's own transaction.
      outcome = this.#feed.project(pendingProjection.resync, () => { bumpRevision(this.#db, this.#ids); });
    } catch (error) {
      // A selection waits for a running comet to end; any other failure is logged once and tried again, as a fresh
      // start, since the copy was emptied.
      if (!waitsForComet(error)) this.#feedFailure('internal', error);
      this.#projectLater(true, 1000);
      return;
    }
    this.#syncAttempts = 0;
    if (this.#feedFailing) {
      this.#feedFailing = false;
      this.#context.log.info('operation.completed', {'bunny.operation': 'feed', 'bunny.outcome': 'current'});
    }
    if (outcome === 'selected') {
      this.#context.log.info('feed.changed', {'bunny.generation': this.#feed.generation, 'bunny.outcome': 'current'});
      for (const id of this.#ids) this.#ensureSupervisor(id);
    }
    this.#changed();
  }

  #feedFailure(code: ErrorCode, error?: unknown): void {
    if (this.#feedFailing) return;
    this.#feedFailing = true;
    this.#context.log.warn('operation.failed', {'bunny.operation': 'feed', 'bunny.code': code, ...(error === undefined ? {} : {'error.type': errorType(error)})});
  }

  // Controllers

  /** Starts the device's supervised worker unless one runs (`launch_worker`). */
  #ensureSupervisor(device: string): void {
    const {clock, scheduler, signal} = this.#context;
    if (signal.aborted || this.#supervisors.has(device)) return;
    const link = this.#links.get(device);
    if (link === undefined) return;
    // A worker that starts any other way, for a command or a selection, replaces the pending restart.
    this.#restartTimers.get(device)?.();
    this.#restartTimers.delete(device);
    // The worker waits fractions of a second on its clock in seconds; the runtime's scheduler takes whole milliseconds, so
    // each wait is rounded up to the next one.
    const whole = {after: (delayMs: number, callback: () => void): Cancel => scheduler.after(Math.max(0, Math.ceil(delayMs)), callback)};
    const running: Promise<void> = superviseWorker({
      directory: this.#directory, database: this.#context.database, device, clock, scheduler: whole, signal, request: link.request,
      transact: this.#transact, onFailure: (error, failed) => { this.#passFailed(failed, error); },
    }).then((end: SupervisorEnd) => {
      this.#supervisors.delete(device);
      // Another instance held the lock, or a failure could not even be recorded, as on a busy or full store.
      if (end === 'locked' || end === 'unrecorded') this.#workerEnded(device, {'bunny.reason': 'busy'});
      this.#changed(device);
    }, (error: unknown) => {
      this.#supervisors.delete(device);
      if (!signal.aborted) this.#workerEnded(device, {'error.type': errorType(error)});
      this.#changed(device);
    });
    this.#supervisors.set(device, running);
    if (!this.#restarts.has(device)) return;
    // A worker started again counts as presenting its device once it has kept running for a while.
    try {
      scheduler.after(RESTARTED_MS, () => {
        if (this.#supervisors.get(device) !== running) return;
        const restarts = this.#restarts.get(device);
        if (restarts === undefined) return;
        this.#restarts.delete(device);
        this.#context.log.info('operation.completed', {'bunny.device.id': device, 'bunny.operation': 'status', 'bunny.attempt_count': restarts.attempts,
          'bunny.duration_ms': Math.min(86_400_000, Math.max(0, clock.now() - restarts.sinceMs))});
        this.#changed(device);
      });
    } catch {
      // The module is stopping.
    }
  }

  /**
   * A device's worker ended on a failure while the module runs: it is logged once per run of such ends, each later end at
   * DEBUG, the device shows degraded meanwhile, and the worker starts again after a wait that doubles to
   * `RESTART_MAX_MS` (policy A). One start waits at a time; a worker started any other way replaces it.
   */
  #workerEnded(device: string, why: Record<string, string>): void {
    const {clock, scheduler, signal, log} = this.#context;
    if (signal.aborted) return;
    let restarts = this.#restarts.get(device);
    if (restarts === undefined) {
      restarts = {sinceMs: clock.now(), attempts: 0};
      this.#restarts.set(device, restarts);
      log.error('operation.failed', {'bunny.device.id': device, 'bunny.operation': 'status', ...why});
    } else {
      // Each later end of the same run is a bounded retry, at DEBUG.
      log.debug('operation.failed', {'bunny.device.id': device, 'bunny.operation': 'status', ...why, 'bunny.attempt_count': restarts.attempts});
    }
    // One start waits at a time, however many ends came before it.
    if (this.#restartTimers.has(device)) return;
    const wait = Math.min(RESTART_MAX_MS, RESTART_MS * 2 ** Math.min(5, restarts.attempts));
    restarts.attempts += 1;
    try {
      this.#restartTimers.set(device, scheduler.after(wait, () => {
        this.#restartTimers.delete(device);
        this.#ensureSupervisor(device);
      }));
    } catch {
      // The module is stopping.
    }
  }

  /**
   * A worker pass failed and the supervisor retries it. A device that did not answer is already counted by the
   * availability record; any other failure is logged once per run of failures, then summarized at most once a minute.
   */
  #passFailed(device: string, error: unknown): void {
    this.#changed(device);
    // A device that did not answer, or that refuses the module's token, is already the link's record.
    if (error instanceof DeviceUnreachable || error instanceof LinkStopped || (error instanceof HttpError && refusesToken(error.status))) return;
    const now = this.#context.clock.now();
    const run = this.#runs.get(device);
    if (run === undefined) {
      this.#runs.set(device, {sinceMs: now, failed: 1, unsummarized: 0, summarizedAtMs: now});
      this.#context.log.warn('operation.failed', {'bunny.device.id': device, 'bunny.operation': 'status', 'error.type': errorType(error), 'bunny.attempt_count': 1});
      return;
    }
    run.failed += 1;
    run.unsummarized += 1;
    if (now - run.summarizedAtMs < SUMMARY_MS) return;
    this.#context.log.debug('operation.failed', {'bunny.device.id': device, 'bunny.operation': 'status', 'error.type': errorType(error),
      'bunny.attempt_count': run.unsummarized});
    run.unsummarized = 0;
    run.summarizedAtMs = now;
  }

  /**
   * Reads the device's power and brightness (`GET /state`): the device's own report, which the device record carries as
   * its observation. While the device answers, every `OBSERVE_MS`; while it does not, after a wait that doubles to
   * `OBSERVE_MAX_MS`. A failed read is the link's, which logs one degradation and one recovery per outage.
   */
  async #observe(device: string, failures: number): Promise<void> {
    const {scheduler, signal} = this.#context;
    const link = this.#links.get(device);
    if (signal.aborted || link === undefined) return;
    let next = OBSERVE_MS;
    try {
      await link.request({ip: '', token: ''}, 'GET', '/state');
      failures = 0;
      this.#recovered(device);
    } catch {
      failures += 1;
      next = Math.min(OBSERVE_MAX_MS, 1000 * 2 ** Math.min(5, failures - 1));
    }
    if (signal.aborted) return;
    const cancel = scheduler.after(next, () => { this.#backoffs.delete(device); void this.#observe(device, failures); });
    if (failures > 0) this.#backoffs.set(device, {atMs: this.#context.clock.now() + next, cancel});
  }

  /** A device that answers any request is read again within `OBSERVE_MS`, not at the end of the backoff its outage began. */
  #answered(device: string): void {
    const backoff = this.#backoffs.get(device);
    const {clock, scheduler, signal} = this.#context;
    if (signal.aborted || backoff === undefined || this.#links.get(device)?.status !== 'reached' || backoff.atMs - clock.now() <= OBSERVE_MS) return;
    backoff.cancel();
    this.#backoffs.delete(device);
    scheduler.after(OBSERVE_MS, () => this.#observe(device, 0));
  }

  /**
   * A device that answers again after a run of other failed passes logs its recovery once, when a worker presents it
   * again: not while its worker is down, when a busy store may also have kept the failed pass from being recorded.
   */
  #recovered(device: string): void {
    const run = this.#runs.get(device);
    if (run === undefined || this.#restarts.has(device) || !this.#supervisors.has(device)) return;
    const {error} = controlState(this.#db, device);
    if (error !== null && error !== '') return;
    this.#runs.delete(device);
    this.#context.log.info('operation.completed', {'bunny.device.id': device, 'bunny.operation': 'status', 'bunny.attempt_count': run.failed,
      'bunny.duration_ms': Math.min(86_400_000, Math.max(0, this.#context.clock.now() - run.sinceMs))});
  }

  // Commands

  async #respond(device: string): Promise<void> {
    const {sdk} = this.#context;
    for (const family of Object.keys(NATIVE) as NativeFamily[]) {
      await sdk.respond<Guards & Record<string, unknown>>(`bunny.cmd.${family}.${device}`, command => this.#native(device, family, command));
    }
    for (const family of UNSUPPORTED) {
      await sdk.respond<Guards>(`bunny.cmd.${family}.${device}`, command =>
        errorBody('unsupported-capability', {requestId: command.data.requestId, detail: 'a Nanoleaf controller does not take this command'}));
    }
    const {wallEdit, machineEdit, animationPlay, favoriteEdit: favorite, acknowledge} = NANOLEAF_FAMILIES;
    await sdk.respond<{requestId: string; edit: unknown}>(`bunny.cmd.${wallEdit.family}.${device}`, command => this.#wallEdit(device, command));
    await sdk.respond<Guards & {edit: unknown}>(`bunny.cmd.${machineEdit.family}.${device}`, command => this.#machineEdit(device, command));
    await sdk.respond<{requestId: string; animation: Record<string, unknown>}>(`bunny.cmd.${animationPlay.family}.${device}`,
      command => this.#animation(device, command));
    await sdk.respond<Guards & {edit: Record<string, unknown>}>(`bunny.cmd.${favorite.family}.${device}`, command => this.#favorite(device, command));
    await sdk.respond<{requestId: string; task: string; noticeId: string}>(`bunny.cmd.${acknowledge.family}.${device}`,
      command => this.#acknowledge(device, command));
  }

  /**
   * Runs one admission in the outbox's transaction. A refusal rolls everything back, so the command had no effect and
   * its reply carries the refusal; so does a store failure, which the transaction rolled back. A full disk is the
   * registry's `capacity`, which the bus records at WARN; any other store failure is `internal`, which the bus records at
   * ERROR and the module logs once more, at ERROR with the error's type. No record carries the error's text. Accepted, it
   * runs `after`.
   */
  async #admit(command: Command<{requestId: string}>, work: (report: Report, add: AddMessage) => void, after: () => void = () => {}): Promise<Reply> {
    const {requestId} = command.data;
    try {
      await this.#outbox.transaction(add => { work(this.#reporter(add), add); });
    } catch (error) {
      if (error instanceof CommandRefused) return errorBody(error.code, {requestId, detail: error.detail});
      if (error instanceof PortRefused) return errorBody(error.code, {requestId, detail: PORT_REFUSALS[error.code] ?? OTHER_REFUSAL});
      if (error instanceof Failure) return errorBody(error.code, {requestId, detail: FAVORITE_REFUSALS[error.code]});
      if (fullDisk(error)) return errorBody('capacity', {requestId, detail: 'the module\'s store is full; nothing changed'});
      this.#context.log.error('command.rejected', {'bunny.request.id': requestId, 'bunny.code': 'internal', 'error.type': errorType(error)}, command);
      return errorBody('internal', {requestId, detail: 'the module could not take the command; nothing changed'});
    }
    after();
    return ACCEPTED;
  }

  /** Records an accepted command, in its trace, until its outcome is reported. A repeated request ID is refused. */
  #record(command: Command<{requestId: string}>, device: string, family: string): void {
    const {requestId} = command.data;
    if (first(this.#db, 'SELECT 1 FROM nanoleaf_commands WHERE id=?', requestId) !== undefined) {
      throw new CommandRefused('duplicate-conflict', 'a command with this request ID is still running');
    }
    execute(this.#db, 'INSERT INTO nanoleaf_commands VALUES (?,?,?,?,?)', requestId, device, family, command.traceparent, expiresMs(command, this.#context.clock.now()));
  }

  /** Refuses a stale configuration revision or generation before changing anything. */
  #guard(device: string, guards: Guards): void {
    if (guards.expectedConfigurationRevision !== undefined && guards.expectedConfigurationRevision !== configurationRevision(this.#db, device)) {
      throw new CommandRefused('revision-conflict', 'the device\'s configuration changed; read its state again');
    }
    const generation = guards.expectedGeneration;
    if (generation !== undefined) {
      if (generation.epoch !== storeEpoch(this.#db) || generation.sequence !== controlState(this.#db, device).revision) {
        throw new CommandRefused('revision-conflict', 'the device\'s generation changed; read its state again');
      }
    }
  }

  #native(device: string, family: NativeFamily, command: Command<Guards & Record<string, unknown>>): Promise<Reply> {
    const {requestId, expectedConfigurationRevision: _revision, expectedGeneration: _generation, ...fields} = command.data;
    const general = {family, data: command.data} as DeviceCommand;
    return this.#admit(command, report => {
      this.#guard(device, command.data);
      if (!this.#links.has(device)) throw new CommandRefused('not-found', 'no such device');
      if (!commandSupported(capabilities(this.#db, device), general)) {
        throw new CommandRefused('unsupported-capability', 'the device does not offer this');
      }
      this.#record(command, device, family);
      if (family === 'device-mode-set') {
        // A mode is the module's own state (ADR 0012, module-local effects): it commits here, ending the device's queued
        // work, its hold and its overrides, and the command completes as observed. Nothing is sent to the device as part
        // of it, so it has no expiry; the worker paints the new mode as its own state once the device answers, and the
        // device's availability shows whether it has. A mode command is also a configuration edit a queued machine edit
        // must not overwrite.
        changeMode(this.#db, String(fields.mode), this.#seconds(), report, device);
        report({type: 'outcome', device, requestId, result: 'succeeded', evidence: 'observed'});
        bumpRevision(this.#db, [device]);
        return;
      }
      admitCommand(this.#db, this.#directory, {id: requestId, device, command: {kind: NATIVE[family].kind, ...fields}, instant: this.#seconds(),
        expires: expiresMs(command, this.#context.clock.now()) / 1000}, report);
    }, () => { this.#accepted(device, family === 'device-mode-set' ? undefined : command); });
  }

  #animation(device: string, command: Command<{requestId: string; animation: Record<string, unknown>}>): Promise<Reply> {
    const {requestId, animation} = command.data;
    return this.#admit(command, report => {
      // The port reads the saved Lines layout for the animation's placement; until the device answered once there is none.
      // The condition clears by itself, so it is the device's state, as for a wall edit then.
      if (device === LINES && savedLayout(this.#directory, LINES) === undefined) {
        throw new CommandRefused('invalid-state', 'the Lines\' layout is not saved yet; it is read once the device answers');
      }
      this.#record(command, device, NANOLEAF_FAMILIES.animationPlay.family);
      admitCommand(this.#db, this.#directory, {id: requestId, device, command: {kind: 'animation.play', ...animation}, instant: this.#seconds(),
        expires: expiresMs(command, this.#context.clock.now()) / 1000}, report);
    }, () => { this.#accepted(device, command); });
  }

  /**
   * After an accepted command: its device's worker runs and its state is published; a device write, `command`, expires
   * on time.
   */
  #accepted(device: string, command?: Command<{requestId: string}>): void {
    const {scheduler, clock} = this.#context;
    this.#ensureSupervisor(device);
    this.#changed(device);
    if (command === undefined) return;
    const wait = Math.max(0, expiresMs(command, clock.now()) - clock.now()) + 1;
    try {
      // The worker expires what it holds as it checks; this ends a command no worker checks in time.
      scheduler.after(wait, () => this.#transact(report => { expireQueued(this.#db, device, clock.now() / 1000, report); }).catch(() => {
        // The store refused: the worker still expires the command as it next checks.
      }));
    } catch {
      // The module is stopping.
    }
  }

  #wallEdit(device: string, command: Command<{requestId: string; edit: unknown}>): Promise<Reply> {
    const family = NANOLEAF_FAMILIES.wallEdit.family;
    return this.#admit(command, report => {
      const edit = editOf(command.data.edit);
      bumpRevision(this.#db, applyEdit(this.#db, this.#feed.copy, savedLayout(this.#directory, device), device, edit, this.#ids));
      this.#record(command, device, family);
      report({type: 'outcome', device, requestId: command.data.requestId, result: 'succeeded', evidence: 'observed'});
    }, () => { this.#changed(); });
  }

  #machineEdit(device: string, command: Command<Guards & {edit: unknown}>): Promise<Reply> {
    const family = NANOLEAF_FAMILIES.machineEdit.family;
    return this.#admit(command, () => {
      // The extension's edits belonged to the Lines alone; other devices are read-only to machines.
      if (device !== LINES) throw new CommandRefused('unsupported-capability', 'machine edits apply to the Lines only');
      this.#guard(device, command.data);
      refusePendingWallEdit(this.#db, device);
      if (queuedEdits(this.#db, device).length > 0) throw new CommandRefused('capacity', 'another machine edit is waiting on this device');
      const edit: MapEdit = editOf(command.data.edit);
      if (edit.kind === 'locate' || edit.kind === 'evict') throw new CommandRefused('unsupported-capability', 'machines do not locate or evict');
      checkEdit(this.#db, this.#feed.copy, savedLayout(this.#directory, device), device, edit, this.#ids);
      this.#record(command, device, family);
      execute(this.#db, 'INSERT INTO nanoleaf_machine_edits (id,device,edit,revision,expires_ms) VALUES (?,?,?,?,?)', command.data.requestId, device,
        JSON.stringify(edit), configurationRevision(this.#db, device), expiresMs(command, this.#context.clock.now()));
    }, () => {
      this.#changed(device);
      this.#processEdits(device);
    });
  }

  /** Applies the device's queued machine edits once they may, and looks again while one waits. */
  #processEdits(device: string): void {
    const {scheduler, clock, signal} = this.#context;
    this.#edits.get(device)?.();
    this.#edits.delete(device);
    if (signal.aborted) return;
    void this.#transact(report => {
      const ended = processMachineEdits(this.#db, this.#feed.copy, savedLayout(this.#directory, device), device, clock.now(), this.#ids,
        id => configurationRevision(this.#db, id));
      for (const end of ended) {
        report(end.result === 'applied'
          ? {type: 'outcome', device, requestId: end.edit.id, result: 'succeeded', evidence: 'observed'}
          : {type: 'outcome', device, requestId: end.edit.id, result: 'failed', evidence: 'none', error: errorBody(end.code).error});
      }
      return queuedEdits(this.#db, device).length > 0;
    }).then(waiting => {
      if (ended(signal) || !waiting) return;
      this.#edits.set(device, scheduler.after(EDIT_POLL_MS, () => { this.#processEdits(device); }));
    }, () => {
      if (!ended(signal)) this.#edits.set(device, scheduler.after(EDIT_POLL_MS, () => { this.#processEdits(device); }));
    });
  }

  #favorite(device: string, command: Command<Guards & {edit: Record<string, unknown>}>): Promise<Reply> {
    const family = NANOLEAF_FAMILIES.favoriteEdit.family;
    return this.#admit(command, report => {
      if (device !== LINES) throw new CommandRefused('unsupported-capability', 'animation favorites belong to the Lines');
      this.#guard(device, command.data);
      const {kind, ...rest} = command.data.edit;
      const edit = {kind: `animation.${String(kind)}`, ...rest};
      if (!validFavoriteEdit(edit)) throw new CommandRefused('invalid-request', 'the favorite edit is malformed');
      favoriteEdit(this.#db, edit, false);
      favoriteEdit(this.#db, edit, true);
      bumpRevision(this.#db, [device]);
      this.#record(command, device, family);
      report({type: 'outcome', device, requestId: command.data.requestId, result: 'succeeded', evidence: 'observed'});
    }, () => { this.#changed(device); });
  }

  /**
   * The wall acknowledges a finished turn for the Nanoleaf consumer: the module asks the core (`notice-acknowledge`) for
   * a task it shows. A task it does not show, such as a skipped session from a source not qualified, is refused without
   * sending a request. The core's answer is the outcome.
   */
  #acknowledge(device: string, command: Command<{requestId: string; task: string; noticeId: string}>): Promise<Reply> {
    const family = NANOLEAF_FAMILIES.acknowledge.family;
    const {requestId, task, noticeId} = command.data;
    let session: string | undefined;
    return this.#admit(command, () => {
      const copy = this.#feed.copy.envelope;
      const presentedTask = copy === null ? undefined : presented(copy.snapshot).get(task);
      const root = presentedTask?.[0];
      if (root === undefined || !root.notices.some(notice => notice.id === noticeId)) {
        throw new CommandRefused('not-found', 'the wall shows no such finished turn');
      }
      // The copy holds `session/2.0` records only, so the identity is one of theirs.
      session = sessionEntityId(root.identity as SessionRecord['identity']);
      this.#record(command, device, family);
    }, () => {
      if (session !== undefined) void this.#sendAcknowledgment(device, requestId, session, noticeId, command);
    });
  }

  async #sendAcknowledgment(device: string, requestId: string, session: string, noticeId: string, command: Command<{requestId: string}>): Promise<void> {
    const {sdk, signal} = this.#context;
    let outcome: Outcome;
    try {
      const result = await sdk.request(`bunny.cmd.notice-acknowledge.${session}`, {
        type: 'org.bunny.notice.acknowledge.requested', subject: session, dataschema: 'https://bunny.invalid/events/notice-acknowledge/2.0',
        data: {consumerId: CONSUMER, noticeId},
      }, {timeoutMs: ACKNOWLEDGE_MS, parent: command});
      outcome = result.status === 'accepted' ? {type: 'outcome', device, requestId, result: 'succeeded', evidence: 'transmitted'}
        : result.status === 'rejected' ? {type: 'outcome', device, requestId, result: 'failed', evidence: 'none', error: errorBody(result.error.error.code).error}
          : {type: 'outcome', device, requestId, result: 'uncertain', evidence: 'none', error: errorBody('uncertain-result').error};
    } catch {
      // The module's participant is closing: the request may never have gone out.
      if (signal.aborted) return;
      outcome = {type: 'outcome', device, requestId, result: 'uncertain', evidence: 'none', error: errorBody('uncertain-result').error};
    }
    if (signal.aborted) return;
    await this.#transact(report => { report(outcome); }).catch(() => {
      // The store refused: the command stays recorded, and the next start reports it uncertain.
    });
  }

  #seconds(): number {
    return this.#context.clock.now() / 1000;
  }
}

/** When a command expires, in epoch milliseconds: its envelope's `expiresat`, or now when it carries none. */
function expiresMs(command: {expiresat?: string}, nowMs: number): number {
  const parsed = command.expiresat === undefined ? Number.NaN : Date.parse(command.expiresat);
  return Number.isFinite(parsed) ? parsed : nowMs;
}

const ended = (signal: AbortSignal): boolean => signal.aborted;

/** Fixed text for each refusal of a control or an animation the port decides; the port's own messages are not repeated. */
const PORT_REFUSALS: Partial<Readonly<Record<ErrorCode, string>>> = {
  'unsupported-capability': 'the device does not take this now: scenes and animations play in Free only, and animations on the Lines only',
  capacity: 'the device has too many waiting commands, or another animation is waiting',
  'not-found': 'no such device',
};
const OTHER_REFUSAL = 'the command is not one the device takes';
/** Fixed text for each refusal of a favorite edit (`favorites.ts`). */
const FAVORITE_REFUSALS: Readonly<Record<Failure['code'], string>> = {
  capacity: 'the Lines keep as many favorites as they can; forget one first',
  'revision-conflict': 'a favorite with that name exists; read the options again',
  'unsupported-capability': 'no favorite has that name; read the options again',
};
