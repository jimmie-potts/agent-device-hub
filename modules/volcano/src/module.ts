// The Volcano module (Hub #615): the one owner of a VOLCANO HYBRID's private history. It reaches no device: a source-bound
// host-local collector publishes bounded snapshots, and the module takes those of its one feed, stores the facts they add
// and publishes the device's observed state. Facts, continuity and the state messages commit in one transaction through
// the outbox, so a restart between a commit and its publication sends the messages once more and repeats no fact. The gap
// threshold is its only command, and it changes how sessions are grouped when they are read, nothing else.
import {createHash, randomUUID} from 'node:crypto';
import {errorBody, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {CompletedOutcome} from '@jimmie-potts/event-contracts/v2/devices';
import {VOLCANO_OBSERVATION_SCHEMA, VOLCANO_OBSERVATION_TYPE, volcanoFeedId, volcanoObservationKey, type VolcanoFeed, type VolcanoObservation} from '@jimmie-potts/event-contracts/v2/families';
import {DeviceAvailability, Outbox, Outcome, SdkError, fullDisk, recordLog, type AddMessage, type BunnyModule, type Cancel, type Command, type ModuleContentRequest, type ModuleContext, type Reply, type TraceContext} from '@jimmie-potts/sdk';
import {configureVolcano, type VolcanoConfig} from './configuration.js';
import {readContent} from './content.js';
import {MAX_GAP_MINUTES, MIN_GAP_MINUTES, STALE_MS, admit, reduce, stale, type Continuity, type Fact} from './facts.js';
import {GAP_COMPLETED_TYPE, GAP_FAMILY, GAP_SCHEMA, GAP_TYPE, STATUS_FAMILY, statusSchema, volcanoValidator} from './families.js';
import {stateDrafts, statusOf, type VolcanoStatus} from './status.js';
import {VolcanoStore, type Meta} from './store.js';

/** How often a synthetic feed reports when nothing changed, as a collector does. */
export const FEED_HEARTBEAT_MS = 5000;
const PART_SOURCE = /^bunny\/parts\/[a-z0-9][a-z0-9-]*$/;

/** A synthetic device for harnesses, in place of a collector: never part of a real build's manifest, gateway or configuration. */
export type SyntheticFeed = {
  /** The device's snapshot now, or undefined when the harness cannot reach it. */
  observe(feed: VolcanoFeed, nowMs: number): Promise<VolcanoObservation | undefined>;
  /** Hears each change to the device; returns how to stop. */
  onChange(changed: () => void): () => void;
};
export type GapRequest = {requestId: string; gapMinutes: number; expectedConfigurationRevision?: number};

const canonical = (value: unknown): string => (Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : typeof value === 'object' && value !== null ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value));

/** What a published state compares by, so a repeated snapshot publishes nothing: every field but the observation times. */
const shown = ({revision: _revision, observedAtMs: _observedAtMs, receivedAtMs: _receivedAtMs, ...rest}: VolcanoStatus): string => canonical(rest);

export function createVolcanoModule(options: {feed?: SyntheticFeed} = {}): BunnyModule<VolcanoConfig> {
  let owner: Owner | undefined;
  let closing = false;
  const refusing = (): ErrorBody => errorBody('unavailable');
  return {
    manifest: {
      name: 'volcano', apiVersion: '1.3', configure: configureVolcano,
      content: (ref, request) => (closing || owner === undefined ? refusing() : owner.read(ref, request)),
      tools: [{
        name: 'status', description: 'Read the VOLCANO HYBRID\'s observed heater, pump and temperature with their observation time. Unavailable is unknown, never off.',
        input: {type: 'object', additionalProperties: false, properties: {}}, output: statusSchema,
        read: () => (closing || owner === undefined ? refusing() : owner.status()),
      }],
    },
    async start(context) {
      if (context.config === undefined) throw new SdkError(errorBody('invalid-request'));
      context.signal.addEventListener('abort', () => { closing = true; }, {once: true});
      owner = new Owner(context, options.feed);
      await owner.start();
    },
    async stop() {
      closing = true;
      await owner?.stop();
    },
  };
}

