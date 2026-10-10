import {createHash, randomUUID} from 'node:crypto';
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {CompletedOutcome, DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {Outbox, SdkError, fullDisk, type AddMessage, type BunnyModule, type Command, type ModuleContext, type Reply, type TraceContext} from '@jimmie-potts/sdk';
import {configureBb8, type Bb8Config} from './configuration.js';
import {BOUNDS, completedType, PUBLIC_FAMILIES, schemaOf, type LinkRequest, type LinkResult, type Operation, type PublicFamily, type PublicRequest, type RobotState, type Unknown} from './contracts.js';
import {bb8Validator} from './families.js';
import {Bb8Store, type Responsibility} from './store.js';
import {SdkLink, type LinkPort} from './transport.js';
const UNKNOWN: Unknown = {status: 'unknown'};
const UNSUPPORTED = {supported: false as const};
const refuse = (code: ErrorCode): ErrorBody => errorBody(code, {detail: 'BB-8 command refused'});
const storageCode = (error: unknown): ErrorCode => fullDisk(error) ? 'capacity' : 'internal';
export function createBb8Module(options: {transport?: LinkPort} = {}): BunnyModule {
  let run: Bb8Run | undefined;
  return {manifest: {name: 'bb8', apiVersion: '1.3', configure: configureBb8, pages: [{id: 'robot', title: 'BB-8', presentation: 'react'}], settings: {
    schema: {type: 'object', additionalProperties: false, required: ['id', 'configurationRevision'], properties: {id: {type: 'string'}, configurationRevision: {type: 'integer', minimum: 0}}}, show: config => config as Bb8Config,
  }}, async start(context) {run = new Bb8Run(context, options.transport ?? new SdkLink()); await run.start();}, async stop() {await run?.stop();}};
}
class Bb8Run {
  readonly #context: ModuleContext;
  readonly #config: Bb8Config;
  readonly #link: LinkPort;
  readonly #store: Bb8Store;
  readonly #outbox: Outbox;
  #state: RobotState;
  #closing = false;
  #blocked = false;
  #work = new Set<Promise<void>>();
  #writes: Promise<void> = Promise.resolve();
  #refreshTail: Promise<void> = Promise.resolve();
  #consuming = new Set<string>();
  #deadlineCancels = new Map<string, () => void>();
  readonly #recoveryIds = new Set<string>();
  #held: {requestId: string; heldAtMs: number} | undefined;
  constructor(context: ModuleContext, link: LinkPort) {
    this.#context = context; this.#config = context.config as Bb8Config; this.#link = link;
    const database = context.database(); this.#store = new Bb8Store(database);
    this.#outbox = new Outbox({sdk: context.sdk, database, clock: context.clock, validator: bb8Validator(), log: context.log, trace: context.trace});
    for (const row of this.#store.pending()) this.#recoveryIds.add(row.operation_id);
    const saved = this.#store.state();
    if (saved !== undefined && saved.id !== this.#config.id) throw new SdkError(refuse('revision-conflict'));
    this.#held = saved?.held;
    this.#state = {...(saved ?? {id: this.#config.id, revision: 0, configurationRevision: this.#config.configurationRevision, link: UNKNOWN, linkLive: false, desiredLed: UNKNOWN, physicalLed: UNKNOWN, power: UNKNOWN, lastResult: UNKNOWN}), configurationRevision: this.#config.configurationRevision, linkLive: false};
    context.signal.addEventListener('abort', () => {this.#closing = true; for (const cancel of this.#deadlineCancels.values()) cancel(); this.#deadlineCancels.clear();}, {once: true});
  }
  async start(): Promise<void> {
    await this.#outbox.republish();
    await this.#transaction(add => {this.#records(add);});
    await this.#context.sdk.serveSync(['device', 'bb8-robot'], request => this.#blocked ? refuse('unavailable') : ({revision: this.#state.revision, states: [
      ...(request.data.families.includes('device') ? [this.#device()] : []), ...(request.data.families.includes('bb8-robot') ? [this.#robot()] : []),
    ]}));
    for (const family of PUBLIC_FAMILIES) await this.#context.sdk.respond(`bunny.cmd.${family}.${this.#config.id}`, command => this.#admit(family, command));
    this.#link.start(this.#config.id, this.#context, () => {this.#refreshTail = this.#refreshTail.then(() => this.#refresh()).catch(error => {this.#storageFailed(error);});});
    // Recover only after the first live helper membership, or after a bounded wait. Never execute stored work.
    this.#context.scheduler.after(BOUNDS.responseMs, () => {this.#track(this.#recover());});
  }
  #transaction(work: (add: AddMessage) => void): Promise<void> {
    const write = this.#writes.then(() => this.#outbox.transaction(work));
    this.#writes = write.catch(() => {}); return write;
  }
  #track(work: Promise<void>): void {this.#work.add(work); void work.catch(error => {this.#storageFailed(error);}).finally(() => {this.#work.delete(work);});}
  #storageFailed(error: unknown): void {this.#blocked = true; this.#context.log.error('operation.failed', {'bunny.operation': 'storage', 'bunny.code': storageCode(error)});}
  #robot() {return {kind: 'state' as const, type: 'org.bunny.bb8-robot.updated', subject: this.#state.id, dataschema: schemaOf('bb8-robot'), data: {...this.#state}};}
  #device() {
    const pending = this.#store.pending(), last = this.#state.lastResult;
    const rows = this.#context.database().prepare("SELECT request_id,operation_id,outcome FROM bb8_responsibility WHERE stage='done' ORDER BY rowid DESC LIMIT 1").get() as {request_id: string; operation_id: string; outcome: string} | undefined;
    const outcome = rows === undefined ? undefined : JSON.parse(rows.outcome) as CompletedOutcome;
    const available = this.#state.linkLive && this.#state.link.status === 'known' && this.#state.link.value.connection === 'connected';
    const data: DeviceRecord = {id: this.#state.id, revision: this.#state.revision, kind: 'bb8', configurationRevision: this.#state.configurationRevision, generation: {epoch: this.#state.link.status === 'known' ? this.#state.link.value.helperEpoch : 'unknown', sequence: this.#state.link.status === 'known' ? this.#state.link.value.connectionGeneration : 0}, availability: this.#held !== undefined ? 'unavailable' : available ? 'available' : this.#state.link.status === 'unknown' ? 'unknown' : 'unavailable',
      capabilities: {power: UNSUPPORTED, brightness: UNSUPPORTED, modes: UNSUPPORTED, moments: UNSUPPORTED, media: UNSUPPORTED, scenes: UNSUPPORTED, zones: UNSUPPORTED, preview: UNSUPPORTED}, desired: {power: UNKNOWN, brightness: UNKNOWN, mode: UNKNOWN}, observed: UNKNOWN,
      pending: pending.length, pendingKinds: [...new Set(pending.map(row => row.family))], lastOutcome: outcome === undefined ? UNKNOWN : {status: 'known', outcome}, lastTransmission: last.status === 'known' && last.value.evidence !== 'none' ? {status: 'known', transmittedAtMs: last.value.completedAtMs, operationIds: rows === undefined ? [] : [rows.operation_id]} : UNKNOWN, externalControl: UNKNOWN, ...(this.#held === undefined ? {} : {held: this.#held})};
    return {kind: 'state' as const, type: 'org.bunny.device.updated', subject: data.id, dataschema: schemaOf('device').replace('/2.0', '/2.1'), data};
  }
  #records(add: AddMessage, parent?: TraceContext): void {
    const {held: _oldHold, ...state} = this.#state;
    this.#state = {...state, ...(this.#held === undefined ? {} : {held: this.#held}), revision: this.#state.revision + 1}; this.#store.setState(this.#state);
    add(`bunny.state.bb8-robot.${this.#state.id}`, this.#robot(), parent === undefined ? {} : {parent}); add(`bunny.state.device.${this.#state.id}`, this.#device(), parent === undefined ? {} : {parent});
  }
  async #admit(family: PublicFamily, command: Command<Record<string, unknown>>): Promise<Reply> {
    if (command.subject !== this.#config.id) return refuse('not-found');
    if (command.dataschema !== schemaOf(family) || !bb8Validator().validate(command).ok) return refuse('invalid-message');
    if (Date.parse(command.expiresat ?? '') <= this.#context.clock.now()) return refuse('expired');
    const data = command.data as unknown as PublicRequest;
    const digest = createHash('sha256').update(JSON.stringify({family, data})).digest('hex');
    let prior: Responsibility | undefined;
    try {prior = this.#store.row(command.source, data.requestId);} catch (error) {return refuse(storageCode(error));}
    if (prior !== undefined) return prior.digest === digest ? {status: 'accepted'} : refuse('duplicate-conflict');
    if (this.#closing || this.#blocked || !this.#link.live()) return refuse('unavailable');
    const helper = this.#link.state(); if (helper === undefined || helper.id !== this.#config.id) return refuse('unavailable');
    if (data.expectedConfigurationRevision !== this.#config.configurationRevision || data.expectedConfigurationRevision !== helper.configurationRevision || data.expectedHelperEpoch !== helper.helperEpoch || data.expectedConnectionGeneration !== helper.connectionGeneration) return refuse('revision-conflict');
    if (this.#held !== undefined && family !== 'bb8-connect' && family !== 'bb8-disconnect') return refuse('invalid-state');
    if (family !== 'bb8-connect' && family !== 'bb8-disconnect' && helper.connection !== 'connected') return refuse('unavailable');
    if (this.#store.pending().length >= BOUNDS.maxPending + 1) return refuse('capacity');
    let operation: Operation;
    switch (family) {
      case 'bb8-connect': operation = {kind: 'connect'}; break;
      case 'bb8-disconnect': operation = {kind: 'disconnect'}; break;
      case 'bb8-wake': operation = {kind: 'wake'}; break;
      case 'bb8-power-refresh': operation = {kind: 'power-refresh'}; break;
      case 'bb8-led-set': if (data.led === undefined) return refuse('invalid-message'); operation = {kind: 'led-set', led: data.led}; break;
    }
    const id = randomUUID(), deadline = this.#context.clock.now() + (operation.kind === 'connect' ? BOUNDS.connectMs : BOUNDS.operationMs);
    const row = {source: command.source, request_id: data.requestId, digest, family, operation_id: id, helper_epoch: helper.helperEpoch, generation: helper.connectionGeneration, deadline, traceparent: command.traceparent};
    const before = this.#state;
    try {
      await this.#transaction(add => {if (this.#store.pending().length >= BOUNDS.maxPending + 1) throw new SdkError(refuse('capacity')); this.#store.accept(row); if (operation.kind === 'led-set') this.#state = {...this.#state, desiredLed: {status: 'known', value: operation.led}}; this.#records(add, command);});
    } catch (error) {this.#state = before; return refuse(error instanceof SdkError ? error.body.error.code : storageCode(error));}
    this.#track(this.#execute({...row, stage: 'accepted', outcome: null}, operation, data, command));
    return {status: 'accepted'};
  }
  async #execute(row: Responsibility, operation: Operation, guards: PublicRequest, parent: TraceContext): Promise<void> {
    const controller = new AbortController();
    let dispatched = false;
    const abort = (): void => {controller.abort();}; this.#context.signal.addEventListener('abort', abort, {once: true});
    try {
      if (this.#closing || this.#blocked) {await this.#failure(row, 'failed', 'cancelled'); return;}
      await this.#transaction(() => {this.#store.started(row.operation_id);});
      const request: LinkRequest = {requestId: row.operation_id, operationId: row.operation_id, parentRequestId: row.request_id, expectedConfigurationRevision: guards.expectedConfigurationRevision, expectedHelperEpoch: guards.expectedHelperEpoch, expectedConnectionGeneration: guards.expectedConnectionGeneration, operationExpiresAtMs: row.deadline, operation};
      const span = this.#context.trace.start('bunny.device.call', {parent, kind: 'client', attributes: {'bunny.device.id': this.#config.id, 'bunny.operation': operation.kind === 'led-set' ? 'brightness' : operation.kind === 'power-refresh' ? 'power' : 'setup'}});
      let result;
      try {dispatched = true; result = await this.#link.execute(request, span.context, controller.signal);} finally {span.end();}
      if (result.status !== 'accepted') {await this.#failure(row, result.status === 'rejected' ? 'failed' : 'uncertain', result.error.error.code); return;}
      await this.#refresh();
      if (this.#store.operation(row.operation_id)?.stage === 'done') return;
      const cancel = this.#context.scheduler.after(Math.max(0, row.deadline + BOUNDS.responseMs - this.#context.clock.now()), () => {
        this.#deadlineCancels.delete(row.operation_id); this.#track(this.#failure(row, 'uncertain', 'uncertain-result'));
      }); this.#deadlineCancels.set(row.operation_id, cancel);
    } catch (error) {await this.#failure(row, dispatched ? 'uncertain' : 'failed', error instanceof SdkError ? error.body.error.code : 'uncertain-result');}
    finally {this.#context.signal.removeEventListener('abort', abort);}
  }
  async #failure(row: Responsibility, result: 'failed' | 'uncertain', code: ErrorCode): Promise<void> {
    if (this.#store.operation(row.operation_id)?.stage === 'done') return;
    await this.#complete(row, {requestId: row.request_id, result, evidence: 'none', error: refuse(code).error});
  }
  async #complete(row: Responsibility, outcome: CompletedOutcome, receipt?: LinkResult): Promise<boolean> {
    const before = this.#state, held = this.#held;
    try {
      await this.#transaction(add => {
        const current = this.#store.operation(row.operation_id);
        if (current?.stage === 'done' && !(current.outcome !== null && (JSON.parse(current.outcome) as CompletedOutcome).result === 'uncertain' && receipt !== undefined && receipt.result !== 'uncertain')) return;
        this.#store.complete(row.operation_id, outcome);
        if (outcome.result === 'uncertain') this.#held = {requestId: row.request_id, heldAtMs: this.#context.clock.now()};
        else if ((['bb8-connect', 'bb8-disconnect'].includes(row.family) && outcome.result === 'succeeded') || this.#held?.requestId === row.request_id) this.#held = undefined;
        this.#state = {...this.#state, ...(receipt?.power === undefined ? {} : {power: {status: 'known', value: receipt.power}}), lastResult: {status: 'known', value: {result: outcome.result, evidence: outcome.evidence, completedAtMs: receipt?.completedAtMs ?? this.#context.clock.now()}}};
        this.#records(add, {traceparent: row.traceparent});
        add(`bunny.event.${row.family}.${this.#config.id}`, {kind: 'outcome', type: completedType(row.family), subject: this.#config.id, dataschema: schemaOf('outcome'), data: outcome}, {parent: {traceparent: row.traceparent}});
      });
      this.#deadlineCancels.get(row.operation_id)?.(); this.#deadlineCancels.delete(row.operation_id); return true;
    } catch (error) {this.#state = before; this.#held = held; this.#storageFailed(error); return false;}
  }
  async #refresh(): Promise<void> {
    if (this.#closing) return;
    const link = this.#link.state();
    const projection = link === undefined ? UNKNOWN : {status: 'known' as const, value: {helperEpoch: link.helperEpoch, connectionGeneration: link.connectionGeneration, connection: link.connection, changedAtMs: link.changedAtMs}};
    const live = this.#link.live();
    if (JSON.stringify(projection) !== JSON.stringify(this.#state.link) || live !== this.#state.linkLive) {
      const before = this.#state;
      try {await this.#transaction(add => {this.#state = {...this.#state, link: projection, linkLive: live}; this.#records(add);});}
      catch (error) {this.#state = before; throw error;}
    }
    for (const receipt of this.#link.results()) {
      const row = this.#store.operation(receipt.id);
      if (row === undefined || receipt.robotId !== this.#config.id || receipt.parentRequestId !== row.request_id || receipt.helperEpoch !== row.helper_epoch) continue;
      const outcome: CompletedOutcome = {requestId: row.request_id, result: receipt.result, evidence: receipt.evidence, ...(receipt.error === undefined ? {} : {error: receipt.error})};
      if (row.stage !== 'done' || (row.outcome !== null && (JSON.parse(row.outcome) as CompletedOutcome).result === 'uncertain' && receipt.result !== 'uncertain')) {
        if (!await this.#complete(row, outcome, receipt)) continue;
      }
      if (!live || this.#consuming.has(receipt.id)) continue;
      this.#consuming.add(receipt.id);
      try {await this.#link.recorded(receipt.id, {traceparent: row.traceparent});} catch { /* Keep the receipt for a later explicit resync/restart; never execute it again. */ }
      finally {this.#consuming.delete(receipt.id);}
    }
  }
  async #recover(): Promise<void> {
    await this.#refresh();
    for (const row of this.#store.pending()) {
      if (!this.#recoveryIds.has(row.operation_id)) continue;
      await this.#failure(row, row.stage === 'started' ? 'uncertain' : 'failed', row.stage === 'started' ? 'uncertain-result' : 'cancelled');
      this.#recoveryIds.delete(row.operation_id);
    }
  }
  async stop(): Promise<void> {
    this.#closing = true; for (const cancel of this.#deadlineCancels.values()) cancel(); this.#deadlineCancels.clear();
    await this.#link.stop(); await Promise.allSettled([...this.#work]); await this.#refreshTail;
  }
}
