// The core owns capture authority and durable start/stop responsibility. This part never addresses a light.
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {MessageValidator, errorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {CAPTURE_CLOCK_DRIFT_MS, CAPTURE_MAX_CLOCK_SKEW_MS, CAPTURE_VALIDITY_MS, MUSIC_PRODUCER_SOURCE,
  type CaptureCalibrationReason, type CaptureResponseBinding, type CaptureResponseState, type CaptureControl, type CaptureEndpointControl, type CaptureFeatures, type CaptureLost, type CaptureProgress, type CaptureSelection, type CaptureState, type CaptureWork,
} from '@jimmie-potts/event-contracts/v2/music-capture';
import {Outcome, fullDisk, recordLog, type Cancel, type Command, type ModuleScheduler, type Reply, type StateDraft} from '@jimmie-potts/sdk';
import {Backoff} from './backoff.js';
import {QuietCalibration, ResponseClock, calibrationDurationMs, responseDefaults, retireResponse, sameResponseBinding} from './music-calibration.js';
import type {CoreHandle, CorePart} from './core.js';
import type {CoreTransaction} from './store.js';
import type {CompletedOutcome, CoreResponsibility} from './tracker.js';

const SCHEMA = 'https://bunny.invalid/events/';
const stateDraft = (data: CaptureState): StateDraft<CaptureState> => ({type: 'org.bunny.music-capture.updated', subject: 'music', dataschema: `${SCHEMA}music-capture-state/2.2`, data});
const selectedInput = (value: CaptureSelection): CaptureSelection => value.input === 'music' ? {input: 'music'} : {input: 'microphone', microphoneId: value.microphoneId};
type Responsibility = {authority: CoreResponsibility; action: 'start' | 'stop' | 'calibrate'; generation: string; endpointId: string;
  result: 'pending' | 'uncertain' | 'succeeded' | 'failed'; traceparent: string; selection?: CaptureSelection};
type ClockAnchor = {wall: number; mono: number};
type Live = ClockAnchor & {generation: string; sequence: number; sourceEnd: number; untilWall: number; untilMono: number;
  latest?: CaptureFeatures; latestAtMono?: number; appliedClock?: ResponseClock; candidateClock?: ResponseClock};
type CurrentState = CaptureState & {response: CaptureResponseState};
export type CaptureAdmission = {
  admit(command: Command<CaptureControl>): boolean;
  retain(command: Command<CaptureControl>): CoreResponsibility;
  complete(tx: CoreTransaction, authority: CoreResponsibility, result: Omit<CompletedOutcome, 'requestId'>): () => void;
  end(command: Command<CaptureControl>): void;
};

export class MusicCapturePart implements CorePart {
  readonly families = ['music-capture-state'];
  readonly #validator = new MessageValidator();
  #core: CoreHandle | undefined;
  #database: DatabaseSync | undefined;
  #closed = false;
  #retireEndpoint: (() => void) | undefined;
  #disconnected = false;
  #faulted = false;
  #recovering: Cancel | undefined;
  readonly #backoff = new Backoff(1000, 60_000);
  #queue: Promise<unknown> = Promise.resolve();
  #live: Live | undefined;
  #calibration: {operationId: string; trial: QuietCalibration} | undefined;
  #endpointClock: ClockAnchor | undefined;
  #timer: Cancel | undefined;
  readonly #deadlines = new Map<string, Cancel>();
  constructor(readonly admission: CaptureAdmission, readonly scheduler: ModuleScheduler, readonly monotonic: () => number = () => performance.now()) {
    registerCoreFamilies(this.#validator);
  }
  open(database: DatabaseSync): void {
    this.#database = undefined;
    database.exec("CREATE TABLE IF NOT EXISTS music_capture (id TEXT PRIMARY KEY CHECK (id = 'music'), record TEXT NOT NULL) STRICT; " +
      'CREATE TABLE IF NOT EXISTS music_capture_responsibilities (id TEXT PRIMARY KEY, record TEXT NOT NULL) STRICT');
    const initial: CaptureState = {id: 'music', revision: 0, endpointId: null, availability: 'off', session: {status: 'idle'}, response: responseDefaults()};
    database.prepare('INSERT INTO music_capture VALUES (?, ?) ON CONFLICT DO NOTHING').run('music', JSON.stringify(initial));
    this.#database = database;
  }
  states(families: readonly string[]): StateDraft[] {
    if (!families.includes('music-capture-state')) return [];
    if (!this.available()) return [];
    return [stateDraft(this.#state())];
  }
  storageFailed(): void {
    if (this.#faulted || this.#live !== undefined || (this.#database?.isOpen === true && this.#state().endpointId !== null)) this.#failure();
  }
  available(): boolean {return !this.#faulted && this.#database !== undefined;}
  /** The current session a lighting Start may bind to (#1272): only while the endpoint is available and the session active. */
  activeCapture(): {endpointId: string; generation: string; input: CaptureSelection['input']} | undefined {
    if (this.#closed || !this.available()) return undefined;
    try {
      const state = this.#state(), session = state.session;
      if (state.availability !== 'available' || state.endpointId === null || session.status !== 'active') return undefined;
      return {endpointId: state.endpointId, generation: session.generation, input: session.input};
    } catch {return undefined;}
  }
  setRetirement(retire: () => void): void {
    if (this.#retireEndpoint !== undefined) throw new Error('capture-retirement-already-bound');
    this.#retireEndpoint = retire;
  }
  start(core: CoreHandle): Promise<unknown> {
    this.#core = core;
    return Promise.all([
      core.sdk.respond<CaptureEndpointControl>('bunny.cmd.music-capture-endpoint.*', command => this.#serial(() => this.#endpoint(command)).catch(() => errorBody('internal'))),
      core.sdk.respond<CaptureControl>('bunny.cmd.music-capture-control.music', command => this.#control(command)),
      core.sdk.subscribe<CaptureProgress>('bunny.event.music-capture-progress.*', message => this.#serial(() => this.#progress(message)).catch(() => {}), {onOverflow: () => this.#lose()}),
      core.sdk.subscribe<CaptureFeatures>('bunny.event.music-capture-features.*', message => this.#serial(() => this.#features(message)).catch(() => {}), {onOverflow: () => this.#lose()}),
      core.sdk.subscribe<CaptureLost>('bunny.event.music-capture-lost.*', message => {
        if (message.source !== 'bunny/runtime/gateway' || !this.#validator.validate(message).ok) return;
        return this.#serial(async () => {
          await core.ready;
          if (!this.#closed && message.data.id === this.#state().endpointId) await this.#retire('unavailable');
        }).catch(() => {});
      }, {onOverflow: () => this.#lose()}),
    ]);
  }
  /** Called after store readiness, before the runtime exposes its gateway. No prior work is sent again. */
  async recover(): Promise<void> {
    try {await this.#recover();} catch {this.#failure();}
  }
  async #recover(): Promise<void> {
    if (this.#database === undefined) return;
    const previous = this.#state();
    if (previous.endpointId === null && previous.microphone === undefined && previous.session.status === 'idle' && previous.response.appliedTo === null && !['measuring', 'ready'].includes(previous.response.calibration.status) && this.#responsibilities().every(record => record.result !== 'pending')) return;
    const core = this.#required();
    const completions: (() => void)[] = [];
    await core.transaction(tx => {
      const current = this.#state();
      if (current.endpointId !== null || current.microphone !== undefined || current.session.status !== 'idle' || current.response.appliedTo !== null || ['measuring', 'ready'].includes(current.response.calibration.status)) {
        delete current.microphone;
        this.#save(tx, {...current, response: retireResponse(current.response, 'restart'), endpointId: null, availability: 'unavailable',
          session: current.session.status === 'idle' ? current.session : {...current.session, status: 'unavailable'}});
      }
      for (const record of this.#responsibilities()) if (record.result === 'pending') completions.push(this.#finish(tx, record, 'uncertain', 'uncertain-result'));
    });
    for (const complete of completions) complete();
  }
  async close(): Promise<void> {
    this.#disconnect();this.#closed = true;this.#fence();this.#recovering?.();this.#recovering = undefined;
    for (const cancel of this.#deadlines.values()) cancel();this.#deadlines.clear();
    await this.#queue;
  }
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(work);this.#queue = result.catch(() => {this.#fence();this.#failure();});return result;
  }
  #required(): CoreHandle {if (this.#core === undefined) throw new Error('capture-core-unavailable');return this.#core;}
  #db(): DatabaseSync {if (this.#database === undefined) throw new Error('capture-store-unavailable');return this.#database;}
  #state(): CurrentState {
    const row = this.#db().prepare("SELECT record FROM music_capture WHERE id = 'music'").get() as {record: string};
    const state = JSON.parse(row.record) as CaptureState;
    return {...state, response: state.response ?? responseDefaults()};
  }
  #responsibilities(): Responsibility[] {
    return this.#db().prepare('SELECT record FROM music_capture_responsibilities').all().map(row => JSON.parse(String(row.record)) as Responsibility);
  }
  #responsibility(id: string): Responsibility | undefined {
    const row = this.#db().prepare('SELECT record FROM music_capture_responsibilities WHERE id = ?').get(id) as {record: string} | undefined;
    return row === undefined ? undefined : JSON.parse(row.record) as Responsibility;
  }
  #write(record: Responsibility): void {
    this.#db().prepare('INSERT INTO music_capture_responsibilities VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record')
      .run(record.authority.requestId, JSON.stringify(record));
  }
  #save(tx: CoreTransaction, record: CaptureState): void {
    const next = {...record, response: record.response ?? responseDefaults(), revision: tx.revision()};
    this.#db().prepare("UPDATE music_capture SET record = ? WHERE id = 'music'").run(JSON.stringify(next));
    tx.add('bunny.state.music-capture-state.music', {kind: 'state', ...stateDraft(next)});
  }
  #finish(tx: CoreTransaction, record: Responsibility, result: 'succeeded' | 'failed' | 'uncertain', code?: ErrorCode): () => void {
    if (record.result === result || (record.result === Outcome.succeeded && record.action === 'start')) return () => {};
    const complete = this.admission.complete(tx, record.authority, {result, evidence: result === Outcome.succeeded ? Outcome.observed : Outcome.none,
      ...(code === undefined ? {} : {error: errorBody(code).error})});
    this.#write({...record, result});return complete;
  }
  async #endpoint(command: Command<CaptureEndpointControl>): Promise<Reply> {
    const core = this.#required();await core.ready;
    if (this.#closed || this.#faulted) return errorBody('unavailable');
    if (command.source !== MUSIC_PRODUCER_SOURCE) return errorBody('forbidden');
    const checked = this.#validator.validate(command, {nowMs: core.clock.now()});if (!checked.ok) return {error: checked.error};
    if (command.data.action === 'disable') {
      if (this.#state().endpointId !== command.subject) return errorBody('forbidden');
      this.#fence();await this.#retire('off');return {status: 'accepted'};
    }
    const anchor = {wall: core.clock.now(), mono: this.monotonic()};
    const microphone = command.data.microphone;
    let registered = false;
    const reply = await core.transaction(tx => {
      const current = this.#state();
      if (current.endpointId !== null && current.endpointId !== command.subject) return errorBody('invalid-state');
      if (current.endpointId === command.subject && current.microphone?.id !== microphone?.id) return errorBody('invalid-state');
      if (current.endpointId !== command.subject || current.availability !== 'available') {
        this.#save(tx, {...current, endpointId: command.subject, availability: 'available',
          ...(microphone === undefined ? {} : {microphone: {id: microphone.id}})});registered = true;
      }
      return {status: 'accepted'} as const;
    });
    if (!('error' in reply)) {
      this.#disconnected = false;if (registered) this.#endpointClock = anchor;
    }
    return reply;
  }
  async #control(command: Command<CaptureControl>): Promise<Reply> {
    const checked = this.#validator.validate(command);if (!checked.ok) return {error: checked.error};
    if (!this.admission.admit(command)) return errorBody('forbidden');
    const authority = this.admission.retain(command);
    try {return await this.#serial(async () => {
      const core = this.#required();await core.ready;
      if (this.#closed || this.#faulted) return errorBody('unavailable');
      if (command.data.action !== 'start' && command.data.action !== 'stop') return this.#tune(command, authority);
      const completions: (() => void)[] = [];
      let accepted: Responsibility | undefined, live: Live | undefined;
      let clockInvalid = false;
      const anchor = this.#endpointClock;
      const answer = await core.transaction(tx => {
        let current = this.#state(); const data = command.data;
        if (data.action !== 'start' && data.action !== 'stop') return errorBody('invalid-request');
        if (Date.parse(command.expiresat ?? '') <= tx.atMs) return errorBody('expired');
        if (data.expectedRevision !== current.revision) return errorBody('revision-conflict');
        if (current.availability !== 'available' || current.endpointId === null) return errorBody('unavailable');
        if (data.action === 'start' && (data.endpointId !== current.endpointId || ['starting', 'active', 'stale', 'stopping', 'uncertain'].includes(current.session.status))) return errorBody('invalid-state');
        if (data.action === 'start' && data.input === 'microphone' && data.microphoneId !== current.microphone?.id) return errorBody('unsupported-capability');
        if (data.action === 'stop' && (current.session.status === 'idle' || current.session.status === 'stopping')) return errorBody('invalid-state');
        if (data.action === 'start' && (anchor === undefined || !this.#clockValid(anchor, core.clock.now(), this.monotonic()))) {
          clockInvalid = true;return errorBody('unavailable');
        }
        const selection = data.action === 'start' ? selectedInput(data) : current.session.status === 'idle' ? undefined : selectedInput(current.session);
        if (selection === undefined) return errorBody('invalid-state');
        const generation = data.action === 'start' ? randomUUID() : current.session.status === 'idle' ? '' : current.session.generation;
        const record: Responsibility = {authority, action: data.action, generation, endpointId: current.endpointId, result: 'pending', traceparent: command.traceparent, selection};
        this.#write(record);
        const retired = this.#invalidate(tx, current, 'stopped'); current = retired.state; completions.push(retired.complete);
        this.#save(tx, {...current, session: {status: data.action === 'start' ? 'starting' : 'stopping', generation, operationId: authority.requestId, ...selection}});
        tx.take(command);accepted = record;
        if (data.action === 'start' && anchor !== undefined) live = {...anchor, generation, sequence: 0, sourceEnd: -1, untilWall: 0, untilMono: 0};
        return {status: 'accepted'} as const;
      });
      for (const complete of completions) complete();
      if (clockInvalid) await this.#retire('unavailable');
      if (accepted !== undefined) {
        this.#fence();this.#live = live;
        const record = accepted;
        this.#deadlines.set(authority.requestId, this.scheduler.after(record.action === 'start' ? 10_000 : 6000, () => this.#serial(() => this.#uncertain(record)).catch(() => {})));
        void this.#send(record);this.#schedule();
      }
      return answer;
    });} catch (error) {return errorBody(fullDisk(error) ? 'capacity' : 'internal');}
    finally {this.admission.end(command);}
  }
  #binding(state: CurrentState): CaptureResponseBinding | undefined {
    const live = this.#live, session = state.session, core = this.#required();
    if (state.availability !== 'available' || state.endpointId === null || session.status !== 'active' || session.input !== 'microphone' ||
      live?.latest === undefined || live.generation !== session.generation || live.latest.input !== 'microphone' ||
      core.clock.now() >= live.untilWall || this.monotonic() >= live.untilMono || !this.#clockValid(live, core.clock.now(), this.monotonic())) return undefined;
    return {endpointId: state.endpointId, generation: session.generation, microphoneId: session.microphoneId,
      sampleRateHz: live.latest.sampleRateHz, channels: live.latest.channels};
  }
  #invalidate(tx: CoreTransaction, state: CurrentState, reason: CaptureCalibrationReason): {state: CurrentState; complete: () => void} {
    if (this.#live !== undefined) {delete this.#live.appliedClock;delete this.#live.candidateClock;}
    const attempt = state.response.calibration;
    const record = attempt.status === 'measuring' ? this.#responsibility(attempt.operationId) : undefined;
    const complete = record?.result === 'pending' ? this.#finish(tx, record, 'failed', reason === 'cancelled' || reason === 'stopped' ? 'cancelled' : 'invalid-state') : () => {};
    return {state: {...state, response: retireResponse(state.response, reason)}, complete};
  }
  async #tune(command: Command<CaptureControl>, authority: CoreResponsibility): Promise<Reply> {
    const core = this.#required(), data = command.data;
    if (data.action === 'start' || data.action === 'stop') return errorBody('invalid-request');
    let complete = () => {}, cancelled = () => {};
    let measurement: {operationId: string; trial: QuietCalibration} | undefined;
    let appliedClock: ResponseClock | undefined;
    const reply = await core.transaction(tx => {
      const current = this.#state(), binding = this.#binding(current), response = current.response;
      if (Date.parse(command.expiresat ?? '') <= tx.atMs) return errorBody('expired');
      if (data.expectedRevision !== current.revision) return errorBody('revision-conflict');
      if (binding === undefined) return errorBody('unavailable');
      if (!sameResponseBinding(data.binding, binding)) return errorBody('revision-conflict');
      const attempt = response.calibration;
      if (data.action === 'calibrate') {
        if (attempt.status === 'measuring') return errorBody('invalid-state');
        const clock = {wall: core.clock.now(), mono: this.monotonic()};
        this.#write({authority, action: 'calibrate', generation: binding.generation, endpointId: binding.endpointId,
          result: 'pending', traceparent: command.traceparent});
        this.#save(tx, {...current, response: {...response, calibration: {status: 'measuring', operationId: authority.requestId,
          binding, startedAtMs: clock.wall, deadlineAtMs: clock.wall + calibrationDurationMs}}});
        measurement = {operationId: authority.requestId, trial: new QuietCalibration(authority.requestId, binding, clock)};
      } else if (data.action === 'cancel-calibration') {
        if (attempt.status !== 'measuring' || attempt.operationId !== data.operationId) return errorBody('invalid-state');
        const record = this.#responsibility(attempt.operationId);
        if (record?.result !== 'pending') return errorBody('invalid-state');
        cancelled = this.#finish(tx, record, 'failed', 'cancelled');
        this.#save(tx, {...current, response: {...response, calibration: {status: 'ended', operationId: attempt.operationId, reason: 'cancelled'}}});
      } else {
        if (attempt.status === 'measuring') return errorBody('invalid-state');
        if (data.expectedSettingsRevision !== response.settingsRevision) return errorBody('revision-conflict');
        const gate = data.settings.gate, evidence = response.evidence;
        if (gate.mode === 'calibrated' && (attempt.status !== 'ready' || attempt.operationId !== gate.calibrationId || evidence === null ||
          evidence.id !== gate.calibrationId || !sameResponseBinding(evidence.binding, binding))) return errorBody('invalid-state');
        const live = this.#live;
        if (live?.latest === undefined || live.latestAtMono === undefined) return errorBody('unavailable');
        appliedClock = new ResponseClock(live.latest, live.latestAtMono);
        this.#save(tx, {...current, response: {...response, settingsRevision: tx.revision(), settings: structuredClone(data.settings), appliedTo: binding}});
      }
      tx.take(command);
      if (data.action !== 'calibrate') complete = this.admission.complete(tx, authority, {result: Outcome.succeeded, evidence: Outcome.observed});
      return {status: 'accepted'} as const;
    });
    complete();cancelled();
    if (!('error' in reply)) {
      if (data.action === 'calibrate') {this.#calibration = measurement;if (this.#live !== undefined) delete this.#live.candidateClock;}
      else if (data.action === 'cancel-calibration') this.#calibration = undefined;
      else if (this.#live !== undefined && appliedClock !== undefined) this.#live.appliedClock = appliedClock;
      this.#schedule();
    }
    return reply;
  }
  async #send(record: Responsibility): Promise<void> {
    const core = this.#required();
    if (this.#closed || record.action === 'calibrate') return;
    const selection = record.selection ?? {input: 'music'};
    const data: CaptureWork = {requestId: record.authority.requestId, operationId: record.authority.requestId, generation: record.generation,
      ...(record.action === 'start' ? {action: 'start', ...selection} : {action: 'stop'})};
    try {
      const reply = await core.sdk.request(`bunny.cmd.music-capture-work.${record.endpointId}`, {type: 'org.bunny.music-capture.work.requested', subject: record.endpointId,
        dataschema: `${SCHEMA}music-capture-work/${record.action === 'start' && selection.input === 'microphone' ? '2.1' : '2.0'}`, data}, {requestId: record.authority.requestId, timeoutMs: 2000, parent: record});
      if (reply.status === 'accepted') return;
      await this.#serial(() => this.#settleFailure(record, reply.status === 'rejected' ? 'failed' : 'uncertain', reply.error.error.code));
    } catch {await this.#serial(() => this.#settleFailure(record, 'uncertain', 'uncertain-result'));}
  }
  async #uncertain(record: Responsibility): Promise<void> {await this.#settleFailure(record, 'uncertain', 'uncertain-result');}
  async #settleFailure(record: Responsibility, result: 'failed' | 'uncertain', code: ErrorCode): Promise<void> {
    const core = this.#required(), currentRecord = this.#responsibility(record.authority.requestId);
    if (this.#closed || currentRecord?.result !== 'pending') return;
    const selected = this.#state().session;
    if (selected.status !== 'idle' && selected.operationId === record.authority.requestId) {
      this.#fence();if (result === Outcome.uncertain || record.action === 'stop') this.#disconnect();
    }
    let complete = () => {}, calibrationComplete = () => {};
    await core.transaction(tx => {
      complete = this.#finish(tx, currentRecord, result, code);
      const current = this.#state();
      if (current.session.status !== 'idle' && current.session.operationId === record.authority.requestId) {
        const retired = this.#invalidate(tx, current, 'source-lost');calibrationComplete = retired.complete;
        this.#save(tx, {...retired.state, session: {...current.session, status: result === Outcome.uncertain ? 'uncertain' : 'unavailable'}});
      }
    });complete();calibrationComplete();this.#cancelDeadline(record.authority.requestId);
  }
  async #progress(message: Message<CaptureProgress>): Promise<void> {
    const core = this.#required();await core.ready;
    if (this.#closed || this.#faulted || message.source !== MUSIC_PRODUCER_SOURCE || !this.#validator.validate(message).ok) return;
    const data = message.data, record = this.#responsibility(data.operationId);
    if (record === undefined || record.action === 'calibrate' || record.endpointId !== message.subject || record.generation !== data.generation) return;
    if (data.status === 'started' && record.action !== 'start' || data.status === 'stopped' && record.action !== 'stop') return;
    const definitive = data.status === 'started' || data.status === 'stopped';
    const result = definitive ? Outcome.succeeded : data.status === 'failed' ? Outcome.failed : Outcome.uncertain;
    if (record.result === result && definitive) return;
    let complete = () => {}, calibrationComplete = () => {};
    const state = this.#state();
    const selected = state.endpointId === record.endpointId && state.session.status !== 'idle' && state.session.operationId === data.operationId;
    if (!definitive && selected) {this.#fence();if (record.action === 'stop') this.#disconnect();}
    await core.transaction(tx => {
      if (record.result === 'pending' || record.result === Outcome.uncertain || (record.action === 'stop' && definitive)) {
        complete = this.#finish(tx, record, result, 'error' in data ? data.error.code : undefined);
      }
      if (selected) {
        const current = this.#state();
        if (current.session.status === 'idle') return;
        // Late evidence can settle an operation, but only a still-authorized generation can become live.
        if (data.status === 'started' && this.#live?.generation === data.generation) this.#save(tx, {...current, session: {...current.session, status: 'stale'}});
        else if (data.status === 'stopped') this.#save(tx, {...current, session: {status: 'idle'}});
        else if (!definitive) {
          const retired = this.#invalidate(tx, current, 'source-lost');calibrationComplete = retired.complete;
          this.#save(tx, {...retired.state, session: {...current.session, status: data.status === 'uncertain' ? 'uncertain' : 'unavailable'}});
        }
      }
    });complete();calibrationComplete();this.#cancelDeadline(data.operationId);this.#schedule();
  }
  async #features(message: Message<CaptureFeatures>): Promise<void> {
    const core = this.#required(), live = this.#live;
    if (this.#closed || this.#faulted || live === undefined || message.source !== MUSIC_PRODUCER_SOURCE || !this.#validator.validate(message).ok) return;
    const current = this.#state(), frame = message.data, wall = core.clock.now(), mono = this.monotonic();
    if (!this.#clockValid(live, wall, mono)) {await this.#retire('unavailable');return;}
    if (message.subject !== current.endpointId || frame.generation !== live.generation || current.session.status === 'idle' ||
      !['active', 'stale'].includes(current.session.status) || frame.sequence <= live.sequence || frame.endMonotonicMs <= live.sourceEnd || frame.observedAtMs > wall + CAPTURE_MAX_CLOCK_SKEW_MS || wall >= frame.validUntilMs) return;
    if (frame.input !== current.session.input || (frame.input === 'microphone' &&
      (current.session.input !== 'microphone' || frame.microphoneId !== current.session.microphoneId))) return;
    const previous = live.latest;
    const invalidation: CaptureCalibrationReason | undefined = previous !== undefined &&
      (frame.sampleRateHz !== previous.sampleRateHz || frame.channels !== previous.channels) ? 'format' :
      previous !== undefined && (frame.discontinuity || frame.sequence !== previous.sequence + 1 || Math.abs(frame.startMonotonicMs - previous.endMonotonicMs) > 0.01) ? 'discontinuity' :
      previous !== undefined && (wall >= live.untilWall || mono >= live.untilMono) ? 'stale' :
      live.appliedClock?.accept(frame, mono) === false || live.candidateClock?.accept(frame, mono) === false ? 'clock' : undefined;
    live.sequence = frame.sequence;live.sourceEnd = frame.endMonotonicMs;live.untilWall = frame.validUntilMs;
    live.untilMono = mono + Math.min(CAPTURE_VALIDITY_MS, frame.validUntilMs - wall); live.latest = frame;live.latestAtMono = mono;
    const session = current.session;
    if (session.status !== 'active' || invalidation !== undefined) {
      let complete = () => {};
      await core.transaction(tx => {
        const retired = invalidation === undefined ? {state: current, complete} : this.#invalidate(tx, current, invalidation);
        complete = retired.complete;this.#save(tx, {...retired.state, session: {...session, status: 'active'}});
      });complete();if (invalidation !== undefined) this.#calibration = undefined;
    }
    const calibration = this.#calibration;
    if (calibration !== undefined) {
      let result = calibration.trial.accept(frame, mono);
      if (result.status === 'failed' || result.status === 'complete') {
        let complete = () => {};
        await core.transaction(tx => {
          if (calibration.trial.expired(this.monotonic())) result = {status: 'failed', reason: 'deadline'};
          else if (core.clock.now() >= frame.validUntilMs || !this.#clockValid(live, core.clock.now(), this.monotonic())) result = {status: 'failed', reason: 'stale'};
          if (result.status !== 'complete' && result.status !== 'failed') return;
          const selected = this.#state(), attempt = selected.response.calibration;
          const record = this.#responsibility(calibration.operationId);
          if (record?.result !== 'pending' || attempt.status !== 'measuring' || attempt.operationId !== calibration.operationId) return;
          const retained = result.status === 'failed' && result.reason === 'clock' ? retireResponse(selected.response, 'clock') : selected.response;
          const response: CaptureResponseState = {...retained, calibration: result.status === 'complete'
            ? {status: 'ready', operationId: calibration.operationId} : {status: 'ended', operationId: calibration.operationId, reason: result.reason},
            ...(result.status === 'complete' ? {evidence: result.evidence} : {})};
          this.#save(tx, {...selected, response});
          complete = this.#finish(tx, record, result.status === 'complete' ? 'succeeded' : 'failed', result.status === 'complete' ? undefined : 'invalid-state');
        });complete();this.#calibration = undefined;
        if (result.status === 'complete') live.candidateClock = result.timing;
        else if (result.status === 'failed' && result.reason === 'clock') {delete live.appliedClock;delete live.candidateClock;}
      }
    }
    this.#schedule();
  }
  #clockValid(live: ClockAnchor, wall: number, mono: number): boolean {
    return Number.isFinite(wall) && Number.isFinite(mono) && mono >= live.mono && Math.abs(wall - live.wall - (mono - live.mono)) <= CAPTURE_CLOCK_DRIFT_MS;
  }
  #schedule(): void {
    this.#timer?.();this.#timer = undefined;
    const live = this.#live;
    if (!this.#closed && live !== undefined) {
      const remaining = Math.min(live.untilWall - this.#required().clock.now(), live.untilMono - this.monotonic());
      this.#timer = this.scheduler.after(remaining > 0 ? Math.ceil(Math.min(100, remaining)) : 100, () => this.#serial(() => this.#tick()).catch(() => {}));
    }
  }
  async #tick(): Promise<void> {
    const live = this.#live, core = this.#required();if (this.#closed || this.#faulted || live === undefined) return;
    const wall = core.clock.now(), mono = this.monotonic();
    if (!this.#clockValid(live, wall, mono)) {await this.#retire('unavailable');return;}
    const current = this.#state();
    const session = current.session;
    const stale = session.status === 'active' && (wall >= live.untilWall || mono >= live.untilMono);
    const expired = this.#calibration?.trial.expired(mono) === true;
    if (stale || expired) {
      let complete = () => {};
      await core.transaction(tx => {
        const retired = this.#invalidate(tx, current, stale ? 'stale' : 'deadline');complete = retired.complete;
        this.#save(tx, {...retired.state, session: stale ? {...session, status: 'stale'} : session});
      });complete();this.#calibration = undefined;
    }
    this.#schedule();
  }
  #fence(): void {this.#calibration = undefined;this.#live = undefined;this.#timer?.();this.#timer = undefined;}
  #cancelDeadline(id: string): void {this.#deadlines.get(id)?.();this.#deadlines.delete(id);}
  #lose(): void {this.#fence();if (!this.#closed) void this.#serial(() => this.#retire('unavailable')).catch(() => {});}
  async #retire(availability: 'off' | 'unavailable'): Promise<void> {
    this.#endpointClock = undefined;
    if (availability === 'unavailable') this.#disconnect();
    this.#fence();if (this.#closed) return;
    const core = this.#required();await core.ready;
    const completions: (() => void)[] = [];
    await core.transaction(tx => {
      const current = this.#state();
      delete current.microphone;
      this.#save(tx, {...current, response: retireResponse(current.response, 'source-lost'), endpointId: null, availability,
        session: current.session.status === 'idle' ? current.session : {...current.session, status: 'unavailable'}});
      for (const record of this.#responsibilities()) if (record.result === 'pending') completions.push(this.#finish(tx, record, 'uncertain', 'uncertain-result'));
    });for (const complete of completions) complete();
    for (const cancel of this.#deadlines.values()) cancel();this.#deadlines.clear();
  }
  #disconnect(): void {
    this.#endpointClock = undefined;
    if (this.#disconnected) return;
    this.#disconnected = true;this.#retireEndpoint?.();
  }
  #failure(): void {
    if (this.#closed || this.#core === undefined) return;
    if (!this.#faulted) recordLog(this.#core.log, 'operation.failed', {'bunny.operation': 'status', 'bunny.outcome': Outcome.rejected, 'bunny.code': 'internal'});
    this.#faulted = true;this.#disconnect();this.#fence();
    if (this.#recovering !== undefined) return;
    this.#backoff.failed(this.#core.clock.now());
    this.#recovering = this.scheduler.after(Math.max(0, this.#backoff.next - this.#core.clock.now()), async () => {
      this.#recovering = undefined;
      try {await this.#serial(() => this.#retire('unavailable'));this.#faulted = false;this.#backoff.reset();}
      catch {this.#failure();}
    });
  }
}
