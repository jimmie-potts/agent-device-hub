// The LIFX runtime module (Hub #928, ADR 0012). It replaces the LIFX half of the old local controller host at the
// cutover (#840). Each configured bulb gets one queue, the only path to it, behind its writer lease. A qualified bulb
// publishes its `device/2.0` record and its `lifx-light` color record, answers power, brightness, its own Work, Quiet and
// Free, color and color temperature, and paints automatic agent status from the module's synced copy of the core's
// sessions, only when the shown status changes and never in Free. An unqualified bulb, such as the Beam, is listed with
// no controls and never reached.
//
// Under policy A, start opens only local resources: the database, the private folder with the leases, and the bus. The
// module reaches each bulb afterwards, and a bulb's errors and timeouts become outcomes and an `unavailable` record,
// never a module failure. A command is stored before it is accepted, so a full disk refuses it with no effect, and its
// outcome is stored with the change it reports and goes out through the outbox, so a crash never loses it. A command
// whose work a stop or a crash cut short is reported at the next start as `uncertain` when its write may have begun,
// and `failed` otherwise. Nothing is ever sent again, and a restart writes nothing to a bulb.
import {createHash, randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {errorBody, SCHEMA_BASE, type ErrorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {commandSupported, type Capabilities, type CompletedOutcome, type DeviceCommand, type DeviceRecord, type Tagged} from '@jimmie-potts/event-contracts/v2/devices';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {highestStatus} from '@jimmie-potts/event-contracts/v2/status';
import {
  DeviceAvailability, errorType, Outbox, type AddMessage, type BunnyModule, type Cancel, type Command, type LogFields, type ModuleContext,
  type Reply, type Sdk, type Snapshot, type StateDraft, type SyncChange, type SyncedCopy, type TraceContext,
} from '@jimmie-potts/sdk';
import {configureLifx, NATIVE_MODES, qualified, type LifxBulbConfig, type LifxConfig, type NativeMode, type StatusCaps} from './configuration.js';
import {DEVICE_SCHEMA, LIFX_COLOR_SET_SCHEMA, LIFX_LIGHT_SCHEMA, LIFX_TEMPERATURE_SET_SCHEMA, lifxValidator, OUTCOME_SCHEMA, type LifxLight} from './families.js';
import {acquireLease, type Lease} from './lease.js';
import {UdpTransport, type Hsbk} from './protocol.js';
import {BulbQueue, type Attempt, type Observation, type Operation, type Reservation} from './queue.js';
import type {LifxNetwork} from './simulated.js';
import {paintFor, shownKey, type PaintKey} from './status.js';
import {LifxStore, type BulbRow} from './store.js';

export const MODULE_NAME = 'lifx';
/** At most one on-demand LightGet per bulb in this long, while its records are read, as the old host did (#330). */
export const READ_INTERVAL_MS = 30_000;
/** The first wait before the module reads an unavailable bulb again; each later wait doubles, up to `PROBE_MAX_MS`. */
export const PROBE_FIRST_MS = 30_000;
export const PROBE_MAX_MS = 300_000;
/** How long one sync of the core's sessions may take, and the waits before the module syncs again after a failure. */
const SYNC_TIMEOUT_MS = 5000;
const RESYNC_FIRST_MS = 1000;
const RESYNC_MAX_MS = 60_000;
/** SQLite's result code for a full disk, from a node:sqlite error's `errcode`. */
const SQLITE_FULL = 13;

/** The command families each bulb answers on `bunny.cmd.<family>.<bulb id>`. */
export const COMMAND_FAMILIES = ['power-set', 'brightness-set', 'device-mode-set', 'lifx-color-set', 'lifx-temperature-set'] as const;
export type CommandFamily = (typeof COMMAND_FAMILIES)[number];
const COMMANDS: Readonly<Record<CommandFamily, {dataschema: string; entity: string; operation?: 'power' | 'brightness' | 'mode'; sent: string}>> = {
  'power-set': {dataschema: `${SCHEMA_BASE}power-set/2.0`, entity: 'org.bunny.power.set', operation: 'power', sent: 'power'},
  'brightness-set': {dataschema: `${SCHEMA_BASE}brightness-set/2.0`, entity: 'org.bunny.brightness.set', operation: 'brightness', sent: 'brightness'},
  'device-mode-set': {dataschema: `${SCHEMA_BASE}device-mode-set/2.0`, entity: 'org.bunny.device-mode.set', operation: 'mode', sent: 'mode'},
  'lifx-color-set': {dataschema: LIFX_COLOR_SET_SCHEMA, entity: 'org.bunny.lifx-color.set', sent: 'color'},
  'lifx-temperature-set': {dataschema: LIFX_TEMPERATURE_SET_SCHEMA, entity: 'org.bunny.lifx-temperature.set', sent: 'temperature'},
};
const isFamily = (value: string): value is CommandFamily => COMMAND_FAMILIES.some(family => family === value);

const UNSUPPORTED = {supported: false} as const;
const NO_CONTROLS: Capabilities = {
  power: UNSUPPORTED, brightness: UNSUPPORTED, modes: UNSUPPORTED, moments: UNSUPPORTED, media: UNSUPPORTED, scenes: UNSUPPORTED, zones: UNSUPPORTED,
  preview: UNSUPPORTED,
};
const QUALIFIED: Capabilities = {
  ...NO_CONTROLS, power: {supported: true}, brightness: {supported: true, minimum: 0, maximum: 100}, modes: {supported: true, values: [...NATIVE_MODES]},
};

/** The real network: one UDP transport per configured address, on the LAN's unicast port 56700. */
export const udpNetwork: LifxNetwork = {connect: address => new UdpTransport({address})};

export type LifxModuleOptions = {
  /** How the module reaches its bulbs: `udpNetwork`, or `SimulatedLifx` in tests and disposable runs. */
  transport: LifxNetwork;
  /**
   * Follows the core's acknowledgments of the module's outcomes, so its outbox forgets each one the core took. The core's
   * acknowledgment belongs to Hub #782; until then tests and the fixture core pass the kit's stand-in
   * (`followStandInAcks`), and the shipped module keeps its outcomes and sends them again at each start.
   */
  acknowledgments?: (sdk: Sdk, outbox: Pick<Outbox, 'acknowledge'>) => Promise<unknown>;
  /** Runs before each message leaves the outbox, with the message. A crash test ends the runtime here, after the commit. */
  beforePublish?: (message: Message<unknown>) => void;
};

type Bulb = {
  readonly config: LifxBulbConfig;
  readonly qualified: boolean;
  readonly caps: StatusCaps | undefined;
  /** The bulb's queue: only for a qualified bulb whose lease the module holds. */
  readonly queue: BulbQueue | undefined;
  readonly lease: Lease | undefined;
  availability: DeviceRecord['availability'];
  configurationRevision: number;
  mode: NativeMode | undefined;
  /** The shown key, kept across restarts so a restart paints nothing while the status stands. */
  shown: PaintKey | undefined;
  desired: {power: Tagged<boolean>; brightness: Tagged<number>};
  observed: Observation | undefined;
  /** Accepted commands without an outcome, by `<source> <requestId>`. */
  readonly pending: Map<string, CommandFamily>;
  lastOutcome: CompletedOutcome | undefined;
  lastTransmission: DeviceRecord['lastTransmission'];
  deviceRevision: number;
  lightRevision: number;
  /** When the last read began, which spaces on-demand reads. */
  readAtMs: number | undefined;
  probe: Cancel | undefined;
  probeDelayMs: number;
};

const UNKNOWN = {status: 'unknown'} as const;
const known = <T>(value: T): {status: 'known'; value: T} => ({status: 'known', value});
const percentOf = (wire: number): number => Math.round((wire * 100) / 65535);
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
};
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** A request ID as a record field, left out when the diagnostic contract's pattern refuses it. */
const requestField = (requestId: string): LogFields => REQUEST_ID.test(requestId) ? {'bunny.request.id': requestId} : {};
const storageCode = (error: unknown): ErrorCode =>
  typeof error === 'object' && error !== null && 'errcode' in error && error.errcode === SQLITE_FULL ? 'capacity' : 'internal';

/** The outcome of a command's device work, by ADR 0012 and MAPPING.md's receipt rule. */
function outcomeOf(requestId: string, attempt: Attempt): CompletedOutcome {
  if (attempt.effect === 'sent') return {requestId, result: 'succeeded', evidence: 'transmitted'};
  if (attempt.effect === 'possible') {
    return {requestId, result: 'uncertain', evidence: 'none', error: errorBody('uncertain-result', {detail: 'the write went out and the bulb did not acknowledge it'}).error};
  }
  const failed = (code: ErrorCode, detail: string): CompletedOutcome => ({requestId, result: 'failed', evidence: 'none', error: errorBody(code, {detail}).error});
  if (attempt.failure === 'cancelled') return failed('cancelled', 'the module stopped before the command reached the bulb');
  if (attempt.failure === 'expired') return failed('expired', 'the command\'s deadline passed before it reached the bulb');
  return failed('unavailable', 'the bulb did not answer');
}

/** What the device work of a command is. A mode change sends nothing: it waits for its turn, then commits. */
function operationOf(family: CommandFamily, data: Record<string, unknown>): Operation {
  switch (family) {
    case 'power-set': return {kind: 'power', on: data.on === true};
    case 'brightness-set': return {kind: 'brightness', percent: Number(data.percent)};
    case 'lifx-color-set': return {kind: 'color', hue: Number(data.hue), saturation: Number(data.saturation)};
    case 'lifx-temperature-set': return {kind: 'temperature', kelvin: Number(data.kelvin)};
    case 'device-mode-set': return {kind: 'turn'};
  }
}

/** Creates the LIFX module with `transport`; its bulbs, their addresses and its bounds come from its section (#919). */
export function createLifxModule(options: LifxModuleOptions): BunnyModule<LifxConfig> {
  let run: LifxRun | undefined;
  return {
    manifest: {name: MODULE_NAME, apiVersion: '1.1', configure: configureLifx},
    async start(context) {
      // The runtime starts a module with `configure` only with what `configure` accepted.
      if (context.config === undefined) throw new Error('the LIFX module started without its configuration');
      run = new LifxRun(context, context.config, options);
      await run.open();
    },
    async stop() {
      await run?.stop();
    },
  };
}

/** One start of the module, from `start` to `stop`. */
class LifxRun {
  readonly #context: ModuleContext<LifxConfig>;
  readonly #config: LifxConfig;
  readonly #options: LifxModuleOptions;
  readonly #bulbs = new Map<string, Bulb>();
  /** Work the module started on its own, which its stop waits for, so outcomes commit before the database closes. */
  readonly #work = new Set<Promise<void>>();
  /** The bulbs' generation epoch for this start: a command guarded on another start's generation is refused. */
  readonly #epoch = randomUUID();
  readonly #availability: DeviceAvailability;
  #store: LifxStore | undefined;
  #outbox: Outbox | undefined;
  #revision = 0;
  #closing = false;
  /** The core's sessions: the copy once its first sync completed, and until then what its changes delivered. */
  #copy: SyncedCopy<SessionRecord> | undefined;
  readonly #sessions = new Map<string, SessionRecord>();
  #synced = false;
  #resync: Cancel | undefined;
  #resyncDelayMs = RESYNC_FIRST_MS;
  #feedDown = false;
  #storageDown: ErrorCode | undefined;

  constructor(context: ModuleContext<LifxConfig>, config: LifxConfig, options: LifxModuleOptions) {
    this.#context = context;
    this.#config = config;
    this.#options = options;
    this.#availability = new DeviceAvailability({log: context.log, clock: context.clock});
  }

  async open(): Promise<void> {
    const {sdk, log, clock, trace, database, files, signal} = this.#context;
    const db = database();
    const store = new LifxStore(db);
    this.#store = store;
    const {beforePublish} = this.#options;
    const outbox = new Outbox({
      sdk: beforePublish === undefined ? sdk : {source: sdk.source, publishMessage: (key, message) => {
        beforePublish(message);
        return sdk.publishMessage(key, message);
      }},
      database: db, clock, log, trace,
    });
    this.#outbox = outbox;
    this.#revision = store.revision() + 1;
    const leases = join(files(), 'leases');
    for (const config of this.#config.bulbs) this.#bulbs.set(config.id, this.#bulb(config, store, leases));
    signal.addEventListener('abort', () => { this.#close(); }, {once: true});

    // Follow the core's acknowledgments first, so a resent outcome's acknowledgment is heard; then send what is stored.
    if (this.#options.acknowledgments !== undefined) {
      await this.#options.acknowledgments(sdk, {acknowledge: id => {
        const forgot = outbox.acknowledge(id);
        if (forgot) log.info('outbox.acknowledged', {'bunny.message.id': id});
        return forgot;
      }});
    }
    log.info('outbox.republished', {'bunny.outbox.republished_count': await outbox.republish()});
    await this.#settle();

    await sdk.serveSync(['device', 'lifx-light'], request => this.#snapshot(request.data.families));
    for (const bulb of this.#bulbs.values()) {
      for (const family of COMMAND_FAMILIES) await sdk.respond(`bunny.cmd.${family}.${bulb.config.id}`, command => this.#command(bulb, family, command));
    }
    await this.#follow();
    // Reach each qualified bulb once, read-only, to learn whether it answers. This never writes to a bulb.
    for (const bulb of this.#bulbs.values()) this.#scheduleProbe(bulb, 0);
  }

  async stop(): Promise<void> {
    this.#close();
    while (this.#work.size > 0) await Promise.allSettled([...this.#work]);
    for (const bulb of this.#bulbs.values()) bulb.lease?.release();
  }

  /** Stops admitting work: the bulbs' queues close, so what waits sends nothing and what is in flight ends. */
  #close(): void {
    if (this.#closing) return;
    this.#closing = true;
    this.#cancel(this.#resync);
    for (const bulb of this.#bulbs.values()) {
      this.#cancel(bulb.probe);
      if (bulb.queue !== undefined) this.#track(bulb.queue.close());
    }
  }

  #cancel(cancel: Cancel | undefined): void {
    try {
      cancel?.();
    } catch {
      // A timer the runtime already cancelled.
    }
  }

  #bulb(config: LifxBulbConfig, store: LifxStore, leases: string): Bulb {
    const {log, clock, scheduler} = this.#context;
    const isQualified = qualified(config);
    let row: BulbRow | undefined;
    try {
      row = store.bulb(config.id);
      if (row === undefined) store.seed(config.id, isQualified ? config.initialMode ?? 'free' : undefined);
    } catch (error) {
      this.#storageFailed(storageCode(error));
    }
    const lease = acquireLease(leases, config.address);
    if (lease === undefined) log.warn('operation.failed', {'bunny.device.id': config.id, 'bunny.operation': 'startup', 'bunny.reason': 'busy'});
    const queue = isQualified && lease !== undefined ? new BulbQueue({
      transport: this.#options.transport.connect(config.address), timeoutMs: this.#config.timeoutMs, retries: this.#config.retries,
      maxPending: this.#config.maxPending, now: () => clock.now(), scheduler,
    }) : undefined;
    return {
      config, qualified: isQualified, caps: config.status, queue, lease, availability: lease === undefined ? 'unavailable' : 'unknown',
      configurationRevision: row?.configurationRevision ?? 0, mode: isQualified ? row?.mode ?? config.initialMode ?? 'free' : undefined,
      shown: row?.shown, desired: {power: UNKNOWN, brightness: UNKNOWN}, observed: undefined, pending: new Map(), lastOutcome: undefined,
      lastTransmission: UNKNOWN, deviceRevision: this.#revision, lightRevision: this.#revision, readAtMs: undefined, probe: undefined,
      probeDelayMs: PROBE_FIRST_MS,
    };
  }

  // Records

  #device(bulb: Bulb): StateDraft<DeviceRecord> {
    const {observed} = bulb;
    const kinds = [...new Set(bulb.pending.values())];
    const record: DeviceRecord = {
      id: bulb.config.id, revision: bulb.deviceRevision, kind: 'lifx', availability: bulb.availability,
      configurationRevision: bulb.configurationRevision, generation: {epoch: this.#epoch, sequence: 0},
      capabilities: bulb.qualified ? QUALIFIED : NO_CONTROLS,
      desired: {...bulb.desired, mode: bulb.mode === undefined ? UNKNOWN : known(bulb.mode)},
      observed: observed === undefined ? UNKNOWN : {
        status: 'known', observedAtMs: observed.atMs, power: known(observed.state.power), brightness: known(percentOf(observed.state.color.brightness)),
      },
      pending: bulb.pending.size, pendingKinds: kinds,
      lastOutcome: bulb.lastOutcome === undefined ? UNKNOWN : {status: 'known', outcome: bulb.lastOutcome},
      lastTransmission: bulb.lastTransmission, externalControl: UNKNOWN,
    };
    return {type: 'org.bunny.device.updated', subject: bulb.config.id, dataschema: DEVICE_SCHEMA, data: record};
  }

  #light(bulb: Bulb): StateDraft<LifxLight> {
    const color = bulb.observed?.state.color;
    const light: LifxLight = {
      id: bulb.config.id, revision: bulb.lightRevision,
      capabilities: {color: {supported: bulb.qualified}, temperature: bulb.qualified ? {supported: true, minimum: 1500, maximum: 9000} : UNSUPPORTED},
      observed: color === undefined || bulb.observed === undefined ? UNKNOWN : {
        status: 'known', observedAtMs: bulb.observed.atMs, hue: Math.round((color.hue * 360) / 65535), saturation: percentOf(color.saturation),
        brightness: percentOf(color.brightness), kelvin: color.kelvin,
      },
    };
    return {type: 'org.bunny.lifx-light.updated', subject: bulb.config.id, dataschema: LIFX_LIGHT_SCHEMA, data: light};
  }

  /**
   * The module's records of the requested families at its current revision. A read of them also starts an on-demand
   * read of a stale bulb.
   */
  #snapshot(families: readonly string[]): Snapshot | ErrorBody {
    if (this.#closing) return errorBody('unavailable', {detail: 'the LIFX module is stopping'});
    this.#readOnDemand();
    const bulbs = [...this.#bulbs.values()];
    return {
      revision: this.#revision,
      states: [
        ...(families.includes('device') ? bulbs.map(bulb => this.#device(bulb)) : []), ...(families.includes('lifx-light') ? bulbs.map(bulb => this.#light(bulb)) : []),
      ],
    };
  }

  /** Adds the bulb's records at a new revision to a transaction. */
  #records(add: AddMessage, bulb: Bulb, light: boolean, parent: TraceContext | undefined): void {
    this.#revision += 1;
    this.#store?.setRevision(this.#revision);
    bulb.deviceRevision = this.#revision;
    const options = parent === undefined ? undefined : {parent};
    add(`bunny.state.device.${bulb.config.id}`, {kind: 'state', ...this.#device(bulb)}, options);
    if (light) {
      bulb.lightRevision = this.#revision;
      add(`bunny.state.lifx-light.${bulb.config.id}`, {kind: 'state', ...this.#light(bulb)}, options);
    }
  }

  /**
   * Runs `work` in one transaction of the module's database and outbox, and publishes what it added after the commit.
   * Answers undefined once it committed, or the registry code of a store that refused it: `capacity` for a full disk.
   */
  async #transaction(work: (add: AddMessage) => void): Promise<ErrorCode | undefined> {
    const outbox = this.#outbox;
    if (outbox === undefined) return 'internal';
    try {
      await outbox.transaction(add => { work(add); });
    } catch (error) {
      const code = storageCode(error);
      this.#storageFailed(code);
      return code;
    }
    if (this.#storageDown !== undefined) {
      this.#storageDown = undefined;
      this.#context.log.info('operation.completed', {'bunny.operation': 'storage', 'bunny.outcome': 'succeeded'});
    }
    return undefined;
  }

  /** One record per run of store failures, not one per attempt. */
  #storageFailed(code: ErrorCode): void {
    if (this.#storageDown === code) return;
    this.#storageDown = code;
    const level = code === 'internal' ? 'error' : 'warn';
    this.#context.log[level]('operation.failed', {'bunny.operation': 'storage', 'bunny.code': code});
  }

  async #publish(bulb: Bulb, light: boolean, parent: TraceContext | undefined): Promise<void> {
    await this.#transaction(add => { this.#records(add, bulb, light, parent); });
  }

  // Commands

  async #command(bulb: Bulb, family: CommandFamily, command: Command<Record<string, unknown>>): Promise<Reply> {
    const {store} = this;
    const spec = COMMANDS[family];
    // A refusal here proves no effect: nothing has been stored or sent.
    if (command.dataschema !== spec.dataschema) return errorBody('invalid-request', {detail: 'the command is not of the family its key names'});
    const checked = lifxValidator().validate(command);
    if (!checked.ok) return errorBody(checked.error.code, {detail: 'the command does not match its family\'s schema'});
    if (command.subject !== bulb.config.id) return errorBody('invalid-request', {detail: 'the command\'s subject is not the bulb its key names'});
    const {data} = command;
    const {requestId} = data;
    const digest = createHash('sha256').update(canonical({family, subject: command.subject, data})).digest('hex');
    let earlier;
    try {
      earlier = store.request(command.source, requestId);
    } catch (error) {
      return errorBody(storageCode(error), {detail: 'the module could not read its records'});
    }
    // A repeat of a command the module accepted changes nothing: its outcome goes out once.
    if (earlier !== undefined) {
      return earlier.digest === digest ? {status: 'accepted'} : errorBody('duplicate-conflict', {detail: 'the requestId was used for another command'});
    }
    const {expectedConfigurationRevision: revision, expectedGeneration: generation} = data as {expectedConfigurationRevision?: number; expectedGeneration?: {epoch: string; sequence: number}};
    if (revision !== undefined && revision !== bulb.configurationRevision) {
      return errorBody('revision-conflict', {detail: 'the bulb\'s configuration revision has moved on; read its record again'});
    }
    if (generation !== undefined && (generation.epoch !== this.#epoch || generation.sequence !== 0)) {
      return errorBody('revision-conflict', {detail: 'the bulb\'s generation has moved on; read its record again'});
    }
    if (!this.#supports(bulb, family, data)) return errorBody('unsupported-capability', {detail: 'the bulb does not offer this operation'});
    if (bulb.queue === undefined) return errorBody('unavailable', {detail: 'another writer holds the bulb'});
    if (this.#closing) return errorBody('unavailable', {detail: 'the LIFX module is stopping'});
    const reservation = bulb.queue.reserve();
    if (reservation === undefined) return errorBody('capacity', {detail: 'the bulb\'s queue is full'});

    // Store the accepted command before replying, with the record that shows it pending.
    const key = `${command.source} ${requestId}`;
    const before = {configurationRevision: bulb.configurationRevision, desired: bulb.desired};
    const refused = await this.#transaction(add => {
      store.accept({source: command.source, requestId, digest, bulb: bulb.config.id, family, traceparent: command.traceparent});
      bulb.configurationRevision += 1;
      if (family === 'power-set') bulb.desired = {...bulb.desired, power: known(data.on === true)};
      if (family === 'brightness-set') bulb.desired = {...bulb.desired, brightness: known(Number(data.percent))};
      bulb.pending.set(key, family);
      store.setBulb(this.#row(bulb));
      this.#records(add, bulb, false, command);
    });
    if (refused !== undefined) {
      bulb.configurationRevision = before.configurationRevision;
      bulb.desired = before.desired;
      bulb.pending.delete(key);
      reservation.release();
      return errorBody(refused, {detail: refused === 'capacity' ? 'the module\'s store is full' : 'the module could not store the command'});
    }
    this.#track(this.#carryOut(bulb, family, command, reservation));
    return {status: 'accepted'};
  }

  get store(): LifxStore {
    if (this.#store === undefined) throw new Error('the LIFX store is not open');
    return this.#store;
  }

  #row(bulb: Bulb): BulbRow {
    return {id: bulb.config.id, configurationRevision: bulb.configurationRevision, mode: bulb.mode, shown: bulb.shown};
  }

  #supports(bulb: Bulb, family: CommandFamily, data: Record<string, unknown>): boolean {
    const capabilities = bulb.qualified ? QUALIFIED : NO_CONTROLS;
    switch (family) {
      case 'lifx-color-set':
      case 'lifx-temperature-set':
        return bulb.qualified;
      case 'power-set':
      case 'brightness-set':
      case 'device-mode-set':
        return commandSupported(capabilities, {family, data} as DeviceCommand);
    }
  }

  /** The accepted command's work, in its bulb's turn, and its outcome, stored with the records it changes. */
  async #carryOut(bulb: Bulb, family: CommandFamily, command: Command<Record<string, unknown>>, reservation: Reservation): Promise<void> {
    const {log, trace} = this.#context;
    const {store} = this;
    const {requestId} = command.data;
    const spec = COMMANDS[family];
    const fields: LogFields = {
      'bunny.device.id': bulb.config.id, ...requestField(requestId), 'bunny.routing.key': `bunny.cmd.${family}.${bulb.config.id}`,
      ...(spec.operation === undefined ? {} : {'bunny.operation': spec.operation}),
    };
    const deadline = Date.parse(command.expiresat ?? '');
    const within = Number.isNaN(deadline) ? {} : {deadlineMs: deadline};
    let attempt: Attempt;
    if (family === 'device-mode-set') {
      attempt = await reservation.run({kind: 'turn'}, within);
    } else {
      // The work is marked begun in its turn, just before its write goes out, so after a crash a command still waiting in
      // the queue, or one that only read the bulb, is reported failed, and only one whose write may have gone out is
      // uncertain. A store that cannot mark it ends the command with no effect.
      let unrecorded: ErrorCode = 'internal';
      const beforeWrite = (): boolean => {
        try {
          store.setState(command.source, requestId, 'started');
          return true;
        } catch (error) {
          unrecorded = storageCode(error);
          this.#storageFailed(unrecorded);
          return false;
        }
      };
      log.info('command.executing', fields, command);
      const call = trace.start('bunny.device.call', {parent: command, kind: 'client', attributes: fields});
      attempt = await reservation.run(operationOf(family, command.data), {...within, beforeWrite});
      call.end(attempt.failure === undefined ? 'unset' : 'error');
      this.#observe(bulb, attempt, spec.sent, requestId, call.context);
      if (attempt.failure === 'unrecorded') {
        const error = errorBody(unrecorded, {detail: 'the module could not record the work before it began'}).error;
        await this.#complete(bulb, family, command, {requestId, result: 'failed', evidence: 'none', error}, attempt.observed !== undefined);
        return;
      }
    }
    if (family === 'device-mode-set' && attempt.failure === undefined) {
      log.info('command.executing', fields, command);
      await this.#changeMode(bulb, command);
      return;
    }
    await this.#complete(bulb, family, command, outcomeOf(requestId, attempt), attempt.observed !== undefined);
  }

  /** A mode change and its outcome commit together; entering any mode paints the current status once, as before. */
  async #changeMode(bulb: Bulb, command: Command<Record<string, unknown>>): Promise<void> {
    const before = {mode: bulb.mode, shown: bulb.shown};
    const mode = NATIVE_MODES.find(value => value === command.data.mode) ?? 'free';
    bulb.mode = mode;
    bulb.shown = undefined;
    const committed = await this.#complete(bulb, 'device-mode-set', command, {requestId: command.data.requestId, result: 'succeeded', evidence: 'transmitted'}, false);
    if (!committed) {
      bulb.mode = before.mode;
      bulb.shown = before.shown;
      return;
    }
    this.#evaluate(command);
  }

  /** Stores the command's outcome with the bulb's records, and publishes both after the commit. Answers whether it committed. */
  async #complete(bulb: Bulb, family: CommandFamily, command: Command<Record<string, unknown>>, outcome: CompletedOutcome, light: boolean): Promise<boolean> {
    const {store} = this;
    const key = `${command.source} ${outcome.requestId}`;
    const before = bulb.lastOutcome;
    const refused = await this.#transaction(add => {
      store.setState(command.source, outcome.requestId, 'done');
      bulb.pending.delete(key);
      bulb.lastOutcome = outcome;
      store.setBulb(this.#row(bulb));
      this.#records(add, bulb, light, command);
      add(`bunny.event.${family}.${bulb.config.id}`, {
        kind: 'outcome', type: `${COMMANDS[family].entity}.completed`, subject: bulb.config.id, dataschema: OUTCOME_SCHEMA, data: outcome,
      }, {parent: command});
    });
    if (refused === undefined) return true;
    // Not stored: the command stays pending in the module's records, and the next start reports it.
    bulb.pending.set(key, family);
    bulb.lastOutcome = before;
    return false;
  }

  /**
   * Reports, at start, each command a stop or a crash left without a stored outcome: `uncertain` when its write may have
   * begun, and `failed` with `cancelled` when the records prove it never did. None runs again. Only the commands of bulbs
   * whose lease this instance holds are its to report: another instance on the same state directory that holds a bulb's
   * lease still has that bulb's commands in hand, and reports them itself.
   */
  async #settle(): Promise<void> {
    const {store} = this;
    let rows;
    try {
      rows = store.unfinished().filter(row => this.#bulbs.get(row.bulb)?.lease !== undefined);
    } catch (error) {
      this.#storageFailed(storageCode(error));
      return;
    }
    if (rows.length === 0) return;
    await this.#transaction(add => {
      for (const row of rows) {
        store.setState(row.source, row.requestId, 'done');
        if (!isFamily(row.family)) continue;
        const begun = row.state === 'started' && row.family !== 'device-mode-set';
        const outcome: CompletedOutcome = begun
          ? {requestId: row.requestId, result: 'uncertain', evidence: 'none', error: errorBody('uncertain-result', {detail: 'the runtime stopped while the write was under way'}).error}
          : {requestId: row.requestId, result: 'failed', evidence: 'none', error: errorBody('cancelled', {detail: 'the runtime stopped before the command reached the bulb'}).error};
        add(`bunny.event.${row.family}.${row.bulb}`, {
          kind: 'outcome', type: `${COMMANDS[row.family].entity}.completed`, subject: row.bulb, dataschema: OUTCOME_SCHEMA, data: outcome,
        }, {parent: {traceparent: row.traceparent}});
      }
    });
  }

  // Reaching bulbs

  /** Applies what a job saw: the reading, a transmission, and whether the bulb answered. */
  #observe(bulb: Bulb, attempt: Attempt, sent: string | undefined, requestId: string | undefined, trace: TraceContext): void {
    if (attempt.observed !== undefined) bulb.observed = attempt.observed;
    if (attempt.effect === 'sent' && attempt.transmittedAtMs !== undefined && sent !== undefined) {
      bulb.lastTransmission = {status: 'known', ...(requestId === undefined ? {} : {requestId}), transmittedAtMs: attempt.transmittedAtMs, operationIds: [sent]};
    }
    if (attempt.failure === 'unreachable') {
      bulb.availability = 'unavailable';
      this.#availability.unreachable(bulb.config.id, 'unavailable', trace);
      this.#scheduleProbe(bulb, bulb.probeDelayMs);
    } else if (attempt.failure === undefined) {
      bulb.availability = 'available';
      this.#availability.reached(bulb.config.id, trace);
      this.#cancel(bulb.probe);
      bulb.probe = undefined;
      bulb.probeDelayMs = PROBE_FIRST_MS;
    }
  }

  /** One read-only LightGet through the bulb's queue, and the records it changes. Answers whether the bulb answered. */
  async #read(bulb: Bulb): Promise<boolean> {
    const {trace, clock} = this.#context;
    bulb.readAtMs = clock.now();
    const run = bulb.queue?.run({kind: 'read'});
    // A full or closed queue skips the read; a later one tries again.
    if (run === undefined) return false;
    const call = trace.start('bunny.device.call', {kind: 'client', attributes: {'bunny.device.id': bulb.config.id, 'bunny.operation': 'snapshot'}});
    const attempt = await run;
    call.end(attempt.failure === undefined ? 'unset' : 'error');
    if (attempt.failure === 'cancelled') return false;
    const before = bulb.availability;
    this.#observe(bulb, attempt, undefined, undefined, call.context);
    // An unanswered read of a bulb already known to be unavailable changes nothing, so it publishes nothing.
    if (attempt.failure === undefined || before !== bulb.availability) await this.#publish(bulb, attempt.observed !== undefined, call.context);
    return attempt.failure === undefined;
  }

  /** Reads a qualified bulb after `delayMs`, and again with a doubling wait while it does not answer. */
  #scheduleProbe(bulb: Bulb, delayMs: number): void {
    if (this.#closing || bulb.queue === undefined || bulb.probe !== undefined) return;
    try {
      bulb.probe = this.#context.scheduler.after(delayMs, () => {
        bulb.probe = undefined;
        this.#track(this.#read(bulb).then(() => {}));
      });
      if (delayMs > 0) bulb.probeDelayMs = Math.min(PROBE_MAX_MS, delayMs * 2);
    } catch {
      // The module is stopping, and its timers refuse use.
    }
  }

  /** An on-demand read of each available qualified bulb whose reading is missing or stale, at most once a `READ_INTERVAL_MS`. */
  #readOnDemand(): void {
    const now = this.#context.clock.now();
    for (const bulb of this.#bulbs.values()) {
      if (bulb.queue === undefined || bulb.probe !== undefined || bulb.availability === 'unavailable') continue;
      if (bulb.observed !== undefined && now - bulb.observed.atMs < READ_INTERVAL_MS) continue;
      if (bulb.readAtMs !== undefined && now - bulb.readAtMs < READ_INTERVAL_MS) continue;
      this.#track(this.#read(bulb).then(() => {}));
    }
  }

  // Automatic agent status

  /** Syncs the core's sessions. A sync the core refuses leaves the status unknown, and the module syncs again later. */
  async #follow(): Promise<void> {
    if (this.#closing) return;
    this.#resync = undefined;
    this.#sessions.clear();
    this.#synced = false;
    let result;
    try {
      result = await this.#context.sdk.sync<SessionRecord>(['session'], change => { this.#sessionChanged(change); }, {timeoutMs: SYNC_TIMEOUT_MS});
    } catch {
      // The module is stopping, and its participant refuses use.
      return;
    }
    if (result.status === 'rejected') {
      this.#feedLost(result.error.error.code);
      return;
    }
    this.#copy = result.copy;
    this.#resyncDelayMs = RESYNC_FIRST_MS;
    if (this.#feedDown) {
      this.#feedDown = false;
      this.#context.log.info('operation.completed', {'bunny.operation': 'feed', 'bunny.outcome': 'succeeded'});
    }
  }

  #sessionChanged(change: SyncChange<SessionRecord>): void {
    switch (change.type) {
      case 'updated':
        this.#sessions.set(change.entity.id, change.message.data);
        break;
      case 'removed':
        this.#sessions.delete(change.entity.id);
        break;
      case 'synced':
        this.#synced = true;
        break;
      case 'failed':
        // The copy stopped following the core: the status is unknown, which paints nothing, until a new sync.
        this.#synced = false;
        this.#copy = undefined;
        this.#feedLost(change.error.error.code);
        return;
    }
    if (this.#synced) this.#evaluate(change.message);
  }

  #feedLost(code: ErrorCode): void {
    if (!this.#feedDown) {
      this.#feedDown = true;
      this.#context.log.warn('operation.failed', {'bunny.operation': 'feed', 'bunny.code': code});
    }
    if (this.#closing || this.#resync !== undefined) return;
    const delayMs = this.#resyncDelayMs;
    this.#resyncDelayMs = Math.min(RESYNC_MAX_MS, delayMs * 2);
    try {
      this.#resync = this.#context.scheduler.after(delayMs, () => { this.#track(this.#follow()); });
    } catch {
      // The module is stopping.
    }
  }

  /** The sessions as the core holds them: the whole copy once it exists, so a resync is never seen half applied. */
  #currentSessions(): SessionRecord[] {
    return this.#copy === undefined ? [...this.#sessions.values()] : this.#copy.states().map(message => message.data);
  }

  /**
   * Paints each status bulb whose shown key changes: only on a transition, in Work or Quiet, never in Free and never while
   * the status is unknown. The shown key advances to the target whatever the paint's result, so a failed paint is not
   * repeated; the next transition paints the current status.
   */
  #evaluate(parent: TraceContext | undefined): void {
    if (this.#closing) return;
    const status = highestStatus({synced: this.#synced, sessions: this.#currentSessions()});
    for (const bulb of this.#bulbs.values()) {
      if (bulb.queue === undefined || bulb.caps === undefined || bulb.mode === undefined) continue;
      const key = shownKey(bulb.mode, status);
      if (key === undefined || key === bulb.shown) continue;
      bulb.shown = key;
      try {
        this.store.setBulb(this.#row(bulb));
      } catch (error) {
        this.#storageFailed(storageCode(error));
      }
      this.#context.log.info('feed.changed', {'bunny.device.id': bulb.config.id, 'bunny.operation': 'status'}, parent);
      const paint = paintFor(key, bulb.mode, bulb.caps);
      if (paint !== undefined) this.#track(this.#paint(bulb, paint, parent));
    }
  }

  async #paint(bulb: Bulb, hsbk: Hsbk, parent: TraceContext | undefined): Promise<void> {
    const run = bulb.queue?.run({kind: 'paint', hsbk});
    // A paint that finds the queue full is a failed attempt, never repeated.
    if (run === undefined) return;
    const call = this.#context.trace.start('bunny.device.call', {
      kind: 'client', attributes: {'bunny.device.id': bulb.config.id, 'bunny.operation': 'status'}, ...(parent === undefined ? {} : {parent}),
    });
    const attempt = await run;
    call.end(attempt.failure === undefined ? 'unset' : 'error');
    if (attempt.failure === 'cancelled') return;
    this.#observe(bulb, attempt, 'status', undefined, call.context);
    await this.#publish(bulb, false, call.context);
  }

  /** Work the module runs on its own. An error that escapes it is the module's fault: it is logged once, by type. */
  #track(work: Promise<void>): void {
    const tracked = work.catch((error: unknown) => {
      this.#context.log.error('operation.failed', {'bunny.code': 'internal', 'error.type': errorType(error)});
    });
    this.#work.add(tracked);
    void tracked.finally(() => { this.#work.delete(tracked); });
  }
}

/** Whether a message is a LIFX bulb's device record that reports it unavailable, for the module test kit's policy A check. */
export const reportsUnavailable = (message: Message): boolean =>
  message.dataschema === DEVICE_SCHEMA && message.source === `bunny/modules/${MODULE_NAME}` && (message.data as Partial<DeviceRecord>).availability === 'unavailable';
