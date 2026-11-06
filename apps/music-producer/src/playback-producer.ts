import {randomUUID} from 'node:crypto';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {MUSIC_PLAYBACK_OWNER, MUSIC_PLAYBACK_CLOCK_SKEW_MS, MUSIC_PLAYBACK_POLL_MS, MUSIC_PLAYBACK_WORK_MS,
  type MusicPlaybackObservation, type MusicPlaybackResult, type MusicPlaybackWork} from '@jimmie-potts/event-contracts/v2/music-playback';
import {Outcome, SdkError, type Command, type RemoteEndpoint, type RemoteParticipant, type Reply, type Scheduler} from '@jimmie-potts/sdk';
import {systemClock, systemScheduler, type NativeTermination} from './native.js';
import type {PlaybackNativeControlResult, PlaybackNativeReadResult, PlaybackNativeSource} from './playback-native.js';
import type {NativePlaybackRead, NativePlaybackSample} from './playback-protocol.js';
import {PlaybackClock} from './playback-timing.js';
import {coreClockQualified, type ClockReading} from './timing.js';

export type PlaybackProducerOptions = {participant: Pick<RemoteParticipant, 'openEndpoint' | 'close'>; native: PlaybackNativeSource;
  libraryScopeId: string; clock?: () => ClockReading; scheduler?: Scheduler};
type Operation = {work: MusicPlaybackWork; traceparent: string; controller: AbortController; deadlineMonotonicMs: number};
const schema = (family: string): string => `https://bunny.invalid/events/${family}/2.0`;
const uncertain = (): NativeTermination => ({status: Outcome.uncertain, error: errorBody('uncertain-result').error});

