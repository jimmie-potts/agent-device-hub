import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {MUSIC_PLAYBACK_CLOCK_DRIFT_MS, MUSIC_PLAYBACK_CLOCK_SKEW_MS, MUSIC_PLAYBACK_RESULT_MS, MUSIC_PLAYBACK_SOURCE,
  type MusicPlaybackAction, type MusicPlaybackEndpoint, type MusicPlaybackLost, type MusicPlaybackObservation,
  type MusicPlaybackResult, type MusicPlaybackSample, type MusicPlaybackWork} from '@jimmie-potts/event-contracts/v2/music-playback';
import type {Cancel, Clock, Command, Scheduler, Sdk, TraceContext} from '@jimmie-potts/sdk';
import {STALE_MS, type PlaybackObservation} from './playback.js';

export type MusicTarget = {endpointId: string; processEpoch: string};
type Pending = {target: MusicTarget; action: MusicPlaybackAction; resolve: ((result: MusicPlaybackResult) => void) | undefined;
  cancel: Cancel; seen: Set<MusicPlaybackResult['status']>};
type Options = {sdk: Sdk; clock: Clock; scheduler: Scheduler; monotonic: () => number; signal: AbortSignal; enabled: boolean;
  onChange: () => void; onLateResult: (result: MusicPlaybackResult) => void | Promise<void>};
const schema = (family: string): string => `https://bunny.invalid/events/${family}/2.0`;
const result = (operationId: string, target: MusicTarget, action: MusicPlaybackAction,
  status: 'unsent' | 'uncertain', code: 'unavailable' | 'expired' | 'invalid-state' | 'uncertain-result'): MusicPlaybackResult =>
  ({operationId, processEpoch: target.processEpoch, action, status, error: errorBody(code).error});

