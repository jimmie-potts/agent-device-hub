import {randomUUID} from 'node:crypto';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {CAPTURE_WINDOW_MS, type CaptureFeatures, type CaptureProgress, type CaptureWork} from '@jimmie-potts/event-contracts/v2/music-capture';
import {Outcome, SdkError, type Command, type RemoteEndpoint, type RemoteParticipant, type Reply, type Scheduler} from '@jimmie-potts/sdk';
import {systemClock, systemScheduler, type NativeRun, type NativeSource, type NativeTermination} from './native.js';
import {nativeFailure, type NativeFailure, type NativeFrame} from './protocol.js';
import {CaptureClock, coreClockQualified, type ClockReading} from './timing.js';

type Operation = {operationId: string; traceparent: string};
type Session = {
  generation: string; start: Operation; stop: Operation | null;
  phase: 'qualifying' | 'starting' | 'reporting-start' | 'active' | 'stopping';
  run: NativeRun | null; clock: CaptureClock; pending: NativeFrame | null;
  failure: NativeFailure | null; ending: boolean; cancelStartup: () => void;
};
export type ProducerOptions = {participant: Pick<RemoteParticipant, 'openEndpoint' | 'close'>; native: NativeSource;
  clock?: () => ClockReading; scheduler?: Scheduler};
const schema = (family: string): string => `https://bunny.invalid/events/${family}/2.0`;

