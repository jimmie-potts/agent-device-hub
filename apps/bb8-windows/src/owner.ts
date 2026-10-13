import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {Outbox, SdkError, fullDisk, errorType, levelOf, noSpans, startSpan, childOf, type Logger, type LogFields, type TraceContext, type SpanRecorder, type Command, type Participant, type Reply, type Scheduler} from '@jimmie-potts/sdk';
import {BOUNDS, bb8Validator, commandType, completedType, MODULE_SOURCE, schemaOf, type LinkRequest, type LinkResult, type LinkState, type RecordedRequest} from '@jimmie-potts/bb8/link';
import {Receipts, type ReceiptRow} from './receipts.js';
import {PacketTransport, ProtocolRefusal, StepFailure, type Adapter, type TransportObservation} from './transport.js';
export type HelperOptions = {
  id: string; configurationRevision: number; database: DatabaseSync; sdk: Participant; now: () => number; scheduler: Scheduler;
  /** Undefined means cross-host clock qualification is absent or has expired. */
  clockErrorMs: () => number | undefined; adapter: () => Adapter; onError?: (error: unknown) => void; log?: Logger; trace?: SpanRecorder;
};
const refuse = (code: ErrorCode): ErrorBody => errorBody(code, {detail: 'BB-8 transport operation refused'});
const storageCode = (error: unknown): ErrorCode => fullDisk(error) ? 'capacity' : 'internal';
/** Owns private transport responsibility; publication and recovery never execute a saved request. */
export class HelperOwner {
  readonly #options: HelperOptions;
  readonly #store: Receipts;
  readonly #outbox: Outbox;
  readonly #transport: PacketTransport;
  readonly #epoch = randomUUID();
  #state: LinkState;
  #live = true;
  #blocked = false;
  #closing = false;
  #pending = 0;
  #queue: {data: LinkRequest; command: Command<Record<string, unknown>>}[] = [];
  #running: Promise<void> | undefined;
  #stepReserved = false;
  readonly #cancelledGestures = new Set<string>();
  #active: AbortController | undefined;
  constructor(options: HelperOptions) {
    this.#options = options; this.#store = new Receipts(options.database); this.#store.bind(options.id);
    this.#outbox = new Outbox({sdk: options.sdk, database: options.database, clock: {now: options.now}, validator: bb8Validator(), ...(options.log === undefined ? {} : {log: options.log}), ...(options.trace === undefined ? {} : {trace: options.trace}), onError: error => {options.onError?.(error);}});
    this.#transport = new PacketTransport(options.adapter, options.scheduler, options.now, () => {void this.radioLost().catch(error => {this.#blocked = true; options.onError?.(error);});});
    this.#state = {id: options.id, revision: this.#store.revision(), configurationRevision: options.configurationRevision, helperEpoch: this.#epoch, connectionGeneration: this.#store.generation(), connection: 'disconnected', changedAtMs: options.now()};
  }
  get state(): LinkState {return {...this.#state};}
  get results(): LinkResult[] {return this.#store.results();}
  async start(): Promise<void> {
    const {sdk} = this.#options;
    await this.#outbox.republish();
    await this.#outbox.transaction(add => {
      this.#state.connectionGeneration = this.#store.nextGeneration(); this.#state.revision = this.#store.nextRevision();
      for (const row of this.#store.pending()) {
        const result = this.#recovered(row); this.#store.complete(result);
        add(`bunny.state.bb8-link-result.${result.id}`, {kind: 'state', type: 'org.bunny.bb8-link-result.updated', subject: result.id, dataschema: schemaOf('bb8-link-result'), data: result}, {parent: {traceparent: row.traceparent}});
        add(`bunny.event.bb8-link-execute.${this.#state.id}`, {kind: 'outcome', type: completedType('bb8-link-execute'), subject: this.#state.id, dataschema: schemaOf('outcome'), data: {requestId: row.id, result: result.result, evidence: result.evidence, error: result.error}}, {parent: {traceparent: row.traceparent}});
      }
      add(`bunny.state.bb8-link.${this.#state.id}`, this.#draft());
    });
    await sdk.serveSync(['bb8-link', 'bb8-link-result'], request => this.#blocked ? refuse('unavailable') : ({revision: this.#store.revision(), states: [
      ...(request.data.families.includes('bb8-link') ? [this.#draft()] : []),
      ...(request.data.families.includes('bb8-link-result') ? this.results.map(data => ({type: 'org.bunny.bb8-link-result.updated', subject: data.id, dataschema: schemaOf('bb8-link-result'), data})) : []),
    ]}));
    await sdk.respond(`bunny.cmd.bb8-link-execute.${this.#state.id}`, command => this.#answer(command, () => this.#admit(command)));
    await sdk.respond<RecordedRequest>(`bunny.cmd.bb8-link-recorded.${this.#state.id}`, command => this.#answer(command, () => this.#consume(command)));
  }
  #record(level: keyof Logger, event: string, fields: LogFields, trace?: TraceContext): void {
    try {this.#options.log?.[level](event, fields, trace ?? childOf(undefined));} catch { /* Diagnostic loss cannot change domain work. */ }
  }
  async #answer(command: Command<Record<string, unknown>>, answer: () => Promise<Reply>): Promise<Reply> {
    const reply = await answer();
    if ('error' in reply) this.#record(levelOf(reply.error.code), 'command.rejected', {'bunny.code': reply.error.code, 'bunny.request.id': String(command.data.requestId), 'bunny.outcome': 'rejected'}, command.source === MODULE_SOURCE && command.subject === this.#state.id && bb8Validator().validate(command).ok ? command : undefined);
    return reply;
  }
  #draft() {return {kind: 'state' as const, type: 'org.bunny.bb8-link.updated', subject: this.#state.id, dataschema: schemaOf('bb8-link'), data: {...this.#state}};}
  #recovered(row: ReceiptRow): LinkResult {
    const uncertain = row.effect === 1;
    return {id: row.id, revision: this.#store.revision(), robotId: this.#state.id, parentRequestId: row.parent_id, requestId: row.id, helperEpoch: row.helper_epoch, connectionGeneration: row.generation, result: uncertain ? 'uncertain' : 'failed', evidence: 'none', completedAtMs: this.#options.now(), error: refuse(uncertain ? 'uncertain-result' : 'unavailable').error};
  }
  #check(command: Command<Record<string, unknown>>): ErrorBody | undefined {
    if (command.source !== MODULE_SOURCE) return refuse('forbidden');
    if (command.subject !== this.#state.id) return refuse('not-found');
    if (!bb8Validator().validate(command).ok) return refuse('invalid-message');
    if (Date.parse(command.expiresat ?? '') <= this.#options.now()) return refuse('expired');
    if (this.#closing || this.#blocked || !this.#live) return refuse('unavailable');
    return undefined;
  }
  async #admit(command: Command<Record<string, unknown>>): Promise<Reply> {
    const check = this.#check(command); if (check !== undefined) return check;
    if (command.dataschema !== schemaOf('bb8-link-execute')) return refuse('invalid-message');
    const data = command.data as unknown as LinkRequest;
    const now = this.#options.now(), errorMs = this.#options.clockErrorMs();
    if (errorMs === undefined || !Number.isFinite(errorMs) || errorMs < 0 || errorMs > 1000) return refuse('unavailable');
    if (data.operationExpiresAtMs <= now + errorMs) return refuse('expired');
    if (data.operationExpiresAtMs > now + errorMs + (data.operation.kind === 'connect' ? BOUNDS.connectMs : BOUNDS.operationMs)) return refuse('invalid-request');
    if (!this.#guards(data)) return refuse('revision-conflict');
    if (data.operation.kind === 'gesture' && this.#stepReserved) return refuse('invalid-state');
    if (data.operation.kind === 'step' && (this.#stepReserved || this.#state.forwardReference === undefined || data.operation.forwardReference !== this.#state.forwardReference)) return refuse('invalid-state');
    let reserved = false;
    try {
      if (this.#store.row(data.operationId) !== undefined) return refuse('duplicate-conflict');
      const reserveStop = this.#stepReserved || data.operation.kind === 'step' || data.operation.kind === 'gesture';
      const stop = data.operation.kind === 'stop';
      if (this.#store.count() >= BOUNDS.maxResults - (reserveStop && !stop ? 1 : 0) || this.#pending >= BOUNDS.maxPending + (reserveStop && !stop ? 0 : 1)) return refuse('capacity');
      this.#pending += 1; reserved = true;
      if (data.operation.kind === 'step' || data.operation.kind === 'gesture') this.#stepReserved = true;
      // Admission commits before acknowledgment or any possible native effect.
      await this.#outbox.transaction(() => {this.#store.admit(data, command.traceparent);});
    } catch (error) {if (reserved) {this.#pending -= 1; if (data.operation.kind === 'step' || data.operation.kind === 'gesture') this.#stepReserved = false;} return refuse(storageCode(error));}
    this.#record('info', 'command.admitted', {'bunny.request.id': data.operationId, 'bunny.outcome': 'accepted'}, command);
    if (data.operation.kind === 'stop') {
      for (const item of this.#queue) if (item.data.operation.kind === 'gesture') this.#cancelledGestures.add(item.data.operationId);
      this.#clearReference(); this.#transport.interruptStep(); this.#queue.unshift({data, command});
    } else this.#queue.push({data, command});
    this.#running ??= Promise.resolve().then(() => this.#pump());
    return {status: 'accepted'};
  }
  #clearReference(): void {const {forwardReference: _reference, ...state} = this.#state; this.#state = state;}
  async #pump(): Promise<void> {
    try {
      let item;
      while ((item = this.#queue.shift()) !== undefined) {
        try {await this.#execute(item.data, item.command);}
        catch (error) {this.#blocked = true; this.#options.onError?.(error);}
        finally {this.#pending -= 1; if (item.data.operation.kind === 'step' || item.data.operation.kind === 'gesture') this.#stepReserved = false;}
      }
    } finally {this.#running = undefined;}
  }
  #guards(request: LinkRequest): boolean {
    return request.expectedConfigurationRevision === this.#state.configurationRevision && request.expectedHelperEpoch === this.#state.helperEpoch && request.expectedConnectionGeneration === this.#state.connectionGeneration;
  }
  async #execute(request: LinkRequest, command: Command<Record<string, unknown>>): Promise<void> {
    const controller = new AbortController(); this.#active = controller;
    let effect = false;
    const check = (): void => {
      const errorMs = this.#options.clockErrorMs();
      if (!this.#live || this.#closing || this.#blocked || controller.signal.aborted || errorMs === undefined || !Number.isFinite(errorMs) || errorMs < 0 || errorMs > 1000) throw new SdkError(refuse('unavailable'));
      if (request.operationExpiresAtMs <= this.#options.now() + errorMs) throw new SdkError(refuse('expired'));
      if (!this.#guards(request)) throw new SdkError(refuse('revision-conflict'));
      if (request.operation.kind === 'step' && request.operation.forwardReference !== this.#state.forwardReference) throw new SdkError(refuse('invalid-state'));
      if (request.operation.kind !== 'connect' && request.operation.kind !== 'disconnect' && this.#state.connection !== 'connected') throw new SdkError(refuse('unavailable'));
    };
    const completionCheck = (): void => {
      if (this.#closing || this.#blocked || this.#state.connection !== 'connected') throw new SdkError(refuse('unavailable'));
      if (!this.#guards(request)) throw new SdkError(refuse('revision-conflict'));
    };
    const started = (): void => {
      check(); if (effect) return;
      this.#options.database.exec('BEGIN IMMEDIATE');
      try {this.#store.effect(request.operationId, this.#state.connectionGeneration); this.#options.database.exec('COMMIT'); effect = true;}
      catch (error) {this.#options.database.exec('ROLLBACK'); throw error;}
    };
    const span = startSpan(this.#options.trace ?? noSpans, 'bunny.device.call', {parent: command, kind: 'client', attributes: {'bunny.device.id': this.#state.id, 'bunny.operation': request.operation.kind === 'led-set' ? 'brightness' : request.operation.kind === 'power-refresh' ? 'power' : 'setup'}});
    this.#record('info', 'command.executing', {'bunny.request.id': request.operationId, 'bunny.outcome': 'queued'}, span.context);
    let observation: TransportObservation = {}, failure: unknown;
    let cancel: (() => void) | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      cancel = this.#options.scheduler.after(Math.max(0, Math.min(request.operation.kind === 'connect' ? BOUNDS.connectMs : BOUNDS.operationMs, request.operationExpiresAtMs - this.#options.now() - (this.#options.clockErrorMs() ?? BOUNDS.connectMs))), () => {if (request.operation.kind === 'step' || request.operation.kind === 'gesture') this.#transport.interruptStep(); else controller.abort(); reject(new SdkError(refuse('expired')));});
    });
    void expired.catch(() => {});
    try {
      check();
      if (this.#cancelledGestures.delete(request.operationId)) throw new SdkError(refuse('cancelled'));
      if (request.operation.kind === 'gesture' || request.operation.kind === 'aim' || request.operation.kind === 'stop' || request.operation.kind === 'connect' || request.operation.kind === 'disconnect' || request.operation.kind === 'wake') this.#clearReference();
      const work = this.#transport.execute(request.operation, controller.signal, check, started, completionCheck);
      observation = request.operation.kind === 'step' || request.operation.kind === 'gesture' ? await work : await Promise.race([work, expired]);
    } catch (error) {failure = error; if (!(error instanceof StepFailure && error.stopAcknowledged)) controller.abort(); if (effect && !(error instanceof StepFailure && error.stopAcknowledged)) await this.#transport.close();}
    finally {cancel?.(); this.#active = undefined; span.end(failure === undefined || (failure instanceof SdkError && failure.body.error.code !== 'internal') ? 'unset' : 'error');}
    const code = failure instanceof SdkError ? failure.body.error.code : failure === undefined ? undefined : storageCode(failure);
    // A known protocol refusal proves failure; an unanswered or interrupted possible effect remains uncertain.
    const definitiveRefusal = failure instanceof ProtocolRefusal;
    const cancelled = failure instanceof StepFailure && code === 'cancelled';
    const result: LinkResult['result'] = code === undefined ? 'succeeded' : definitiveRefusal || cancelled ? 'failed' : effect && !['unsupported-capability', 'invalid-request'].includes(code) ? 'uncertain' : 'failed';
    const keepLink = failure instanceof StepFailure && failure.stopAcknowledged;
    if (failure !== undefined && (request.operation.kind === 'step' || request.operation.kind === 'gesture')) this.#clearReference();
    if (failure === undefined && request.operation.kind === 'aim' && request.operation.action === 'set' && !this.#queue.some(item => item.data.operation.kind === 'stop')) this.#state.forwardReference = randomUUID();
    const before = {...this.#state};
    try {
      await this.#outbox.transaction(add => {
        const revision = this.#store.nextRevision();
        if (effect && (request.operation.kind === 'connect' || request.operation.kind === 'disconnect' || (failure !== undefined && !keepLink))) this.#state.connectionGeneration = this.#store.nextGeneration();
        this.#state = {...this.#state, revision, changedAtMs: this.#options.now(), connection: failure !== undefined && !keepLink ? effect ? 'unavailable' : this.#state.connection : request.operation.kind === 'connect' ? 'connected' : request.operation.kind === 'disconnect' ? 'disconnected' : this.#state.connection};
        const receipt: LinkResult = {id: request.operationId, revision, robotId: this.#state.id, parentRequestId: request.parentRequestId, requestId: request.operationId, helperEpoch: request.expectedHelperEpoch, connectionGeneration: this.#state.connectionGeneration, completedAtMs: this.#options.now(), result, evidence: code === undefined ? observation.power !== undefined || observation.version !== undefined ? 'observed' : 'transmitted' : definitiveRefusal || (cancelled && failure instanceof StepFailure && failure.stopAcknowledged) ? 'transmitted' : 'none',
          ...(code === undefined ? observation : {error: refuse(result === 'uncertain' ? 'uncertain-result' : code).error})};
        this.#store.complete(receipt);
        add(`bunny.state.bb8-link-result.${receipt.id}`, {kind: 'state', type: 'org.bunny.bb8-link-result.updated', subject: receipt.id, dataschema: schemaOf('bb8-link-result'), data: receipt}, {parent: command});
        add(`bunny.event.bb8-link-execute.${this.#state.id}`, {kind: 'outcome', type: completedType('bb8-link-execute'), subject: this.#state.id, dataschema: schemaOf('outcome'), data: {requestId: receipt.id, result: receipt.result, evidence: receipt.evidence, ...(receipt.error === undefined ? {} : {error: receipt.error})}}, {parent: command});
        add(`bunny.state.bb8-link.${this.#state.id}`, this.#draft(), {parent: command});
      });
      this.#record(result === 'succeeded' ? 'info' : 'warn', 'command.completed', {'bunny.request.id': request.operationId, 'bunny.outcome': result, ...(code === undefined ? {} : {'bunny.code': code})}, span.context);
    } catch (error) {this.#record('error', 'operation.failed', {'bunny.code': storageCode(error), 'error.type': errorType(error), 'bunny.outcome': 'failed'}, span.context); this.#state = {...before, connection: 'unavailable'}; this.#blocked = true; controller.abort(); await this.#transport.close(); this.#options.onError?.(error);}
  }
  async #consume(command: Command<RecordedRequest>): Promise<Reply> {
    const check = this.#check(command); if (check !== undefined) return check;
    if (command.dataschema !== schemaOf('bb8-link-recorded')) return refuse('invalid-message');
    const row = this.#store.row(command.data.operationId); if (row === undefined || row.completed !== 1) return refuse('not-found');
    if (row.consumed === 1) return {status: 'accepted'};
    try {
      await this.#outbox.transaction(add => {
        this.#store.consume(row.id); const revision = this.#store.nextRevision(); this.#state.revision = revision;
        add(`bunny.state.bb8-link-result.${row.id}`, {kind: 'removal', type: 'org.bunny.bb8-link-result.removed', subject: row.id, dataschema: schemaOf('removal'), data: {entity: {family: 'bb8-link-result', id: row.id}, revision, reason: 'retired'}}, {parent: command});
        add(`bunny.event.bb8-link-recorded.${this.#state.id}`, {kind: 'outcome', type: completedType('bb8-link-recorded'), subject: this.#state.id, dataschema: schemaOf('outcome'), data: {requestId: command.data.requestId, result: 'succeeded', evidence: 'transmitted'}}, {parent: command});
      }); return {status: 'accepted'};
    } catch (error) {return refuse(storageCode(error));}
  }
  /** A reconnect only restores SDK resources. Lost-stream work is invalidated and never replayed. */
  async streamLost(): Promise<void> {
    this.#live = false; await this.radioLost();
  }
  /** Radio loss invalidates generations, without impersonating SDK stream loss or reconnecting automatically. */
  async radioLost(): Promise<void> {
    this.#clearReference(); this.#active?.abort(); this.#transport.interruptStep(); await this.#transport.close();
    await this.#outbox.transaction(add => {this.#state = {...this.#state, revision: this.#store.nextRevision(), connectionGeneration: this.#store.nextGeneration(), connection: 'unavailable', changedAtMs: this.#options.now()}; add(`bunny.state.bb8-link.${this.#state.id}`, this.#draft());});
    this.#record('warn', 'device.unavailable', {'bunny.device.id': this.#state.id, 'bunny.code': 'unavailable', 'bunny.outcome': 'unavailable'});
  }
  async streamRestored(): Promise<void> {this.#live = true; await this.#outbox.republish();}
  async drain(): Promise<void> {while (this.#running !== undefined) await this.#running;}
  async stop(): Promise<void> {this.#closing = true; this.#clearReference(); this.#active?.abort(); this.#transport.interruptStep(); await this.#transport.close(); await this.drain();}
}
export const executeDraft = (id: string, data: object) => ({type: commandType('bb8-link-execute'), subject: id, dataschema: schemaOf('bb8-link-execute'), data});
