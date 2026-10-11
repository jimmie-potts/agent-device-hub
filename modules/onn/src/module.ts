import {createHash, randomUUID} from 'node:crypto';
import {errorBody, type ErrorBody, type ErrorCode, type MessageValidator} from '@jimmie-potts/event-contracts/v2';
import type {CompletedOutcome, DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {DeviceAvailability, fullDisk, Outbox, SdkError, type AddMessage, type BunnyModule, type Cancel, type Command, type ModuleContext, type Reply, type StateDraft} from '@jimmie-potts/sdk';
import {APPS, KEYS, keyCommand, textCommand} from './actions.js';
import {configureOnn, type OnnConfig} from './configuration.js';
import {FAMILIES, schemaOf, types, type Family, type Input, type OnnState} from './contracts.js';
import {onnStatusSchema, onnValidator} from './families.js';
import {canonical, OnnStore, type RequestRow} from './store.js';
import {AdbTransport, type Attempt, type OnnAction, type OnnTransport} from './transport.js';

export const ACTION_LIMIT_MS = 5000, POLL_MS = 5000, STALE_MS = 15_000, MAX_PENDING = 16;
const unknown = {status: 'unknown'} as const;
const unsupported = {supported: false} as const;
type Pending = {command: Command<Input>; family: Family; action: OnnAction};
type Synchronous<T> = T extends PromiseLike<unknown> ? never : T;
const actionOf = (family: Family, data: Input): OnnAction | undefined => {
  if (family === 'onn-key-press' && 'key' in data && keyCommand(data.key) !== undefined) return {kind: 'key', key: data.key};
  if (family === 'onn-app-open' && 'app' in data && APPS.includes(data.app)) return {kind: 'app', app: data.app};
  if (family === 'onn-text' && 'text' in data && textCommand(data.text) !== undefined) return {kind: 'text', text: data.text};
  return undefined;
};
const failure = (requestId: string, code: ErrorCode, started = false): CompletedOutcome => ({requestId, result: started ? 'uncertain' : 'failed', evidence: 'none', error: errorBody(code, {detail: started ? 'the interrupted action may have reached ONN; it will not be sent again' : 'the action ended before device work'}).error});

export function createOnnModule(options: {transport?: OnnTransport} = {}): BunnyModule<OnnConfig> {
  let owner: OnnOwner | undefined;
  return {manifest: {name: 'onn', apiVersion: '1.3', configure: configureOnn,
    pages: [{id: 'controls', title: 'ONN', presentation: 'react'}],
    tools: [{name: 'status', description: 'Read the configured ONN connection, neutral current app and qualified controls. App observations become stale after 15 seconds. Reading sends no control. Use core_send_command with onn-key-press, onn-app-open or onn-text; seeking requires a focused TV timeline. Results report transmission, not visible playback.',
      input: {type: 'object', additionalProperties: false, properties: {}}, output: onnStatusSchema,
      read: () => owner === undefined ? errorBody('unavailable', {detail: 'ONN has not started'}) : owner.status()}]},
    start: async context => {owner = new OnnOwner(context, options.transport); await owner.start();},
    stop: () => owner?.stop(),
  };
}

class OnnOwner {
  readonly #context: ModuleContext<OnnConfig>;
  readonly #config: OnnConfig;
  readonly #transport: OnnTransport;
  readonly #store: OnnStore;
  readonly #outbox: Outbox;
  readonly #validator: MessageValidator = onnValidator();
  readonly #availability: DeviceAvailability;
  readonly #pending = new Map<string, Pending>();
  readonly #queue: Pending[] = [];
  readonly #stopSignal = new AbortController();
  #state: OnnState;
  #lastOutcome: CompletedOutcome | undefined;
  #lastTransmission: DeviceRecord['lastTransmission'] = unknown;
  #admitting: Promise<void> = Promise.resolve();
  #committing: Promise<void> = Promise.resolve();
  #running: Promise<void> | undefined;
  #reading: Promise<void> | undefined;
  #poll: Cancel | undefined;
  #stale: Cancel | undefined;
  #stopped = false;

  constructor(context: ModuleContext<OnnConfig>, transport: OnnTransport | undefined) {
    if (context.config === undefined) throw new Error('ONN started without configuration');
    this.#context = context; this.#config = context.config;
    this.#store = new OnnStore(context.database(), context.files);
    this.#outbox = new Outbox({...context, database: context.database(), validator: this.#validator});
    this.#transport = transport ?? new AdbTransport(this.#config);
    this.#availability = new DeviceAvailability(context);
    this.#state = {id: this.#config.id, revision: this.#store.revision(), configurationRevision: this.#config.configurationRevision,
      generation: {epoch: randomUUID(), sequence: 0}, connection: 'unknown', currentApp: unknown,
      controls: {keys: KEYS, apps: APPS, text: {maximum: 256, alphabet: 'ascii-letters-digits-space-dot-underscore-hyphen'}}};
    this.#lastOutcome = this.#store.lastOutcome();
  }
  async start(): Promise<void> {
    const {sdk} = this.#context;
    for (const family of FAMILIES) await sdk.respond<Input>(`bunny.cmd.${family}.*`, command => {
      const result = this.#admitting.then(() => this.#accept(family, command));
      this.#admitting = result.then(() => {}, () => {}); return result;
    });
    await sdk.serveSync(['device', 'onn-state'], request => ({revision: this.#state.revision, states: this.#states(request.data.families)}));
    await this.#outbox.republish();
    for (const row of this.#store.unfinished()) await this.#commitOutcome(row,
      failure(row.requestId, row.state === 'started' ? 'uncertain-result' : 'unavailable', row.state === 'started'));
    await this.#transaction(add => this.#records(add));
    this.#poll = this.#context.scheduler.after(0, () => this.#read());
  }
  status(): OnnState {return structuredClone(this.#state);}
  #states(families: readonly string[]): StateDraft[] {
    return [
      ...(families.includes('onn-state') ? [{type: 'org.bunny.onn-state.updated', subject: this.#config.id, dataschema: schemaOf('onn-state'), data: this.#state}] : []),
      ...(families.includes('device') ? [{type: 'org.bunny.device.updated', subject: this.#config.id, dataschema: 'https://bunny.invalid/events/device/2.1', data: this.#device()}] : []),
    ];
  }
  #device(): DeviceRecord {
    return {id: this.#config.id, revision: this.#state.revision, kind: 'onn', label: 'ONN', configurationRevision: this.#config.configurationRevision,
      generation: this.#state.generation, availability: this.#state.connection,
      capabilities: {power: unsupported, brightness: unsupported, modes: unsupported, moments: unsupported, media: unsupported, scenes: unsupported, zones: unsupported, preview: unsupported},
      desired: {power: unknown, brightness: unknown, mode: unknown}, observed: unknown,
      pending: this.#pending.size, pendingKinds: [...new Set([...this.#pending.values()].map(value => value.family))],
      lastOutcome: this.#lastOutcome === undefined ? unknown : {status: 'known', outcome: this.#lastOutcome},
      lastTransmission: this.#lastTransmission, externalControl: unknown};
  }
  #records(add: AddMessage, parent?: {traceparent: string}): void {
    this.#state.revision = this.#store.nextRevision();
    for (const draft of this.#states(['device', 'onn-state'])) add(`bunny.state.${draft.type === 'org.bunny.device.updated' ? 'device' : 'onn-state'}.${this.#config.id}`, {kind: 'state', ...draft}, parent === undefined ? {} : {parent});
  }
  #transaction<T>(work: (add: AddMessage) => Synchronous<T>): Promise<T> {
    const result = this.#committing.then(async () => {
      const state = structuredClone(this.#state), outcome = this.#lastOutcome, transmission = this.#lastTransmission;
      try {return await this.#outbox.transaction(work);} catch (error) {this.#state = state; this.#lastOutcome = outcome; this.#lastTransmission = transmission; throw error;}
    });
    this.#committing = result.then(() => {}, () => {}); return result;
  }
  #guards(command: Command<Input>): ErrorBody | undefined {
    if (this.#stopped || this.#context.signal.aborted) return errorBody('unavailable', {detail: 'ONN is not taking commands'});
    if (command.subject !== this.#config.id) return errorBody('not-found', {detail: 'no such configured ONN'});
    if (command.expiresat === undefined || !Number.isFinite(Date.parse(command.expiresat))) return errorBody('invalid-message', {detail: 'the ONN command needs an expiry'});
    if (Date.parse(command.expiresat) <= this.#context.clock.now()) return errorBody('expired', {detail: 'the ONN command expired before device work'});
    const data = command.data;
    if (data.expectedConfigurationRevision !== undefined && data.expectedConfigurationRevision !== this.#config.configurationRevision
      || data.expectedGeneration !== undefined && canonical(data.expectedGeneration) !== canonical(this.#state.generation)) return errorBody('revision-conflict', {detail: 'read the current ONN configuration and connection generation'});
    return undefined;
  }
  async #accept(family: Family, command: Command<Input>): Promise<Reply> {
    const checked = this.#validator.validate(command);
    if (!checked.ok || command.type !== types[family] || command.dataschema !== schemaOf(family)) return errorBody('invalid-message', {detail: 'the ONN command shape is invalid'});
    const action = actionOf(family, command.data);
    if (action === undefined) return errorBody('unsupported-capability', {detail: 'ONN supports only its qualified keys, apps and focused ASCII input'});
    const {requestId} = command.data;
    let admitted = false;
    try {
      const answer = await this.#transaction(add => {
        const identity = canonical({source: command.source, requestId, target: command.subject, family, type: command.type, schema: command.dataschema, data: command.data});
        const digest = family === 'onn-text' ? this.#store.privateDigest.digest('bunny/onn-text-owner/1', identity, !this.#store.hasText()) : createHash('sha256').update(identity).digest('hex');
        const previous = this.#store.get(requestId);
        if (previous !== undefined) return previous.digest === digest ? {status: 'accepted'} as const : errorBody('duplicate-conflict', {detail: 'another ONN action used this request ID'});
        const guard = this.#guards(command); if (guard !== undefined) return guard;
        if (this.#pending.size >= MAX_PENDING) return errorBody('capacity', {detail: 'the ONN queue is full'});
        this.#store.save({source: command.source, requestId, family, digest, state: 'accepted', traceparent: command.traceparent});
        this.#pending.set(requestId, {command, family, action}); admitted = true;
        this.#records(add, command); return {status: 'accepted'} as const;
      });
      if (admitted) {
        this.#queue.push({command, family, action});
        this.#running ??= this.#drain();
      }
      return answer;
    } catch (error) {
      if (admitted) this.#pending.delete(requestId);
      return errorBody(error instanceof SdkError ? error.body.error.code : fullDisk(error) ? 'capacity' : 'internal', {detail: 'ONN could not commit admission; no command was sent'});
    }
  }
  async #drain(): Promise<void> {
    await Promise.resolve();
    try {while (!this.#stopped) {
      const next = this.#queue.shift(); if (next === undefined) break;
      await this.#execute(next);
    }} finally {this.#running = undefined;}
  }
  async #execute(pending: Pending): Promise<void> {
    const {command, family, action} = pending, {requestId} = command.data;
    const row = this.#store.get(requestId); if (row === undefined || row.state !== 'accepted') return;
    const guard = this.#guards(command);
    if (guard !== undefined) {await this.#finish(row, failure(requestId, guard.error.code)); return;}
    try {
      await this.#transaction(() => {
        // The same durable fence must still belong to this exact admitted request.
        const current = this.#store.get(requestId);
        if (current?.state !== 'accepted' || current.digest !== row.digest) throw new Error('ONN fence changed');
        this.#store.save({...row, state: 'started'});
      });
    } catch {await this.#finish(row, failure(requestId, 'internal')); return;}
    const finalGuard = this.#guards(command);
    if (finalGuard !== undefined) {await this.#finish(row, failure(requestId, finalGuard.error.code)); return;}
    const current = this.#store.get(requestId);
    if (current?.state !== 'started' || current.digest !== row.digest) {await this.#finish(row, failure(requestId, 'internal')); return;}
    const remaining = Math.min(ACTION_LIMIT_MS, Date.parse(command.expiresat ?? '') - this.#context.clock.now());
    if (remaining <= 0 || this.#stopped) {await this.#finish(row, failure(requestId, 'expired')); return;}
    const call = this.#context.trace.start('bunny.device.call', {kind: 'client', parent: command, attributes: {'bunny.device.id': this.#config.id, 'bunny.request.id': requestId}});
    const trace = {traceparent: command.traceparent};
    this.#context.log.info('command.executing', {'bunny.device.id': this.#config.id, 'bunny.request.id': requestId, 'bunny.routing.key': `bunny.cmd.${family}.${this.#config.id}`}, trace);
    let result: Attempt;
    try {result = await this.#bounded(signal => this.#transport.execute(action, signal, () => {
      // Transport preparation may yield. Check the live guard and fence at its effect write.
      const guard = this.#guards(command); if (guard !== undefined) return guard.error.code;
      try {
        const current = this.#store.get(requestId);
        return current?.state === 'started' && current.digest === row.digest ? undefined : 'internal';
      } catch {return 'internal';}
    }), remaining);} catch {result = {result: 'uncertain', evidence: 'none', code: 'uncertain-result'};}
    call.end(result.result === 'succeeded' ? 'unset' : 'error');
    if (result.result === 'succeeded') this.#availability.reached(this.#config.id, trace);
    else this.#availability.unreachable(this.#config.id, result.code ?? 'unavailable', trace);
    const outcome: CompletedOutcome = {requestId, result: result.result, evidence: result.evidence,
      ...(result.code === undefined ? {} : {error: errorBody(result.code, {detail: result.result === 'uncertain' ? 'the ONN effect is uncertain; it will not be repeated' : 'ONN device work was refused'}).error})};
    await this.#finish(row, outcome);
  }
  async #bounded<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
    const controller = new AbortController(), cancel = this.#context.scheduler.after(ms, () => {controller.abort();});
    const signal = AbortSignal.any([controller.signal, this.#context.signal, this.#stopSignal.signal]);
    try {signal.throwIfAborted(); return await work(signal);} finally {cancel(); controller.abort();}
  }
  async #finish(row: RequestRow, outcome: CompletedOutcome): Promise<void> {
    this.#pending.delete(row.requestId);
    try {await this.#commitOutcome(row, outcome);} catch {
      // Its accepted/started fence remains. Restart settles it; no effect is retried.
      this.#context.log.warn('command.completed', {'bunny.device.id': this.#config.id, 'bunny.request.id': row.requestId, 'bunny.outcome': 'uncertain', 'bunny.code': 'internal'}, row);
    }
  }
  async #commitOutcome(row: RequestRow, outcome: CompletedOutcome): Promise<void> {
    await this.#transaction(add => {
      this.#store.outcome(row, outcome); this.#lastOutcome = outcome;
      if (outcome.evidence === 'transmitted') this.#lastTransmission = {status: 'known', requestId: row.requestId, transmittedAtMs: this.#context.clock.now(), operationIds: []};
      this.#records(add, row);
      add(`bunny.event.${row.family}.${this.#config.id}`, {kind: 'outcome', type: types[row.family].replace(/\.requested$/, '.completed'), subject: this.#config.id,
        dataschema: 'https://bunny.invalid/events/outcome/2.0', data: outcome}, {parent: row});
    });
  }
  async #read(): Promise<void> {
    if (this.#stopped) return;
    const startedAt = this.#context.clock.now();
    this.#reading = this.#observe();
    try {await this.#reading;} finally {
      this.#reading = undefined;
      if (!this.#stopped) this.#poll = this.#context.scheduler.after(Math.max(0, POLL_MS - (this.#context.clock.now() - startedAt)), () => this.#read());
    }
  }
  async #observe(): Promise<void> {
    const call = this.#context.trace.start('bunny.device.call', {kind: 'client', attributes: {'bunny.device.id': this.#config.id, 'bunny.operation': 'snapshot'}});
    let observation: Awaited<ReturnType<OnnTransport['read']>>;
    try {observation = await this.#bounded(signal => this.#transport.read(signal), ACTION_LIMIT_MS);} catch {observation = undefined;}
    call.end(observation === undefined ? 'error' : 'unset');
    if (this.#stopped) return;
    if (observation === undefined) this.#availability.unreachable(this.#config.id, 'unavailable', call.context); else this.#availability.reached(this.#config.id, call.context);
    try {await this.#transaction(add => {
      const connection = observation === undefined ? 'unavailable' : 'available';
      if (connection !== this.#state.connection) this.#state.generation = {...this.#state.generation, sequence: this.#state.generation.sequence + 1};
      this.#state.connection = connection;
      this.#state.currentApp = observation?.app === undefined ? unknown : {status: 'known', value: observation.app, observedAtMs: this.#context.clock.now()};
      this.#records(add, call.context);
    });} catch {return;}
    this.#stale?.();
    this.#stale = this.#context.scheduler.after(STALE_MS, async () => {
      if (this.#stopped || this.#state.currentApp.status === 'unknown') return;
      try {await this.#transaction(add => {this.#state.currentApp = unknown; this.#records(add);});} catch { /* the last committed evidence retains its timestamp */ }
    });
  }
  async stop(): Promise<void> {
    this.#stopped = true; this.#stopSignal.abort(); this.#poll?.(); this.#stale?.(); this.#queue.length = 0;
    await Promise.all([this.#admitting, this.#running, this.#reading]);
    await this.#committing;
    this.#pending.clear();
  }
}