class Owner {
  readonly #context: ModuleContext<VolcanoConfig>;
  readonly #config: VolcanoConfig;
  readonly #store: VolcanoStore;
  readonly #outbox: Outbox;
  readonly #availability: DeviceAvailability;
  readonly #synthetic: SyntheticFeed | undefined;
  readonly #feedId: string;
  readonly #run = randomUUID();
  #meta: Meta;
  #generation = 0;
  /** When this process last took a snapshot. A store's last snapshot from an earlier run proves nothing. */
  #freshSinceMs: number | undefined;
  #lastShown: string | undefined;
  #lastAvailability: VolcanoStatus['availability'] | undefined;
  #committing: Promise<void> = Promise.resolve();
  #staleTimer: Cancel | undefined;
  #heartbeat: Cancel | undefined;
  #stopSynthetic: (() => void) | undefined;
  #recording: VolcanoStatus['recording'] = 'ok';
  #stopped = false;
  #refusalLogged = false;

  constructor(context: ModuleContext<VolcanoConfig>, synthetic: SyntheticFeed | undefined) {
    if (context.config === undefined) throw new SdkError(errorBody('invalid-request'));
    this.#context = context;
    this.#config = context.config;
    this.#synthetic = synthetic;
    const database = context.database();
    this.#store = new VolcanoStore(database);
    this.#outbox = new Outbox({sdk: context.sdk, database, clock: context.clock, validator: volcanoValidator(), log: context.log, trace: context.trace});
    this.#availability = new DeviceAvailability(context);
    this.#meta = this.#store.meta();
    this.#feedId = volcanoFeedId(this.#feed);
  }

  get #feed(): VolcanoFeed {
    return {provider: 'storz-bickel', client: 'volcano', hostId: this.#config.hostId, sourceId: this.#config.sourceId};
  }

