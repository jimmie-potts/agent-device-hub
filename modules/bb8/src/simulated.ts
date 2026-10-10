import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {ModuleContext, TraceContext} from '@jimmie-potts/sdk';
import {BOUNDS, type Led, type LinkRequest, type LinkResult, type LinkState} from './contracts.js';
import type {LinkAdmission, LinkPort} from './transport.js';
export type SimulatedState = {link: LinkState; operations: {id: string; kind: string}[]; led?: Led; online: boolean};
/** Catalog stand-in for the helper contract. Actual PacketV1/GATT is verified independently in helper integration tests. */
export class SimulatedLink implements LinkPort {
  #link: LinkState = {id: 'bb8', revision: 0, configurationRevision: 0, helperEpoch: 'simulated-helper', connectionGeneration: 0, connection: 'disconnected', changedAtMs: 0};
  #results = new Map<string, LinkResult>();
  #seen = new Set<string>();
  #operations: {id: string; kind: string}[] = [];
  #led: Led | undefined;
  #online = true;
  #next: 'failed' | 'uncertain' | undefined;
  #changed: () => void = () => {};
  #now = (): number => 0;
  start(id: string, context: ModuleContext, changed: () => void): void {this.attach(id, () => context.clock.now(), changed);}
  attach(id: string, now: () => number, changed: () => void): void {this.#link.id = id; this.#now = now; if (this.#link.changedAtMs === 0) this.#link.changedAtMs = now(); this.#changed = changed; changed();}
  state(): LinkState {return {...this.#link};}
  results(): LinkResult[] {return [...this.#results.values()];}
  live(): boolean {return this.#online;}
  snapshot(): SimulatedState {return {link: this.state(), operations: [...this.#operations], online: this.#online, ...(this.#led === undefined ? {} : {led: this.#led})};}
  next(result: 'failed' | 'uncertain'): void {this.#next = result;}
  online(value: boolean): void {this.#online = value; if (!value) this.#link = {...this.#link, connection: 'unavailable', connectionGeneration: this.#link.connectionGeneration + 1, revision: this.#link.revision + 1, changedAtMs: this.#now()}; this.#changed();}
  async execute(request: LinkRequest, _parent: TraceContext, signal: AbortSignal): Promise<LinkAdmission> {
    const refused = (code: 'unavailable' | 'revision-conflict' | 'expired' | 'duplicate-conflict' | 'capacity'): LinkAdmission => ({status: 'rejected', error: errorBody(code, {detail: 'simulated BB-8 helper refused work'})});
    if (!this.#online || signal.aborted) return refused('unavailable');
    if (this.#seen.has(request.operationId)) return refused('duplicate-conflict');
    if (this.#results.size >= BOUNDS.maxResults) return refused('capacity');
    if (request.operationExpiresAtMs <= this.#now()) return refused('expired');
    if (request.expectedConfigurationRevision !== this.#link.configurationRevision || request.expectedHelperEpoch !== this.#link.helperEpoch || request.expectedConnectionGeneration !== this.#link.connectionGeneration) return refused('revision-conflict');
    if (request.operation.kind !== 'connect' && request.operation.kind !== 'disconnect' && this.#link.connection !== 'connected') return refused('unavailable');
    const failure = this.#next; this.#next = undefined;
    this.#seen.add(request.operationId); this.#operations.push({id: request.operationId, kind: request.operation.kind});
    if (request.operation.kind === 'connect' || request.operation.kind === 'disconnect') this.#link = {...this.#link, connection: request.operation.kind === 'connect' ? 'connected' : 'disconnected', connectionGeneration: this.#link.connectionGeneration + 1};
    if (failure !== 'failed' && request.operation.kind === 'led-set') this.#led = request.operation.led;
    this.#link = {...this.#link, ...(failure === undefined ? {} : {connection: 'unavailable'}), revision: this.#link.revision + 1, changedAtMs: this.#now()};
    const observation = request.operation.kind === 'power-refresh' ? {power: {recordVersion: 1 as const, category: 2 as const, voltageHundredths: 420, rechargeCount: 5, secondsAwakeSinceRecharge: 100, observedAtMs: this.#now()}} : request.operation.kind === 'connect' ? {version: {bytes: [1, 2, 3, 4, 5, 6, 7, 8] as [number, number, number, number, number, number, number, number], observedAtMs: this.#now()}} : {};
    this.#results.set(request.operationId, {id: request.operationId, revision: this.#link.revision, robotId: this.#link.id, parentRequestId: request.parentRequestId, requestId: request.operationId, helperEpoch: this.#link.helperEpoch, connectionGeneration: this.#link.connectionGeneration, result: failure ?? 'succeeded', ...(failure === undefined ? {} : {error: errorBody(failure === 'uncertain' ? 'uncertain-result' : 'unavailable').error}), evidence: failure !== undefined ? 'none' : request.operation.kind === 'connect' || request.operation.kind === 'power-refresh' ? 'observed' : 'transmitted', completedAtMs: this.#now(), ...(failure === undefined ? observation : {})});
    await Promise.resolve(); this.#changed(); return {status: 'accepted'};
  }
  async recorded(id: string, _parent: TraceContext): Promise<void> {this.#results.delete(id); await Promise.resolve(); this.#changed();}
  async stop(): Promise<void> {this.#changed = () => {}; await Promise.resolve();}
}