/** One connection-bound endpoint and one explicitly issued capture generation. */
export class MusicProducer {
  readonly closed: Promise<NativeTermination>;
  #resolveClosed: (result: NativeTermination) => void = () => {};
  readonly #participant: ProducerOptions['participant'];
  readonly #native: NativeSource;
  readonly #clock: () => ClockReading;
  readonly #scheduler: Scheduler;
  #endpoint: RemoteEndpoint | undefined;
  #session: Session | undefined;
  #opened = false;
  #ready = false;
  #registrationClock: ClockReading | undefined;
  #closed = false;
  #closing = false;
  #blocked = false;
  #terminated: {generation: string; result: NativeTermination} | undefined;
  #lastPublishedMs = -Infinity;
  #lastSequence = 0;
  #publishing = false;
  #reportingCleanup = false;
  #cancelPublication: (() => void) | undefined;
  #progressTail = Promise.resolve();
  constructor({participant, native, clock = systemClock, scheduler = systemScheduler}: ProducerOptions) {
    this.#participant = participant; this.#native = native; this.#clock = clock; this.#scheduler = scheduler;
    this.closed = new Promise(resolve => {this.#resolveClosed = resolve;});
  }
  async start(): Promise<void> {
    if (this.#opened || this.#closed) throw new SdkError(errorBody('invalid-state'));
    this.#opened = true;
    try {
      const endpoint = await this.#participant.openEndpoint<CaptureWork>({family: 'music-capture-work',
        respond: command => this.#work(command), onClosed: () => this.#lost()});
      if (this.#closed || this.#closing) {await endpoint.close(); throw new SdkError(errorBody('unavailable'));}
      this.#endpoint = endpoint;
      const sent = this.#clock();
      const answer = await endpoint.request('music-capture-endpoint', {type: 'org.bunny.music-capture.endpoint.requested',
        dataschema: schema('music-capture-endpoint'), data: {requestId: randomUUID(), action: 'enable', input: 'music'}}, {timeoutMs: 2000});
      const received = this.#clock();
      if (this.#closed || this.#closing || answer.status !== 'accepted' || answer.reply.source !== 'bunny/core' ||
        !coreClockQualified({sent, received, replyAtMs: Date.parse(answer.reply.time)})) throw new SdkError(errorBody('unavailable'));
      this.#registrationClock = received; this.#ready = true;
    } catch {
      this.#lost();
      throw new SdkError(errorBody('unavailable', {detail: 'Music producer registration or clock qualification failed.'}));
    }
  }
  async stop(): Promise<NativeTermination> {
    if (this.#closing || this.#closed) return this.closed;
    this.#closing = true; this.#ready = false;
    const session = this.#session;
    if (session !== undefined) {
      this.#fence(session);
      if (session.run !== null) await session.run.stop();
    }
    const endpoint = this.#endpoint;
    if (!this.#closed && endpoint !== undefined) {
      try {await endpoint.request('music-capture-endpoint', {type: 'org.bunny.music-capture.endpoint.requested',
        dataschema: schema('music-capture-endpoint'), data: {requestId: randomUUID(), action: 'disable'}}, {timeoutMs: 2000});} catch { /* Endpoint loss carries the same authority fence. */ }
    }
    this.#lost();
    await this.#participant.close();
    return this.closed;
  }
  #lost(): void {
    if (this.#closed) return;
    this.#closed = true; this.#ready = false;
    this.#cancelPublication?.(); this.#cancelPublication = undefined;
    const session = this.#session;
    if (session !== undefined) this.#fence(session);
    const cleanup = session?.run?.stop() ?? Promise.resolve(this.#terminated?.result ?? {status: 'stopped'});
    void cleanup.then(this.#resolveClosed, () => this.#resolveClosed({status: Outcome.uncertain, error: nativeFailure('uncertain-result')}));
    void this.#participant.close().catch(() => {});
  }
  #work(command: Command<CaptureWork>): Reply {
    if (command.source !== 'bunny/core' || command.subject !== this.#endpoint?.id) return errorBody('forbidden');
    if (!this.#ready || this.#closed || this.#closing) return errorBody('invalid-state');
    const deadline = Date.parse(command.expiresat ?? '');
    if (!Number.isFinite(deadline) || deadline <= this.#clock().wallMs) return errorBody('expired');
    const work = command.data;
    if (work.action === 'start') {
      if (work.input !== 'music') return errorBody('unsupported-capability');
      if (this.#blocked || this.#terminated?.generation === work.generation) return errorBody('invalid-state');
      if (this.#session !== undefined) return errorBody('capacity');
      const session: Session = {generation: work.generation, start: {operationId: work.operationId, traceparent: command.traceparent},
        stop: null, phase: 'qualifying', run: null, clock: new CaptureClock(this.#registrationClock ?? this.#clock()), pending: null, failure: null,
        ending: false, cancelStartup: () => {}};
      this.#session = session; this.#lastSequence = 0;
      session.cancelStartup = this.#scheduler.after(5000, () => this.#fail(session, nativeFailure('unavailable')));
      void this.#begin(session);
      return {status: 'accepted'};
    }
    const session = this.#session;
    if (this.#terminated?.generation === work.generation && (session === undefined || session.ending)) {
      if (this.#reportingCleanup) return errorBody('capacity');
      this.#reportingCleanup = true;
      const progress = this.#cleanupProgress(work, this.#terminated.result);
      void this.#progress(progress, command.traceparent).then(() => {this.#reportingCleanup = false;}, () => {
        this.#reportingCleanup = false; this.#lost();
      });
      return {status: 'accepted'};
    }
    if (session === undefined || work.generation !== session.generation) return errorBody('not-found');
    if (session.stop !== null) return errorBody('capacity');
    session.stop = {operationId: work.operationId, traceparent: command.traceparent};
    this.#fence(session);
    if (session.run === null) void this.#ended(session, {status: 'stopped'});
    else void session.run.stop();
    return {status: 'accepted'};
  }
  async #begin(session: Session): Promise<void> {
    try {
      const now = this.#clock();
      if (session.clock.timestamps(now.monotonicMs, now) === undefined) {this.#fail(session, nativeFailure('unavailable')); return;}
      const qualified = await this.#native.qualifyClock();
      if (!this.#current(session) || session.phase !== 'qualifying') return;
      if (!qualified || !session.clock.valid) {this.#fail(session, nativeFailure('unavailable')); return;}
      session.phase = 'starting';
      session.run = this.#native.start(frame => this.#frame(session, frame));
      void session.run.ended.then(result => this.#ended(session, result), () => this.#ended(session, {status: Outcome.uncertain, error: nativeFailure('uncertain-result')}));
    } catch {this.#fail(session, nativeFailure('unavailable'));}
  }
  #current(session: Session): boolean {return this.#session === session && !this.#closed && !this.#closing;}
  #fence(session: Session): void {
    session.phase = 'stopping'; session.pending = null; session.cancelStartup();
    this.#cancelPublication?.(); this.#cancelPublication = undefined;
  }
  #fail(session: Session, error: NativeFailure): void {
    if (!this.#current(session) || session.ending) return;
    session.failure ??= error; this.#fence(session);
    if (session.run === null) void this.#ended(session, {status: Outcome.failed, error});
    else void session.run.stop();
  }
  async #ended(session: Session, result: NativeTermination): Promise<void> {
    if (session.ending) return;
    session.ending = true; this.#fence(session);
    this.#terminated = {generation: session.generation, result};
    if (!this.#current(session)) return;
    if (result.status === Outcome.uncertain) this.#blocked = true;
    const operation = session.stop ?? session.start;
    const progress: CaptureProgress = session.stop !== null ? this.#cleanupProgress({operationId: operation.operationId, generation: session.generation}, result)
      : result.status === Outcome.uncertain
      ? {operationId: operation.operationId, generation: session.generation, ...result}
      : session.failure !== null ? {operationId: operation.operationId, generation: session.generation, status: Outcome.failed, error: session.failure}
        : {operationId: operation.operationId, generation: session.generation, ...result};
    try {await this.#progress(progress, operation.traceparent);} catch {this.#lost();}
    if (this.#session === session) this.#session = undefined;
  }
  #cleanupProgress(operation: Pick<CaptureWork, 'operationId' | 'generation'>, result: NativeTermination): CaptureProgress {
    const {operationId, generation} = operation;
    return result.status === Outcome.uncertain ? {operationId, generation, ...result} : {operationId, generation, status: 'stopped'};
  }
  #frame(session: Session, frame: NativeFrame): void {
    if (!this.#current(session) || session.phase === 'stopping' || session.ending) return;
    const now = this.#clock();
    if (frame.emittedMonotonicMs > now.monotonicMs) {this.#fail(session, nativeFailure('invalid-message')); return;}
    const timestamp = session.clock.timestamps(frame.endMonotonicMs, now);
    if (timestamp === undefined) {if (!session.clock.valid) this.#fail(session, nativeFailure('unavailable')); return;}
    session.pending = frame;
    if (session.phase === 'starting') {
      session.cancelStartup(); session.phase = 'reporting-start';
      void this.#progress({operationId: session.start.operationId, generation: session.generation, status: 'started'}, session.start.traceparent).then(() => {
        if (this.#current(session) && session.phase === 'reporting-start') {session.phase = 'active'; this.#pump(session);}
      }, () => this.#lost());
    } else if (session.phase === 'active') this.#pump(session);
  }
  #progress(data: CaptureProgress, traceparent: string): Promise<void> {
    const send = async (): Promise<void> => {
      const endpoint = this.#endpoint;
      if (this.#closed || this.#closing || endpoint === undefined) throw new SdkError(errorBody('unavailable'));
      await endpoint.publish('music-capture-progress', {kind: 'occurrence', type: 'org.bunny.music-capture.progress.observed',
        dataschema: schema('music-capture-progress'), data}, {parent: {traceparent}});
    };
    const pending = this.#progressTail.then(send);
    this.#progressTail = pending.catch(() => {});
    return pending;
  }
  #pump(session: Session): void {
    if (!this.#current(session) || session.phase !== 'active' || this.#publishing || session.pending === null || this.#cancelPublication !== undefined) return;
    const now = this.#clock();
    const wait = Math.max(0, CAPTURE_WINDOW_MS - (now.monotonicMs - this.#lastPublishedMs));
    if (wait > 0) {
      this.#cancelPublication = this.#scheduler.after(wait, () => {this.#cancelPublication = undefined; this.#pump(session);});
      return;
    }
    const frame = session.pending; session.pending = null;
    const times = session.clock.timestamps(frame.endMonotonicMs, now);
    if (times === undefined) {if (!session.clock.valid) this.#fail(session, nativeFailure('unavailable')); return;}
    const endpoint = this.#endpoint;
    if (endpoint === undefined) return;
    const data: CaptureFeatures = {...frame, ...times, generation: session.generation, input: 'music',
      discontinuity: frame.discontinuity || frame.sequence !== this.#lastSequence + 1};
    this.#lastSequence = frame.sequence; this.#lastPublishedMs = now.monotonicMs; this.#publishing = true;
    void endpoint.publish('music-capture-features', {kind: 'occurrence', type: 'org.bunny.music-capture.features.observed',
      dataschema: schema('music-capture-features'), data}, {parent: {traceparent: session.start.traceparent}}).then(() => {
      this.#publishing = false;
      if (this.#session !== undefined) this.#pump(this.#session);
    }, () => {this.#publishing = false; this.#lost();});
  }
}
