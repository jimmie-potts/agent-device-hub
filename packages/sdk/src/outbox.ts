// The per-module outbox (ADR 0012, "Ownership and publication"). Stub: the tests are written first (#882).
import type {DatabaseSync} from 'node:sqlite';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type Clock, type Draft, type Scheduler, type Sdk, type SendOptions} from './sdk.js';

export type OutboxOptions = {
  sdk: Pick<Sdk, 'source' | 'publishMessage'>;
  database: DatabaseSync;
  clock: Clock;
  scheduler: Scheduler;
  retainMs?: number;
};
export type AddMessage = <T extends object>(key: string, draft: Draft<T>, options?: SendOptions) => Message<T>;

const unbuilt = (): SdkError => new SdkError(errorBody('internal', {detail: 'not built yet'}));

export class Outbox {
  constructor(_options: OutboxOptions) {}

  transaction<R>(_work: (add: AddMessage) => R): Promise<R> {
    return Promise.reject(unbuilt());
  }

  republish(): Promise<void> {
    return Promise.reject(unbuilt());
  }
}
