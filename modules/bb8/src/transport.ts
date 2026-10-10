import {randomUUID} from 'node:crypto';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type ModuleContext, type SyncedCopy, type TraceContext} from '@jimmie-potts/sdk';
import {BOUNDS, commandType, HELPER_SOURCE, schemaOf, type LinkRequest, type LinkResult, type LinkState} from './contracts.js';
import {bb8Validator} from './families.js';
export type LinkAdmission = {status: 'accepted'} | {status: 'rejected' | 'uncertain'; error: ErrorBody};
export interface LinkPort {
  start(id: string, context: ModuleContext, changed: () => void): void;
  state(): LinkState | undefined;
  results(): LinkResult[];
  live(): boolean;
  execute(request: LinkRequest, parent: TraceContext, signal: AbortSignal): Promise<LinkAdmission>;
  recorded(id: string, parent: TraceContext): Promise<void>;
  stop(): Promise<void>;
}
/** Remote Windows owner through the existing SDK. Reconnection restores copies, never commands. */
export class SdkLink implements LinkPort {
  #context: ModuleContext | undefined;
  #id = '';
  #changed: () => void = () => {};
  #copy: SyncedCopy<LinkState | LinkResult> | undefined;
  #live = false;
  #stopped = false;
  #cancel: (() => void) | undefined;
  start(id: string, context: ModuleContext, changed: () => void): void {this.#id = id; this.#context = context; this.#changed = changed; void this.#follow();}
  state(): LinkState | undefined {return this.#copy?.get({family: 'bb8-link', id: this.#id})?.data as LinkState | undefined;}
  results(): LinkResult[] {return (this.#copy?.states() ?? []).filter(message => message.dataschema === schemaOf('bb8-link-result') && bb8Validator().validate(message).ok).map(message => message.data as LinkResult);}
  live(): boolean {return this.#live;}
  async #follow(): Promise<void> {
    const context = this.#context; if (context === undefined || this.#stopped) return;
    try {
      const result = await context.sdk.sync<LinkState | LinkResult>(['bb8-link', 'bb8-link-result'], change => {
        if (this.#stopped) return;
        if (change.type === 'failed') {this.#live = false; this.#changed(); this.#retry();}
        else if (change.type === 'synced') {this.#live = true; this.#changed();}
        else this.#changed();
      }, {owner: HELPER_SOURCE, timeoutMs: BOUNDS.responseMs, maxBuffered: 128});
      if (result.status === 'rejected') {this.#live = false; this.#changed(); this.#retry(); return;}
      if (this.#stopped) {await result.copy.close(); return;}
      const previous = this.#copy; this.#copy = result.copy; await previous?.close(); this.#live = true; this.#changed();
    } catch {this.#live = false; this.#changed(); this.#retry();}
  }
  #retry(): void {
    if (this.#stopped || this.#cancel !== undefined) return;
    this.#cancel = this.#context?.scheduler.after(BOUNDS.responseMs, () => {this.#cancel = undefined; void this.#follow();});
  }
  async execute(request: LinkRequest, parent: TraceContext, signal: AbortSignal): Promise<LinkAdmission> {
    if (!this.#live || signal.aborted || this.#context === undefined) return {status: 'rejected', error: errorBody('unavailable', {detail: 'BB-8 helper unavailable'})};
    return this.#context.sdk.request(`bunny.cmd.bb8-link-execute.${this.#id}`, {type: commandType('bb8-link-execute'), subject: this.#id, dataschema: schemaOf('bb8-link-execute'), data: request}, {requestId: request.operationId, timeoutMs: Math.min(BOUNDS.responseMs, Math.max(1, request.operationExpiresAtMs - this.#context.clock.now())), parent});
  }
  async recorded(id: string, parent: TraceContext): Promise<void> {
    if (!this.#live || this.#context === undefined) throw new SdkError(errorBody('unavailable', {detail: 'BB-8 helper unavailable'}));
    const requestId = randomUUID();
    const result = await this.#context.sdk.request(`bunny.cmd.bb8-link-recorded.${this.#id}`, {type: commandType('bb8-link-recorded'), subject: this.#id, dataschema: schemaOf('bb8-link-recorded'), data: {requestId, operationId: id}}, {requestId, timeoutMs: BOUNDS.responseMs, parent});
    if (result.status !== 'accepted') throw new SdkError(result.error);
  }
  async stop(): Promise<void> {this.#stopped = true; this.#cancel?.(); this.#live = false; await this.#copy?.close();}
}
