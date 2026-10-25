import {errorBody} from '@jimmie-potts/event-contracts/v2/errors';
import type {CompanionCard, SpeechOutput, SpeechPlayback, SpeechState} from '@jimmie-potts/event-contracts/v2/companions';
import type {FrontendApi, FrontendSpeechEndpoint} from '@jimmie-potts/sdk/frontend';
import type {Command, Reply, TraceContext} from '@jimmie-potts/sdk';
import type {SpeechDriver, SpeechResult} from './speech-driver.js';

export type SpeechSessionState = {availability: 'off' | 'enabling' | 'available' | 'unavailable'; playback: SpeechState['playback']; busy: boolean};
export type SpeechSessionOptions = {api: NonNullable<FrontendApi['speech']>; createDriver(): SpeechDriver | undefined; usable(): boolean;
  eligible(card: CompanionCard): boolean; changed(state: SpeechSessionState): void};
type Attempt = {operationId: string; card: CompanionCard; started: boolean};
type Receipt = {playback: SpeechPlayback; parent: TraceContext};
function receipt(operationId: string, result: SpeechResult): SpeechPlayback {
  switch (result.kind) {
    case 'not-started': return {operationId, status: result.kind, started: false, reason: result.reason};
    case 'completed': return {operationId, status: result.kind, started: true};
    case 'failed': return {operationId, status: result.kind, started: false};
    case 'stopped': case 'uncertain': return {operationId, status: result.kind, started: result.started};
  }
}