/** One push source and bounded endpoint correlations; durable commands remain in the playback owner. */
export class MusicPlaybackInput {
  readonly #options: Options;
  #endpoint: {id: string; libraryScopeId: string} | undefined;
  readonly #retiredIds = new Set<string>();
  #sample: MusicPlaybackSample | undefined;
  #sequence = 0;
  #processEpoch: string | undefined;
  #clock: {wall: number; monotonic: number} | undefined;
  #lastMonotonic = 0;
  #reason: 'missing' | 'clock' | 'disconnected' = 'missing';
  readonly #pending = new Map<string, Pending>();
  readonly #readWaiters = new Set<() => void>();
  constructor(options: Options) {
    this.#options = options;
    options.signal.addEventListener('abort', () => {this.#retire('disconnected');}, {once: true});
  }
  get sample(): MusicPlaybackSample | undefined {return this.#sample === undefined ? undefined : structuredClone(this.#sample);}
  get endpointId(): string | undefined {return this.#endpoint?.id;}
  get reason(): 'missing' | 'clock' | 'disconnected' {return this.#reason;}
  get generation(): string {return `${this.#endpoint?.id ?? ''}/${this.#processEpoch ?? ''}`;}
  observation(): {value: PlaybackObservation; observedAtMs: number} | undefined {
    const sample = this.#sample;
    if (sample?.state.status !== 'observed') return undefined;
    const state = sample.state.value;
    const text = (field: typeof sample.metadata.title): string | undefined => {
      if (field.status !== 'observed') return undefined;
      const value = field.value.trim();
      return value === '' ? undefined : value;
    };
    const title = text(sample.metadata.title), artist = text(sample.metadata.artist), album = text(sample.metadata.album);
    return {observedAtMs: sample.state.interval.earliestAtMs, value: {
      status: state === 'fast-forwarding' || state === 'rewinding' ? 'unknown' : state,
      controls: state === 'playing' ? ['pause', 'next', 'previous'] : state === 'paused' ? ['play', 'next', 'previous'] : [],
      ...(title === undefined ? {} : {title}), ...(artist === undefined ? {} : {artist}), ...(album === undefined ? {} : {album}),
    }};
  }
  target(): MusicTarget | undefined {
    if (!this.#clockValid()) return undefined;
    const sample = this.#sample, endpoint = this.#endpoint;
    return sample?.state.status === 'observed' && endpoint !== undefined && this.#options.clock.now() - sample.state.interval.earliestAtMs < STALE_MS
      ? {endpointId: endpoint.id, processEpoch: sample.processEpoch} : undefined;
  }
  async start(): Promise<void> {
    const {sdk} = this.#options;
    await sdk.respond<MusicPlaybackEndpoint>('bunny.cmd.music-playback-endpoint.*', command => this.#register(command));
    await sdk.subscribe<MusicPlaybackObservation>('bunny.event.music-playback-observation.*', message => {this.#observe(message);},
      {onOverflow: () => {this.#retire('disconnected');}});
    await sdk.subscribe<MusicPlaybackResult>('bunny.event.music-playback-result.*', message => this.#receiveResult(message),
      {onOverflow: () => {this.#retire('disconnected');}});
    await sdk.subscribe<MusicPlaybackLost>('bunny.event.music-playback-lost.*', message => {
      if (message.source === 'bunny/runtime/gateway' && message.data.id === this.#endpoint?.id) this.#retire('disconnected');
    }, {onOverflow: () => {this.#retire('disconnected');}});
  }
  #register(command: Command<MusicPlaybackEndpoint>) {
    if (command.source !== MUSIC_PLAYBACK_SOURCE) return errorBody('forbidden', {detail: 'only the configured Music playback producer may register'});
    if (!this.#options.enabled) return errorBody('unsupported-capability', {detail: 'Music is not configured as a playback source'});
    if (this.#options.signal.aborted) return errorBody('unavailable', {detail: 'the playback module is stopping'});
    if (command.data.action === 'disable') {
      if (command.subject === this.#endpoint?.id) this.#retire('disconnected');
      return {status: 'accepted' as const};
    }
    if (this.#retiredIds.has(command.subject)) return errorBody('invalid-state', {detail: 'a retired Music endpoint requires a new connection'});
    if (this.#retiredIds.size >= 64) return errorBody('capacity', {detail: 'the Music endpoint retirement limit requires an owner restart'});
    if (this.#endpoint !== undefined) return this.#endpoint.id === command.subject && this.#endpoint.libraryScopeId === command.data.libraryScopeId
      ? {status: 'accepted' as const} : errorBody('capacity', {detail: 'one Music playback endpoint is already registered'});
    this.#endpoint = {id: command.subject, libraryScopeId: command.data.libraryScopeId};
    this.#sequence = 0; this.#processEpoch = undefined; this.#sample = undefined;
    this.#clock = {wall: this.#options.clock.now(), monotonic: this.#options.monotonic()};
    this.#lastMonotonic = this.#clock.monotonic; this.#reason = 'missing';
    this.#options.onChange();
    return {status: 'accepted' as const};
  }
  #clockValid(): boolean {
    const origin = this.#clock;
    if (origin === undefined || this.#endpoint === undefined || this.#options.signal.aborted) return false;
    const wall = this.#options.clock.now(), monotonic = this.#options.monotonic();
    if (!Number.isSafeInteger(wall) || !Number.isFinite(monotonic) || monotonic < this.#lastMonotonic
      || Math.abs(wall - origin.wall - (monotonic - origin.monotonic)) > MUSIC_PLAYBACK_CLOCK_DRIFT_MS) {
      this.#retire('clock'); return false;
    }
    this.#lastMonotonic = monotonic;
    return true;
  }
  #observe(message: Message<MusicPlaybackObservation>): void {
    const endpoint = this.#endpoint, observation = message.data;
    if (message.source !== MUSIC_PLAYBACK_SOURCE || endpoint === undefined || message.subject !== endpoint.id || !this.#clockValid()) return;
    if (observation.sequence <= this.#sequence) return;
    const now = this.#options.clock.now();
    if (observation.interval.latestAtMs > now + MUSIC_PLAYBACK_CLOCK_SKEW_MS || observation.interval.earliestAtMs > now
      || now - observation.interval.earliestAtMs >= 30_000) return;
    if (observation.status === 'sample' && observation.state.status === 'observed' && observation.state.interval.earliestAtMs > now) {
      this.#retire('clock'); return;
    }
    const sequenceGap = observation.sequence !== this.#sequence + 1;
    if (observation.status === 'unavailable') {
      this.#sequence = observation.sequence;
      // Missing read evidence disables controls; it does not disprove an earlier
      // transmission from this still-live endpoint and its last known process.
      this.#sample = undefined; this.#reason = 'missing';
    } else {
      if (observation.libraryScopeId !== endpoint.libraryScopeId) {this.#retire('disconnected'); return;}
      if (this.#sample !== undefined && observation.interval.earliestAtMs < this.#sample.interval.earliestAtMs) return;
      const previous = this.#sample;
      const identityChanged = previous?.item.status !== 'observed' || observation.item.status !== 'observed'
        || previous.item.value !== observation.item.value || previous.processEpoch !== observation.processEpoch;
      let positionStep = false;
      if (previous?.position.status === 'observed' && observation.position.status === 'observed') {
        const elapsed = Math.max(0, observation.position.interval.earliestAtMs - previous.position.interval.earliestAtMs) / 1000;
        const expected = previous.position.value + (previous.state.status === 'observed' && previous.state.value === 'playing' ? elapsed : 0);
        const intervalError = (observation.position.interval.latestAtMs - observation.position.interval.earliestAtMs
          + previous.position.interval.latestAtMs - previous.position.interval.earliestAtMs) / 1000;
        positionStep = Math.abs(observation.position.value - expected) > 1 + intervalError;
      }
      if (this.#processEpoch !== undefined && this.#processEpoch !== observation.processEpoch) this.#finishPending();
      this.#processEpoch = observation.processEpoch;
      this.#sequence = observation.sequence;
      this.#sample = {...structuredClone(observation), discontinuity: observation.discontinuity || sequenceGap || identityChanged || positionStep};
      this.#reason = 'missing';
    }
    for (const resolve of [...this.#readWaiters]) resolve();
    this.#options.onChange();
  }
  #finishPending(): void {
    for (const [operationId, pending] of this.#pending) {
      this.#settle(pending, result(operationId, pending.target, pending.action, 'uncertain', 'uncertain-result'));
    }
    this.#pending.clear();
  }
  #retire(reason: 'clock' | 'disconnected'): void {
    if (this.#endpoint !== undefined) this.#retiredIds.add(this.#endpoint.id);
    this.#endpoint = undefined; this.#sample = undefined; this.#processEpoch = undefined; this.#clock = undefined; this.#reason = reason;
    this.#finishPending();
    for (const resolve of [...this.#readWaiters]) resolve();
    this.#options.onChange();
  }
  #settle(pending: Pending, value: MusicPlaybackResult): void {
    const resolve = pending.resolve;
    pending.resolve = undefined; pending.cancel();
    resolve?.(value);
  }
  async #receiveResult(message: Message<MusicPlaybackResult>): Promise<void> {
    const value = message.data, pending = this.#pending.get(value.operationId);
    if (message.source !== MUSIC_PLAYBACK_SOURCE || pending === undefined || this.#options.signal.aborted
      || message.subject !== this.#endpoint?.id || message.subject !== pending.target.endpointId
      || value.processEpoch !== this.#processEpoch || value.processEpoch !== pending.target.processEpoch || value.action !== pending.action
      || pending.seen.has(value.status)) return;
    pending.seen.add(value.status);
    if (pending.resolve !== undefined) this.#settle(pending, value);
    else if (value.status !== 'uncertain') await this.#options.onLateResult(value);
  }
  dispatch(action: MusicPlaybackAction, target: MusicTarget, operationId: string, expiresAtMs: number, parent: TraceContext): Promise<MusicPlaybackResult> {
    const current = this.target();
    if (current?.endpointId !== target.endpointId || current.processEpoch !== target.processEpoch)
      return Promise.resolve(result(operationId, target, action, 'unsent', 'unavailable'));
    const remaining = expiresAtMs - this.#options.clock.now();
    if (remaining <= 0) return Promise.resolve(result(operationId, target, action, 'unsent', 'expired'));
    if (this.#pending.has(operationId)) return Promise.resolve(result(operationId, target, action, 'unsent', 'invalid-state'));
    while (this.#pending.size >= 64) {
      const oldest = this.#pending.keys().next().value;
      if (oldest === undefined) break;
      this.#pending.delete(oldest);
    }
    return new Promise(resolve => {
      const pending: Pending = {target: {...target}, action, resolve, cancel: () => {}, seen: new Set()};
      this.#pending.set(operationId, pending);
      pending.cancel = this.#options.scheduler.after(MUSIC_PLAYBACK_RESULT_MS, () => {
        this.#settle(pending, result(operationId, target, action, 'uncertain', 'uncertain-result'));
      });
      void this.#options.sdk.request<Omit<MusicPlaybackWork, 'requestId'>>(`bunny.cmd.music-playback-work.${target.endpointId}`, {
        type: 'org.bunny.music-playback.work.requested', subject: target.endpointId, dataschema: schema('music-playback-work'),
        data: {operationId, processEpoch: target.processEpoch, action},
      }, {parent, requestId: operationId, timeoutMs: Math.max(1, Math.min(remaining, MUSIC_PLAYBACK_RESULT_MS))}).then(reply => {
        if (pending.resolve === undefined || reply.status === 'accepted') return;
        const status = reply.status === 'rejected' ? 'unsent' : 'uncertain';
        this.#settle(pending, {operationId, processEpoch: target.processEpoch, action, status,
          error: errorBody(reply.error.error.code).error});
      }, () => {this.#settle(pending, result(operationId, target, action, 'uncertain', 'uncertain-result'));});
    });
  }
  /** Give the producer's post-control read a bounded chance before the next command's admission. */
  readAfter(timeoutMs: number): Promise<void> {
    if (this.#options.signal.aborted || this.#endpoint === undefined) return Promise.resolve();
    return new Promise(resolve => {
      let cancel: Cancel = () => {};
      const done = (): void => {cancel(); this.#readWaiters.delete(done); resolve();};
      this.#readWaiters.add(done);
      cancel = this.#options.scheduler.after(timeoutMs, done);
    });
  }
}
