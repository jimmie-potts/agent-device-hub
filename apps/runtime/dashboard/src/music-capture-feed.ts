import {musicResponse, type MusicResponseValue} from '@jimmie-potts/nanoleaf/music-response';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {CAPTURE_CLOCK_DRIFT_MS, CAPTURE_MAX_CLOCK_SKEW_MS, CAPTURE_REGISTRATION_SKEW_MS, CAPTURE_VALIDITY_MS,
  CAPTURE_WINDOW_MS, MUSIC_PRODUCER_SOURCE, type CaptureFeatures, type CaptureState} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import type {RemoteParticipant, Scheduler, Subscription, SyncedCopy, SyncCompleted} from '@jimmie-potts/sdk/remote';
export type CaptureReading = {wallMs: number; monotonicMs: number};
export type MusicCaptureView = {synced: boolean; state: CaptureState | undefined; features: CaptureFeatures | undefined; response?: MusicResponseValue; clockQualified: boolean};
const finite = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const validReading = (value: CaptureReading): boolean => Number.isSafeInteger(value.wallMs) && finite(value.wallMs) && finite(value.monotonicMs);
type ClockAnchor = {sent: CaptureReading; received: CaptureReading; replyAt: number; lastMono: number};
const identity = (state: CaptureState | undefined): string => state?.session.status !== undefined && state.session.status !== 'idle'
  ? `${state.endpointId ?? ''}/${state.session.generation}/${state.session.input}/${state.session.input === 'microphone' ? state.session.microphoneId : ''}` : '';
