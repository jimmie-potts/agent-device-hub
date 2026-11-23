import {createHash, randomUUID} from 'node:crypto';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import type {CompanionCard, SpeechDispatch, SpeechEndpointControl, SpeechEndpointLost, SpeechPlayback, SpeechState, SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import {speechDeadline as deadline, type SpeechSource} from '../presentation-policy.js';
import {Outcome, fullDisk, recordLog, type Cancel, type Command, type ModuleContext, type Outbox, type Reply, type Subscription, type TraceContext} from '@jimmie-potts/sdk';
import {advanceRevision} from '../revision.js';
import {SpeechStore, type Responsibility} from './store.js';

export type {SpeechSource};
/** A waiting utterance, with the order it arrived in; `line` names a reply's conversation. */
type Candidate = {source: SpeechSource; parent: TraceContext; epoch: number; candidateId: string; arrival: number; line?: string};
type Active = Responsibility & {candidate: Candidate; accepted: boolean; sent: boolean; stopping: boolean; settling: boolean; deadlineAtMs: number; cancel: Cancel};
const noop = (): void => {};
/** A reply answers the owner's own request, so it ranks with coding attention: above notices and social speech, never above an active equal. */
const priority = (source: SpeechSource): number => source.kind === 'reply' ? 2 : source.card.opportunity.category === 'coding-attention' ? 2 : source.card.opportunity.category === 'coding-notice' ? 1 : 0;
export const speechStateDraft = (data: SpeechState) => ({kind: 'state' as const, type: 'org.bunny.companion-speech-state.updated', subject: 'reachy',
  dataschema: 'https://bunny.invalid/events/companion-speech-state/2.1', data});

/**
 * One selected endpoint and one active operation. Waiting are at most one card and one reply per conversation (Hub
 * #2027); the voice takes the highest rank first, then arrival order.
 */
export class SpeechCoordinator {
  readonly #store: SpeechStore;
  readonly #validator = coreValidator();
  readonly #subscriptions: Subscription[] = [];
  #state: SpeechState = {id: 'reachy', revision: 0, endpointId: null, availability: 'off', playback: null, pending: false};
  #active: Active | undefined;
  /** Reachy's card slot: a newer card of equal or higher rank replaces the waiting one. */
  #card: Candidate | undefined;
  /** Each conversation's one waiting reply: a newer reply of the same conversation replaces it. */
  readonly #replies = new Map<string, Candidate>();
  #arrivals = 0;
  #epoch = 0;
  #closed = false;
  #blocked = false;
  #queued: Cancel | undefined;
  constructor(readonly context: ModuleContext, readonly outbox: Outbox, readonly eligible: (source: SpeechSource) => boolean, readonly qualified: () => boolean) {
    this.#store = new SpeechStore(context.database());
  }
  inspect(): SpeechState {return structuredClone(this.#state);}
  mark(): number | undefined {return this.#state.availability === 'available' && !this.#closed && !this.context.signal.aborted ? this.#epoch : undefined;}
  async start(): Promise<void> {
    for (const record of this.#store.records('pending')) await this.#save(record, {operationId: record.operationId, status: Outcome.uncertain, started: record.started});
    const uncertain = this.#store.uncertain();
    if (uncertain !== undefined) {
      this.#state.recoveryOperationId = uncertain.operationId;
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
    this.#offer({kind: 'card', card: structuredClone(card)}, `${card.opportunity.origin.source}:${card.opportunity.origin.id}`, parent, epoch, undefined);
  }
  /**
   * Offers a saved assistant reply once per `key`: the message itself for the reply that ended a turn, or the message with
   * the owner's request for a replay. `line` names the reply's conversation, which keeps one waiting reply (Hub #2027).
   */
  offerReply(reply: SpokenReply, key: string, parent: TraceContext, epoch: number | undefined, line: string): void {
    this.#offer({kind: 'reply', reply: {...reply}}, `reply:${reply.taskId}:${key}`, parent, epoch, line);
  }
  #offer(source: SpeechSource, identity: string, parent: TraceContext, epoch: number | undefined, line: string | undefined): void {
    if (epoch === undefined || epoch !== this.mark() || !this.#eligible(source)) return;
    const candidateId = createHash('sha256').update(identity).digest('hex');
    if (this.#store.has(candidateId) || this.#active?.candidateId === candidateId || this.#waiting().some(waiting => waiting.candidateId === candidateId)) return;
    const candidate: Candidate = {source, parent: {...parent}, epoch, candidateId, arrival: ++this.#arrivals, ...(line === undefined ? {} : {line})};
    if (line === undefined) {
      // A newer card of equal rank replaces the waiting card; a reply and a card never replace each other.
      if (this.#card !== undefined && priority(this.#card.source) > priority(source)) return;
      this.#card = candidate;
    } else {
      // A newer reply of the same conversation replaces its waiting one, so a later answer is never preceded by a stale one there.
      this.#replies.set(line, candidate);
    }
    this.#changed();
    const active = this.#active;
    if (active === undefined) this.#schedule();
    else if (priority(source) > priority(active.candidate.source)) this.#interrupt(active);
  }
  invalidate(): void {
    const stale = this.#waiting().filter(waiting => !this.#eligible(waiting.source));
    for (const waiting of stale) this.#remove(waiting);
    if (stale.length > 0) this.#changed();
    if (this.#active !== undefined && !this.#eligible(this.#active.candidate.source)) this.#interrupt(this.#active);
  }
  /** Every waiting candidate: the card and each conversation's reply. */
  #waiting(): Candidate[] {return [...(this.#card === undefined ? [] : [this.#card]), ...this.#replies.values()];}
  #remove(candidate: Candidate): void {
    if (this.#card === candidate) this.#card = undefined;
    else if (candidate.line !== undefined && this.#replies.get(candidate.line) === candidate) this.#replies.delete(candidate.line);
  }
  /** The candidate the voice takes next: the highest rank, then the earliest arrival. */
  #next(): Candidate | undefined {
    return this.#waiting().reduce<Candidate | undefined>((best, waiting) => best === undefined || priority(waiting.source) > priority(best.source)
      || (priority(waiting.source) === priority(best.source) && waiting.arrival < best.arrival) ? waiting : best, undefined);
  }
  #eligible(source: SpeechSource): boolean {
    if (this.#closed || this.context.signal.aborted || this.context.clock.now() >= deadline(source)) return false;
    if (source.kind === 'card' && (source.card.history || source.card.opportunity.context !== 'live')) return false;
    return this.eligible(source);
  }
  #clear(): void {this.#epoch += 1; this.#card = undefined; this.#replies.clear(); this.#queued?.(); this.#queued = undefined;}
  #control(command: Command<SpeechEndpointControl>): Reply {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    if (command.source !== 'bunny/parts/dashboard') return errorBody('forbidden');
    const checked = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    if (!checked.ok) return {error: checked.error};
    if (command.data.action === 'recover') return this.#recover(command, command.data);
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
  #recover(command: Command<SpeechEndpointControl>, recovery: Extract<SpeechEndpointControl, {action: 'recover'}>): Reply {
    if (!this.qualified()) return errorBody('unavailable');
    if (this.#active !== undefined || this.#state.endpointId !== null || this.#state.recoveryOperationId !== recovery.operationId
      || this.#state.revision !== recovery.expectedRevision) return errorBody('invalid-state', {detail: 'speech recovery no longer matches an orphaned operation'});
    let saved: ReturnType<SpeechStore['acknowledge']>;
    try {saved = this.#store.acknowledge({...recovery, endpointId: command.subject, traceparent: command.traceparent, atMs: this.context.clock.now()});}
    catch (error) {
      this.#storageFailure(error, command);
      return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'speech recovery could not be saved'});
    }
    this.#clear();
    const next = saved.next;
    this.#blocked = next !== undefined;
    this.#state.availability = next === undefined ? 'off' : 'unavailable';
    this.#state.playback = next === undefined ? null : {operationId: next.operationId, status: Outcome.uncertain, started: next.started};
    if (next === undefined) delete this.#state.recoveryOperationId;
    else this.#state.recoveryOperationId = next.operationId;
    this.#changed(saved.revision);
    return {status: 'accepted'};
  }
  #schedule(): void {
    if (this.#queued !== undefined || this.#active !== undefined || this.#next() === undefined || this.mark() === undefined) return;
    this.#queued = this.context.scheduler.after(0, () => {this.#queued = undefined; void this.#dispatch();});
  }
  async #dispatch(): Promise<void> {
    const endpointId = this.#state.endpointId;
    if (endpointId === null) {this.#card = undefined; this.#replies.clear(); this.#changed(); return;}
    // A candidate that went stale or lost its epoch while waiting is dropped, and the next one is taken.
    let candidate = this.#next();
    while (candidate !== undefined && (candidate.epoch !== this.mark() || !this.#eligible(candidate.source))) {this.#remove(candidate); candidate = this.#next();}
    if (candidate === undefined) {this.#changed(); return;}
    this.#remove(candidate);
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
  #changed(savedRevision?: number): void {
    this.#state.pending = this.#waiting().length > 0;
    if (this.#closed || this.context.signal.aborted) return;
    try {this.#state.revision = savedRevision ?? advanceRevision(this.context.database());}
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