/** The mounted page owns local cancellation; its server endpoint owns admission and pending work. */
export class SpeechSession {
  #state: SpeechSessionState = {availability: 'off', playback: null, busy: false};
  #driver: SpeechDriver | undefined;
  #endpoint: FrontendSpeechEndpoint | undefined;
  #attempt: Attempt | undefined;
  #last: Receipt | undefined;
  #receipts: Promise<void> = Promise.resolve();
  #generation = 0;
  #closed = false;
  readonly options: SpeechSessionOptions;
  constructor(options: SpeechSessionOptions) {this.options = options;}
  inspect(): SpeechSessionState {return structuredClone(this.#state);}
  #changed(): void {this.options.changed(this.inspect());}

  async enable(): Promise<void> {
    if (this.#closed || this.#state.busy || this.#endpoint !== undefined || !this.options.usable()) return;
    const generation = ++this.#generation, driver = this.options.createDriver();
    this.#driver = driver; this.#state.availability = 'enabling'; this.#state.busy = true; this.#receipts = Promise.resolve(); this.#last = undefined; this.#changed();
    const current = (): boolean => generation === this.#generation && !this.#closed && this.options.usable();
    try {
      if (driver === undefined || !await driver.enable() || !current()) {
        if (generation === this.#generation) await this.#release('unavailable');
        return;
      }
      const endpoint = await this.options.api.open({respond: command => this.#output(generation, command), onClosed: () => {
        if (generation === this.#generation) void this.#release('unavailable');
      }});
      if (!current()) {await endpoint.close(); return;}
      this.#endpoint = endpoint;
      const answer = await endpoint.control({requestId: crypto.randomUUID(), action: 'enable', available: true});
      if (!current()) return;
      if (answer.status !== 'accepted') {await this.#release('unavailable'); return;}
      this.#state.availability = 'available';
    } catch {if (generation === this.#generation) await this.#release('unavailable');}
    finally {if (generation === this.#generation) {this.#state.busy = false; this.#changed();}}
  }
  stop(): Promise<void> {return this.#control('stop');}
  mute(): Promise<void> {
    if (this.#state.availability === 'enabling' || this.#endpoint === undefined) return this.#release('off');
    return this.#control('mute');
  }
  async #control(action: 'stop' | 'mute'): Promise<void> {
    const endpoint = this.#endpoint, driver = this.#driver, generation = this.#generation;
    if (endpoint === undefined || driver === undefined || this.#closed) return;
    this.#state.busy = true;
    if (action === 'mute') this.#state.availability = 'off';
    // Local cancellation precedes the network request and is never held by its acknowledgment.
    const stopped = action === 'mute' ? driver.mute() : driver.stop(); this.#changed();
    try {
      const answer = await endpoint.control({requestId: crypto.randomUUID(), action});
      await stopped; await this.#receipts;
      if (generation !== this.#generation) return;
      if (answer.status !== 'accepted') await this.#release('unavailable');
      else if (action === 'mute') await this.#release('off');
    } catch {if (generation === this.#generation) await this.#release('unavailable');}
    finally {if (generation === this.#generation) {this.#state.busy = false; this.#changed();}}
  }
  update(): void {
    if (this.#closed) return;
    if (!this.options.usable()) {if (this.#driver !== undefined) void this.#release('unavailable'); return;}
    if (this.#attempt !== undefined && !this.options.eligible(this.#attempt.card)) void this.#driver?.stop();
  }
  close(): Promise<void> {this.#closed = true; return this.#release('off');}
  #release(availability: 'off' | 'unavailable'): Promise<void> {
    const endpoint = this.#endpoint, driver = this.#driver, attempt = this.#attempt;
    this.#generation++; this.#endpoint = undefined; this.#driver = undefined; this.#attempt = undefined;
    this.#state.availability = availability; this.#state.busy = false;
    if (attempt !== undefined) this.#state.playback = {operationId: attempt.operationId, status: 'uncertain', started: attempt.started};
    const stopped = driver?.close(); this.#changed();
    return Promise.allSettled([stopped, endpoint?.close()]).then(() => {});
  }
  #output(generation: number, command: Command<SpeechOutput>): Reply {
    if (generation !== this.#generation || this.#closed || this.#endpoint === undefined || this.#driver === undefined) return errorBody('unavailable');
    if (command.source !== 'bunny/modules/companions') return errorBody('forbidden');
    if (command.data.action === 'stop') {
      if (this.#attempt?.operationId === command.data.operationId) {void this.#driver.stop(); return {status: 'accepted'};}
      if (this.#last?.playback.operationId === command.data.operationId) {
        void this.#observe(generation, this.#last).catch(() => {}); return {status: 'accepted'};
      }
      return errorBody('not-found');
    }
    if (this.#attempt?.operationId === command.data.operationId || this.#last?.playback.operationId === command.data.operationId) return {status: 'accepted'};
    if (this.#state.availability !== 'available' || this.#state.busy || !this.options.usable() || !this.options.eligible(command.data.card)
      || Date.parse(command.expiresat ?? '') <= Date.now()) return errorBody('unavailable');
    if (this.#attempt !== undefined) return errorBody('invalid-state');
    const attempt: Attempt = {operationId: command.data.operationId, card: command.data.card, started: false};
    this.#attempt = attempt; this.#state.playback = {operationId: attempt.operationId, status: 'dispatching', started: false}; this.#changed();
    const driver = this.#driver;
    const done = driver.play({text: attempt.card.text, expiresAtMs: attempt.card.opportunity.validUntilMs,
      eligible: () => generation === this.#generation && this.#state.availability === 'available' && !this.#state.busy && this.options.usable() && this.options.eligible(attempt.card),
      onStarted: () => {
        if (generation !== this.#generation || this.#attempt !== attempt) return;
        attempt.started = true; this.#state.playback = {operationId: attempt.operationId, status: 'started', started: true}; this.#changed();
        void this.#observe(generation, {playback: this.#state.playback, parent: command}).catch(() => {});
      },
    });
    void done.then(async result => {
      if (generation !== this.#generation || this.#attempt !== attempt) return;
      this.#attempt = undefined;
      const final = {playback: receipt(attempt.operationId, result), parent: command}; this.#last = final;
      this.#state.playback = final.playback;
      const muted = this.#state.availability === 'off';
      if (!driver.enabled && !muted) this.#state.availability = 'unavailable';
      this.#changed();
      await this.#observe(generation, final);
      if (generation === this.#generation && !driver.enabled && !muted) await this.#release('unavailable');
    }).catch(() => {if (generation === this.#generation) void this.#release('unavailable');});
    return {status: 'accepted'};
  }
  #observe(generation: number, receipt: Receipt): Promise<void> {
    const endpoint = this.#endpoint;
    if (generation !== this.#generation || endpoint === undefined) return Promise.resolve();
    const sent = this.#receipts.then(async () => {
      if (generation === this.#generation && endpoint === this.#endpoint) await endpoint.observe(receipt.playback, receipt.parent);
    });
    this.#receipts = sent;
    void sent.catch(() => {if (generation === this.#generation) void this.#release('unavailable');});
    return sent;
  }
}
