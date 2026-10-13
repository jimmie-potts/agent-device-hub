import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {ModuleContext, TraceContext} from '@jimmie-potts/sdk';
import {BOUNDS, GESTURE_PRESETS, type Led, type LinkRequest, type LinkResult, type LinkState} from './contracts.js';
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
  #endStep: (() => void) | undefined;
  #after = (ms: number, run: () => void): (() => void) => {const timer = setTimeout(run, ms); return () => {clearTimeout(timer);};};
  start(id: string, context: ModuleContext, changed: () => void): void {this.#after = (ms, run) => context.scheduler.after(ms, run); this.attach(id, () => context.clock.now(), changed);}
  attach(id: string, now: () => number, changed: () => void): void {this.#clearReference(); this.#link.id = id; this.#now = now; if (this.#link.changedAtMs === 0) this.#link.changedAtMs = now(); this.#changed = changed; changed();}
  #clearReference(): void {const {forwardReference: _reference, ...state} = this.#link; this.#link = state;}
  state(): LinkState {return {...this.#link};}
  results(): LinkResult[] {return [...this.#results.values()];}
  live(): boolean {return this.#online;}
  snapshot(): SimulatedState {return {link: this.state(), operations: [...this.#operations], online: this.#online, ...(this.#led === undefined ? {} : {led: this.#led})};}
  next(result: 'failed' | 'uncertain'): void {this.#next = result;}
  online(value: boolean): void {this.#online = value; if (!value) {this.#clearReference(); this.#endStep?.();} if (!value) this.#link = {...this.#link, connection: 'unavailable', connectionGeneration: this.#link.connectionGeneration + 1, revision: this.#link.revision + 1, changedAtMs: this.#now()}; this.#changed();}
  async execute(request: LinkRequest, _parent: TraceContext, signal: AbortSignal): Promise<LinkAdmission> {
    const refused = (code: 'unavailable' | 'revision-conflict' | 'expired' | 'duplicate-conflict' | 'capacity' | 'invalid-state'): LinkAdmission => ({status: 'rejected', error: errorBody(code, {detail: 'simulated BB-8 helper refused work'})});
    if (!this.#online || signal.aborted) return refused('unavailable');
    if (this.#seen.has(request.operationId)) return refused('duplicate-conflict');
    if (this.#results.size >= BOUNDS.maxResults) return refused('capacity');
    if (request.operationExpiresAtMs <= this.#now()) return refused('expired');
    if (request.expectedConfigurationRevision !== this.#link.configurationRevision || request.expectedHelperEpoch !== this.#link.helperEpoch || request.expectedConnectionGeneration !== this.#link.connectionGeneration) return refused('revision-conflict');
    if (request.operation.kind !== 'connect' && request.operation.kind !== 'disconnect' && this.#link.connection !== 'connected') return refused('unavailable');
    if (request.operation.kind === 'gesture' && this.#endStep !== undefined) return refused('invalid-state');
    if (request.operation.kind === 'step' && (this.#endStep !== undefined || this.#link.forwardReference === undefined || request.operation.forwardReference !== this.#link.forwardReference)) return refused('invalid-state');
    let failure = this.#next; this.#next = undefined;
    this.#seen.add(request.operationId); this.#operations.push({id: request.operationId, kind: request.operation.kind});
    if (request.operation.kind === 'connect' || request.operation.kind === 'disconnect') this.#link = {...this.#link, connection: request.operation.kind === 'connect' ? 'connected' : 'disconnected', connectionGeneration: this.#link.connectionGeneration + 1};
    if (['connect', 'disconnect', 'wake', 'aim', 'stop', 'gesture'].includes(request.operation.kind)) this.#clearReference();
    if (request.operation.kind === 'aim' && request.operation.action === 'set' && failure === undefined) this.#link.forwardReference = crypto.randomUUID();
    if (request.operation.kind === 'stop') this.#endStep?.();
    if (request.operation.kind === 'step' || request.operation.kind === 'gesture') {
      let interrupted = true;
      await new Promise<void>(resolve => {
        const cancel = this.#after(request.operation.kind === 'step' ? request.operation.durationMs : request.operation.kind === 'gesture' ? GESTURE_PRESETS[request.operation.gesture].durationMs * GESTURE_PRESETS[request.operation.gesture].headings.length : 0, () => {interrupted = false; resolve();});
        this.#endStep = () => {cancel(); resolve();};
      });
      this.#endStep = undefined;
      if (interrupted) failure = 'uncertain';
      if (failure !== undefined) this.#clearReference();
    }
    if (failure !== 'failed' && request.operation.kind === 'led-set') this.#led = request.operation.led;
    this.#link = {...this.#link, ...(failure === undefined || request.operation.kind === 'step' || request.operation.kind === 'gesture' ? {} : {connection: 'unavailable'}), revision: this.#link.revision + 1, changedAtMs: this.#now()};
    const observation = request.operation.kind === 'power-refresh' ? {power: {recordVersion: 1 as const, category: 1 as const, voltageHundredths: 420, rechargeCount: 5, secondsAwakeSinceRecharge: 100, observedAtMs: this.#now()}} : request.operation.kind === 'connect' ? {version: {bytes: [1, 2, 3, 4, 5, 6, 7, 8] as [number, number, number, number, number, number, number, number], observedAtMs: this.#now()}} : {};
    this.#results.set(request.operationId, {id: request.operationId, revision: this.#link.revision, robotId: this.#link.id, parentRequestId: request.parentRequestId, requestId: request.operationId, helperEpoch: this.#link.helperEpoch, connectionGeneration: this.#link.connectionGeneration, result: failure ?? 'succeeded', ...(failure === undefined ? {} : {error: errorBody(failure === 'uncertain' ? 'uncertain-result' : 'unavailable').error}), evidence: failure !== undefined ? 'none' : request.operation.kind === 'connect' || request.operation.kind === 'power-refresh' ? 'observed' : 'transmitted', completedAtMs: this.#now(), ...(failure === undefined ? observation : {})});
    await Promise.resolve(); this.#changed(); return {status: 'accepted'};
  }
  async recorded(id: string, _parent: TraceContext): Promise<void> {this.#results.delete(id); await Promise.resolve(); this.#changed();}
  async stop(): Promise<void> {this.#endStep?.(); this.#clearReference(); this.#changed = () => {}; await Promise.resolve();}
}