  async start(): Promise<void> {
    const {sdk} = this.#context;
    await sdk.respond<GapRequest>(`bunny.cmd.${GAP_FAMILY}.${this.#config.id}`, command => {
      const work = this.#committing.then(() => this.#gapRequested(command));
      this.#committing = work.then(() => {}, () => {});
      return work;
    });
    await sdk.serveSync(['device', STATUS_FAMILY], request => {
      return {revision: this.#meta.revision, states: this.#drafts().filter(draft => request.data.families.includes(draft.dataschema.includes('/device/') ? 'device' : STATUS_FAMILY))};
    });
    await this.#outbox.republish();
    // A full disk at a start is the store's to report: the module still serves its reads and tries again with each snapshot.
    await this.#transaction(add => { this.#publish(add); }).catch(() => {});
    await sdk.subscribe<VolcanoObservation>(volcanoObservationKey(this.#feed), message => { this.#delivered(message); });
    this.#armStale();
    if (this.#synthetic !== undefined) {
      this.#stopSynthetic = this.#synthetic.onChange(() => { this.#observeSynthetic(); });
      this.#beatSynthetic();
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#staleTimer?.();
    this.#heartbeat?.();
    this.#stopSynthetic?.();
    await this.#committing;
  }

  /** The status now, with its freshness read at this moment. */
  status(): VolcanoStatus {
    return statusOf(this.#config, this.#meta, this.#freshSinceMs, this.#context.clock.now(), this.#recording);
  }

  read(ref: string, request: ModuleContentRequest | undefined): ReturnType<typeof readContent> {
    return readContent(ref, request, this.status(), this.#store, this.#meta.continuity.lastReadingAtMs);
  }

  /** A message on the feed's key: a remote part's well-formed snapshot of this feed, or a refusal logged once. */
  #delivered(message: Message<VolcanoObservation>): void {
    const fields = {'bunny.operation': 'feed', 'bunny.message.id': message.id, 'bunny.message.kind': message.kind} as const;
    const valid = message.dataschema === VOLCANO_OBSERVATION_SCHEMA && message.type === VOLCANO_OBSERVATION_TYPE && message.kind === 'occurrence'
      && PART_SOURCE.test(message.source) && message.subject === this.#feedId && volcanoValidator().validate(message).ok;
    if (!valid) {
      if (!this.#refusalLogged) {
        this.#refusalLogged = true;
        recordLog(this.#context.log, 'message.received', {'bunny.operation': 'feed', 'bunny.outcome': Outcome.rejected, 'bunny.code': 'forbidden'}, message);
      }
      return;
    }
    this.#context.log.debug('message.received', {...fields, 'bunny.outcome': 'accepted'}, message);
    this.#enqueue(message.data, message);
  }

  #enqueue(snapshot: VolcanoObservation, parent?: TraceContext): void {
    this.#committing = this.#committing.then(() => this.#take(snapshot, parent)).catch(() => { /* #commit recorded the refusal. */ });
  }

  async #take(snapshot: VolcanoObservation, parent?: TraceContext): Promise<void> {
    if (this.#stopped) return;
    const now = this.#context.clock.now();
    const admission = admit(this.#meta.continuity, snapshot, now);
    if (!admission.take) {
      // Only the ordering baseline moves, in memory: an old snapshot is never evidence, and a restart recomputes this.
      this.#meta = {...this.#meta, continuity: {...this.#meta.continuity, baselineMs: admission.baselineMs}};
      return;
    }
    const {state, facts} = reduce(this.#meta.continuity, snapshot, now);
    const before = this.#freshSinceMs;
    this.#freshSinceMs = now;
    try {
      await this.#commit(state, facts, parent);
    } catch (error) {
      this.#freshSinceMs = before;
      throw error;
    }
    this.#report(snapshot, facts);
    this.#armStale();
  }

  /** Connection and continuity changes as private diagnostics: registry codes and the device's routing ID, never a value. */
  #report(snapshot: VolcanoObservation, facts: readonly Fact[]): void {
    if (snapshot.link === 'connected' && snapshot.reading !== null) this.#availability.reached(this.#config.id);
    else this.#availability.unreachable(this.#config.id, snapshot.link === 'identity-mismatch' ? 'forbidden' : 'unavailable');
    if (facts.some(fact => fact.kind === 'discontinuity')) {
      recordLog(this.#context.log, 'operation.failed', {'bunny.operation': 'feed', 'bunny.outcome': Outcome.failed, 'bunny.code': 'revision-conflict', 'bunny.device.id': this.#config.id});
    }
  }

  #armStale(): void {
    this.#staleTimer?.();
    if (this.#stopped) return;
    this.#staleTimer = this.#context.scheduler.after(STALE_MS, () => {
      const work = this.#committing.then(async () => {
        if (this.#stopped) return;
        this.#availability.unreachable(this.#config.id, 'unavailable');
        const {state, facts} = stale(this.#meta.continuity, this.#context.clock.now());
        try {
          await this.#commit(state, facts);
        } catch {
          // A full disk cannot keep a stale feed reading as available: say so unstored, and try to store it again later.
          this.#announceUnstored();
          this.#armStale();
        }
      }).catch(() => { /* A stopping participant refuses the announcement. */ });
      this.#committing = work;
    });
  }

  /** Commits what a snapshot or a stale feed adds, and publishes the state when what it shows changed. */
  async #commit(continuity: Continuity, facts: readonly Fact[], parent?: TraceContext): Promise<void> {
    await this.#transaction(add => {
      const meta = {...this.#meta, continuity};
      this.#store.append(facts);
      this.#store.saveMeta(meta);
      this.#meta = meta;
      this.#publish(add, parent);
    });
  }

  /** Publishes the current state if it shows anything new, with the next revision, in the current transaction. */
  #publish(add: AddMessage, parent?: TraceContext): void {
    if (!this.#advance()) return;
    this.#store.saveMeta(this.#meta);
    const [status, device] = this.#drafts();
    add(this.#keyOf(status), status, parent === undefined ? {} : {parent});
    add(this.#keyOf(device), device, parent === undefined ? {} : {parent});
  }

  /** Moves the revision on, and the generation with an availability change, when what the state shows changed. */
  #advance(): boolean {
    const status = this.status();
    const now = shown(status);
    if (now === this.#lastShown) return false;
    if (status.availability !== this.#lastAvailability) this.#generation += 1;
    this.#lastAvailability = status.availability;
    this.#lastShown = now;
    this.#meta = {...this.#meta, revision: this.#meta.revision + 1};
    return true;
  }

  #drafts(): ReturnType<typeof stateDrafts> {
    return stateDrafts(this.#config, this.status(), {epoch: this.#run, sequence: this.#generation});
  }

  #keyOf(draft: {dataschema: string}): string {
    return `bunny.state.${draft.dataschema.includes('/device/') ? 'device' : STATUS_FAMILY}.${this.#config.id}`;
  }

  /** The one state published outside the outbox: unavailability while the store refuses every commit. The next commit stores its revision. */
  #announceUnstored(): void {
    if (this.#stopped || !this.#advance()) return;
    const [status, device] = this.#drafts();
    void this.#context.sdk.publish(this.#keyOf(status), status).catch(() => {});
    void this.#context.sdk.publish(this.#keyOf(device), device).catch(() => {});
  }

  /** One commit, with every in-memory change undone if it is refused. A refused commit never fences the module: the next one tries again. */
  async #transaction(work: (add: AddMessage) => void, parent?: TraceContext): Promise<void> {
    const before = {meta: this.#meta, shown: this.#lastShown, availability: this.#lastAvailability, generation: this.#generation, recording: this.#recording};
    this.#recording = 'ok';
    try {
      await this.#outbox.transaction(work);
    } catch (error) {
      this.#meta = before.meta;
      this.#lastShown = before.shown;
      this.#lastAvailability = before.availability;
      this.#generation = before.generation;
      this.#recording = 'refused';
      if (before.recording === 'ok') {
        recordLog(this.#context.log, 'operation.failed', {'bunny.operation': 'storage', 'bunny.outcome': Outcome.failed, 'bunny.code': fullDisk(error) ? 'capacity' : 'internal', 'bunny.device.id': this.#config.id}, parent);
      }
      throw error;
    }
  }

  /** The threshold command: stored and answered in one transaction, or refused before anything is accepted. */
  async #gapRequested(command: Command<GapRequest>): Promise<Reply> {
    const checked = volcanoValidator().validate(command);
    if (!checked.ok || command.type !== GAP_TYPE || command.dataschema !== GAP_SCHEMA) return errorBody('invalid-message');
    if (command.subject !== this.#config.id) return errorBody('not-found');
    const {requestId, gapMinutes, expectedConfigurationRevision} = command.data;
    const digest = createHash('sha256').update(canonical({source: command.source, target: command.subject, family: GAP_FAMILY, data: command.data})).digest('hex');
    let answer: Reply = errorBody('internal');
    try {
      await this.#transaction(add => {
        const previous = this.#store.request(requestId);
        if (previous !== undefined) {
          answer = previous.digest === digest ? {status: 'accepted'} : errorBody('duplicate-conflict');
          return;
        }
        if (this.#stopped) { answer = errorBody('unavailable'); return; }
        const expiresAtMs = command.expiresat === undefined ? Number.NaN : Date.parse(command.expiresat);
        if (!Number.isFinite(expiresAtMs)) { answer = errorBody('invalid-message'); return; }
        if (expiresAtMs <= this.#context.clock.now()) { answer = errorBody('expired'); return; }
        if (expectedConfigurationRevision !== undefined && expectedConfigurationRevision !== this.#meta.settings.configurationRevision) { answer = errorBody('revision-conflict'); return; }
        const inRange = Number.isSafeInteger(gapMinutes) && gapMinutes >= MIN_GAP_MINUTES && gapMinutes <= MAX_GAP_MINUTES;
        const outcome: CompletedOutcome = inRange
          ? {requestId, result: Outcome.succeeded, evidence: Outcome.observed}
          : {requestId, result: Outcome.failed, evidence: Outcome.none, error: errorBody('invalid-request', {detail: `the gap threshold is ${String(MIN_GAP_MINUTES)} to ${String(MAX_GAP_MINUTES)} minutes`}).error};
        this.#store.saveRequest({requestId, digest, outcome});
        if (inRange) {
          this.#meta = {...this.#meta, settings: {gapMinutes, configurationRevision: this.#meta.settings.configurationRevision + 1}};
          this.#store.saveMeta(this.#meta);
          this.#publish(add, command);
        }
        add(`bunny.event.${GAP_FAMILY}.${this.#config.id}`, {kind: 'outcome', type: GAP_COMPLETED_TYPE, subject: this.#config.id, dataschema: 'https://bunny.invalid/events/outcome/2.0', data: outcome}, {parent: command});
        answer = {status: 'accepted'};
      }, command);
    } catch (error) {
      return errorBody(fullDisk(error) ? 'capacity' : 'internal');
    }
    return answer;
  }

  #observeSynthetic(): void {
    if (this.#stopped || this.#synthetic === undefined) return;
    void this.#synthetic.observe(this.#feed, this.#context.clock.now()).then(snapshot => { if (snapshot !== undefined) this.#enqueue(snapshot); }, () => {});
  }

  #beatSynthetic(): void {
    if (this.#stopped) return;
    this.#observeSynthetic();
    this.#heartbeat = this.#context.scheduler.after(FEED_HEARTBEAT_MS, () => { this.#beatSynthetic(); });
  }
}
