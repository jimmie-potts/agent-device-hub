// The art owner (Hub #680; docs/art-generation-qualification.md). One admitted request is one durable job row, committed
// with its `succeeded`, `observed` outcome, as `assistant-input` does: the tracked effect is durable admission, since a
// provider call can outlast the device deadline. Results appear in the `art` state. A job is never re-run after a restart.
import {createHash, randomUUID} from 'node:crypto';
import {errorBody, type ErrorBody, type ErrorCode, type MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {ART_ID, ART_STATE_KEY, ART_STATE_SCHEMA, ART_STATE_TYPE, artContentRef, type ArtCandidate, type ArtDisplayTarget, type ArtOutcome, type ArtProviderName, type ArtProviderSpend, type ArtReason, type ArtState, type ArtTarget, type ArtTargetOutcome, type ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import {Outbox, Outcome, childOf, fullDisk, recordLog, type AddMessage, type BunnyModule, type Cancel, type Command, type ModuleContent, type ModuleContentRequest, type ModuleContext, type Reply, type Subscription, type TraceContext} from '@jimmie-potts/sdk';
import {AnthropicIdeas} from './anthropic.js';
import {ANTHROPIC_KEY, OPENAI_KEY, configureArt, type ArtConfig} from './configuration.js';
import {artValidator} from './families.js';
import {GUARD_LIMIT, GUARD_WINDOW_MS, Ledger, dayKey, monthKey} from './ledger.js';
import {MAX_DISPLAY_BYTES, MediaFault, assembleGif, browserRendition, localMotion, paletteOf, proceduralImage, reduceFrame, reduceStill, sha256, sliceSheet, stillFromSheet, validateImage, validateSheet, FRAME_DELAY_MS, SHEET_COLUMNS, SHEET_ROWS, type SheetReason} from './media.js';
import {OpenAiImages} from './openai.js';
import {IDEA_MAX_TOKENS, IDEA_MODEL, IMAGE_MODEL, type PriceKey, type Usage} from './prices.js';
import {MAX_TEXT, boundIdea, contextFor, ideaPrompt, ideaSystem, imagePrompt, localIdea, variationIdea} from './prompts.js';
import {ProviderFault, type ArtProvider, type Transport} from './provider.js';
import {unwiredCommands, unwiredDispatch, unwiredWeather, type ArtCommandSeam, type ArtDispatchSeam, type ArtGenerate, type ArtOwnerAction, type StageResult, type WeatherSeam} from './seams.js';
import {ArtStore, type Artwork, type Job, type JobTarget, type StageRow, type StoredComposition} from './store.js';

export const MAX_RUNNING = 2;
export const MAX_PENDING = 8;
/** A complex prompt may take up to two minutes; past this margin the answer is lost and the call uncertain. */
export const CALL_DEADLINE_MS = 150_000;
/** How long a device keeps a staged copy before the module must stage it again. */
export const STAGE_LIFETIME_MS = 7 * 24 * 3_600_000;
const STATE_JOBS = 16, STATE_ARTWORKS = 24, STATE_CANDIDATES = 32, STATE_RETAINED = 16, MAX_PAGE = 100, KEEP_FINISHED_JOBS = 1000, KEEP_RECEIPTS_MS = 30 * 24 * 3_600_000;
const DISPLAY: Readonly<Record<ArtDisplayTarget, {width: number; height: number; quality: string; size: string}>> = {
  tidbyt: {width: 64, height: 32, quality: 'low', size: '1536x768'},
  pixoo: {width: 64, height: 64, quality: 'low', size: '1024x1024'},
};
const BROWSER = {width: 1536, height: 1024, quality: 'medium', size: '1536x1024', card: {width: 768, height: 512}};
/** The sheet entry the trial observed. Low quality at this size has no price entry, so it cannot run. */
const SHEET = {width: 1536, height: 1024, quality: 'medium', size: '1536x1024'};
const TARGETS: readonly ArtTarget[] = ['ui', 'tidbyt', 'pixoo'];
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const isDisplay = (target: ArtTarget): target is ArtDisplayTarget => target !== 'ui';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : object(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);

class Refusal extends Error {constructor(readonly code: ErrorCode, readonly detail?: string) {super(code);}}
const refuse = (code: ErrorCode, detail?: string): never => {throw new Refusal(code, detail);};

/** The record's rules for one artwork, from its targets alone. */
export function artworkOutcome(targets: readonly ArtTargetOutcome[]): ArtOutcome {
  const every = (outcome: ArtTargetOutcome): boolean => targets.every(target => target === outcome);
  if (every('succeeded')) return 'succeeded';
  if (targets.includes('succeeded')) return 'partial';
  if (targets.includes('uncertain')) return 'uncertain';
  if (every('rejected')) return 'rejected';
  if (every('cancelled')) return 'cancelled';
  return 'failed';
}

export type ArtModuleOptions = {
  /** Replaces the providers the section's key files would build. Tests pass fakes, or none for "no key". */
  readonly providers?: Readonly<Partial<Record<ArtProviderName, ArtProvider>>>;
  /** The fetch both providers use. */
  readonly transport?: Transport;
  readonly commands?: ArtCommandSeam;
  readonly dispatch?: ArtDispatchSeam;
  readonly weather?: WeatherSeam;
};

export function createArtModule(options: ArtModuleOptions = {}): BunnyModule<ArtConfig> {
  let owner: ArtOwner | undefined;
  return {
    manifest: {name: 'art', apiVersion: '1.3', configure: configureArt, content: (ref, request) => owner?.content(ref, request)},
    start: async context => {owner = new ArtOwner(context, options); await owner.start();},
    stop: async () => {await owner?.stop();},
  };
}

type Paid<T> = {status: 'answered'; value: T} | {status: 'refused'; reason: ArtReason} | {status: 'cancelled'} | {status: 'fault'; fault: ProviderFault};
type Running = {readonly controller: AbortController; readonly work: Promise<void>};
type Settled = Pick<JobTarget, 'outcome' | 'code' | 'reason'>;

class ArtOwner {
  readonly #context: ModuleContext<ArtConfig>;
  readonly #options: ArtModuleOptions;
  readonly #config: ArtConfig;
  readonly #store: ArtStore;
  readonly #ledger: Ledger;
  readonly #validator: MessageValidator = artValidator();
  readonly #outbox: Outbox;
  readonly #commands: ArtCommandSeam;
  readonly #dispatch: ArtDispatchSeam;
  readonly #weather: WeatherSeam;
  readonly #running = new Map<string, Running>();
  readonly #queue: string[] = [];
  #providers: Partial<Record<ArtProviderName, ArtProvider>> = {};
  #subscriptions: Subscription[] = [];
  #timers: Cancel[] = [];
  #closed = false;

  constructor(context: ModuleContext<ArtConfig>, options: ArtModuleOptions) {
    if (context.config === undefined) throw new Error('art needs its section');
    this.#context = context; this.#options = options; this.#config = context.config;
    this.#store = new ArtStore(context.database());
    this.#ledger = new Ledger(this.#store, this.#config.limits);
    this.#outbox = new Outbox({...context, database: context.database(), validator: this.#validator});
    this.#commands = options.commands ?? unwiredCommands;
    this.#dispatch = options.dispatch ?? unwiredDispatch;
    this.#weather = options.weather ?? unwiredWeather;
  }

  async start(): Promise<void> {
    this.#providers = {...await this.#keyed(), ...this.#options.providers};
    await this.#outbox.transaction(add => {this.#recover(); this.#prune(); this.#publish(add);});
    await this.#outbox.republish();
    const {sdk} = this.#context;
    this.#subscriptions.push(await sdk.serveSync(['art'], () => ({revision: this.#store.revision(), states: [{type: ART_STATE_TYPE, subject: ART_ID, dataschema: ART_STATE_SCHEMA, data: this.state()}]})));
    this.#subscriptions.push(...await this.#weather.start(sdk));
    this.#subscriptions.push(...await this.#dispatch.watch(sdk, (requestId, result) => {void this.#stageResult(requestId, result);}));
    this.#subscriptions.push(...await this.#commands.serve(sdk, {
      owner: command => this.#owner(command),
      automatic: command => this.#admit(command, 'art-auto', 'automatic', () => this.#generate(command, 'automatic')),
    }));
    this.#scheduleMidnight();
    this.#renewAmbient();
  }
  async stop(): Promise<void> {
    this.#closed = true;
    for (const cancel of this.#timers) cancel();
    this.#timers = [];
    this.#queue.length = 0;
    await Promise.all(this.#subscriptions.map(subscription => subscription.close()));
    const running = [...this.#running.values()];
    for (const job of running) job.controller.abort();
    await Promise.all(running.map(job => job.work));
  }
  /** A key is read once, at start, and lives only in its provider. A missing file means no key, not a failed module. */
  async #keyed(): Promise<Partial<Record<ArtProviderName, ArtProvider>>> {
    const transport = this.#options.transport === undefined ? {} : {transport: this.#options.transport};
    const read = async (name: string): Promise<string | undefined> => {
      try {
        const key = (await this.#context.secrets.read(name)).trim();
        return key === '' ? undefined : key;
      } catch {return undefined;}
    };
    const openai = this.#config.keys.openai ? await read(OPENAI_KEY) : undefined, anthropic = this.#config.keys.anthropic ? await read(ANTHROPIC_KEY) : undefined;
    return {...(openai === undefined ? {} : {openai: new OpenAiImages({key: openai, ...transport})}), ...(anthropic === undefined ? {} : {anthropic: new AnthropicIdeas({key: anthropic, ...transport})})};
  }
  /** A restart resends nothing: a dispatched call is uncertain, its reservation kept, and its job ends where it stood. */
  #recover(): void {
    const {uncertain} = this.#ledger.recover(), lost = new Set(uncertain);
    for (const stage of this.#store.pendingStages()) this.#store.saveStage({...stage, status: 'uncertain'});
    for (const job of this.#store.unfinished()) {
      const inFlight = new Set(this.#ledger.calls(job.requestId).filter(call => lost.has(call.callId)).map(call => call.target as string));
      for (const target of job.targets) {
        if (target.outcome !== 'pending') continue;
        const settled: Settled = job.cancelRequested && !inFlight.has(target.target) ? {outcome: 'cancelled', code: 'cancelled', reason: 'cancelled'}
          : inFlight.has(target.target) ? {outcome: Outcome.uncertain, code: 'uncertain-result', reason: 'restart'} : {outcome: Outcome.failed, code: 'unavailable', reason: 'restart'};
        Object.assign(target, settled);
      }
      this.#finishJob(job);
    }
  }

  // Admission.
  #owner(command: Command<ArtOwnerAction>): Promise<Reply> {
    const data = command.data as ArtOwnerAction & Record<string, unknown>;
    const apply = (): (() => void) | undefined => {
      switch (data.action) {
        case 'generate': return this.#generate(command as Command<ArtGenerate>, 'owner');
        case 'cancel': return this.#cancel(data);
        case 'favorite': this.#favorite(data); return undefined;
        case 'feedback': this.#feedback(data); return undefined;
        case 'delete': return this.#delete(data);
        case 'reuse': return this.#reuse(data, command);
        default: return refuse('invalid-request', 'unknown art action');
      }
    };
    return this.#admit(command, 'art-request', 'owner', apply);
  }
  /** One transaction holds the row, the receipt, the state and the `succeeded`, `observed` outcome. */
  async #admit<T extends {requestId: string}>(command: Command<T>, family: 'art-request' | 'art-auto', admittedBy: 'owner' | 'automatic', apply: () => (() => void) | undefined): Promise<Reply> {
    if (this.#closed || this.#context.signal.aborted) return errorBody('unavailable');
    if (command.expiresat !== undefined && Date.parse(command.expiresat) <= this.#context.clock.now()) return errorBody('expired');
    const {requestId} = command.data, digest = createHash('sha256').update(canonical({family, admittedBy, data: command.data})).digest('hex');
    let launch: (() => void) | undefined;
    try {
      await this.#outbox.transaction(add => {
        const previous = this.#store.receipt(requestId);
        if (previous !== undefined) {if (previous !== digest) refuse('duplicate-conflict'); return;}
        launch = apply();
        this.#store.remember(requestId, digest, this.#context.clock.now());
        this.#publish(add, command);
        add(`bunny.event.${family}.${ART_ID}`, {kind: 'outcome', type: command.type.replace(/\.requested$/, '.completed'), subject: ART_ID,
          dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId, result: Outcome.succeeded, evidence: Outcome.observed}}, {parent: command});
      });
    } catch (error) {
      if (error instanceof Refusal) return errorBody(error.code, error.detail === undefined ? {} : {detail: error.detail});
      recordLog(this.#context.log, 'operation.failed', {'bunny.operation': 'storage', 'bunny.outcome': Outcome.failed, 'bunny.code': fullDisk(error) ? 'capacity' : 'internal', 'bunny.request.id': requestId}, command);
      return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'the art request was not saved'});
    }
    launch?.();
    return {status: 'accepted'};
  }
  /** Reads only the declared fields, so a label cannot widen what a job may do or what a prompt may hold. */
  #generate(command: Command<ArtGenerate>, admittedBy: 'owner' | 'automatic'): () => void {
    const data = command.data as Record<string, unknown>, now = this.#context.clock.now();
    if (Object.keys(data).some(key => !['requestId', 'action', 'purpose', 'origin', 'text', 'targets', 'variationOf', 'animated', 'source'].includes(key))) refuse('invalid-request', 'an art request has only its declared fields');
    if (data.action !== 'generate') refuse('invalid-request', 'only a generate action makes art');
    const {requestId} = command.data, text = data.text === undefined ? null : data.text, targets = data.targets, variationOf = data.variationOf === undefined ? null : data.variationOf;
    if (text !== null && (typeof text !== 'string' || text.trim() === '' || text.length > MAX_TEXT)) refuse('invalid-request', 'the art text is 1 to 1,500 characters');
    if (!Array.isArray(targets) || targets.length === 0 || new Set(targets).size !== targets.length || !targets.every(target => TARGETS.includes(target as ArtTarget))) refuse('invalid-request', 'an art request names its distinct targets');
    if (!['request', 'ambient', 'appearance', 'variation'].includes(data.purpose as string)) refuse('invalid-request', 'unknown art purpose');
    if (data.animated !== undefined && typeof data.animated !== 'boolean') refuse('invalid-request', 'animated is a boolean');
    if (data.source !== undefined && !['generate', 'procedural'].includes(data.source as string)) refuse('invalid-request', 'unknown art source');
    if (variationOf !== null) {
      const source = typeof variationOf === 'string' ? this.#store.artwork(variationOf) : undefined;
      if (source === undefined || source.deletedAtMs !== null) refuse('not-found', 'no such artwork to vary');
    }
    if (this.#store.pendingJobs() >= MAX_PENDING) refuse('capacity', 'too many art jobs are waiting');
    const origin = object(data.origin) && ['owner', 'schedule', 'weather'].includes(data.origin.kind as string)
      ? {kind: data.origin.kind as Job['origin']['kind'], ...(typeof data.origin.reference === 'string' && ID.test(data.origin.reference) ? {reference: data.origin.reference} : {})} : {kind: admittedBy === 'owner' ? 'owner' as const : 'schedule' as const};
    this.#store.saveJob({requestId, artworkId: `art-${randomUUID()}`, purpose: data.purpose as Job['purpose'], origin, admittedBy, text: text as string | null,
      context: contextFor(requestId, now, this.#weather.read()), targets: (targets as ArtTarget[]).map(target => ({target, outcome: 'pending', code: null, reason: null, compositionId: null})),
      variationOf: variationOf as string | null, animated: data.animated === true, source: data.source === 'procedural' ? 'procedural' : 'generate',
      status: 'queued', cancelRequested: false, outcome: null, idea: null, traceparent: command.traceparent, createdAtMs: now, finishedAtMs: null});
    return () => {this.#queue.push(requestId); this.#pump();};
  }
  #cancel(data: Extract<ArtOwnerAction, {action: 'cancel'}>): () => void {
    const job = this.#store.job(data.job) ?? refuse('not-found', 'no such art job');
    if (job.status === 'finished') refuse('invalid-state', 'that art job has finished');
    job.cancelRequested = true;
    if (job.status === 'queued') {
      for (const target of job.targets) Object.assign(target, {outcome: 'cancelled', code: 'cancelled', reason: 'cancelled'});
      this.#finishJob(job);
      const at = this.#queue.indexOf(job.requestId);
      if (at >= 0) this.#queue.splice(at, 1);
      return () => {};
    }
    this.#store.saveJob(job);
    return () => {this.#running.get(job.requestId)?.controller.abort();};
  }
  #saved(artworkId: unknown): Artwork {
    const artwork = typeof artworkId === 'string' ? this.#store.artwork(artworkId) : undefined;
    return artwork !== undefined && artwork.deletedAtMs === null ? artwork : refuse('not-found', 'no such artwork');
  }
  #favorite(data: Extract<ArtOwnerAction, {action: 'favorite'}>): void {
    if (typeof data.favorite !== 'boolean') refuse('invalid-request', 'favorite is a boolean');
    this.#store.saveArtwork({...this.#saved(data.artworkId), favorite: data.favorite});
  }
  /** Explicit feedback only. Silence writes nothing, so ignoring a piece is not a negative signal. */
  #feedback(data: Extract<ArtOwnerAction, {action: 'feedback'}>): void {
    if (!['more', 'less', 'dismiss'].includes(data.signal)) refuse('invalid-request', 'unknown art feedback');
    const artwork = this.#saved(data.artworkId);
    this.#store.saveArtwork({...artwork, feedback: data.signal});
    this.#store.addFeedback(artwork.artworkId, data.signal, this.#context.clock.now());
  }
  /**
   * Leaves selection at once. The module's bytes go when nothing can still refer to them: a device's staged copy lives on
   * until it expires, and the state says so, so the row stays as a tombstone until then.
   */
  #delete(data: Extract<ArtOwnerAction, {action: 'delete'}>): () => void {
    const artwork = this.#saved(data.artworkId), now = this.#context.clock.now(), ambient = this.#store.ambient(now);
    this.#store.saveArtwork({...artwork, deletedAtMs: now, favorite: false});
    this.#prune();
    return ambient?.artworkId === artwork.artworkId ? () => {void this.#sendAmbient(null, childOf(undefined));} : () => {};
  }
  /** Saved art plays without generation: reuse stages it again, for free, and offers it once a device confirms. */
  #reuse(data: Extract<ArtOwnerAction, {action: 'reuse'}>, parent: TraceContext): () => void {
    const artwork = this.#saved(data.artworkId);
    if (data.target !== 'tidbyt' && data.target !== 'pixoo') refuse('invalid-request', 'reuse names a display');
    const composition = this.#store.compositions(artwork.artworkId).find(entry => entry.target === data.target) ?? refuse('not-found', 'that artwork has no composition for this display');
    return () => {void this.#stage(artwork.artworkId, composition, parent, false).catch(() => {});};
  }

  // Running a job.
  #pump(): void {
    while (!this.#closed && this.#running.size < MAX_RUNNING) {
      const requestId = this.#queue.shift();
      if (requestId === undefined) return;
      const controller = new AbortController();
      const work = this.#run(requestId, controller).finally(() => {this.#running.delete(requestId); this.#pump();});
      this.#running.set(requestId, {controller, work});
    }
  }
  #job(requestId: string): Job {return this.#store.job(requestId) ?? refuse('not-found');}
  async #run(requestId: string, controller: AbortController): Promise<void> {
    await Promise.resolve();
    try {
      await this.#outbox.transaction(add => {
        const job = this.#job(requestId);
        job.status = 'running'; this.#store.saveJob(job); this.#publish(add, job);
      });
      const first = this.#job(requestId);
      if (first.source === 'procedural') {
        const bytes = await proceduralImage(requestId);
        for (const {target} of first.targets) await this.#composeTarget(requestId, target, bytes, null, 'local');
      } else {
        const idea = await this.#idea(requestId, controller.signal);
        for (const {target} of first.targets) {
          // A stop ends the job where it stands. Its remaining targets were never sent, and nothing resumes them.
          if (this.#closed) break;
          await this.#drawTarget(requestId, target, idea, controller.signal);
        }
      }
    } catch {
      recordLog(this.#context.log, 'operation.failed', {'bunny.operation': 'media', 'bunny.outcome': Outcome.failed, 'bunny.code': 'internal', 'bunny.request.id': requestId}, this.#traceOf(requestId));
    }
    await this.#outbox.transaction(add => {
      const job = this.#job(requestId);
      // Only a failure of storage or local work leaves a target pending here. Its call, if any, was settled or kept already.
      const unsent: Settled = this.#closed ? {outcome: Outcome.failed, code: 'unavailable', reason: 'restart'} : {outcome: Outcome.failed, code: 'internal', reason: 'storage'};
      for (const target of job.targets) if (target.outcome === 'pending') Object.assign(target, unsent);
      this.#finishJob(job); this.#prune(); this.#publish(add, job);
    }).catch(() => {/* The next start ends the job from its saved rows. */});
  }
  #traceOf(requestId: string): TraceContext | undefined {
    const job = this.#store.job(requestId);
    return job === undefined ? undefined : {traceparent: job.traceparent};
  }
  #finishJob(job: Job): void {
    job.status = 'finished'; job.outcome = artworkOutcome(job.targets.map(target => target.outcome)); job.finishedAtMs = this.#context.clock.now();
    this.#store.saveJob(job);
  }
  /** The idea call is optional and its own row. Without Claude, or if it fails, plain local words stand in, and nothing is resent. */
  async #idea(requestId: string, signal: AbortSignal): Promise<string> {
    const job = this.#job(requestId);
    let idea: string;
    if (job.variationOf !== null) {
      idea = variationIdea(this.#store.jobOfArtwork(job.variationOf)?.idea ?? job.context.imagination, job.text);
    } else {
      idea = boundIdea(localIdea(job.text, job.context));
      const provider = this.#providers.anthropic;
      if (provider?.text !== undefined && provider.capabilities.text) {
        const text = provider.text.bind(provider), key: PriceKey = {provider: 'anthropic', model: IDEA_MODEL, maxTokens: IDEA_MAX_TOKENS};
        const answer = await this.#paid(job, 'idea', key, call => text({model: IDEA_MODEL, system: ideaSystem(), prompt: ideaPrompt(job.text, job.context), maxTokens: IDEA_MAX_TOKENS}, call), signal);
        if (answer.status === 'answered' && answer.value.text !== null) idea = boundIdea(answer.value.text);
      }
    }
    await this.#outbox.transaction(() => {const live = this.#job(requestId); live.idea = idea; this.#store.saveJob(live);});
    return idea;
  }
  /** One image call for one target. Each target succeeds or fails alone. */
  async #drawTarget(requestId: string, target: ArtTarget, idea: string, signal: AbortSignal): Promise<void> {
    const job = this.#job(requestId), animated = job.animated && isDisplay(target);
    if (job.cancelRequested) return this.#settleTarget(requestId, target, {outcome: 'cancelled', code: 'cancelled', reason: 'cancelled'});
    const provider = this.#providers.openai;
    if (provider === undefined) return this.#settleTarget(requestId, target, {outcome: Outcome.rejected, code: 'unavailable', reason: 'no-key'});
    if (provider.image === undefined || !provider.capabilities.image) return this.#settleTarget(requestId, target, {outcome: Outcome.rejected, code: 'unsupported-capability', reason: 'unsupported'});
    const spec = animated ? SHEET : isDisplay(target) ? DISPLAY[target] : BROWSER, draw = provider.image.bind(provider);
    const key: PriceKey = {provider: 'openai', model: IMAGE_MODEL, quality: spec.quality, size: spec.size};
    const prompt = imagePrompt(idea, target, job.context, animated);
    const answer = await this.#paid(job, target, key, call => draw({model: IMAGE_MODEL, quality: spec.quality, size: spec.size, prompt}, call), signal);
    if (answer.status === 'refused') return this.#settleTarget(requestId, target, {outcome: Outcome.rejected, code: answer.reason === 'unknown-price' ? 'unsupported-capability' : 'capacity', reason: answer.reason});
    if (answer.status === 'cancelled') return this.#settleTarget(requestId, target, {outcome: 'cancelled', code: 'cancelled', reason: 'cancelled'});
    if (answer.status === 'fault') {
      const {fault} = answer;
      return this.#settleTarget(requestId, target, {outcome: fault.uncertain ? Outcome.uncertain : Outcome.failed, code: fault.code, reason: fault.reason});
    }
    try {
      const [width, height] = spec.size.split('x').map(Number);
      await validateImage(answer.value.bytes, width ?? 0, height ?? 0);
    } catch (error) {
      return this.#settleTarget(requestId, target, {outcome: Outcome.failed, code: error instanceof MediaFault && error.reason === 'too-large' ? 'too-large' : 'invalid-message', reason: 'invalid-output'});
    }
    await this.#composeTarget(requestId, target, answer.value.bytes, sha256(Buffer.from(prompt)), 'openai');
  }
  async #settleTarget(requestId: string, target: ArtTarget, settled: Settled, change?: (job: Job) => void): Promise<void> {
    await this.#outbox.transaction(add => {
      const job = this.#job(requestId), entry = job.targets.find(item => item.target === target);
      if (entry !== undefined) Object.assign(entry, settled);
      change?.(job);
      this.#store.saveJob(job); this.#publish(add, job);
    });
  }
  /** Local work, which costs nothing, then one transaction for the bytes, the rows and the state. */
  async #composeTarget(requestId: string, target: ArtTarget, source: Uint8Array, promptHash: string | null, generatedBy: 'openai' | 'local'): Promise<void> {
    let composed: Composed;
    try {
      composed = await this.#compose(requestId, target, source);
    } catch {
      return this.#settleTarget(requestId, target, {outcome: Outcome.failed, code: 'invalid-message', reason: 'invalid-output'});
    }
    const {composition, blobs, palette} = composed, display = composition.renditions[0];
    if (isDisplay(target) && display !== undefined && display.bytes > MAX_DISPLAY_BYTES) return this.#settleTarget(requestId, target, {outcome: Outcome.failed, code: 'too-large', reason: 'invalid-output'});
    const stored: StoredComposition = {...composition, promptHash};
    let artworkId = '', ambient = false, parent: TraceContext | undefined;
    await this.#settleTarget(requestId, target, {outcome: Outcome.succeeded, code: null, reason: null}, job => {
      artworkId = job.artworkId; ambient = job.purpose === 'ambient' && target === 'tidbyt'; parent = {traceparent: job.traceparent};
      for (const blob of blobs) this.#store.saveBlob(blob.id, blob.type, blob.bytes);
      this.#store.saveComposition(job.artworkId, stored);
      const artwork = this.#store.artwork(job.artworkId) ?? {artworkId: job.artworkId, requestId, createdAtMs: this.#context.clock.now(), favorite: false, feedback: null, variationOf: job.variationOf, palette: [], generatedBy, deletedAtMs: null};
      this.#store.saveArtwork(target === 'ui' || artwork.palette.length === 0 ? {...artwork, palette} : artwork);
      if (composition.sheet !== null) this.#store.countSheet(composition.sheet === 'accepted');
      const entry = job.targets.find(item => item.target === target);
      if (entry !== undefined) entry.compositionId = composition.compositionId;
    });
    if (isDisplay(target) && parent !== undefined) await this.#stage(artworkId, stored, parent, ambient);
  }
  async #compose(requestId: string, target: ArtTarget, source: Uint8Array): Promise<Composed> {
    const job = this.#job(requestId), originalType = 'image/png', compositionIdOf = sha256(source), palette = await paletteOf(source);
    const original = {id: compositionIdOf, type: originalType, bytes: source};
    if (target === 'ui') {
      const wide = await browserRendition(source, BROWSER.width, BROWSER.height), card = await browserRendition(source, BROWSER.card.width, BROWSER.card.height);
      const renditions = [rendition(wide, BROWSER.width, BROWSER.height, 'webp'), rendition(card, BROWSER.card.width, BROWSER.card.height, 'webp')];
      return {palette, blobs: [original, {id: sha256(wide), type: 'image/webp', bytes: wide}, {id: sha256(card), type: 'image/webp', bytes: card}],
        composition: {target, compositionId: compositionIdOf, outcome: Outcome.succeeded, motion: 'still', renditions, promptHash: null, originalId: original.id, sheet: null}};
    }
    const {width, height} = DISPLAY[target];
    if (!job.animated) {
      const bytes = await reduceStill(source, width, height);
      return {palette, blobs: [original, {id: sha256(bytes), type: 'image/png', bytes}],
        composition: {target, compositionId: compositionIdOf, outcome: Outcome.succeeded, motion: 'still', renditions: [rendition(bytes, width, height, 'png')], promptHash: null, originalId: original.id, sheet: null}};
    }
    const gifComposition = (bytes: Buffer, compositionId: string, motion: 'sheet' | 'local', sheet: StoredComposition['sheet']): Composed => ({palette, blobs: [original, {id: sha256(bytes), type: 'image/gif', bytes}],
      composition: {target, compositionId, outcome: Outcome.succeeded, motion, renditions: [rendition(bytes, width, height, 'gif', FRAMES)], promptHash: null, originalId: original.id, sheet}});
    if (job.source === 'procedural') {
      const bytes = await localMotion(source, width, height);
      return gifComposition(bytes, sha256(bytes), 'local', null);
    }
    const verdict = await validateSheet(source);
    if (verdict.ok) {
      const frames = await Promise.all((await sliceSheet(source)).map(frame => reduceFrame(frame, width, height)));
      return gifComposition(assembleGif(frames, width, height), compositionIdOf, 'sheet', 'accepted');
    }
    // A rejected sheet still cost its call. The art falls back to local motion, which costs nothing, and nothing is resent.
    const reason: SheetReason = verdict.reason, bytes = await localMotion(await stillFromSheet(source, reason), width, height);
    return gifComposition(bytes, sha256(bytes), 'local', reason);
  }

  // One paid call: reserve, mark dispatched, send, settle. Nothing retries.
  async #paid<T extends {readonly usage: Usage | null}>(job: Job, target: ArtTarget | 'idea', key: PriceKey, send: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<Paid<T>> {
    const {requestId} = job, callId = randomUUID(), parent = {traceparent: job.traceparent};
    const reserved = await this.#outbox.transaction(add => {
      if (this.#job(requestId).cancelRequested) return {ok: false as const, reason: 'cancelled' as const};
      const answer = this.#ledger.reserve({callId, requestId, target, key, admittedBy: job.admittedBy, atMs: this.#context.clock.now()});
      if (answer.ok) this.#publish(add, parent);
      return answer;
    });
    if (!reserved.ok) return reserved.reason === 'cancelled' ? {status: 'cancelled'} : {status: 'refused', reason: reserved.reason};
    const go = await this.#outbox.transaction(add => {
      if (this.#job(requestId).cancelRequested || signal.aborted) {this.#ledger.release(callId); this.#publish(add, parent); return false;}
      this.#ledger.dispatched(callId, this.#context.clock.now());
      return true;
    });
    if (!go) return {status: 'cancelled'};
    const span = this.#context.trace.start('bunny.art.call', {parent, kind: 'client', attributes: {'bunny.operation': 'media', 'bunny.request.id': requestId}});
    let answer: Paid<T>;
    try {
      answer = {status: 'answered', value: await this.#bounded(send, signal)};
    } catch (error) {
      answer = {status: 'fault', fault: error instanceof ProviderFault ? error : new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true})};
    }
    span.end(answer.status === 'answered' ? 'unset' : 'error');
    const excess = await this.#outbox.transaction(add => {
      const usage = answer.status === 'answered' ? answer.value.usage : answer.status === 'fault' ? answer.fault.usage : null;
      const keep = answer.status === 'answered' ? usage === null : answer.status === 'fault' && answer.fault.usage === null && answer.fault.keep;
      let over = 0;
      if (keep) this.#ledger.keep(callId); else over = this.#ledger.settle(callId, usage, reserved.reservedMicros);
      this.#publish(add, parent);
      return over;
    });
    if (excess > 0) recordLog(this.#context.log, 'operation.failed', {'bunny.operation': 'media', 'bunny.outcome': Outcome.failed, 'bunny.code': 'internal', 'bunny.request.id': requestId}, parent);
    const fault = answer.status === 'fault' ? answer.fault : undefined;
    recordLog(this.#context.log, fault === undefined ? 'operation.completed' : 'operation.failed', {'bunny.operation': 'media', 'bunny.outcome': fault === undefined ? Outcome.succeeded : fault.uncertain ? Outcome.uncertain : Outcome.failed,
      ...(fault === undefined ? {} : {'bunny.code': fault.code}), 'bunny.request.id': requestId}, parent);
    return answer;
  }
  /** A late answer is discarded: past its deadline or a cancel, the call has already become uncertain. */
  async #bounded<T>(send: (signal: AbortSignal) => Promise<T>, outer: AbortSignal): Promise<T> {
    const deadline = new AbortController(), cancel = this.#context.scheduler.after(CALL_DEADLINE_MS, () => {deadline.abort();});
    const signal = AbortSignal.any([deadline.signal, outer, this.#context.signal]);
    let abort = (): void => {};
    try {
      signal.throwIfAborted();
      const work = send(signal);
      work.catch(() => {});
      return await Promise.race([work, new Promise<never>((_, reject) => {
        abort = () => {reject(new ProviderFault(outer.aborted ? 'cancelled' : 'uncertain-result', outer.aborted ? 'cancelled' : 'lost-response', {uncertain: true, keep: true}));};
        signal.addEventListener('abort', abort, {once: true});
      })]);
    } finally {
      signal.removeEventListener('abort', abort);
      cancel();
    }
  }

  // The handoff, through #679's seam.
  async #stage(artworkId: string, composition: StoredComposition, parent: TraceContext, ambient: boolean): Promise<void> {
    const target = composition.target, rendered = composition.renditions[0], blob = rendered === undefined ? undefined : this.#store.blob(rendered.renditionId);
    if (!isDisplay(target) || rendered === undefined || blob === undefined || rendered.format === 'webp') return;
    const requestId = `stage-${randomUUID()}`, row: StageRow = {requestId, artworkId, compositionId: composition.compositionId, target, status: 'pending', expiresAtMs: this.#context.clock.now() + STAGE_LIFETIME_MS, ambient};
    let reply: Reply;
    try {
      await this.#outbox.transaction(add => {this.#store.saveStage(row); this.#publish(add, parent);});
      reply = await this.#dispatch.stage({requestId, compositionId: composition.compositionId, target, format: rendered.format, width: rendered.width, height: rendered.height, frames: rendered.frames,
        sha256: rendered.renditionId, bytes: blob.bytes, lifetimeMs: STAGE_LIFETIME_MS}, parent);
    } catch {
      reply = errorBody('uncertain-result');
    }
    if ('error' in reply) await this.#stageResult(requestId, reply.error.code === 'uncertain-result' ? 'uncertain' : 'failed');
  }
  async #stageResult(requestId: string, result: StageResult): Promise<void> {
    let row: StageRow | undefined;
    try {
      await this.#outbox.transaction(add => {
        row = this.#store.stage(requestId);
        if (row === undefined || row.status !== 'pending') {row = undefined; return;}
        this.#store.saveStage({...row, status: result, expiresAtMs: result === Outcome.failed ? this.#context.clock.now() : this.#context.clock.now() + STAGE_LIFETIME_MS});
        this.#publish(add);
      });
    } catch {return;}
    if (row?.ambient === true && result === Outcome.succeeded) {await this.#sendAmbient(row.compositionId, childOf(undefined)); this.#renewAmbient();}
  }
  async #sendAmbient(compositionId: string | null, parent: TraceContext): Promise<void> {
    try {await this.#dispatch.ambient({requestId: `ambient-${randomUUID()}`, target: 'tidbyt', compositionId}, parent);} catch {/* The tile keeps what it holds. Nothing resends. */}
  }
  /** Keeps the ambient tile's copy alive while generation is paused. Staging is local and free. */
  #renewAmbient(): void {
    if (this.#closed) return;
    const row = this.#store.ambient(this.#context.clock.now());
    if (row === undefined || row.expiresAtMs === null) return;
    this.#timers.push(this.#context.scheduler.after(Math.max(0, (row.expiresAtMs - this.#context.clock.now()) / 2), () => {
      if (this.#closed) return;
      const found = this.#store.compositions(row.artworkId).find(entry => entry.compositionId === row.compositionId);
      if (found !== undefined) void this.#stage(row.artworkId, found, childOf(undefined), true).catch(() => {});
    }));
  }
  /** Nothing else publishes at the turn of a day, and the dashboard's day and month must follow it. */
  #scheduleMidnight(): void {
    const now = new Date(this.#context.clock.now()), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1).getTime();
    this.#timers.push(this.#context.scheduler.after(Math.max(1000, next - now.getTime()), () => {
      if (this.#closed) return;
      void this.#outbox.transaction(add => {this.#publish(add);}).catch(() => {});
      this.#scheduleMidnight();
    }));
  }

  // Retention. Only unsaved, unreferenced art past the limit goes, and a deleted row goes once nothing refers to it.
  #prune(): void {
    const now = this.#context.clock.now(), unfinished = new Set(this.#store.unfinished().map(job => job.artworkId));
    const free = (artwork: Artwork): boolean => !unfinished.has(artwork.artworkId) && !this.#store.referenced(artwork.artworkId, now);
    for (const artwork of [...this.#store.pruneCandidates(this.#config.recentLimit), ...this.#store.deletedArtworks()]) if (free(artwork)) this.#store.purge(artwork.artworkId);
    this.#store.trim(KEEP_FINISHED_JOBS, now - KEEP_RECEIPTS_MS);
  }

  // Reads.
  #publish(add: AddMessage, parent?: TraceContext): void {
    this.#store.bump();
    add(ART_STATE_KEY, {kind: 'state', type: ART_STATE_TYPE, subject: ART_ID, dataschema: ART_STATE_SCHEMA, data: this.state()}, parent === undefined ? {} : {parent});
  }
  #spend(provider: ArtProviderName, now: number): ArtProviderSpend {
    const limits = this.#config.limits[provider], totals = this.#ledger.totals(provider, now);
    return {provider, available: this.#providers[provider] !== undefined, ceilingMicros: limits.ceilingMicros, paceMicros: limits.paceMicros, ...totals};
  }
  #summary(artwork: Artwork): ArtworkSummary {
    return {artworkId: artwork.artworkId, createdAtMs: artwork.createdAtMs, favorite: artwork.favorite, feedback: artwork.feedback, variationOf: artwork.variationOf, palette: artwork.palette,
      provenance: {generatedBy: artwork.generatedBy, factual: false},
      compositions: this.#store.compositions(artwork.artworkId).map(entry => ({target: entry.target, compositionId: entry.compositionId, outcome: entry.outcome, motion: entry.motion, renditions: entry.renditions}))};
  }
  /** Saved art a device holds. Explicit feedback shapes the order, deletion and dislike remove it, and silence changes nothing. */
  #candidates(now: number): ArtCandidate[] {
    const seen = new Set<string>(), rows: (ArtCandidate & {more: boolean})[] = [];
    for (const stage of this.#store.liveStages(now)) {
      const key = `${stage.compositionId}/${stage.target}`, artwork = this.#store.artwork(stage.artworkId);
      if (seen.has(key) || artwork === undefined || artwork.deletedAtMs !== null || artwork.feedback === 'less' || artwork.feedback === 'dismiss') continue;
      seen.add(key);
      rows.push({artworkId: stage.artworkId, target: stage.target, compositionId: stage.compositionId, favorite: artwork.favorite, stagedUntilMs: stage.expiresAtMs ?? now, more: artwork.feedback === 'more'});
    }
    return rows.sort((a, b) => (Number(b.favorite) * 2 + Number(b.more)) - (Number(a.favorite) * 2 + Number(a.more))).slice(0, STATE_CANDIDATES).map(({more, ...candidate}) => {void more; return candidate;});
  }
  state(): ArtState {
    const now = this.#context.clock.now(), counts = this.#store.counts();
    const retained = this.#store.deletedArtworks().flatMap(artwork => this.#store.liveStages(now).filter(stage => stage.artworkId === artwork.artworkId).map(stage => ({artworkId: artwork.artworkId, target: stage.target, untilMs: stage.expiresAtMs ?? now}))).slice(0, STATE_RETAINED);
    return {id: ART_ID, revision: this.#store.revision(), month: monthKey(now), day: dayKey(now), providers: [this.#spend('openai', now), this.#spend('anthropic', now)],
      guard: {calls: this.#ledger.guardCalls(now), limit: GUARD_LIMIT, windowMs: GUARD_WINDOW_MS}, sheets: this.#store.sheets(),
      jobs: this.#store.recentJobs(STATE_JOBS).map(job => ({requestId: job.requestId, purpose: job.purpose, admittedBy: job.admittedBy, status: job.status, outcome: job.outcome, artworkId: job.artworkId,
        createdAtMs: job.createdAtMs, finishedAtMs: job.finishedAtMs, targets: job.targets.map(({target, outcome, code, reason}) => ({target, outcome, code, reason}))})),
      artworks: this.#store.artworks(0, STATE_ARTWORKS).artworks.map(artwork => this.#summary(artwork)), candidates: this.#candidates(now),
      retention: {recentLimit: this.#config.recentLimit, recent: counts.recent, favorites: counts.favorites, retained}};
  }
  #result(artworkId: string): object | undefined {
    const job = this.#store.jobOfArtwork(artworkId), artwork = this.#store.artwork(artworkId);
    if (job === undefined || artwork?.deletedAtMs !== undefined && artwork.deletedAtMs !== null) return undefined;
    const compositions = this.#store.compositions(artworkId);
    return {artworkId, requestId: job.requestId, purpose: job.purpose, admittedBy: job.admittedBy, outcome: job.outcome, palette: artwork?.palette ?? [], favorite: artwork?.favorite ?? false, feedback: artwork?.feedback ?? null, variationOf: job.variationOf,
      calls: this.#ledger.calls(job.requestId).map(call => ({callId: call.callId, target: call.target, provider: call.provider, model: call.model, status: call.status, reservedMicros: call.reservedMicros, costMicros: call.costMicros})),
      compositions: job.targets.map(target => {
        const found = compositions.find(entry => entry.target === target.target);
        return {target: target.target, compositionId: found?.compositionId ?? null, outcome: target.outcome, code: target.code, reason: target.reason, promptHash: found?.promptHash ?? null, motion: found?.motion ?? 'still', renditions: found?.renditions ?? []};
      }),
      provenance: {generatedBy: artwork?.generatedBy ?? (job.source === 'procedural' ? 'local' : 'openai'), factual: false}};
  }
  content(ref: string, request?: ModuleContentRequest): ModuleContent | ErrorBody | undefined {
    const query = request?.query ?? {}, jsonBody = (value: unknown): ModuleContent => ({type: 'application/json', bytes: Buffer.from(JSON.stringify(value))});
    try {
      if (ref === artContentRef.catalog || ref === artContentRef.ledger) {
        const after = Number(query.after ?? 0), limit = Number(query.limit ?? MAX_PAGE);
        if (Object.keys(query).some(key => key !== 'after' && key !== 'limit') || !Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) return errorBody('invalid-request');
        if (ref === artContentRef.ledger) return jsonBody(this.#ledger.page(after, limit));
        const page = this.#store.artworks(after, limit);
        return jsonBody({artworks: page.artworks.map(artwork => this.#summary(artwork)), nextAfter: page.nextAfter});
      }
      if (ref.startsWith('artwork.')) {
        const result = this.#result(ref.slice('artwork.'.length));
        return result === undefined ? undefined : jsonBody(result);
      }
      if (ref.startsWith('rendition.')) {
        const blob = this.#store.blob(ref.slice('rendition.'.length));
        return blob === undefined ? undefined : {type: blob.type, bytes: blob.bytes};
      }
      return undefined;
    } catch {
      return errorBody('unavailable');
    }
  }
}
type Composed = {composition: Omit<StoredComposition, 'promptHash'> & {promptHash: null}; blobs: {id: string; type: string; bytes: Uint8Array}[]; palette: string[]};
const FRAMES = SHEET_COLUMNS * SHEET_ROWS;
function rendition(bytes: Uint8Array, width: number, height: number, format: 'png' | 'gif' | 'webp', frames = 1) {
  const renditionId = sha256(bytes);
  return {renditionId, width, height, frames, durationMs: frames > 1 ? frames * FRAME_DELAY_MS : 0, format, bytes: bytes.length, ref: artContentRef.rendition(renditionId)};
}
