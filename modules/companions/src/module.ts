import {readSpeechQualification} from './speech/qualification.js';
import type {SpeechQualification} from './speech-qualification.js';
import {replyRefusal, speechRefusal} from './presentation-policy.js';
import {SpeechCoordinator, speechStateDraft} from './speech/coordinator.js';
import {CodingCoordinator, codingStateDraft} from './coding/coordinator.js';
import type {CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import {Knowledge} from './knowledge/engine.js';
import {Preferences, PREFERENCE_UPLOAD_BYTES, preferenceStateDraft} from './preferences/engine.js';
import {assistantStateDraft, AssistantEngine, type AssistantOptions} from './assistant/engine.js';
import {AnthropicProvider, DEFAULT_MODEL, EFFORTS, type Effort, type Transport} from './assistant/anthropic.js';
import {AnthropicTitleProvider, DEFAULT_TITLE_MODEL} from './assistant/titles.js';
import {deviceToolOwner, allowlistable} from './assistant/tools.js';
import {LIMITS} from './assistant/store.js';
import type {ModelPrices, PriceTable} from './assistant/spend.js';
import {AssistantDeviceCopy} from './assistant/devices.js';
import {ASSISTANT_TOOL_LIMIT, type AssistantDeviceOwner, type AssistantDispatch, type AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import {createHash} from 'node:crypto';
import {errorBody, type ErrorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {OPPORTUNITY_TTL_MS, type CompanionCategory, type CompanionFixtureRun, type CompanionOpportunity,
  type CompanionSettingsSet, type CompanionState, type SpeechState} from '@jimmie-potts/event-contracts/v2/companions';
import {coreValidator, type ModeState, type Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {readSession, type SessionView} from '@jimmie-potts/event-contracts/v2/session';
import {recordLog, Outbox, fullDisk, Outcome, type BunnyModule, type Cancel, type Command, type Configured, type ModuleContext, type ModuleContent, type ModuleContentRequest, type Reply,
  type StateDraft, type Subscription, type SyncedCopy, type TraceContext} from '@jimmie-potts/sdk';
import {revision} from './revision.js';
import {admissionKey, categories, localDay, refusal, selectCard, type Policy} from './rules.js';
import {CompanionStore, type Saved} from './store.js';

type Candidate = {event: CompanionOpportunity; parent: TraceContext; speechEpoch: number | undefined};
const stateDraft = (data: CompanionState): StateDraft<CompanionState> => ({type: 'org.bunny.companion-state.updated', subject: 'reachy',
  dataschema: 'https://bunny.invalid/events/companion-state/2.0', data});
const receiptKey = (event: CompanionOpportunity): string => createHash('sha256').update(`${event.context}:${event.origin.source}:${event.origin.id}:${event.cue}`).digest('hex');
type RetainedArtworkRead = NonNullable<AssistantOptions['retainedArtwork']>;
export const isCompanionsModule = (module: BunnyModule): module is CompanionsModule =>
  module.manifest.name === 'companions' && 'setArtCatalog' in module && typeof module.setArtCatalog === 'function';
export type CompanionsModule = BunnyModule & {setArtCatalog(read: RetainedArtworkRead): void; inspect(): CompanionState | undefined; inspectAssistant(): AssistantState | undefined; inspectSpeech(): SpeechState | undefined; inspectCoding(): CodingState | undefined; pending(): number};
/** The name under the section's `secrets` of the file holding the hosted provider's API key. */
export const API_KEY_SECRET = 'anthropic-api-key';
/**
 * The companions section of the private runtime configuration (Hub #46): `{assistant?, secrets?}`. `assistant` names the
 * `bunny` profile's provider, `synthetic` without one, with its model, effort, conversation title model (Hub #2025) and
 * the allowlisted tool names; a hosted provider needs its key file under `secrets`. An empty section keeps every default
 * and makes no network call.
 */
export type CompanionsConfig = {readonly assistant: {readonly provider: 'synthetic'; readonly tools: readonly string[]}
  | {readonly provider: 'anthropic'; readonly model: string; readonly effort: Effort; readonly titleModel: string; readonly tools: readonly string[]; readonly prices: PriceTable}};
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
const only = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean => Object.keys(value).every(key => keys.includes(key));
const refuse = (detail: string): ErrorBody => errorBody('invalid-request', {detail});
const MODEL = /^[a-z0-9][a-z0-9.-]{0,127}$/;
const PRICE_CLASSES = ['input', 'output', 'cacheWrite', 'cacheRead'] as const;
/**
 * `assistant.prices` (Hub #2024), optional: at most 16 models, each with all four prices in US dollars per million tokens,
 * finite and from 0 to 1000. An entry overrides the built-in table (Hub #2047); without one the ledger uses the built-in
 * prices, or the dearest known rate for a model the table does not know, so nothing needs entering at install.
 */
function pricesOf(value: unknown): PriceTable | string {
  if (value === undefined) return {};
  const shape = 'assistant.prices maps each model to input, output, cacheWrite and cacheRead prices in US dollars per million tokens, from 0 to 1000';
  if (!isObject(value) || Object.keys(value).length > 16) return shape;
  const table: Record<string, ModelPrices> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!MODEL.test(name) || !isObject(entry) || Object.keys(entry).length !== PRICE_CLASSES.length || !PRICE_CLASSES.every(key => {
      const price = entry[key]; return typeof price === 'number' && Number.isFinite(price) && price >= 0 && price <= 1000;
    })) return shape;
    table[name] = {input: entry.input as number, output: entry.output as number, cacheWrite: entry.cacheWrite as number, cacheRead: entry.cacheRead as number};
  }
  return table;
}
export function configureCompanions(section: unknown): Configured<CompanionsConfig> | ErrorBody {
  if (!isObject(section) || !only(section, ['assistant', 'secrets'])) return refuse('the companions section has only assistant and secrets');
  const assistant = section.assistant === undefined ? {} : section.assistant;
  if (!isObject(assistant) || !only(assistant, ['provider', 'model', 'effort', 'titleModel', 'tools', 'prices'])) return refuse('assistant has only provider, model, effort, titleModel, tools and prices');
  const provider = assistant.provider ?? 'synthetic';
  if (provider !== 'synthetic' && provider !== 'anthropic') return refuse('assistant.provider must be synthetic or anthropic');
  const tools = assistant.tools ?? [];
  if (!Array.isArray(tools) || tools.length > ASSISTANT_TOOL_LIMIT || !tools.every(allowlistable) || new Set(tools).size !== tools.length) return refuse('assistant.tools must list each permitted tool name once');
  if (provider === 'synthetic') {
    if (assistant.model !== undefined || assistant.effort !== undefined || assistant.titleModel !== undefined || assistant.prices !== undefined) return refuse('the synthetic provider takes no model, effort, title model or prices');
    return {config: {assistant: {provider, tools: [...tools]}}};
  }
  const model = assistant.model ?? DEFAULT_MODEL, effort = assistant.effort ?? 'medium', titleModel = assistant.titleModel ?? DEFAULT_TITLE_MODEL;
  if (typeof model !== 'string' || !MODEL.test(model)) return refuse('assistant.model is a model identifier of at most 128 lowercase letters, digits, dots and hyphens');
  if (typeof titleModel !== 'string' || !MODEL.test(titleModel)) return refuse('assistant.titleModel is a model identifier of at most 128 lowercase letters, digits, dots and hyphens');
  if (!EFFORTS.includes(effort as Effort)) return refuse('assistant.effort is low, medium or high');
  const prices = pricesOf(assistant.prices);
  if (typeof prices === 'string') return refuse(prices);
  if (!isObject(section.secrets) || !Object.hasOwn(section.secrets, API_KEY_SECRET)) return refuse(`a hosted provider names its API key file as secrets.${API_KEY_SECRET}`);
  return {config: {assistant: {provider, model, effort: effort as Effort, titleModel, tools: [...tools], prices}}};
}
/** What a test or the runtime gives the module: the engine's seams and, for a hosted provider, the transport behind its fetch. */
export type CompanionsOptions = AssistantOptions & {readonly transport?: Transport};

/** One private companion owner; visual admission and optional browser speech share current policy. */
export function createCompanionsModule(options: CompanionsOptions = {}): CompanionsModule {
  const engine = new Companions(options);
  return {manifest: {name: 'companions', apiVersion: '1.3', configure: configureCompanions, pages: [{id: 'reachy', title: 'Reachy', presentation: 'react'}, {id: 'microduck', title: 'MicroDuck', presentation: 'react'}, {id: 'assistant', title: 'Conversation', presentation: 'react'}, {id: 'preferences', title: 'Preferences', presentation: 'react'}, {id: 'knowledge', title: 'Companion knowledge', presentation: 'react'}, {id: 'duck-conversation', title: 'Duck conversation', presentation: 'react'}],
    content: (ref, request) => engine.qualifiedSpeech(ref, request) ?? engine.knowledge?.content(ref, request) ?? engine.preferences?.content(ref, request) ?? engine.assistant?.content(ref, request),
    upload: {family: 'assistant-input', maxBytes: PREFERENCE_UPLOAD_BYTES, stage: request => (request.target === 'knowledge' ? engine.knowledge?.stage(request) : request.target === 'preferences' ? engine.preferences?.stage(request) : engine.assistant?.stage(request)) ?? errorBody('unavailable')}},
    setArtCatalog: read => {engine.retainedArtwork = read;},
    start: context => engine.start(context), stop: () => engine.stop(), inspect: () => engine.inspect(), inspectAssistant: () => engine.assistant?.inspect(), inspectSpeech: () => engine.speech?.inspect(), inspectCoding: () => engine.coding?.inspect(), pending: () => engine.pending()};
}
class Companions {
  retainedArtwork: RetainedArtworkRead | undefined;
  speech: SpeechCoordinator | undefined;
  coding: CodingCoordinator | undefined;
  assistant: AssistantEngine | undefined;
  preferences: Preferences | undefined;
  knowledge: Knowledge | undefined;
  #context: ModuleContext | undefined;
  #qualification: SpeechQualification | undefined;
  #store: CompanionStore | undefined;
  #outbox: Outbox | undefined;
  readonly #deviceCopies = new Map<AssistantDeviceOwner, AssistantDeviceCopy>();
  #copy: SyncedCopy<Session30Record | ModeState> | undefined;
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
  /**
   * The admitted live coding-attention opportunities whose question window may still hold priority (Hub #1865,
   * decision 2). Only memory holds them, so a restart opens no window and replays nothing.
   */
  #priority: CompanionOpportunity[] = [];
  readonly #pending = new Map<CompanionCategory, Candidate>();
  readonly #subscriptions: Subscription[] = [];
  readonly #validator = coreValidator();
  readonly #seen = new Set<string>();
  #work: Promise<void> = Promise.resolve();
  #draining: Promise<void> = Promise.resolve();
  constructor(readonly options: CompanionsOptions) {}
  inspect(): CompanionState | undefined {return this.#store?.read().state;}
  pending(): number {return this.#pending.size + (this.#active === undefined ? 0 : 1);}
  qualifiedSpeech(ref: string, request?: ModuleContentRequest): ModuleContent | ErrorBody | undefined {
    if (ref !== 'speech-qualification') return undefined;
    if (this.#closed || this.#context === undefined || this.#context.signal.aborted || request?.signal.aborted === true || this.#qualification === undefined) return errorBody('unavailable');
    if (Object.keys(request?.query ?? {}).length > 0) return errorBody('invalid-request');
    return {type: 'application/json', bytes: Buffer.from(JSON.stringify(this.#qualification))};
  }
  async start(context: ModuleContext): Promise<void> {
    this.#context = context; this.#priority = [];
    this.#qualification = readSpeechQualification(context.files());
    const database = context.database();
    this.#store = new CompanionStore(database);
    this.#outbox = new Outbox({sdk: context.sdk, database, clock: context.clock, log: context.log, trace: context.trace, validator: this.#validator});
    this.speech = new SpeechCoordinator(context, this.#outbox, source => {
      return source.kind === 'card' ? speechRefusal(source.card, this.#policy(source.card.opportunity)) === undefined : replyRefusal(this.#replyPolicy()) === undefined;
    }, () => this.#qualification !== undefined);
    await this.speech.start();
    // The preference store opens first so the engine can read the owner's active entries at each model call (Hub #507).
    this.preferences = new Preferences(context, this.#outbox);
    const preferences = this.preferences;
    // A reply that ends a turn, or one the owner asks to hear again, goes to the same coordinator and endpoint as Reachy's spoken alerts (Hub #500).
    const speak: AssistantOptions['speak'] = this.options.speak ?? ((reply, key, parent, line) => {this.speech?.offerReply(reply, key, parent, this.speech.mark(), line);});
    // The coding coordinator (Hub #502) is built before the engine, which binds proposals to its revision, and started after it, so a
    // responsibility settled at startup reaches a running engine.
    // Each run is tagged with the companion whose task asked (Hub #2028), read from the engine's saved task.
    const coding = new CodingCoordinator(context, this.#outbox, (taskId, text, parent, evidence, startup) => this.assistant?.deliver(taskId, text, parent, evidence, startup) ?? Promise.resolve(),
      taskId => this.assistant?.store.task(taskId)?.profile);
    this.coding = coding;
    // An approved hand-off goes to the core now when its companion's slot is free, or waits for it (Hub #2028).
    const delegate: AssistantOptions['delegate'] = this.options.delegate ?? ((data, parent) => coding.handOff(data, parent));
    this.assistant = new AssistantEngine(context, this.#outbox, {...await this.#assistantOptions(context),
      retainedArtwork: (id, timeoutMs) => (this.retainedArtwork ?? this.options.retainedArtwork)?.(id, timeoutMs) ?? Promise.resolve(undefined), preferences: () => preferences.store.active().entries, speak,
      coding: this.options.coding ?? (profile => coding.endpoint(profile)), delegate, onCancelled: this.options.onCancelled ?? (taskId => {coding.cancel(taskId);})});
    await this.assistant.start();
    await coding.start();
    await this.preferences.start();
    this.knowledge = new Knowledge(context, this.#outbox, this.assistant, this.preferences.store);
    await this.knowledge.start();
    const saved = this.#store.read();
    for (const key of saved.received) this.#seen.add(key);
    if (saved.state.presentation !== null) saved.state.presentation.history = true;
    saved.state.availability = 'available';
    this.#store.save(saved);
    this.#subscriptions.push(await context.sdk.serveSync(['companion-state', 'assistant-state', 'preference-state', 'companion-speech-state', 'coding-state'], request => {
      const state = this.inspect(), speech = this.speech?.inspect(), codingState = this.coding?.inspect();
      const assistant = this.assistant?.inspect(), preferences = this.preferences?.inspect();
      return state === undefined || speech === undefined || assistant === undefined || preferences === undefined || this.#closed ? errorBody('unavailable') : {revision: revision(database), states: [
        ...(request.data.families.includes('companion-speech-state') ? [speechStateDraft(speech)] : []),
        ...(request.data.families.includes('coding-state') && codingState !== undefined ? [codingStateDraft(codingState)] : []),
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
    await this.coding?.stop();
    await this.speech?.stop();
    await this.assistant?.stop();
    await this.preferences?.stop();
    await this.knowledge?.stop();
    await this.#copy?.close();
    await Promise.all([...this.#deviceCopies.values()].map(copy => copy.close()));
    this.#deviceCopies.clear();
    await Promise.all([this.#work, this.#draining]);
  }
  /** The engine's seams from the section: the `bunny` provider, the allowlist, the synced core copy and the dispatch path. */
  async #assistantOptions(context: ModuleContext): Promise<AssistantOptions> {
    // The runtime gives `config` only as `configureCompanions` returned it; a harness without a section gives undefined.
    const {options} = this, assistant = (context.config as CompanionsConfig | undefined)?.assistant;
    const tools = options.tools ?? assistant?.tools ?? [];
    let provider = options.provider, titleProvider = options.titleProvider;
    if ((provider === undefined || titleProvider === undefined) && assistant?.provider === 'anthropic') {
      // The key is read once, at start, and lives only in the providers; the runtime redacts it from its own records.
      const key = await context.secrets.read(API_KEY_SECRET), transport = options.transport === undefined ? {} : {transport: options.transport};
      provider ??= new AnthropicProvider({key, model: assistant.model, effort: assistant.effort, ...transport});
      // The conversation title call uses the same key and transport with its own small model (Hub #2025).
      titleProvider ??= new AnthropicTitleProvider({key, model: assistant.titleModel, ...transport});
    }
    const core = options.core ?? (() => {
      const records = this.#copy?.states().map(message => message.data) ?? [];
      return {sessions: this.#views(), mode: records.find((record): record is ModeState => 'mode' in record), synced: this.#synced};
    });
    if (options.devices === undefined) {
      for (const tool of tools) {
        const owner = deviceToolOwner(tool);
        if (owner === undefined || this.#deviceCopies.has(owner)) continue;
        const copy = new AssistantDeviceCopy(context, owner);
        this.#deviceCopies.set(owner, copy);
        copy.start();
      }
    }
    const dispatch = options.dispatch ?? ((data: AssistantDispatch, parent: TraceContext) => context.sdk.request('bunny.cmd.assistant-dispatch.assistant',
      {type: 'org.bunny.assistant.dispatch.requested', subject: 'assistant', dataschema: `https://bunny.invalid/events/assistant-dispatch/${data.family === 'mode-set' ? '2.0' : data.family === 'catalog-action' ? '2.3' : 'owner' in data ? '2.2' : '2.1'}`, data},
      {timeoutMs: LIMITS.toolMs - 1000, requestId: data.requestId, parent}));
    const prices = options.prices ?? (assistant?.provider === 'anthropic' ? assistant.prices : undefined);
    return {...(provider === undefined ? {} : {provider}), ...(prices === undefined ? {} : {prices}), ...(options.timeZone === undefined ? {} : {timeZone: options.timeZone}),
      ...(titleProvider === undefined ? {} : {titleProvider}), ...(options.syntheticTitleProvider === undefined ? {} : {syntheticTitleProvider: options.syntheticTitleProvider}),
      ...(options.profileProviders === undefined ? {} : {profileProviders: options.profileProviders}),
      tools, core, dispatch, devices: options.devices ?? (owner => this.#deviceCopies.get(owner)?.records()),
      readDevice: options.readDevice ?? (async (owner, name, signal, parent) => this.#deviceCopies.get(owner)?.read(name, signal, parent)), ...(options.available === undefined ? {} : {available: options.available})};
  }
  #replyPolicy(): Pick<Policy, 'mode' | 'synced'> {
    const records = this.#copy?.states().map(message => message.data) ?? [];
    return {mode: records.find((record): record is ModeState => 'mode' in record)?.mode, synced: this.#synced};
  }
  #policy(event: CompanionOpportunity): Policy {
    const saved = this.#store?.read(), context = this.#context;
    if (saved === undefined || context === undefined) throw new Error('companions-not-started');
    const records = this.#copy?.states().map(message => message.data) ?? [];
    const mode = records.find((record): record is ModeState => 'mode' in record);
    return {nowMs: context.clock.now(), settings: saved.state.settings, mode: mode?.mode, synced: this.#synced,
      sessions: this.#views(), priority: this.#priority, scenarioAttention: event.context === 'scenario' && this.#scenarioAttention && context.clock.now() < this.#scenarioUntilMs,
      allowance: saved.allowances[event.context], admissions: saved.admissions, available: !this.#closed && !context.signal.aborted};
  }
  /** The synced core copy's sessions as the shared read function reads them (Hub #1865). */
  #views(): SessionView[] {
    return (this.#copy?.states() ?? []).flatMap(message => {
      const view = message.type === 'org.bunny.session.updated' ? readSession(message) : undefined;
      return view === undefined ? [] : [view];
    });
  }
  async #follow(): Promise<void> {
    const context = this.#context;
    if (context === undefined || this.#closed) return;
    this.#synced = false;
    const prior = this.#copy; this.#copy = undefined; await prior?.close();
    let replacing = false;
    try {
      const result = await context.sdk.sync<Session30Record | ModeState>(['session', 'mode'], change => {
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
      else recordLog(context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': Outcome.rejected, 'bunny.code': code}, message);
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
    const {event} = candidate;
    if (event.context === 'live' && event.category === 'coding-attention') {
      // The question's window opens with its admitted opportunity. Whatever Reachy shows of it, a background card or
      // speech waiting now loses to it (Hub #1865, decision 2).
      const now = this.#context?.clock.now() ?? 0;
      this.#priority = [...this.#priority.filter(item => item.validUntilMs > now).slice(-31), event];
      this.#invalidate(candidate.parent);
    }
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
    if (unavailable) recordLog(context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': Outcome.uncertain, 'bunny.code': 'uncertain-result'}, parent);
    else if (rejection !== undefined) recordLog(context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': Outcome.rejected, 'bunny.code': rejection}, parent);
    else recordLog(context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': code === 'presented' ? 'accepted' : Outcome.rejected}, parent);
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
            data: {requestId: (command.data as {requestId: string}).requestId, result: Outcome.succeeded, evidence: Outcome.observed}}, {parent: command});
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
