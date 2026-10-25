import {readSpeechQualification} from './speech/qualification.js';
import type {SpeechQualification} from './speech-qualification.js';
import {speechRefusal} from './presentation-policy.js';
import {SpeechCoordinator, speechStateDraft} from './speech/coordinator.js';
import {Knowledge} from './knowledge/engine.js';
import {Preferences, PREFERENCE_UPLOAD_BYTES, preferenceStateDraft} from './preferences/engine.js';
import type {AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import {assistantStateDraft, AssistantEngine, type AssistantOptions} from './assistant/engine.js';
import {createHash} from 'node:crypto';
import {MessageValidator, errorBody, type ErrorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {OPPORTUNITY_TTL_MS, type CompanionCategory, type CompanionFixtureRun, type CompanionOpportunity,
  type CompanionSettingsSet, type CompanionState, type SpeechState} from '@jimmie-potts/event-contracts/v2/companions';
import {registerCoreFamilies, type ModeState, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {recordLog, Outbox, fullDisk, type BunnyModule, type Cancel, type Command, type ModuleContext, type ModuleContent, type ModuleContentRequest, type Reply,
  type StateDraft, type Subscription, type SyncedCopy, type TraceContext} from '@jimmie-potts/sdk';
import {revision} from './revision.js';
import {admissionKey, categories, localDay, refusal, selectCard, type Policy} from './rules.js';
import {CompanionStore, type Saved} from './store.js';

type Candidate = {event: CompanionOpportunity; parent: TraceContext; speechEpoch: number | undefined};
const stateDraft = (data: CompanionState): StateDraft<CompanionState> => ({type: 'org.bunny.companion-state.updated', subject: 'reachy',
  dataschema: 'https://bunny.invalid/events/companion-state/2.0', data});
const receiptKey = (event: CompanionOpportunity): string => createHash('sha256').update(`${event.context}:${event.origin.source}:${event.origin.id}:${event.cue}`).digest('hex');
export type CompanionsModule = BunnyModule & {inspect(): CompanionState | undefined; inspectAssistant(): AssistantState | undefined; inspectSpeech(): SpeechState | undefined; pending(): number};

/** One private companion owner; visual admission and optional browser speech share current policy. */
export function createCompanionsModule(options: AssistantOptions = {}): CompanionsModule {
  const engine = new Companions(options);
  return {manifest: {name: 'companions', apiVersion: '1.3', pages: [{id: 'reachy', title: 'Reachy', presentation: 'react'}, {id: 'assistant', title: 'Synthetic tasks', presentation: 'react'}, {id: 'preferences', title: 'Preferences', presentation: 'react'}, {id: 'knowledge', title: 'Companion knowledge', presentation: 'react'}, {id: 'duck-conversation', title: 'Duck conversation', presentation: 'react'}],
    content: (ref, request) => engine.qualifiedSpeech(ref, request) ?? engine.knowledge?.content(ref, request) ?? engine.preferences?.content(ref, request) ?? engine.assistant?.content(ref, request),
    upload: {family: 'assistant-input', maxBytes: PREFERENCE_UPLOAD_BYTES, stage: request => (request.target === 'knowledge' ? engine.knowledge?.stage(request) : request.target === 'preferences' ? engine.preferences?.stage(request) : engine.assistant?.stage(request)) ?? errorBody('unavailable')}},
    start: context => engine.start(context), stop: () => engine.stop(), inspect: () => engine.inspect(), inspectAssistant: () => engine.assistant?.inspect(), inspectSpeech: () => engine.speech?.inspect(), pending: () => engine.pending()};
}
class Companions {
  speech: SpeechCoordinator | undefined;
  assistant: AssistantEngine | undefined;
  preferences: Preferences | undefined;
  knowledge: Knowledge | undefined;
  #context: ModuleContext | undefined;
  #qualification: SpeechQualification | undefined;
  #store: CompanionStore | undefined;
  #outbox: Outbox | undefined;
  #copy: SyncedCopy<SessionRecord | ModeState> | undefined;
  #synced = false;
  #closed = false;
  #retryMs = 1000;
  #retry: Cancel | undefined;
  #scheduled: Cancel | undefined;
  #expiry: Cancel | undefined;
  #active: Candidate | undefined;
  #scenarioAttention = false;
  #scenarioGeneration = 0;
  #scenarioUntilMs = 0;
  readonly #pending = new Map<CompanionCategory, Candidate>();
  readonly #subscriptions: Subscription[] = [];
  readonly #validator = new MessageValidator();
  readonly #seen = new Set<string>();
  #work: Promise<void> = Promise.resolve();
  #draining: Promise<void> = Promise.resolve();
  constructor(readonly options: AssistantOptions) {registerCoreFamilies(this.#validator);}
  inspect(): CompanionState | undefined {return this.#store?.read().state;}
  pending(): number {return this.#pending.size + (this.#active === undefined ? 0 : 1);}
  qualifiedSpeech(ref: string, request?: ModuleContentRequest): ModuleContent | ErrorBody | undefined {
    if (ref !== 'speech-qualification') return undefined;
    if (this.#closed || this.#context === undefined || this.#context.signal.aborted || request?.signal.aborted === true || this.#qualification === undefined) return errorBody('unavailable');
    if (Object.keys(request?.query ?? {}).length > 0) return errorBody('invalid-request');
    return {type: 'application/json', bytes: Buffer.from(JSON.stringify(this.#qualification))};
  }
  async start(context: ModuleContext): Promise<void> {
    this.#context = context;
    this.#qualification = readSpeechQualification(context.files());
    const database = context.database();
    this.#store = new CompanionStore(database);
    this.#outbox = new Outbox({sdk: context.sdk, database, clock: context.clock, log: context.log, trace: context.trace, validator: this.#validator});
    this.speech = new SpeechCoordinator(context, this.#outbox, card => {
      return speechRefusal(card, this.#policy(card.opportunity)) === undefined;
    }, () => this.#qualification !== undefined);
    await this.speech.start();
    this.assistant = new AssistantEngine(context, this.#outbox, this.options);
    await this.assistant.start();
    this.preferences = new Preferences(context, this.#outbox);
    await this.preferences.start();
    this.knowledge = new Knowledge(context, this.#outbox, this.assistant, this.preferences.store);
    await this.knowledge.start();
    const saved = this.#store.read();
    for (const key of saved.received) this.#seen.add(key);
    if (saved.state.presentation !== null) saved.state.presentation.history = true;
    saved.state.availability = 'available';
    this.#store.save(saved);
    this.#subscriptions.push(await context.sdk.serveSync(['companion-state', 'assistant-state', 'preference-state', 'companion-speech-state'], request => {
      const state = this.inspect(), speech = this.speech?.inspect();
      const assistant = this.assistant?.inspect(), preferences = this.preferences?.inspect();
      return state === undefined || speech === undefined || assistant === undefined || preferences === undefined || this.#closed ? errorBody('unavailable') : {revision: revision(database), states: [
        ...(request.data.families.includes('companion-speech-state') ? [speechStateDraft(speech)] : []),
        ...(request.data.families.includes('companion-state') ? [stateDraft(state)] : []),
        ...(request.data.families.includes('assistant-state') ? [assistantStateDraft(assistant)] : []),
        ...(request.data.families.includes('preference-state') ? [preferenceStateDraft(preferences)] : []),
      ]};
    }));
    this.#subscriptions.push(await context.sdk.subscribe<CompanionOpportunity>('bunny.event.companion-opportunity.reachy', message => {this.#receive(message);},
      {onOverflow: () => {this.#pending.clear(); this.#decision('input-unavailable');}}));
    this.#subscriptions.push(await context.sdk.respond<CompanionSettingsSet>('bunny.cmd.companion-settings-set.reachy', command => this.#settings(command)));
    this.#subscriptions.push(await context.sdk.respond<CompanionFixtureRun>('bunny.cmd.companion-fixture-run.reachy', command => this.#fixture(command)));
    await this.#outbox.republish();
    // Initial state sync is observation only; it never creates opportunities.
    await this.#follow();
  }
  async stop(): Promise<void> {
    this.#closed = true; this.#pending.clear(); this.#scheduled?.(); this.#retry?.(); this.#expiry?.();
    await Promise.all(this.#subscriptions.map(subscription => subscription.close()));
    await this.speech?.stop();
    await this.assistant?.stop();
    await this.preferences?.stop();
    await this.knowledge?.stop();
    await this.#copy?.close();
    await Promise.all([this.#work, this.#draining]);
  }
  #policy(event: CompanionOpportunity): Policy {
    const saved = this.#store?.read(), context = this.#context;
    if (saved === undefined || context === undefined) throw new Error('companions-not-started');
    const records = this.#copy?.states().map(message => message.data) ?? [];
    const mode = records.find((record): record is ModeState => 'mode' in record);
    return {nowMs: context.clock.now(), settings: saved.state.settings, mode: mode?.mode, synced: this.#synced,
      sessions: records.filter((record): record is SessionRecord => 'identity' in record), scenarioAttention: event.context === 'scenario' && this.#scenarioAttention && context.clock.now() < this.#scenarioUntilMs,
      allowance: saved.allowances[event.context], admissions: saved.admissions, available: !this.#closed && !context.signal.aborted};
  }
  async #follow(): Promise<void> {
    const context = this.#context;
    if (context === undefined || this.#closed) return;
    this.#synced = false;
    const prior = this.#copy; this.#copy = undefined; await prior?.close();
    let replacing = false;
    try {
      const result = await context.sdk.sync<SessionRecord | ModeState>(['session', 'mode'], change => {
        if (change.type === 'failed') {this.#synced = false; this.#pending.clear(); this.#invalidate(); this.#resync();}
        else {
          if (change.type === 'synced') {replacing = false; if (this.#copy !== undefined) this.#synced = true;}
          if (this.#copy !== undefined) this.#invalidate(change.message);
        }
      }, {owner: 'bunny/core', timeoutMs: 5000, onRestarted: () => {replacing = true; this.#synced = false; this.#pending.clear(); this.#invalidate();}});
      if (result.status !== 'synced') {this.#resync(); return;}
      if (this.#closed) {await result.copy.close(); return;}
      this.#copy = result.copy; this.#synced = !replacing; this.#retryMs = 1000;
    } catch {this.#resync();}
  }
  #resync(): void {
    if (this.#closed || this.#retry !== undefined) return;
    const context = this.#context;
    if (context === undefined) return;
    const delay = this.#retryMs; this.#retryMs = Math.min(30_000, delay * 2);
    this.#retry = context.scheduler.after(delay, () => {this.#retry = undefined; this.#work = this.#follow();});
  }
  #receive(message: Message<CompanionOpportunity>): void {
    const context = this.#context;
    if (context === undefined || this.#closed) return;
    const checked = this.#validator.validate(message);
    if (!checked.ok || message.source !== 'bunny/core' || message.data.context !== 'live') {
      const code = message.source !== 'bunny/core' || checked.ok ? 'forbidden' : checked.error.code;
      if (message.source === 'bunny/core') this.#decision('invalid-input', message, false, code);
      else recordLog(context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': 'rejected', 'bunny.code': code}, message);
      return;
    }
    this.#enqueue({event: structuredClone(message.data), parent: {traceparent: message.traceparent}, speechEpoch: this.speech?.mark()});
  }
  #enqueue(candidate: Candidate): void {
    const key = receiptKey(candidate.event);
    if (this.#seen.has(key)) return;
    const store = this.#store, outbox = this.#outbox;
    if (store === undefined || outbox === undefined) return;
    const saved = store.read(); saved.received.push(key);
    void outbox.transaction(() => {store.save(saved, false);}).catch(() => {});
    // The outbox commits synchronously; a rolled-back receipt cannot authorize admission.
    if (!store.read().received.includes(key)) {this.#decision('input-unavailable', candidate.parent); return;}
    this.#seen.add(key);
    if (this.#seen.size > 4096) {const oldest = this.#seen.values().next().value; if (oldest !== undefined) this.#seen.delete(oldest);}
    const reason = refusal(candidate.event, this.#policy(candidate.event));
    if (reason !== undefined) {this.#decision(reason, candidate.parent); return;}
    const prior = this.#pending.get(candidate.event.category);
    if (prior !== undefined) this.#decision('coalesced', prior.parent);
    this.#pending.set(candidate.event.category, candidate);
    this.#schedule();
  }
  #schedule(): void {
    const context = this.#context;
    if (context === undefined || this.#closed || this.#scheduled !== undefined || this.#active !== undefined || this.#pending.size === 0) return;
    // The actual asynchronous coalescing boundary. State/controls can change before presentation.
    this.#scheduled = context.scheduler.after(25, () => {this.#scheduled = undefined; this.#draining = this.#drain();});
  }
  async #drain(): Promise<void> {
    const context = this.#context, store = this.#store, outbox = this.#outbox;
    if (context === undefined || store === undefined || outbox === undefined || this.#closed) return;
    const category = categories.find(value => this.#pending.has(value));
    if (category === undefined) return;
    const candidate = this.#pending.get(category); this.#pending.delete(category);
    if (candidate === undefined) return;
    this.#active = candidate;
    try {
      let reason = refusal(candidate.event, this.#policy(candidate.event));
      if (candidate.event.context === 'scenario' && candidate.event.generation !== this.#scenarioGeneration) reason = 'obsolete-scenario';
      if (reason !== undefined) {this.#decision(reason, candidate.parent); return;}
      // Reserve repetition/allowance durably before any output. Outbox waiting is another real asynchronous boundary.
      await outbox.transaction(() => {
        const saved = store.read(), now = context.clock.now();
        saved.admissions.push({key: admissionKey(candidate.event), atMs: now});
        if (category === 'simulated-social') {
          const allowance = saved.allowances[candidate.event.context], day = localDay(now, saved.state.settings.timeZone);
          allowance.count = allowance.day === day ? allowance.count + 1 : 1; allowance.day = day; allowance.lastAtMs = now;
        }
        store.save(saved, false);
      });
      reason = refusal(candidate.event, this.#policy(candidate.event), true);
      if (candidate.event.context === 'scenario' && candidate.event.generation !== this.#scenarioGeneration) reason = 'obsolete-scenario';
      if (reason !== undefined) {this.#decision(reason, candidate.parent); return;}
      const saved = store.read();
      saved.state.presentation = selectCard(candidate.event, context.clock.now(), 'reachy-1');
      saved.state.decision = 'awaiting-publication'; saved.state.availability = 'available';
      this.#expiry?.();
      this.#expiry = context.scheduler.after(Math.max(0, candidate.event.validUntilMs - context.clock.now()), () => {this.#expiry = undefined; this.#invalidate(candidate.parent);});
      // Synchronous save and final publication are adjacent: no wait can invalidate the checked state between them.
      context.database().exec('BEGIN IMMEDIATE');
      try {store.save(saved); context.database().exec('COMMIT');} catch (error) {context.database().exec('ROLLBACK'); throw error;}
      let timeout: Cancel | undefined;
      let abort: (() => void) | undefined;
      const deadline = new Promise<boolean>(resolve => {
        abort = () => {resolve(false);};
        context.signal.addEventListener('abort', abort, {once: true});
        timeout = context.scheduler.after(5000, () => {resolve(false);});
      });
      const publication = context.sdk.publish('bunny.state.companion-state.reachy', {kind: 'state', ...stateDraft(saved.state)}, {parent: candidate.parent})
        .then(() => true, () => false);
      const published = await Promise.race([publication, deadline]); timeout?.();
      if (abort !== undefined) context.signal.removeEventListener('abort', abort);
      if (!published) {
        this.#decision('presentation-unavailable', candidate.parent, true);
      } else {
        this.#decision('presented', candidate.parent);
        this.speech?.offer(saved.state.presentation, candidate.parent, candidate.speechEpoch);
      }
    } catch {
      this.#decision('presentation-unavailable', candidate.parent, true);
    } finally {this.#active = undefined; this.#schedule();}
  }
  #invalidate(parent?: TraceContext): void {
    this.speech?.invalidate();
    const store = this.#store, outbox = this.#outbox;
    if (store === undefined || outbox === undefined || this.#closed) return;
    const saved = store.read(), card = saved.state.presentation;
    if (card === null || card.history || refusal(card.opportunity, this.#policy(card.opportunity), true) === undefined) return;
    card.history = true;
    void outbox.transaction(add => {store.save(saved); add('bunny.state.companion-state.reachy', {kind: 'state', ...stateDraft(saved.state)},
      parent === undefined ? {} : {parent});}).catch(() => {});
  }
  #decision(code: string, parent?: TraceContext, unavailable = false, rejection?: ErrorCode): void {
    const store = this.#store, context = this.#context, outbox = this.#outbox;
    if (store === undefined || context === undefined || outbox === undefined || this.#closed) return;
    const saved = store.read(); saved.state.decision = code;
    if (unavailable) {saved.state.availability = 'unavailable'; if (saved.state.presentation !== null) saved.state.presentation.history = true;}
    // No card is generated. A failed decision save cannot affect core attention or retry the opportunity.
    void outbox.transaction(add => {store.save(saved); add('bunny.state.companion-state.reachy', {kind: 'state', ...stateDraft(saved.state)},
      parent === undefined ? {} : {parent});}).catch(() => {});
    if (unavailable) recordLog(context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': 'uncertain', 'bunny.code': 'uncertain-result'}, parent);
    else if (rejection !== undefined) recordLog(context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': 'rejected', 'bunny.code': rejection}, parent);
    else recordLog(context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': code === 'presented' ? 'accepted' : 'rejected'}, parent);
  }
  #admit(command: Command<object>): ErrorCode | undefined {
    const context = this.#context;
    if (this.#closed || context === undefined) return 'unavailable';
    if (command.source !== 'bunny/core') return 'forbidden';
    if (command.subject !== 'reachy') return 'not-found';
    const checked = this.#validator.validate(command, {nowMs: context.clock.now()});
    return checked.ok ? undefined : checked.error.code;
  }
  async #command<T extends object>(command: Command<T>, change: (saved: Saved) => ErrorCode | undefined): Promise<Reply> {
    const refused = this.#admit(command);
    if (refused !== undefined) return errorBody(refused, {detail: 'the companion command was refused'});
    const store = this.#store, outbox = this.#outbox;
    if (store === undefined || outbox === undefined) return errorBody('unavailable');
    try {
      const pending = outbox.transaction(add => {
        const saved = store.read(), code = change(saved);
        if (code !== undefined) return errorBody(code, {detail: 'the companion state changed; read it again'});
        store.save(saved);
        add('bunny.state.companion-state.reachy', {kind: 'state', ...stateDraft(saved.state)}, {parent: command});
        add(`bunny.event.${command.type.includes('companion-settings') ? 'companion-settings-set' : 'companion-fixture-run'}.reachy`,
          {kind: 'outcome', type: command.type.replace(/\.requested$/, '.completed'), subject: 'reachy', dataschema: 'https://bunny.invalid/events/outcome/2.0',
            data: {requestId: (command.data as {requestId: string}).requestId, result: 'succeeded', evidence: 'observed'}}, {parent: command});
        return {status: 'accepted'} as const;
      });
      this.speech?.invalidate();
      return await pending;
    } catch (error) {return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'the companion state could not be saved'});}
  }
  #settings(command: Command<CompanionSettingsSet>): Promise<Reply> {
    return this.#command(command, saved => {
      const data = command.data;
      if (data.expectedRevision !== saved.state.revision) return 'revision-conflict';
      saved.state.settings.enabled = data.enabled; saved.state.settings.muted = [...data.muted];
      if (data.snooze !== 'keep') saved.state.settings.snoozedUntilMs = data.snooze === 'clear' ? 0 : (this.#context?.clock.now() ?? 0) + 3_600_000;
      if (saved.state.presentation !== null) saved.state.presentation.history = true;
      saved.state.decision = data.enabled ? 'settings-saved' : 'disabled';
      return undefined;
    });
  }
  async #fixture(command: Command<CompanionFixtureRun>): Promise<Reply> {
    command = {...command, data: structuredClone(command.data)};
    const reply = await this.#command(command, saved => {saved.state.decision = 'scenario-admitted'; return undefined;});
    if ('error' in reply || this.#closed) return reply;
    const now = this.#context?.clock.now() ?? 0, data = command.data;
    this.#scenarioUntilMs = now + OPPORTUNITY_TTL_MS;
    this.#scenarioGeneration += 1; this.#scenarioAttention = data.scenario === 'question-and-arrival';
    const make = (coding: boolean): Candidate => ({speechEpoch: undefined, parent: {traceparent: command.traceparent}, event: {
      origin: {id: command.id, source: command.source, type: command.type},
      sourceKind: coding ? 'coding' : 'simulated-apartment', context: 'scenario', category: coding ? 'coding-attention' : 'simulated-social',
      cue: coding ? 'question' : data.scenario === 'visit' ? 'visit' : 'arrival', revision: this.#scenarioGeneration, generation: this.#scenarioGeneration,
      session: coding ? 'scenario-session' : null, identity: null, turn: {status: 'unknown'},
      attention: coding ? {id: {status: 'unknown'}, kind: 'question', turn: {status: 'unknown'}} : null, noticeId: null,
      evidence: 'fixture', occurredAtMs: now, observedAtMs: now, validUntilMs: now + OPPORTUNITY_TTL_MS, busy: data.busy, media: data.media, visitor: null, location: null,
    }});
    if (this.#scenarioAttention) this.#enqueue(make(true));
    this.#enqueue(make(false));
    return reply;
  }
}
