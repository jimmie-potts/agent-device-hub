// The Tronbyt display's controls (Hub #23): the `brightness-set` and `device-mode-set` commands the cloud backend refuses,
// and the pin the display's mode asks for. The modes are the device's native ones in the shared `device/2.0` record, so
// the shared contract does not change:
// - `rotation`, the default: both tiles take their turn, and a push waits for it, as on the cloud;
// - `interrupt`: a tile's push interrupts the display at once;
// - `pin-<tile>`: the server shows only that tile while it stands, and the rotation when it does not;
// - `hide-<tile>`: that tile leaves the rotation, and the module writes it no frame until another mode returns it.
// Commands follow ADR 0012 as the LIFX module's do: stored before they are accepted, one write in the queue's turn, never
// sent again, with an outcome stored with the record it changes. A stop or a crash leaves them to the next start's
// `settleRequests`. Evidence stays `transmitted` at most: a server's answer says what it stored, never what the panel shows.
import {createHash} from 'node:crypto';
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {MessageValidator, SCHEMA_BASE, errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {registerDeviceFamilies, type Capabilities, type CompletedOutcome, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {fullDisk, recordLog, type AddMessage, type Command, type LogFields, type ModuleContext, type Reply, type TraceContext, Outcome} from '@jimmie-potts/sdk';
import type {WriteResult} from './cloud.js';
import type {TronbytConnection} from './tronbyt.js';
import type {CloudQueue, NotSent} from './writer.js';

export type TileName = 'status' | 'now-playing';
export const CONTROL_FAMILIES = ['brightness-set', 'device-mode-set'] as const;
export type ControlFamily = (typeof CONTROL_FAMILIES)[number];
export const isControlFamily = (family: string): family is ControlFamily => CONTROL_FAMILIES.some(entry => entry === family);
export const DEFAULT_MODE = 'rotation';
/** How many accepted commands may wait, so a burst of them stays bounded. */
export const MAX_PENDING = 8;
/** How many completed commands the module remembers, so a repeat of one is accepted again without a second effect. */
export const REMEMBERED = 256;
/** The wait before the display's pin is written again after a write that failed. */
export const PIN_RETRY_MS = 60_000;

const OUTCOME_SCHEMA = `${SCHEMA_BASE}outcome/2.0`;
const COMMANDS: Readonly<Record<ControlFamily, {dataschema: string; entity: string; operation: 'brightness' | 'mode'}>> = {
  'brightness-set': {dataschema: `${SCHEMA_BASE}brightness-set/2.0`, entity: 'org.bunny.brightness.set', operation: 'brightness'},
  'device-mode-set': {dataschema: `${SCHEMA_BASE}device-mode-set/2.0`, entity: 'org.bunny.device-mode.set', operation: 'mode'},
};
const UNSUPPORTED = {supported: false} as const;
const UNKNOWN = {status: 'unknown'} as const;
const known = <T>(value: T): {status: 'known'; value: T} => ({status: 'known', value});
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const requestField = (requestId: string): LogFields => REQUEST_ID.test(requestId) ? {'bunny.request.id': requestId} : {};
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
};

let shared: MessageValidator | undefined;
function validator(): MessageValidator {
  if (shared === undefined) {
    shared = new MessageValidator();
    registerCoreFamilies(shared);
    registerDeviceFamilies(shared);
  }
  return shared;
}

/** The native modes a section offers: without a now-playing tile, there is nothing to pin or hide but the status tile. */
export function displayModes(nowPlaying: boolean): string[] {
  return [DEFAULT_MODE, 'interrupt', 'pin-status', 'hide-status', ...(nowPlaying ? ['pin-now-playing', 'hide-now-playing'] : [])];
}
const pinnedTile = (mode: string): TileName | undefined => mode === 'pin-status' ? 'status' : mode === 'pin-now-playing' ? 'now-playing' : undefined;

/** What the Tronbyt backend offers. Every capability not listed stays unsupported, and the cloud's stay all unsupported. */
export function displayCapabilities(nowPlaying: boolean): Capabilities {
  return {
    power: UNSUPPORTED, brightness: {supported: true, minimum: 0, maximum: 100}, modes: {supported: true, values: displayModes(nowPlaying)}, moments: UNSUPPORTED,
    media: UNSUPPORTED, scenes: UNSUPPORTED, zones: UNSUPPORTED, preview: UNSUPPORTED,
  };
}

/** How the display's pin stands on the server: set, clear, or not known since a write that may not have taken effect. */
type PinState = 'pinned' | 'none' | 'dirty';
type Display = {mode: string; brightness: number | undefined; pin: PinState; configurationRevision: number};
/** The one display row: renaming the device changes neither the display nor its backend. */
const DISPLAY_ROW = 'selected';
type RequestRow = {source: string; requestId: string; digest: string; family: string; state: string; traceparent: string};

/** The module's stored display and its record of each command it accepted, in its own SQLite file. */
export class ControlStore {
  readonly #display: StatementSync;
  readonly #setDisplay: StatementSync;
  readonly #clearDisplay: StatementSync;
  readonly #markPinUnknown: StatementSync;
  readonly #request: StatementSync;
  readonly #accept: StatementSync;
  readonly #setState: StatementSync;
  readonly #unfinished: StatementSync;
  readonly #forget: StatementSync;

  constructor(database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS tidbyt_display (
        id TEXT PRIMARY KEY, mode TEXT NOT NULL, brightness INTEGER, pin TEXT NOT NULL, configuration_revision INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS tidbyt_requests (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, family TEXT NOT NULL,
        state TEXT NOT NULL, traceparent TEXT NOT NULL, UNIQUE (source, request_id)) STRICT`);
    this.#display = database.prepare('SELECT mode, brightness, pin, configuration_revision FROM tidbyt_display WHERE id = ?');
    this.#setDisplay = database.prepare(`INSERT INTO tidbyt_display (id, mode, brightness, pin, configuration_revision) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET mode = excluded.mode, brightness = excluded.brightness, pin = excluded.pin, configuration_revision = excluded.configuration_revision`);
    this.#clearDisplay = database.prepare('DELETE FROM tidbyt_display');
    this.#markPinUnknown = database.prepare('UPDATE tidbyt_display SET pin = \'dirty\' WHERE id = ?');
    this.#request = database.prepare('SELECT source, request_id, digest, family, state, traceparent FROM tidbyt_requests WHERE source = ? AND request_id = ?');
    this.#accept = database.prepare('INSERT INTO tidbyt_requests (source, request_id, digest, family, state, traceparent) VALUES (?, ?, ?, ?, \'accepted\', ?)');
    this.#setState = database.prepare('UPDATE tidbyt_requests SET state = ? WHERE source = ? AND request_id = ?');
    this.#unfinished = database.prepare('SELECT source, request_id, digest, family, state, traceparent FROM tidbyt_requests WHERE state <> \'done\' ORDER BY seq');
    this.#forget = database.prepare(`DELETE FROM tidbyt_requests WHERE state = 'done' AND seq NOT IN (
      SELECT seq FROM tidbyt_requests WHERE state = 'done' ORDER BY seq DESC LIMIT ${REMEMBERED})`);
  }

  display(modes: readonly string[]): Display {
    const row = this.#display.get(DISPLAY_ROW) as {mode: string; brightness: number | null; pin: string; configuration_revision: number} | undefined;
    if (row === undefined) return {mode: DEFAULT_MODE, brightness: undefined, pin: 'none', configurationRevision: 0};
    // A mode the section no longer offers leaves the pin to the next evaluation to clear.
    const pin: PinState = row.pin === 'pinned' || row.pin === 'none' ? row.pin : 'dirty';
    return {mode: modes.includes(row.mode) ? row.mode : DEFAULT_MODE, brightness: row.brightness ?? undefined, pin, configurationRevision: row.configuration_revision};
  }

  setDisplay(display: Display): void {
    this.#setDisplay.run(DISPLAY_ROW, display.mode, display.brightness ?? null, display.pin, display.configurationRevision);
  }

  /** Forgets the display's stored state, as a handoff to another backend does: none of it is true of the next one. */
  clearDisplay(): void {
    this.#clearDisplay.run();
  }

  /** A pin write may have taken effect unanswered, so the pin is written again for the current mode. */
  markPinUnknown(): void {
    this.#markPinUnknown.run(DISPLAY_ROW);
  }

  request(source: string, requestId: string): RequestRow | undefined {
    const row = this.#request.get(source, requestId) as Record<string, string> | undefined;
    return row === undefined ? undefined : requestOf(row);
  }

  accept(source: string, requestId: string, digest: string, family: string, traceparent: string): void {
    this.#accept.run(source, requestId, digest, family, traceparent);
  }

  setState(source: string, requestId: string, state: 'started' | 'done'): void {
    this.#setState.run(state, source, requestId);
    if (state === 'done') this.#forget.run();
  }

  unfinished(): RequestRow[] {
    return (this.#unfinished.all() as Record<string, string>[]).map(requestOf);
  }
}

function requestOf(row: Record<string, string>): RequestRow {
  return {source: row.source ?? '', requestId: row.request_id ?? '', digest: row.digest ?? '', family: row.family ?? '', state: row.state ?? '', traceparent: row.traceparent ?? ''};
}

/**
 * Reports each command a stop or a crash left without a stored outcome: `uncertain` when its write may have begun, and
 * `failed` with `cancelled` when the records prove it never did. None runs again, on this backend or the next.
 */
export function settleRequests(store: ControlStore, device: string, add: AddMessage): void {
  for (const row of store.unfinished()) {
    store.setState(row.source, row.requestId, 'done');
    if (!isControlFamily(row.family)) continue;
    if (row.family === 'device-mode-set' && row.state === 'started') store.markPinUnknown();
    const outcome: CompletedOutcome = row.state === 'started'
      ? {requestId: row.requestId, result: Outcome.uncertain, evidence: Outcome.none, error: errorBody('uncertain-result', {detail: 'the runtime stopped while the write was under way'}).error}
      : {requestId: row.requestId, result: Outcome.failed, evidence: Outcome.none, error: errorBody('cancelled', {detail: 'the runtime stopped before the command reached the server'}).error};
    add(`bunny.event.${row.family}.${device}`, {
      kind: 'outcome', type: `${COMMANDS[row.family].entity}.completed`, subject: device, dataschema: OUTCOME_SCHEMA, data: outcome,
    }, {parent: {traceparent: row.traceparent}});
  }
}

export type DisplayControlOptions = {
  context: Pick<ModuleContext, 'clock' | 'log' | 'trace'>;
  device: string;
  store: ControlStore;
  nowPlaying: boolean;
  /** The tile's installation, or undefined for the connection's default one. */
  installationOf: (tile: TileName) => string | undefined;
  /** Whether the tile's installation is there, as far as its writer knows. */
  presence: (tile: TileName) => 'present' | 'absent' | 'unknown';
  /** Commits the record as `snapshot` shows it, with `extra` in the same transaction. Answers whether it committed. */
  commit: (parent: TraceContext | undefined, extra: (add: AddMessage) => void) => Promise<boolean>;
  /** Hears how a write ended, for the device's availability and last transmission. */
  reached: (result: WriteResult | NotSent, operationId: string, parent: TraceContext | undefined, requestId?: string) => void;
  /** The display's mode changed, so each tile should be evaluated again. */
  changed: (parent: TraceContext | undefined) => void;
  /** Whether the module stops, so an unfinished command is left to the next start's settling. */
  stopping: () => boolean;
  /** Keeps work the module's stop waits for. */
  track: (work: Promise<void>) => void;
  storageFailed: (error: unknown) => void;
};

/** The display's mode, brightness and pin, and the commands that change them. */
export class DisplayControl {
  readonly #options: DisplayControlOptions;
  readonly #modes: readonly string[];
  readonly #display: Display;
  readonly #pending = new Map<string, ControlFamily>();
  #lastOutcome: CompletedOutcome | undefined;
  #writes: {connection: TronbytConnection; queue: CloudQueue} | undefined;
  #reconciling = false;
  #retryPinAtMs = 0;
  #pinFailing = false;

  constructor(options: DisplayControlOptions) {
    this.#options = options;
    this.#modes = displayModes(options.nowPlaying);
    this.#display = options.store.display(this.#modes);
  }

  /** The connection and the queue, once the module holds the writer lease. Without them, every command is refused. */
  attach(connection: TronbytConnection, queue: CloudQueue): void {
    this.#writes = {connection, queue};
  }

  /** The part of the device record that this backend's controls decide. */
  snapshot(): Pick<DeviceRecord, 'capabilities' | 'desired' | 'pending' | 'pendingKinds' | 'lastOutcome' | 'configurationRevision'> {
    const {mode, brightness, configurationRevision} = this.#display;
    return {
      capabilities: displayCapabilities(this.#options.nowPlaying), configurationRevision, pending: this.#pending.size, pendingKinds: [...new Set(this.#pending.values())],
      desired: {power: UNKNOWN, brightness: brightness === undefined ? UNKNOWN : known(brightness), mode: known(mode)},
      lastOutcome: this.#lastOutcome === undefined ? UNKNOWN : {status: 'known', outcome: this.#lastOutcome},
    };
  }

  /** Whether the mode keeps this tile out of the rotation, so the module removes it and writes it no frame. */
  hides(tile: TileName): boolean {
    return this.#display.mode === `hide-${tile}`;
  }

  /** Whether a tile's push interrupts the display. */
  immediate(): boolean {
    return this.#display.mode === 'interrupt';
  }

  async handle(family: ControlFamily, command: Command<Record<string, unknown>>, epoch: string): Promise<Reply> {
    const {store, commit, track} = this.#options;
    const spec = COMMANDS[family];
    // A refusal here proves no effect: nothing has been stored or sent.
    if (command.dataschema !== spec.dataschema) return errorBody('invalid-request', {detail: 'the command is not of the family its key names'});
    const checked = validator().validate(command);
    if (!checked.ok) return errorBody(checked.error.code, {detail: 'the command does not match its family\'s schema'});
    const {data} = command;
    const {requestId} = data;
    const digest = createHash('sha256').update(canonical({family, subject: command.subject, data})).digest('hex');
    let earlier;
    try {
      earlier = store.request(command.source, requestId);
    } catch (error) {
      this.#options.storageFailed(error);
      return errorBody('unavailable', {detail: 'the module could not read its records'});
    }
    // A repeat of a command the module accepted changes nothing: its outcome goes out once.
    if (earlier !== undefined) {
      return earlier.digest === digest ? {status: 'accepted'} : errorBody('duplicate-conflict', {detail: 'the requestId was used for another command'});
    }
    const {expectedConfigurationRevision: revision, expectedGeneration: generation} = data as {expectedConfigurationRevision?: number; expectedGeneration?: {epoch: string; sequence: number}};
    if (revision !== undefined && revision !== this.#display.configurationRevision) {
      return errorBody('revision-conflict', {detail: 'the Tidbyt\'s configuration revision has moved on; read its record again'});
    }
    if (generation !== undefined && (generation.epoch !== epoch || generation.sequence !== 0)) {
      return errorBody('revision-conflict', {detail: 'the Tidbyt\'s generation has moved on; read its record again'});
    }
    if (family === 'device-mode-set' && !this.#modes.includes(String(data.mode))) return errorBody('unsupported-capability', {detail: 'the Tidbyt does not offer this mode'});
    if (this.#writes === undefined) return errorBody('unavailable', {detail: 'the module does not hold the Tidbyt\'s writer lease'});
    if (this.#options.stopping()) return errorBody('unavailable', {detail: 'the Tidbyt module is stopping'});
    if (this.#pending.size >= MAX_PENDING) return errorBody('capacity', {detail: 'too many commands wait for the Tidbyt'});

    // Store the accepted command before replying, with the record that shows it pending.
    const key = `${command.source} ${requestId}`;
    const before = {configurationRevision: this.#display.configurationRevision, brightness: this.#display.brightness};
    this.#display.configurationRevision += 1;
    if (family === 'brightness-set') this.#display.brightness = Number(data.percent);
    this.#pending.set(key, family);
    const accepted = await commit(command, () => {
      store.accept(command.source, requestId, digest, family, command.traceparent);
      store.setDisplay(this.#display);
    });
    if (!accepted) {
      Object.assign(this.#display, before);
      this.#pending.delete(key);
      return errorBody('unavailable', {detail: 'the module could not store the command'});
    }
    track(this.#carryOut(family, command, key));
    return {status: 'accepted'};
  }

  /** The accepted command's one write, in the queue's turn, and its outcome. */
  async #carryOut(family: ControlFamily, command: Command<Record<string, unknown>>, key: string): Promise<void> {
    const {context: {log, trace, clock}, store, device, stopping} = this.#options;
    const writes = this.#writes;
    if (writes === undefined) return;
    const {requestId} = command.data;
    const spec = COMMANDS[family];
    const fields: LogFields = {'bunny.device.id': device, ...requestField(requestId), 'bunny.routing.key': `bunny.cmd.${family}.${device}`, 'bunny.operation': spec.operation};
    const deadline = Date.parse(command.expiresat ?? '');
    let expired = false;
    const current = (): boolean => {
      if (!Number.isNaN(deadline) && clock.now() >= deadline) expired = true;
      return !expired;
    };
    let span: ReturnType<typeof trace.start> | undefined;
    // The write's turn came: a crash from here on leaves it uncertain.
    const sending = (): void => {
      store.setState(command.source, requestId, 'started');
      recordLog(log, 'command.executing', fields, command);
      span = trace.start('bunny.device.call', {parent: command, kind: 'client', attributes: fields});
    };
    const mode = family === 'device-mode-set' ? String(command.data.mode) : undefined;
    let pinning = false;
    let result: WriteResult | NotSent;
    let unrecorded: ErrorCode | undefined;
    try {
      result = await writes.queue.control(signal => {
        if (family === 'brightness-set') return writes.connection.setBrightness(Number(command.data.percent), signal);
        const tile = mode === undefined ? undefined : pinnedTile(mode);
        pinning = tile !== undefined && this.#options.presence(tile) === 'present';
        return tile !== undefined && pinning ? writes.connection.pin(signal, this.#options.installationOf(tile)) : writes.connection.unpin(signal);
      }, sending, current);
    } catch (error) {
      // The store refused to mark the write begun, so it never went out: the command ends with no effect, and this says
      // nothing about the server.
      this.#options.storageFailed(error);
      unrecorded = fullDisk(error) ? 'capacity' : 'internal';
      result = {outcome: 'cancelled'};
    }
    span?.end(result.outcome === 'sent' ? 'unset' : 'error');
    // A stop leaves the command to the next start, which reports what its stored state proves.
    if (stopping()) return;
    this.#options.reached(result, spec.operation, command, requestId);
    if (mode !== undefined) {
      if (result.outcome === 'sent') {
        this.#display.mode = mode;
        this.#display.pin = pinning ? 'pinned' : 'none';
      } else if (result.outcome === Outcome.uncertain) {
        this.#display.pin = 'dirty';
        this.#retryPinAtMs = clock.now() + PIN_RETRY_MS;
      }
    }
    const outcome: CompletedOutcome = unrecorded !== undefined ?
      {requestId, result: Outcome.failed, evidence: Outcome.none, error: errorBody(unrecorded, {detail: 'the module could not record the write before it began'}).error} :
      outcomeOf(requestId, result, expired);
    const previousOutcome = this.#lastOutcome;
    this.#pending.delete(key);
    this.#lastOutcome = outcome;
    recordLog(log, 'command.completed', {...fields, 'bunny.outcome': outcome.result, ...(outcome.error === undefined ? {} : {'bunny.code': outcome.error.code})}, command);
    // Not stored: the record stays as committed, and the next start reports the command from its stored state.
    const stored = await this.#options.commit(command, add => {
      store.setState(command.source, requestId, 'done');
      store.setDisplay(this.#display);
      add(`bunny.event.${family}.${device}`, {
        kind: 'outcome', type: `${spec.entity}.completed`, subject: device, dataschema: OUTCOME_SCHEMA, data: outcome,
      }, {parent: command});
    });
    if (!stored) {
      // The command stays pending in the module's records, and the next start reports it.
      this.#lastOutcome = previousOutcome;
      this.#pending.set(key, family);
    }
    if (mode !== undefined && result.outcome === 'sent') this.#options.changed(command);
  }

  /**
   * Brings the server's pin to what the mode asks once a tile's writes changed what stands. A pushed installation takes a
   * new server ID each time it comes back, and deleting a pinned one leaves the pin set, so the pin follows the tile. It
   * waits for commands in hand; a failed write is a fresh one later, never a replay.
   */
  async reconcile(): Promise<void> {
    const writes = this.#writes;
    const {clock, log, trace} = this.#options.context;
    if (writes === undefined || this.#reconciling || this.#pending.size > 0 || this.#options.stopping() || writes.queue.held()) return;
    const now = clock.now();
    // A time in the future, after the wall clock was set back, counts as now.
    if (this.#retryPinAtMs > now + PIN_RETRY_MS) this.#retryPinAtMs = now;
    if (now < this.#retryPinAtMs) return;
    const tile = pinnedTile(this.#display.mode);
    const presence = tile === undefined ? 'absent' : this.#options.presence(tile);
    // An installation in an unknown state may have taken a new ID, so the pin is written again once it stands.
    if (presence === 'unknown' && this.#display.pin === 'pinned') this.#display.pin = 'dirty';
    const wanted: PinState | undefined = presence === 'present' ? 'pinned' : presence === 'absent' ? 'none' : undefined;
    if (wanted === undefined || wanted === this.#display.pin) return;
    this.#reconciling = true;
    try {
      const fields: LogFields = {'bunny.device.id': this.#options.device, 'bunny.operation': 'mode'};
      let span: ReturnType<typeof trace.start> | undefined;
      const result = await writes.queue.control(signal => wanted === 'pinned' && tile !== undefined ?
        writes.connection.pin(signal, this.#options.installationOf(tile)) : writes.connection.unpin(signal), () => {
        span = trace.start('bunny.device.call', {kind: 'client', attributes: fields});
      });
      span?.end(result.outcome === 'sent' ? 'unset' : 'error');
      if (result.outcome === 'cancelled' || result.outcome === 'held') return;
      this.#options.reached(result, 'mode', undefined);
      if (result.outcome === 'sent') {
        this.#display.pin = wanted;
        if (this.#pinFailing) recordLog(log, 'operation.completed', {...fields, 'bunny.outcome': Outcome.succeeded});
        this.#pinFailing = false;
      } else {
        this.#display.pin = 'dirty';
        this.#retryPinAtMs = clock.now() + PIN_RETRY_MS;
        if (!this.#pinFailing) recordLog(log, 'operation.failed', {...fields, 'bunny.code': codeOf(result)});
        this.#pinFailing = true;
      }
      try {
        this.#options.store.setDisplay(this.#display);
      } catch (error) {
        this.#options.storageFailed(error);
      }
    } finally {
      this.#reconciling = false;
    }
  }
}

function codeOf(result: WriteResult | NotSent): ErrorCode {
  switch (result.outcome) {
    case 'sent':
      return 'internal';
    case Outcome.uncertain:
      return 'uncertain-result';
    case 'cancelled':
      return 'cancelled';
    case 'held':
    case Outcome.failed:
      switch (result.failure) {
        case 'unknown-device':
          return 'not-found';
        case 'transport-failure':
          return 'unavailable';
        case 'capacity':
        case 'forbidden':
        case 'invalid-request':
        case 'unauthenticated':
          return result.failure;
      }
  }
}

function outcomeOf(requestId: string, result: WriteResult | NotSent, expired: boolean): CompletedOutcome {
  if (result.outcome === 'sent') return {requestId, result: Outcome.succeeded, evidence: Outcome.transmitted};
  if (result.outcome === Outcome.uncertain) {
    return {requestId, result: Outcome.uncertain, evidence: Outcome.none, error: errorBody('uncertain-result', {detail: 'the write went out and the server did not answer it'}).error};
  }
  if (expired) return {requestId, result: Outcome.failed, evidence: Outcome.none, error: errorBody('expired', {detail: 'the command\'s deadline passed before it reached the server'}).error};
  return {requestId, result: Outcome.failed, evidence: Outcome.none, error: errorBody(codeOf(result), {detail: 'the server did not take the write'}).error};
}