/** One explicitly started observation loop and one connection-bound Music command authority. */
export class MusicPlaybackProducer {
  readonly closed: Promise<NativeTermination>;
  #resolveClosed: (value: NativeTermination) => void = () => {};
  readonly #participant: PlaybackProducerOptions['participant'];
  readonly #native: PlaybackNativeSource;
  readonly #libraryScopeId: string;
  readonly #now: () => ClockReading;
  readonly #scheduler: Scheduler;
  #endpoint: RemoteEndpoint | undefined;
  #mapping: PlaybackClock | undefined;
  #opened = false;
  #ready = false;
  #ending: Promise<NativeTermination> | undefined;
  #ended = false;
  #cancelPoll: (() => void) | undefined;
  #polling = false;
  #read: {controller: AbortController; pending: Promise<PlaybackNativeReadResult>} | undefined;
  #readGeneration = 0;
  #operation: Operation | undefined;
  #sequence = 0;
  #instance: {native: string; epoch: string} | undefined;
  #latest: NativePlaybackSample | undefined;
  readonly #operations = new Map<string, {processEpoch: string; action: MusicPlaybackWork['action']}>();
  constructor({participant, native, libraryScopeId, clock = systemClock, scheduler = systemScheduler}: PlaybackProducerOptions) {
    if (libraryScopeId.length > 128 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(libraryScopeId)) throw new SdkError(errorBody('invalid-request'));
    this.#participant = participant; this.#native = native; this.#libraryScopeId = libraryScopeId; this.#now = clock; this.#scheduler = scheduler;
    this.closed = new Promise(resolve => {this.#resolveClosed = resolve;});
  }
  async start(): Promise<void> {
    if (this.#opened || this.#ended) throw new SdkError(errorBody('invalid-state'));
    this.#opened = true;
    try {
      const endpoint = await this.#participant.openEndpoint<MusicPlaybackWork>({family: 'music-playback-work',
        respond: command => this.#work(command), onClosed: () => {void this.#end(false);}});
      if (this.#ended) {await endpoint.close(); throw new SdkError(errorBody('unavailable'));}
      this.#endpoint = endpoint;
      const sent = this.#now();
      const answer = await endpoint.request('music-playback-endpoint', {type: 'org.bunny.music-playback.endpoint.requested',
        dataschema: schema('music-playback-endpoint'), data: {requestId: randomUUID(), action: 'enable', libraryScopeId: this.#libraryScopeId}}, {timeoutMs: 2000});
      const received = this.#now();
      if (this.#ended || answer.status !== 'accepted' || answer.reply.source !== MUSIC_PLAYBACK_OWNER ||
        !coreClockQualified({sent, received, replyAtMs: Date.parse(answer.reply.time)})) throw new SdkError(errorBody('unavailable'));
      this.#mapping = new PlaybackClock(received);
      if (!await this.#native.qualifyClock() || this.#ended || !this.#mapping.check(this.#now())) throw new SdkError(errorBody('unavailable'));
      this.#ready = true; void this.#poll();
    } catch {
      await this.#end(false);
      throw new SdkError(errorBody('unavailable', {detail: 'Music playback registration or clock qualification failed.'}));
    }
  }
  stop(): Promise<NativeTermination> {return this.#end(true);}
  #end(disable: boolean): Promise<NativeTermination> {
    if (this.#ending !== undefined) return this.#ending;
    this.#ended = true; this.#ready = false; this.#readGeneration += 1;
    this.#cancelPoll?.(); this.#cancelPoll = undefined; this.#read?.controller.abort(); this.#operation?.controller.abort();
    this.#ending = (async () => {
      let result: NativeTermination;
      try {result = await this.#native.close();} catch {result = uncertain();}
      if (disable && this.#endpoint !== undefined) {
        try {await this.#endpoint.request('music-playback-endpoint', {type: 'org.bunny.music-playback.endpoint.requested',
          dataschema: schema('music-playback-endpoint'), data: {requestId: randomUUID(), action: 'disable'}}, {timeoutMs: 2000});} catch { /* Stream closure also retires authority. */ }
      }
      try {await this.#participant.close();} catch { /* Local native ownership remains the cleanup result. */ }
      this.#resolveClosed(result); return result;
    })();
    return this.#ending;
  }
  #schedule(delay = MUSIC_PLAYBACK_POLL_MS): void {
    if (!this.#ready || this.#ended || this.#operation !== undefined || this.#cancelPoll !== undefined) return;
    this.#cancelPoll = this.#scheduler.after(delay, () => {this.#cancelPoll = undefined; void this.#poll();});
  }
  async #poll(): Promise<void> {
    if (!this.#ready || this.#ended || this.#polling || this.#operation !== undefined) return;
    const mapping = this.#mapping, start = this.#now();
    if (mapping === undefined || !mapping.check(start)) {void this.#end(false); return;}
    this.#polling = true;
    const generation = this.#readGeneration, controller = new AbortController();
    let cleanupUnknown = false;
    try {
      const pending = this.#native.read({signal: controller.signal}); this.#read = {controller, pending};
      const result = await pending;
      this.#read = undefined;
      if (this.#ended || generation !== this.#readGeneration) return;
      const now = this.#now();
      if (!mapping.check(now)) {void this.#end(false); return;}
      cleanupUnknown = result.cleanup === 'uncertain';
      const record: NativePlaybackRead = result.status === 'record' ? result.record : {schema: 'music-playback-read/1.0', status: 'unavailable',
        error: result.error, interval: {startedMonotonicMs: start.monotonicMs, endedMonotonicMs: now.monotonicMs}};
      const previous = this.#latest;
      let discontinuity = previous === undefined || record.status === 'unavailable';
      if (record.status === 'sample') {
        if (this.#instance?.native !== record.sourceInstance) {this.#instance = {native: record.sourceInstance, epoch: randomUUID()}; discontinuity = true;}
        if (record.item.status !== 'observed' || previous?.item.status !== 'observed' || record.item.value !== previous.item.value) discontinuity = true;
        if (previous?.position.status === 'observed' && record.position.status === 'observed') {
          const elapsed = (record.position.interval.startedMonotonicMs - previous.position.interval.endedMonotonicMs) / 1000;
          const change = record.position.value - previous.position.value;
          if (change < -1 || change > Math.max(0, elapsed) + 2 || previous.state.status === 'observed' && previous.state.value === 'paused' && Math.abs(change) > 1) discontinuity = true;
        }
        this.#latest = record;
      } else this.#latest = undefined;
      const observation = mapping.observation(record, {sequence: ++this.#sequence, processEpoch: this.#instance?.epoch ?? '',
        libraryScopeId: this.#libraryScopeId, discontinuity});
      await this.#publishObservation(observation);
    } catch {cleanupUnknown = true;} finally {
      this.#read = undefined; this.#polling = false;
      if (cleanupUnknown) void this.#end(false);
      else this.#schedule(Math.max(0, MUSIC_PLAYBACK_POLL_MS - (this.#now().monotonicMs - start.monotonicMs)));
    }
  }
  async #publishObservation(data: MusicPlaybackObservation): Promise<void> {
    const endpoint = this.#endpoint;
    if (!this.#ready || this.#ended || endpoint === undefined) return;
    if (this.#mapping?.check(this.#now()) !== true) {void this.#end(false); return;}
    await endpoint.publish('music-playback-observation', {kind: 'occurrence', type: 'org.bunny.music-playback.observed', dataschema: schema('music-playback-observation'), data});
  }
  #work(command: Command<MusicPlaybackWork>): Reply {
    if (command.source !== MUSIC_PLAYBACK_OWNER || command.subject !== this.#endpoint?.id) return errorBody('forbidden');
    if (!this.#ready || this.#ended || this.#mapping?.check(this.#now()) !== true) {void this.#end(false); return errorBody('invalid-state');}
    const work = command.data, prior = this.#operations.get(work.operationId);
    if (prior !== undefined) return prior.processEpoch === work.processEpoch && prior.action === work.action ? {status: 'accepted'} : errorBody('duplicate-conflict');
    if (this.#operation !== undefined) return errorBody('capacity');
    const now = this.#now(), expiresAtMs = Date.parse(command.expiresat ?? '');
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.wallMs + MUSIC_PLAYBACK_CLOCK_SKEW_MS) return errorBody('expired');
    const latest = this.#latest;
    if (this.#instance?.epoch !== work.processEpoch || latest === undefined || latest.state.status !== 'observed' ||
      now.monotonicMs - latest.state.interval.startedMonotonicMs + MUSIC_PLAYBACK_CLOCK_SKEW_MS >= 5000) return errorBody('invalid-state');
    const state = latest.state.value;
    const capable = state === 'playing' ? work.action !== 'play' : state === 'paused' && work.action !== 'pause';
    if (!capable) return errorBody('unsupported-capability');
    const operation: Operation = {work, traceparent: command.traceparent, controller: new AbortController(),
      deadlineMonotonicMs: now.monotonicMs + Math.min(MUSIC_PLAYBACK_WORK_MS, expiresAtMs - now.wallMs - MUSIC_PLAYBACK_CLOCK_SKEW_MS)};
    this.#operation = operation; this.#operations.set(work.operationId, {processEpoch: work.processEpoch, action: work.action});
    while (this.#operations.size > 64) {const oldest = this.#operations.keys().next().value; if (oldest !== undefined) this.#operations.delete(oldest);}
    this.#readGeneration += 1; this.#cancelPoll?.(); this.#cancelPoll = undefined; this.#read?.controller.abort();
    void this.#control(operation, this.#instance.native);
    return {status: 'accepted'};
  }
  async #control(operation: Operation, expectedSourceInstance: string): Promise<void> {
    let result: PlaybackNativeControlResult;
    let controlInvoked = false;
    try {
      const priorRead = this.#read === undefined ? undefined : await this.#read.pending;
      const now = this.#now();
      if (this.#ended || operation !== this.#operation) return;
      if (priorRead?.cleanup === 'uncertain') result = {status: 'failure', cleanup: 'uncertain', mayHaveSent: false, error: errorBody('invalid-state').error};
      else if (this.#mapping?.check(now) !== true || now.monotonicMs >= operation.deadlineMonotonicMs) result = {
        status: 'failure', cleanup: 'confirmed', mayHaveSent: false, error: errorBody('expired').error};
      else {
        controlInvoked = true;
        result = await this.#native.control({action: operation.work.action, expectedSourceInstance,
          deadlineMonotonicMs: operation.deadlineMonotonicMs, signal: operation.controller.signal});
      }
    } catch {result = {status: 'failure', cleanup: 'uncertain', mayHaveSent: controlInvoked,
      error: errorBody(controlInvoked ? 'uncertain-result' : 'unavailable').error};}
    if (this.#ended || operation !== this.#operation || this.#endpoint === undefined) return;
    const {operationId, processEpoch, action} = operation.work;
    const base = {operationId, processEpoch, action};
    const data: MusicPlaybackResult = result.status === 'record'
      ? result.record.status === 'sent' ? {...base, status: 'sent'} : {...base, status: result.record.status,
        error: errorBody(result.record.status === 'uncertain' ? 'uncertain-result' : result.record.error.code).error}
      : result.mayHaveSent ? {...base, status: 'uncertain', error: errorBody('uncertain-result').error}
        : {...base, status: 'unsent', error: errorBody(result.error.code).error};
    try {
      await this.#endpoint.publish('music-playback-result', {kind: 'occurrence', type: 'org.bunny.music-playback.result.observed',
        dataschema: schema('music-playback-result'), data}, {parent: {traceparent: operation.traceparent}});
    } catch {void this.#end(false); return;}
    this.#operation = undefined;
    if (result.cleanup === 'uncertain' || this.#mapping?.check(this.#now()) !== true) void this.#end(false);
    else this.#schedule(0);
  }
}
