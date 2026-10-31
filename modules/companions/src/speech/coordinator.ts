import {createHash, randomUUID} from 'node:crypto';
import {MessageValidator, errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {CompanionCard, SpeechDispatch, SpeechEndpointControl, SpeechEndpointLost, SpeechPlayback, SpeechState, SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import {speechDeadline as deadline, type SpeechSource} from '../presentation-policy.js';
import {Outcome, fullDisk, recordLog, type Cancel, type Command, type ModuleContext, type Outbox, type Reply, type Subscription, type TraceContext} from '@jimmie-potts/sdk';
import {advanceRevision} from '../revision.js';
import {SpeechStore, type Responsibility} from './store.js';

export type {SpeechSource};
type Candidate = {source: SpeechSource; parent: TraceContext; epoch: number; candidateId: string};
type Active = Responsibility & {candidate: Candidate; accepted: boolean; sent: boolean; stopping: boolean; settling: boolean; deadlineAtMs: number; cancel: Cancel};
const noop = (): void => {};
/** A reply answers the owner's own request, so it ranks with coding attention: above notices and social speech, never above an active equal. */
const priority = (source: SpeechSource): number => source.kind === 'reply' ? 2 : source.card.opportunity.category === 'coding-attention' ? 2 : source.card.opportunity.category === 'coding-notice' ? 1 : 0;
export const speechStateDraft = (data: SpeechState) => ({kind: 'state' as const, type: 'org.bunny.companion-speech-state.updated', subject: 'reachy',
  dataschema: 'https://bunny.invalid/events/companion-speech-state/2.0', data});

/** One selected endpoint, one active operation and at most one current pending card. */
export class SpeechCoordinator {
  readonly #store: SpeechStore;
  readonly #validator = new MessageValidator();
  readonly #subscriptions: Subscription[] = [];
  #state: SpeechState = {id: 'reachy', revision: 0, endpointId: null, availability: 'off', playback: null, pending: false};
  #active: Active | undefined;
  #pending: Candidate | undefined;
  #epoch = 0;
  #closed = false;
  #blocked = false;
  #queued: Cancel | undefined;
  constructor(readonly context: ModuleContext, readonly outbox: Outbox, readonly eligible: (source: SpeechSource) => boolean, readonly qualified: () => boolean) {
    this.#store = new SpeechStore(context.database()); registerCoreFamilies(this.#validator);
  }
  inspect(): SpeechState {return structuredClone(this.#state);}
  mark(): number | undefined {return this.#state.availability === 'available' && !this.#closed && !this.context.signal.aborted ? this.#epoch : undefined;}
  async start(): Promise<void> {
    for (const record of this.#store.records('pending')) await this.#save(record, {operationId: record.operationId, status: Outcome.uncertain, started: record.started});
    const uncertain = this.#store.uncertain();
    if (uncertain !== undefined) {
      this.#blocked = true; this.#state.availability = 'unavailable';
      this.#state.playback = {operationId: uncertain.operationId, status: Outcome.uncertain, started: uncertain.started};
    }
    this.#subscriptions.push(await this.context.sdk.respond<SpeechEndpointControl>('bunny.cmd.companion-speech-endpoint.*', command => this.#control(command)));
    this.#subscriptions.push(await this.context.sdk.respond<SpeechDispatch>('bunny.cmd.companion-speech-play.reachy', command => this.#accept(command)));
    this.#subscriptions.push(await this.context.sdk.subscribe<SpeechPlayback>('bunny.event.companion-speech-playback.*', message => this.#receipt(message), {onOverflow: () => {this.#lost();}}));
    this.#subscriptions.push(await this.context.sdk.subscribe<SpeechEndpointLost>('bunny.event.companion-speech-lost.*', message => {
      if (message.source === 'bunny/runtime/gateway' && this.#validator.validate(message).ok && message.data.id === this.#state.endpointId) this.#lost();
    }, {onOverflow: () => {this.#lost();}}));
    this.#changed();
  }
  async stop(): Promise<void> {
    this.#closed = true; this.#clear();
    const active = this.#active;
    if (active !== undefined && active.accepted) await this.#finish(active, {operationId: active.operationId, status: Outcome.uncertain, started: active.started});
    active?.cancel();
    await Promise.all(this.#subscriptions.map(subscription => subscription.close()));
  }
  offer(card: CompanionCard, parent: TraceContext, epoch: number | undefined): void {
    this.#offer({kind: 'card', card: structuredClone(card)}, `${card.opportunity.origin.source}:${card.opportunity.origin.id}`, parent, epoch);
  }
  /** Offers a saved assistant reply once per `key`: the message itself for the reply that ended a turn, or the message with the owner's request for a replay. */
  offerReply(reply: SpokenReply, key: string, parent: TraceContext, epoch: number | undefined): void {
    this.#offer({kind: 'reply', reply: {...reply}}, `reply:${reply.taskId}:${key}`, parent, epoch);
  }
  #offer(source: SpeechSource, identity: string, parent: TraceContext, epoch: number | undefined): void {
    if (epoch === undefined || epoch !== this.mark() || !this.#eligible(source)) return;
    const candidateId = createHash('sha256').update(identity).digest('hex');
    if (this.#store.has(candidateId) || this.#active?.candidateId === candidateId || this.#pending?.candidateId === candidateId) return;
    const candidate: Candidate = {source, parent: {...parent}, epoch, candidateId};
    // A newer candidate of equal rank replaces the pending one, so a later reply is never preceded by a stale pending answer.
    if (this.#pending !== undefined && priority(this.#pending.source) > priority(source)) return;
    this.#pending = candidate; this.#changed();
    const active = this.#active;
    if (active === undefined) this.#schedule();
    else if (priority(source) > priority(active.candidate.source)) this.#interrupt(active);
  }
  invalidate(): void {
    if (this.#pending !== undefined && !this.#eligible(this.#pending.source)) {this.#pending = undefined; this.#changed();}
    if (this.#active !== undefined && !this.#eligible(this.#active.candidate.source)) this.#interrupt(this.#active);
  }
  #eligible(source: SpeechSource): boolean {
    if (this.#closed || this.context.signal.aborted || this.context.clock.now() >= deadline(source)) return false;
    if (source.kind === 'card' && (source.card.history || source.card.opportunity.context !== 'live')) return false;
    return this.eligible(source);
  }
  #clear(): void {this.#epoch += 1; this.#pending = undefined; this.#queued?.(); this.#queued = undefined;}
  #control(command: Command<SpeechEndpointControl>): Reply {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    if (command.source !== 'bunny/parts/dashboard') return errorBody('forbidden');
    const checked = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    if (!checked.ok) return {error: checked.error};
    if (command.data.action === 'enable') {
      if (!this.qualified()) return errorBody('unavailable', {detail: 'this installation has no qualified local speech route'});
      if (this.#blocked) return errorBody('unavailable', {detail: 'previous speech has no definitive stop evidence'});
      if ((this.#state.endpointId !== null && this.#state.endpointId !== command.subject) || this.#active !== undefined) return errorBody('invalid-state', {detail: 'another speech endpoint or operation is active'});
      if (this.#state.availability !== 'available') {this.#clear(); this.#state.endpointId = command.subject; this.#state.availability = 'available'; this.#changed();}
    } else {
      if (this.#state.endpointId !== command.subject) return errorBody('forbidden');
      this.#clear();
      if (command.data.action === 'mute') this.#state.availability = 'off';
      const active = this.#active;
      if (active !== undefined) this.#interrupt(active);
      else if (command.data.action === 'mute') this.#state.endpointId = null;
      this.#changed();
    }
    return {status: 'accepted'};
  }
  #schedule(): void {
    if (this.#queued !== undefined || this.#active !== undefined || this.#pending === undefined || this.mark() === undefined) return;
    this.#queued = this.context.scheduler.after(0, () => {this.#queued = undefined; void this.#dispatch();});
  }
  async #dispatch(): Promise<void> {
    const candidate = this.#pending, endpointId = this.#state.endpointId;
    this.#pending = undefined;
    if (candidate === undefined || endpointId === null || candidate.epoch !== this.mark() || !this.#eligible(candidate.source)) {this.#changed(); return;}
    const active: Active = {...candidate, candidate, endpointId, operationId: randomUUID(), traceparent: candidate.parent.traceparent,
      started: false, accepted: false, sent: false, stopping: false, settling: false, deadlineAtMs: this.context.clock.now() + 25_000, cancel: noop};
    this.#active = active; this.#state.playback = {operationId: active.operationId, status: 'dispatching', started: false}; this.#changed();
    try {
      const result = await this.context.sdk.request('bunny.cmd.companion-speech-dispatch.reachy', {
        type: 'org.bunny.companion-speech.dispatch.requested', subject: 'reachy', dataschema: 'https://bunny.invalid/events/companion-speech-dispatch/2.0',
        data: {requestId: active.operationId, candidateId: active.candidateId, endpointId},
      }, {requestId: active.operationId, timeoutMs: 5000, parent: candidate.parent});
      if (result.status !== 'accepted' && this.#active === active && !active.accepted) {
        if (result.status === Outcome.uncertain) this.#uncertain(active);
        else {this.#active = undefined; this.#state.playback = {operationId: active.operationId, status: 'not-started', started: false, reason: 'unavailable'}; this.#changed(); this.#schedule();}
      }
    } catch {if (this.#active === active && !active.accepted) this.#uncertain(active);}
  }
  #accept(command: Command<SpeechDispatch>): Reply {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    if (command.source !== 'bunny/core') return errorBody('forbidden');
    const checked = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    if (!checked.ok) return {error: checked.error};
    const active = this.#active;
    if (active === undefined || command.data.requestId !== active.operationId || command.data.candidateId !== active.candidateId
      || command.data.endpointId !== active.endpointId) return errorBody('invalid-state');
    if (active.accepted) return {status: 'accepted'};
    if (active.stopping || active.candidate.epoch !== this.mark() || !this.#eligible(active.candidate.source)) return errorBody('expired');
    try {this.#store.accept({...active, traceparent: command.traceparent});}
    catch (error) {return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'speech responsibility could not be saved'});}
    active.accepted = true; active.traceparent = command.traceparent;
    active.cancel = this.context.scheduler.after(active.deadlineAtMs - this.context.clock.now(), () => {this.#uncertain(active);});
    // Ownership is durable before this handler returns. Output does not hold the admission reply open.
    queueMicrotask(() => {void this.#send(active);});
    return {status: 'accepted'};
  }
  async #send(active: Active): Promise<void> {
    if (this.#active !== active || active.settling) return;
    if (active.stopping || active.candidate.epoch !== this.mark() || !this.#eligible(active.candidate.source)) {
      await this.#finish(active, {operationId: active.operationId, status: 'not-started', started: false, reason: 'policy'}); return;
    }
    active.sent = true;
    const {source} = active.candidate;
    try {
      const result = await this.context.sdk.request(`bunny.cmd.companion-speech-output.${active.endpointId}`, {
        type: 'org.bunny.companion-speech.output.requested', subject: active.endpointId, dataschema: 'https://bunny.invalid/events/companion-speech-output/2.0',
        data: {requestId: active.operationId, operationId: active.operationId, action: 'speak', ...(source.kind === 'card' ? {card: source.card} : {reply: source.reply})},
      }, {requestId: active.operationId, timeoutMs: Math.min(5000, deadline(source) - this.context.clock.now()), parent: active});
      if (this.#active !== active || active.settling) return;
      if (result.status === Outcome.uncertain) this.#uncertain(active);
      else if (result.status === Outcome.rejected && active.started) this.#uncertain(active);
      else if (result.status === Outcome.rejected) await this.#finish(active, {operationId: active.operationId, status: 'not-started', started: false, reason: 'unavailable'});
    } catch {this.#uncertain(active);}
  }
  #interrupt(active: Active): void {
    if (this.#closed || this.context.signal.aborted || active.stopping || active.settling) return;
    active.stopping = true;
    if (!active.sent) return;
    active.cancel();
    active.cancel = this.context.scheduler.after(Math.max(0, Math.min(5000, active.deadlineAtMs - this.context.clock.now())), () => {this.#uncertain(active);});
    void this.context.sdk.request(`bunny.cmd.companion-speech-output.${active.endpointId}`, {
      type: 'org.bunny.companion-speech.output.requested', subject: active.endpointId, dataschema: 'https://bunny.invalid/events/companion-speech-output/2.0',
      data: {requestId: randomUUID(), operationId: active.operationId, action: 'stop'},
    }, {timeoutMs: 5000, parent: active}).then(result => {if (result.status !== 'accepted') this.#uncertain(active);}, () => {this.#uncertain(active);});
  }
  async #receipt(message: Message<SpeechPlayback>): Promise<void> {
    const active = this.#active;
    if (this.#closed || active === undefined || message.source !== 'bunny/parts/dashboard' || message.subject !== active.endpointId
      || !this.#validator.validate(message).ok || message.data.operationId !== active.operationId || !active.sent || active.settling) return;
    const playback = message.data;
    if (playback.status === Outcome.uncertain && this.#state.playback?.status === Outcome.uncertain && playback.started === this.#state.playback.started) return;
    if (playback.status === 'started') {
      active.started = true;
      try {this.#store.started(active.operationId); this.#state.playback = playback; this.#changed();}
      catch (error) {this.#storageFailure(error, active); this.#uncertain(active);}
      return;
    }
    if ((playback.status === 'completed' && !active.started) || (active.started && !playback.started)) {this.#uncertain(active); return;}
    await this.#finish(active, playback);
  }
  #lost(): void {
    if (this.#closed) return;
    this.#clear(); this.#state.availability = 'unavailable'; this.#state.endpointId = null;
    const active = this.#active;
    if (active !== undefined) {if (active.accepted) this.#uncertain(active); else active.stopping = true;}
    this.#changed();
  }
  #uncertain(active: Active): void {
    if (this.#closed || this.context.signal.aborted) return;
    if (this.#active !== active || active.settling) return;
    this.#blocked = true; this.#clear(); this.#state.availability = 'unavailable';
    this.#state.playback = {operationId: active.operationId, status: Outcome.uncertain, started: active.started};
    this.#changed();
    if (active.accepted) void this.#finish(active, this.#state.playback);
  }
  async #finish(active: Active, playback: SpeechPlayback): Promise<void> {
    if (this.#active !== active || active.settling) return;
    active.settling = true; active.cancel();
    try {if (active.accepted) await this.#save(active, playback);}
    catch (error) {
      this.#storageFailure(error, active);
      this.#blocked = true; this.#clear(); this.#state.availability = 'unavailable';
      this.#state.playback = {operationId: active.operationId, status: Outcome.uncertain, started: active.started};
      this.#changed(); return;
    }
    if (this.#closed || this.context.signal.aborted) return;
    this.#state.playback = playback;
    if (playback.status === Outcome.uncertain) {
      this.#blocked = true; this.#clear(); this.#state.availability = 'unavailable'; active.settling = false;
    } else {
      this.#active = undefined; this.#blocked = this.#store.uncertain() !== undefined;
      if (this.#state.availability !== 'available') this.#state.endpointId = null;
    }
    this.#changed(); this.#schedule();
  }
  #save(record: Responsibility, playback: SpeechPlayback): Promise<void> {
    return this.outbox.transaction(add => {
      this.#store.settle(playback);
      const completed = playback.status === 'completed', interrupted = playback.status === 'stopped' && playback.started;
      const uncertain = playback.status === Outcome.uncertain || interrupted;
      const result = completed ? Outcome.succeeded : uncertain ? Outcome.uncertain : Outcome.failed;
      add('bunny.event.companion-speech-play.reachy', {kind: 'outcome', type: 'org.bunny.companion-speech.play.completed', subject: 'reachy',
        dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId: record.operationId, result,
          evidence: playback.started ? Outcome.observed : Outcome.none,
          ...completed ? {} : {error: errorBody(uncertain ? 'uncertain-result' : playback.status === 'not-started' && playback.reason === 'expired' ? 'expired' : playback.status === Outcome.failed ? 'unavailable' : 'cancelled').error},
        }}, {parent: record});
    });
  }
  #storageFailure(error: unknown, parent?: TraceContext): void {
    recordLog(this.context.log, 'message.received', {'bunny.operation': 'storage', 'bunny.outcome': Outcome.uncertain,
      'bunny.code': fullDisk(error) ? 'capacity' : 'internal'}, parent);
  }
  #changed(): void {
    this.#state.pending = this.#pending !== undefined;
    if (this.#closed || this.context.signal.aborted) return;
    try {this.#state.revision = advanceRevision(this.context.database());}
    catch (error) {
      this.#storageFailure(error, this.#active);
      this.#blocked = true; this.#clear(); this.#state.pending = false; this.#state.availability = 'unavailable';
      if (this.#active !== undefined) this.#interrupt(this.#active);
      return;
    }
    void this.context.sdk.publish('bunny.state.companion-speech-state.reachy', speechStateDraft(this.inspect())).catch(() => {
      recordLog(this.context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': Outcome.rejected, 'bunny.code': 'unavailable'});
    });
  }
}
