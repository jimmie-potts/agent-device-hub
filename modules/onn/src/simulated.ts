import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import type {CurrentApp} from './actions.js';
import type {AppObservation, Attempt, OnnAction, OnnTransport} from './transport.js';
/** In-memory device state survives a disposable host restart. It stores no text. */
export class SimulatedOnn implements OnnTransport {
  online = true;
  app: CurrentApp = 'none';
  effects = 0;
  execute(action: OnnAction, signal: AbortSignal, beforeEffect: () => ErrorCode | undefined = () => undefined): Promise<Attempt> {
    signal.throwIfAborted();
    const code = beforeEffect(); if (code !== undefined) return Promise.resolve({result: 'failed', evidence: 'none', code});
    if (!this.online) return Promise.resolve({result: 'failed', evidence: 'none', code: 'unavailable'});
    this.effects += 1;
    if (action.kind === 'app') this.app = action.app;
    if (action.kind === 'key' && action.key === 'home') this.app = 'other';
    return Promise.resolve({result: 'succeeded', evidence: 'transmitted'});
  }
  read(signal: AbortSignal): Promise<AppObservation | undefined> {signal.throwIfAborted(); return Promise.resolve(this.online ? {app: this.app} : undefined);}
  state(): {online: boolean; app: CurrentApp; effects: number} {return {online: this.online, app: this.app, effects: this.effects};}
  act(action: string): void {
    if (action === 'online') this.online = true;
    else if (action === 'offline') this.online = false;
    else if (action === 'physical-youtube') this.app = 'youtube';
    else if (action === 'physical-stremio') this.app = 'stremio';
    else throw new SdkError(errorBody('invalid-request', {detail: 'unknown ONN simulation action'}));
  }
}
