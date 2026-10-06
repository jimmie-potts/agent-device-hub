// The in-process bus (#879). Stub: the tests below are written first.
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type Sdk} from './sdk.js';

export type ErrorScope = {source: string; pattern: string};
export type BusOptions = {now?: () => number; maxQueued?: number; onError?: (error: unknown, scope: ErrorScope) => void};

const unbuilt = (): Promise<never> => Promise.reject(new SdkError(errorBody('internal', {detail: 'not built yet'})));

export class InProcessBus {
  constructor(_options: BusOptions = {}) {}

  connect(source: string): Sdk {
    return {source, publish: unbuilt, subscribe: unbuilt, request: unbuilt, respond: unbuilt};
  }
}
