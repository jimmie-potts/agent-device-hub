// The Tronbyt display's controls (Hub #23, #337): the `brightness-set`, `device-mode-set` and `moment-play` commands the
// cloud backend refuses, and the pin the display's mode asks for. The modes are the device's native ones in the shared `device/2.0` record, so
// the shared contract does not change:
// - `rotation`, the default: both tiles take their turn, and a push waits for it, as on the cloud;
// - `interrupt`: a tile's push interrupts the display at once;
// - `pin-<tile>`: the server shows only that tile while it stands, and the rotation when it does not;
// - `hide-<tile>`: that tile leaves the rotation, and the module writes it no frame until another mode returns it.
// Commands follow ADR 0012 as the LIFX module's do: stored before they are accepted, one write in the queue's turn, never
// sent again, with an outcome stored with the record it changes. A stop or a crash leaves them to the next start's
// `settleRequests`. Evidence stays `transmitted` at most: a server's answer says what it stored, never what the panel shows.
//
// A moment (ADR 0006) is a bounded takeover: one queue turn reads the server's pin, pushes the frame to interrupt the
// display and pins it; a timer holds it; another turn releases it, and the display returns to whatever the rotation is
// then. It yields to attention and to any pin, and any other command ends it. No frame is stored and nothing replays. A
// row marks a takeover that may stand on the server from before its first write until its release was answered, so a
// release that failed, or a stop or a crash during the hold, is a fresh release later.
import {createHash} from 'node:crypto';
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {MessageValidator, SCHEMA_BASE, errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {commandSupported, registerDeviceFamilies, type Capabilities, type CompletedOutcome, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies, type MomentPlayRequest} from '@jimmie-potts/event-contracts/v2/families';
import {SdkError, fullDisk, recordLog, type AddMessage, type Cancel, type Command, type LogFields, type ModuleContext, type Reply, type TraceContext, Outcome} from '@jimmie-potts/sdk';
import type {WriteResult} from './cloud.js';
import {MOMENT_MOODS, type MomentPicture} from './moment-card.js';
import type {TronbytConnection} from './tronbyt.js';
import type {CloudQueue, NotSent} from './writer.js';

export type TileName = 'status' | 'now-playing';
export const CONTROL_FAMILIES = ['brightness-set', 'device-mode-set', 'moment-play'] as const;
export type ControlFamily = (typeof CONTROL_FAMILIES)[number];
export const isControlFamily = (family: string): family is ControlFamily => CONTROL_FAMILIES.some(entry => entry === family);
export const DEFAULT_MODE = 'rotation';
/** How many accepted commands may wait, so a burst of them stays bounded. */
export const MAX_PENDING = 8;
/** How many completed commands the module remembers, so a repeat of one is accepted again without a second effect. */
export const REMEMBERED = 256;
/** The wait before the display's pin is written again after a write that failed. */
export const PIN_RETRY_MS = 60_000;
/** The longest moment the Tidbyt takes. */
export const MOMENT_MAX_DURATION_MS = 60_000;
/** A shorter moment holds this long: the firmware shows a frame for its own dwell, so a moment of a few seconds is not one the display can keep. */
export const MOMENT_MIN_HOLD_MS = 30_000;
/** How long a moment's picture may take. Past this, the moment ends with nothing sent. */
export const MOMENT_PICTURE_TIMEOUT_MS = 30_000;

const OUTCOME_SCHEMA = `${SCHEMA_BASE}outcome/2.0`;
const COMMANDS: Readonly<Record<ControlFamily, {dataschema: string; entity: string; operation: 'brightness' | 'mode' | 'moment'}>> = {
  'brightness-set': {dataschema: `${SCHEMA_BASE}brightness-set/2.0`, entity: 'org.bunny.brightness.set', operation: 'brightness'},
  'device-mode-set': {dataschema: `${SCHEMA_BASE}device-mode-set/2.0`, entity: 'org.bunny.device-mode.set', operation: 'mode'},
  'moment-play': {dataschema: `${SCHEMA_BASE}moment-play/2.0`, entity: 'org.bunny.moment.play', operation: 'moment'},
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
    power: UNSUPPORTED, brightness: {supported: true, minimum: 0, maximum: 100}, modes: {supported: true, values: displayModes(nowPlaying)},
    moments: {supported: true, moods: [...MOMENT_MOODS], maxDurationMs: MOMENT_MAX_DURATION_MS, coversStatus: true},
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
  readonly #momentSeen: StatementSync;
  readonly #rememberMoment: StatementSync;
  readonly #forgetMoments: StatementSync;
  readonly #markMomentWritten: StatementSync;
  readonly #momentMayStand: StatementSync;
  readonly #momentReleased: StatementSync;

  constructor(database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS tidbyt_display (
        id TEXT PRIMARY KEY, mode TEXT NOT NULL, brightness INTEGER, pin TEXT NOT NULL, configuration_revision INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS tidbyt_requests (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, family TEXT NOT NULL,
        state TEXT NOT NULL, traceparent TEXT NOT NULL, UNIQUE (source, request_id)) STRICT;
      CREATE TABLE IF NOT EXISTS tidbyt_moments (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, may_stand INTEGER NOT NULL DEFAULT 0) STRICT`);
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
    this.#momentSeen = database.prepare('SELECT 1 FROM tidbyt_moments WHERE id = ?');
    this.#rememberMoment = database.prepare('INSERT INTO tidbyt_moments (id) VALUES (?)');
    this.#forgetMoments = database.prepare(`DELETE FROM tidbyt_moments WHERE may_stand = 0 AND seq NOT IN (
      SELECT seq FROM tidbyt_moments ORDER BY seq DESC LIMIT ${REMEMBERED})`);
    this.#markMomentWritten = database.prepare('UPDATE tidbyt_moments SET may_stand = 1 WHERE id = ?');
    this.#momentMayStand = database.prepare('SELECT 1 FROM tidbyt_moments WHERE may_stand = 1 LIMIT 1');
    this.#momentReleased = database.prepare('UPDATE tidbyt_moments SET may_stand = 0 WHERE may_stand = 1');
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

  /** Whether this moment ID was accepted before, so a repeat of it never plays again. */
  momentSeen(momentId: string): boolean {
    return this.#momentSeen.get(momentId) !== undefined;
  }

  rememberMoment(momentId: string): void {
    this.#rememberMoment.run(momentId);
    this.#forgetMoments.run();
  }

  /** The takeover's first write is about to go out, so it may stand on the server until a release is answered. */
  markMomentWritten(momentId: string): void {
    this.#markMomentWritten.run(momentId);
  }

  momentMayStand(): boolean {
    return this.#momentMayStand.get() !== undefined;
  }

  momentReleased(): void {
    this.#momentReleased.run();
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
  context: Pick<ModuleContext, 'clock' | 'log' | 'trace' | 'scheduler'>;
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
  /** What the display's status needs: attention, an agent's tile, nothing, or not known while the sessions' copy is lost. */
  presentation: () => 'attention' | 'status' | 'idle' | 'unknown';
  /** Supplies the frame a moment shows. */
  picture: MomentPicture;
};

/** The one moment in hand, from its acceptance to its outcome. `ended` says why it stops before its time, and `taking` that its takeover's turn is queued. */
type Moment = {data: MomentPlayRequest; ended: 'yielded' | 'command' | undefined; wake: (() => void) | undefined; taking: boolean};

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
  #moment: Moment | undefined;
  /** Whether a takeover may stand on the server, so a release is due. */
  #mayStand: boolean;
  #releaseFailing = false;

  constructor(options: DisplayControlOptions) {
    this.#options = options;
    this.#modes = displayModes(options.nowPlaying);
    this.#display = options.store.display(this.#modes);
    this.#mayStand = options.store.momentMayStand();
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

  /** Whether a tile's push interrupts the display. None does from the takeover's turn on, and one that ended early no longer counts. */
  immediate(): boolean {
    const moment = this.#moment;
    return this.#display.mode === 'interrupt' && (moment === undefined || !moment.taking || moment.ended !== undefined);
  }

  /** Ends the moment in hand when what the display must show now outranks it. */
  checkMoment(): void {
    const moment = this.#moment;
    if (moment !== undefined && moment.ended === undefined && this.#blocked(moment.data) !== undefined) this.#endMoment('yielded');
  }

  /** The module stops: a moment's wait ends, and its outcome is left to the next start. */
  close(): void {
    this.#moment?.wake?.();
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
    const moment = family === 'moment-play' ? data as unknown as MomentPlayRequest : undefined;
    if (moment !== undefined) {
      const refusal = this.#refusal(moment);
      if (refusal !== undefined) return refusal;
    }

    // Store the accepted command before replying, with the record that shows it pending.
    const key = `${command.source} ${requestId}`;
    const before = {configurationRevision: this.#display.configurationRevision, brightness: this.#display.brightness};
    // A moment changes no mode and no configuration.
    if (moment === undefined) this.#display.configurationRevision += 1;
    if (family === 'brightness-set') this.#display.brightness = Number(data.percent);
    this.#pending.set(key, family);
    const inHand: Moment | undefined = moment === undefined ? undefined : {data: moment, ended: undefined, wake: undefined, taking: false};
    if (inHand !== undefined) this.#moment = inHand;
    const accepted = await commit(command, () => {
      store.accept(command.source, requestId, digest, family, command.traceparent);
      if (moment !== undefined) store.rememberMoment(moment.momentId);
      else store.setDisplay(this.#display);
    });
    if (!accepted) {
      Object.assign(this.#display, before);
      this.#pending.delete(key);
      if (inHand !== undefined) this.#moment = undefined;
      return errorBody('unavailable', {detail: 'the module could not store the command'});
    }
    if (inHand !== undefined) {
      track(this.#play(command, inHand, key));
      return {status: 'accepted'};
    }
    // Any other explicit command ends a moment (ADR 0006).
    this.#endMoment('command');
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
    await this.#finish(family, command, key, outcome, fields);
    if (mode !== undefined && result.outcome === 'sent') this.#options.changed(command);
  }

  /** Stores a command's outcome with the record it changes. */
  async #finish(family: ControlFamily, command: Command<Record<string, unknown>>, key: string, outcome: CompletedOutcome, fields: LogFields): Promise<void> {
    const {context: {log}, store, device} = this.#options;
    const previousOutcome = this.#lastOutcome;
    this.#pending.delete(key);
    this.#lastOutcome = outcome;
    recordLog(log, 'command.completed', {...fields, 'bunny.outcome': outcome.result, ...(outcome.error === undefined ? {} : {'bunny.code': outcome.error.code})}, command);
    // Not stored: the record stays as committed, and the next start reports the command from its stored state.
    const stored = await this.#options.commit(command, add => {
      store.setState(command.source, outcome.requestId, 'done');
      store.setDisplay(this.#display);
      add(`bunny.event.${family}.${device}`, {
        kind: 'outcome', type: `${COMMANDS[family].entity}.completed`, subject: device, dataschema: OUTCOME_SCHEMA, data: outcome,
      }, {parent: command});
    });
    if (!stored) {
      // The command stays pending in the module's records, and the next start reports it.
      this.#lastOutcome = previousOutcome;
      this.#pending.set(key, family);
    }
  }

  /** Why the display cannot take this moment now, or undefined when it can. */
  #blocked(moment: MomentPlayRequest): string | undefined {
    if (pinnedTile(this.#display.mode) !== undefined) return 'the Tidbyt holds a pin the owner chose';
    switch (this.#options.presentation()) {
      case 'attention':
        return 'an agent needs attention';
      case 'unknown':
        return 'the module does not know whether an agent needs attention';
      case 'status':
        return moment.coversStatus || this.hides('status') ? undefined : 'this moment may not cover the agents\' status';
      case 'idle':
        return undefined;
    }
  }

  /** A moment's refusal at admission, which proves no effect: nothing was stored or sent. */
  #refusal(moment: MomentPlayRequest): Reply | undefined {
    const {store, context: {clock}} = this.#options;
    if (!commandSupported(displayCapabilities(this.#options.nowPlaying), {family: 'moment-play', data: moment})) {
      return errorBody('unsupported-capability', {detail: 'the Tidbyt does not offer this moment'});
    }
    if (clock.now() > moment.startAtMs + moment.toleranceMs) return errorBody('expired', {detail: 'the moment\'s start window has passed'});
    if (this.#pending.size > 0) return errorBody('capacity', {detail: 'a command or a moment is in hand on the Tidbyt'});
    if (this.#mayStand) return errorBody('unavailable', {detail: 'the last moment has not been released yet'});
    let seen: boolean;
    try {
      seen = store.momentSeen(moment.momentId);
    } catch (error) {
      this.#options.storageFailed(error);
      return errorBody('unavailable', {detail: 'the module could not read its records'});
    }
    if (seen) return errorBody('invalid-state', {detail: 'this moment was already accepted'});
    const blocked = this.#blocked(moment);
    return blocked === undefined ? undefined : errorBody('invalid-state', {detail: blocked});
  }

  #endMoment(reason: NonNullable<Moment['ended']>): void {
    const moment = this.#moment;
    if (moment === undefined || moment.ended !== undefined) return;
    moment.ended = reason;
    moment.wake?.();
  }

  /** Waits on the runtime's scheduler until the moment ends or the module stops. */
  #wait(moment: Moment, ms: number): Promise<void> {
    if (ms <= 0 || moment.ended !== undefined || this.#options.stopping()) return Promise.resolve();
    return new Promise(resolve => {
      let cancel: Cancel = () => {};
      const done = (): void => {
        moment.wake = undefined;
        try {
          cancel();
        } catch {
          // A timer the runtime already cancelled.
        }
        resolve();
      };
      moment.wake = done;
      try {
        cancel = this.#options.context.scheduler.after(Math.ceil(ms), done);
      } catch {
        // The module is stopping, and its timers refuse use.
        done();
      }
    });
  }

  /** One moment: its frame, its start, the takeover's turn, the hold and the release. Nothing here runs again after a stop. */
  async #play(command: Command<Record<string, unknown>>, moment: Moment, key: string): Promise<void> {
    const {context: {log, trace, clock}, store, device, stopping, picture} = this.#options;
    const writes = this.#writes;
    if (writes === undefined) return;
    const {data} = moment;
    const {requestId} = data;
    const fields: LogFields = {'bunny.device.id': device, ...requestField(requestId), 'bunny.routing.key': `bunny.cmd.moment-play.${device}`, 'bunny.operation': 'moment'};
    const outcome = (result: CompletedOutcome['result'], evidence: CompletedOutcome['evidence'], code?: ErrorCode, detail?: string): CompletedOutcome =>
      ({requestId, result, evidence, ...(code === undefined ? {} : {error: errorBody(code, detail === undefined ? {} : {detail}).error})});
    const end = async (ended: CompletedOutcome): Promise<void> => {
      this.#moment = undefined;
      await this.#finish('moment-play', command, key, ended, fields);
      this.#options.changed(command);
    };
    /** Why the moment must not start now, or undefined when it may. */
    const barred = (): CompletedOutcome | undefined => {
      if (moment.ended === 'command') return outcome(Outcome.failed, Outcome.none, 'cancelled', 'a later command ended the moment before it started');
      const blocked = moment.ended === 'yielded' ? 'the moment yielded before it started' : this.#blocked(data);
      if (blocked !== undefined) return outcome(Outcome.failed, Outcome.none, 'invalid-state', blocked);
      return clock.now() > data.startAtMs + data.toleranceMs ? outcome(Outcome.failed, Outcome.none, 'expired', 'the moment\'s start window passed') : undefined;
    };

    // Nothing waits on the picture past its time, the moment's end or the stop, whatever it does with its signal.
    const giveUp = new AbortController();
    let webp: Uint8Array | undefined;
    let pictureFailed: unknown;
    const pictured = (async (): Promise<void> => { webp = await picture(data, giveUp.signal); })().catch((error: unknown) => { pictureFailed = error; });
    await Promise.race([pictured, this.#wait(moment, MOMENT_PICTURE_TIMEOUT_MS)]);
    moment.wake?.();
    giveUp.abort();
    if (stopping()) return;
    const unusable = barred();
    if (unusable !== undefined) {
      await end(unusable);
      return;
    }
    const frame: Uint8Array | undefined = webp;
    if (frame === undefined) {
      const code = pictureFailed === undefined ? 'unavailable' : pictureFailed instanceof SdkError ? pictureFailed.body.error.code : 'internal';
      await end(outcome(Outcome.failed, Outcome.none, code, 'the moment\'s picture could not be made'));
      return;
    }
    await this.#wait(moment, data.startAtMs - clock.now());
    if (stopping()) return;
    const before = barred();
    if (before !== undefined) {
      await end(before);
      return;
    }

    let span: ReturnType<typeof trace.start> | undefined;
    let yielded = false;
    let wrote = false;
    let transmitted = false;
    let result: WriteResult | NotSent;
    // From here a tile queued behind the turn must not interrupt it, so this is set before the turn is asked for.
    moment.taking = true;
    try {
      result = await writes.queue.control(async signal => {
        const pin = await writes.connection.serverPin(signal);
        if ('outcome' in pin) return pin;
        if (pin.pinned) {
          yielded = true;
          return {outcome: 'sent'};
        }
        // The read was a wait: what outranks a moment may have arrived during it.
        if (barred() !== undefined) return {outcome: 'sent'};
        wrote = true;
        const pushed = await writes.connection.pushMoment(frame, signal);
        if (pushed.outcome !== 'sent') return pushed;
        transmitted = true;
        // Without a pin, this moment ends at the hold below, at once.
        if (moment.ended !== undefined) return pushed;
        return await writes.connection.pinMoment(signal);
      }, () => {
        store.setState(command.source, requestId, 'started');
        store.markMomentWritten(data.momentId);
        this.#mayStand = true;
        recordLog(log, 'command.executing', fields, command);
        span = trace.start('bunny.device.call', {parent: command, kind: 'client', attributes: fields});
      }, () => barred() === undefined);
    } catch (error) {
      // The store refused to mark the write begun, so it never went out.
      this.#options.storageFailed(error);
      await end(outcome(Outcome.failed, Outcome.none, fullDisk(error) ? 'capacity' : 'internal', 'the module could not record the write before it began'));
      return;
    }
    span?.end(result.outcome === 'sent' ? 'unset' : 'error');
    if (stopping()) return;
    if (result.outcome === 'cancelled' || result.outcome === 'held') {
      await end(barred() ?? outcome(Outcome.failed, Outcome.none, codeOf(result), 'the server did not take the moment'));
      return;
    }
    // Nothing was written: a pin stood, or it could not be read. Nothing stands, so no release is due.
    if (!wrote) {
      const read = result.outcome === 'sent';
      if (!read) this.#options.reached(result, 'moment', command, requestId);
      this.#standsNot();
      if (yielded) await end(outcome(Outcome.failed, Outcome.none, 'invalid-state', 'the server holds a pin'));
      else if (read) await end(barred() ?? outcome(Outcome.failed, Outcome.none, 'cancelled', 'the moment ended before it started'));
      else await end(outcome(Outcome.failed, Outcome.none, codeOf(result), 'the server\'s pin could not be read'));
      return;
    }
    this.#options.reached(result, 'moment', command, requestId);
    if (result.outcome === 'sent') {
      await this.#wait(moment, Math.max(MOMENT_MIN_HOLD_MS, data.durationMs));
      if (stopping()) return;
    } else if (!transmitted && result.outcome === Outcome.failed) {
      // The server refused the push, so nothing of this moment stands.
      this.#standsNot();
      await end(outcome(Outcome.failed, Outcome.none, codeOf(result), 'the server refused the moment'));
      return;
    }
    // An event during the release itself does not make a moment that held its time one that ended early.
    const endedEarly = moment.ended;
    const released = await this.#release(command);
    if (stopping()) return;
    if (released.outcome !== 'sent' || result.outcome === Outcome.uncertain) {
      await end(outcome(Outcome.uncertain, transmitted ? Outcome.transmitted : Outcome.none, 'uncertain-result', 'the server did not confirm the moment\'s writes'));
    } else if (result.outcome === Outcome.failed) {
      await end(outcome(Outcome.failed, Outcome.transmitted, codeOf(result), 'the server took the frame and refused its pin'));
    } else if (endedEarly !== undefined) {
      await end(outcome(Outcome.failed, Outcome.transmitted, 'cancelled', endedEarly === 'command' ? 'a later command ended the moment' : 'the moment yielded before its time'));
    } else {
      await end(outcome(Outcome.succeeded, Outcome.transmitted));
    }
  }

  /** Nothing of a moment stands on the server. A store that refuses this only leaves one more harmless release. */
  #standsNot(): void {
    this.#mayStand = false;
    try {
      this.#options.store.momentReleased();
    } catch (error) {
      this.#options.storageFailed(error);
    }
  }

  /** One release in the queue's turn. A failed one is a fresh one later, at the next evaluation after the retry wait. */
  async #release(parent: TraceContext | undefined): Promise<WriteResult | NotSent> {
    const writes = this.#writes;
    const {context: {trace, clock, log}, device} = this.#options;
    if (writes === undefined) return {outcome: 'cancelled'};
    const fields: LogFields = {'bunny.device.id': device, 'bunny.operation': 'moment'};
    let span: ReturnType<typeof trace.start> | undefined;
    const result = await writes.queue.control(signal => writes.connection.releaseMoment(signal), () => {
      span = trace.start('bunny.device.call', {...(parent === undefined ? {} : {parent}), kind: 'client', attributes: fields});
    });
    span?.end(result.outcome === 'sent' ? 'unset' : 'error');
    if (result.outcome === 'cancelled' || result.outcome === 'held') return result;
    this.#options.reached(result, 'moment', parent);
    if (result.outcome === 'sent') {
      this.#standsNot();
      if (this.#releaseFailing) recordLog(log, 'operation.completed', {...fields, 'bunny.outcome': Outcome.succeeded});
      this.#releaseFailing = false;
    } else {
      this.#retryPinAtMs = clock.now() + PIN_RETRY_MS;
      if (!this.#releaseFailing) recordLog(log, 'operation.failed', {...fields, 'bunny.code': codeOf(result)});
      this.#releaseFailing = true;
    }
    return result;
  }

  /**
   * Brings the server's pin to what the mode asks once a tile's writes changed what stands. A pushed installation takes a
   * new server ID each time it comes back, and deleting a pinned one leaves the pin set, so the pin follows the tile. It
   * waits for commands in hand; a failed write is a fresh one later, never a replay.
   */
  async reconcile(): Promise<void> {
    const writes = this.#writes;
    const {clock, log, trace} = this.#options.context;
    this.checkMoment();
    if (writes === undefined || this.#reconciling || this.#options.stopping() || writes.queue.held()) return;
    const now = clock.now();
    // A time in the future, after the wall clock was set back, counts as now.
    if (this.#retryPinAtMs > now + PIN_RETRY_MS) this.#retryPinAtMs = now;
    if (now < this.#retryPinAtMs) return;
    // A release clears only its own pin, so it need not wait for commands in hand: an outcome the database refused keeps its
    // command pending until the next start, and that must not strand the frame. Only a moment still in hand owns its release.
    if (this.#mayStand && this.#moment === undefined) {
      this.#reconciling = true;
      try {
        await this.#release(undefined);
      } finally {
        this.#reconciling = false;
      }
      if (this.#mayStand) return;
    }
    if (this.#pending.size > 0 || this.#options.stopping()) return;
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