export class CaptureProjection {
  view: MusicCaptureView = {synced: false, state: undefined, features: undefined, clockQualified: false};
  #clock: ClockAnchor | undefined;
  #sequence = 0;
  #sourceEnd = -1;
  #response: MusicResponseValue | undefined;
  #retiredResponseKey = '';
  #responseKey = '';
  #responseSequence = 0;
  #responseEnd = 0;
  synchronize(state: CaptureState, replyAt: number, sent: CaptureReading, received: CaptureReading): void {
    this.state(state);
    const elapsed = received.monotonicMs - sent.monotonicMs;
    const qualified = validReading(sent) && validReading(received) && Number.isSafeInteger(replyAt) && finite(replyAt) && elapsed >= 0 &&
      elapsed <= CAPTURE_REGISTRATION_SKEW_MS * 2 && Math.abs(received.wallMs - sent.wallMs - elapsed) <= CAPTURE_CLOCK_DRIFT_MS;
    this.#clock = qualified ? {sent, received, replyAt, lastMono: received.monotonicMs} : undefined;
    this.view = {...this.view, synced: true, clockQualified: qualified, features: undefined};this.#preview();
  }
  state(state: CaptureState): void {
    if (identity(state) !== identity(this.view.state)) {this.#sequence = 0; this.#sourceEnd = -1; this.view = {...this.view, features: undefined};}
    this.view = {...this.view, state, ...(state.availability !== 'available' || state.session.status !== 'active' ? {features: undefined} : {})};
    this.#preview();
  }
  feature(message: Message<CaptureFeatures>, now: CaptureReading): void {
    const bounds = this.bounds(now), state = this.view.state, frame = message.data;
    if (bounds === undefined || !this.view.synced || state?.availability !== 'available' || state.session.status !== 'active' ||
      message.source !== MUSIC_PRODUCER_SOURCE || message.subject !== state.endpointId || message.kind !== 'occurrence' ||
      !['https://bunny.invalid/events/music-capture-features/2.0', 'https://bunny.invalid/events/music-capture-features/2.1'].includes(message.dataschema) ||
      message.type !== 'org.bunny.music-capture.features.observed' || frame.generation !== state.session.generation || frame.input !== state.session.input ||
      (frame.input === 'microphone' && (message.dataschema.endsWith('/2.0') || state.session.input !== 'microphone' || frame.microphoneId !== state.session.microphoneId))) return;
    if (!Number.isSafeInteger(frame.sequence) || frame.sequence <= this.#sequence || !finite(frame.startMonotonicMs) || !finite(frame.endMonotonicMs) ||
      frame.endMonotonicMs <= this.#sourceEnd || Math.abs(frame.endMonotonicMs - frame.startMonotonicMs - CAPTURE_WINDOW_MS) > 0.01 ||
      !finite(frame.emittedMonotonicMs) || frame.emittedMonotonicMs < frame.endMonotonicMs ||
      !Number.isSafeInteger(frame.observedAtMs) || !finite(frame.observedAtMs) || !Number.isSafeInteger(frame.validUntilMs) ||
      frame.validUntilMs - frame.observedAtMs !== CAPTURE_VALIDITY_MS || frame.observedAtMs > bounds.lower + CAPTURE_MAX_CLOCK_SKEW_MS || frame.validUntilMs <= bounds.upper ||
      !finite(frame.rms) || frame.rms > 16 || !finite(frame.peak) || frame.peak > 16 || frame.rms > frame.peak + 1e-12 ||
      !finite(frame.clippedFraction) || frame.clippedFraction > 1 ||
      !Number.isSafeInteger(frame.sampleRateHz) || frame.sampleRateHz < 8000 || frame.sampleRateHz > 192000 || frame.sampleRateHz % 10 !== 0 ||
      (frame.channels !== 1 && frame.channels !== 2) || frame.frameCount * 1000 !== frame.sampleRateHz * CAPTURE_WINDOW_MS ||
      typeof frame.bands !== 'object' || frame.bands === null || ![frame.bands.bass, frame.bands.mid, frame.bands.treble].every(value => finite(value) && value <= 32)) return;
    const before = this.view.features;
    if (this.#sequence > 0 && (frame.discontinuity || frame.sequence !== this.#sequence + 1 || Math.abs(frame.startMonotonicMs - this.#sourceEnd) > 0.01 ||
      (before !== undefined && (before.validUntilMs <= bounds.upper || before.sampleRateHz !== frame.sampleRateHz || before.channels !== frame.channels)))) this.#retirePreview();
    const discontinuity = frame.discontinuity || this.#sequence === 0 || frame.sequence !== this.#sequence + 1;
    this.#sequence = frame.sequence; this.#sourceEnd = frame.endMonotonicMs;
    this.view = {...this.view, features: {...frame, discontinuity}};
    this.#preview();
  }
  bounds(now: CaptureReading): {lower: number; upper: number} | undefined {
    const clock = this.#clock;
    if (clock === undefined) return undefined;
    if (!validReading(now) || now.monotonicMs < clock.lastMono ||
      Math.abs(now.wallMs - clock.received.wallMs - (now.monotonicMs - clock.received.monotonicMs)) > CAPTURE_CLOCK_DRIFT_MS) {
      this.#clock = undefined; this.view = {...this.view, clockQualified: false, features: undefined}; this.#preview(); return undefined;
    }
    clock.lastMono = now.monotonicMs;
    return {lower: clock.replyAt + now.monotonicMs - clock.received.monotonicMs, upper: clock.replyAt + now.monotonicMs - clock.sent.monotonicMs};
  }
  tick(now: CaptureReading): void {
    const bounds = this.bounds(now);
    if (this.view.features !== undefined && (bounds === undefined || this.view.features.validUntilMs <= bounds.upper)) {
      this.#retirePreview();this.view = {...this.view, features: undefined};this.#preview();
    }
  }
  invalidate(): void {this.#clock = undefined; this.view = {...this.view, synced: false, features: undefined, clockQualified: false};this.#preview();}
  #retirePreview(): void {
    const state = this.view.state;
    if (state?.response !== undefined) this.#retiredResponseKey = JSON.stringify([identity(state), state.response.settingsRevision, state.response.appliedTo]);
  }
  #preview(): void {
    const state = this.view.state, frame = this.view.features, response = state?.response;
    const key = JSON.stringify([identity(state), response?.settingsRevision, response?.appliedTo]);
    const binding = response?.appliedTo;
    const qualified = frame?.input === 'microphone' && binding !== undefined && binding !== null && binding.endpointId === state?.endpointId &&
      binding.generation === frame.generation && binding.microphoneId === frame.microphoneId && binding.sampleRateHz === frame.sampleRateHz && binding.channels === frame.channels;
    if (frame?.input !== 'microphone' || response === undefined || (response.settings.gate.mode !== 'off' && (!qualified || key === this.#retiredResponseKey))) {
      this.#response = undefined;this.#responseKey = '';this.#responseSequence = 0;
      const {response: _previous, ...view} = this.view;this.view = view;return;
    }
    if (key !== this.#responseKey) {this.#response = undefined;this.#responseSequence = 0;this.#responseKey = key;}
    if (frame.sequence === this.#responseSequence) return;
    if (frame.discontinuity) this.#response = undefined;
    const value = musicResponse(response.settings, frame, this.#responseSequence === 0 ? 0 : Math.max(0, frame.endMonotonicMs - this.#responseEnd), this.#response);
    this.#response = value;
    this.#responseSequence = frame.sequence;this.#responseEnd = frame.endMonotonicMs;
    this.view = {...this.view, response: value};
  }
}

const reading = (): CaptureReading => ({wallMs: Date.now(), monotonicMs: performance.now()});
const timers: Scheduler = {after: (ms, callback) => {const timer = setTimeout(callback, ms); return () => clearTimeout(timer);}};
/** A copy's close waits for the edge with no deadline, so a refresh waits for a replaced copy's close at most this long (#1562). */
const REPLACED_CLOSE_WAIT_MS = 250;
type CaptureParticipant = Pick<RemoteParticipant, 'sync' | 'subscribe'>;
/** Read-only Audio-page scope. The dashboard supplies its existing authenticated participant. */
export class MusicCaptureFeed implements Subscription {
  readonly #projection = new CaptureProjection();
  readonly #listeners = new Set<() => void>();
  readonly #participant: CaptureParticipant;
  readonly #now: () => CaptureReading;
  readonly #scheduler: Scheduler;
  readonly #onClosed: () => void;
  #subscription: Subscription | undefined;
  #opening: Promise<Subscription> | undefined;
  #copy: SyncedCopy<CaptureState> | undefined;
  #epoch = 0;
  #closed = false;
  #cancel: () => void = () => {};
  constructor({participant, now = reading, scheduler = timers, onClosed = () => {}}:
    {participant: CaptureParticipant; now?: () => CaptureReading; scheduler?: Scheduler; onClosed?: () => void}) {
    this.#participant = participant; this.#now = now; this.#scheduler = scheduler; this.#onClosed = onClosed;
  }
  readonly getSnapshot = (): MusicCaptureView => this.#projection.view;
  /** True once this scope is closed, by its last user or by the connection; it then reads nothing more. */
  get closed(): boolean {return this.#closed;}
  readonly subscribe = (listener: () => void): (() => void) => {this.#listeners.add(listener); return () => {this.#listeners.delete(listener);};};
  async refresh(): Promise<boolean> {
    if (this.#closed) return false;
    const epoch = ++this.#epoch;
    this.invalidate();
    const previous = this.#copy; this.#copy = undefined; await this.#closeReplaced(previous);
    try {
      if (this.#subscription === undefined) {
        this.#opening ??= this.#participant.subscribe<CaptureFeatures>('bunny.event.music-capture-features.*', message => {
          if (this.#closed) return;
          this.#projection.feature(message, this.#now()); this.#show();
        }, {onOverflow: () => {this.invalidate();}});
        const subscription = await this.#opening;
        if (this.#closed) {await subscription.close(); return false;}
        this.#subscription = subscription;
      }
      if (epoch !== this.#epoch) return false;
      let sent = this.#now(), restarted = false;
      let completed: {message: Message<SyncCompleted>; sent: CaptureReading; received: CaptureReading} | undefined;
      const current = (): boolean => !this.#closed && this.#epoch === epoch;
      const result = await this.#participant.sync<CaptureState>(['music-capture-state'], change => {
        if (!current()) return;
        if (change.type === 'failed' || change.type === 'removed') {this.invalidate(); return;}
        if (change.type === 'synced') {
          completed = {message: change.message, sent, received: this.#now()};
          this.#synchronized(completed.message, completed.sent, completed.received);
        }
        else this.#state();
      }, {owner: 'bunny/core', timeoutMs: 5000, onRestarted: () => {
        if (current()) {sent = this.#now(); restarted = true; completed = undefined; this.invalidate();}
      }});
      if (result.status === 'rejected') {if (current()) this.invalidate(); return false;}
      if (!current()) {await this.#closeReplaced(result.copy); return false;}
      this.#copy = result.copy;
      if (completed !== undefined) this.#synchronized(completed.message, completed.sent, completed.received);
      else if (!restarted) this.#synchronized(result.message, sent, this.#now());
      return this.#projection.view.synced;
    } catch {if (!this.#closed && epoch === this.#epoch) this.invalidate(); return false;}
    finally {this.#opening = undefined;}
  }
  /**
   * Closes a copy this scope no longer reads. A healthy close keeps its place before the next read; a slow or stuck one
   * finishes in the background after REPLACED_CLOSE_WAIT_MS, so it cannot hold a refresh, or a card's Refresh, indefinitely.
   */
  #closeReplaced(copy: SyncedCopy<CaptureState> | undefined): Promise<void> {
    if (copy === undefined) return Promise.resolve();
    let cancel = (): void => {};
    const waited = new Promise<void>(resolve => {cancel = this.#scheduler.after(REPLACED_CLOSE_WAIT_MS, resolve);});
    return Promise.race([copy.close().catch(() => {}), waited]).finally(cancel);
  }
  invalidate(): void {this.#cancel(); this.#projection.invalidate(); this.#show();}
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true; ++this.#epoch; this.invalidate(); this.#onClosed();
    const owned = [this.#subscription, this.#copy]; this.#subscription = undefined; this.#copy = undefined;
    await Promise.all(owned.map(async subscription => {await subscription?.close();}));
  }
  #record(): CaptureState | undefined {
    const messages = this.#copy?.states() ?? [];
    const message = messages.length === 1 ? messages[0] : undefined;
    return message?.kind === 'state' && message.type === 'org.bunny.music-capture.updated' &&
      message.source === 'bunny/core' && message.subject === 'music' && message.data.id === 'music' &&
      ['https://bunny.invalid/events/music-capture-state/2.0', 'https://bunny.invalid/events/music-capture-state/2.1', 'https://bunny.invalid/events/music-capture-state/2.2'].includes(message.dataschema) ? message.data : undefined;
  }
  #state(): void {
    const state = this.#record();
    if (state === undefined) this.#projection.invalidate(); else this.#projection.state(state);
    this.#show();
  }
  #synchronized(completed: Message<SyncCompleted>, sent: CaptureReading, received: CaptureReading): void {
    const state = this.#record();
    if (state === undefined || completed.source !== 'bunny/core') {this.invalidate(); return;}
    this.#projection.synchronize(state, Date.parse(completed.time), sent, received); this.#show();
  }
  #show(): void {
    this.#cancel();
    const now = this.#now(); this.#projection.tick(now);
    const frame = this.#projection.view.features, bounds = this.#projection.bounds(now);
    for (const listener of this.#listeners) listener();
    if (!this.#closed && frame !== undefined && bounds !== undefined) this.#cancel = this.#scheduler.after(Math.max(1, Math.min(50, frame.validUntilMs - bounds.upper)), () => {
      this.#projection.tick(this.#now()); this.#show();
    });
  }
}
