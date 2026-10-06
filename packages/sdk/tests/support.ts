// Shared helpers for the SDK suites. In-process calls never validate; these tests check every message they see against
// profile 2.0 instead (ADR 0012): participants come wrapped by `checked`, and `it` fails a test that saw an invalid one.
import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {
  InProcessBus, type BusOptions, type CommandDraft, type Draft, type ErrorScope, type Handler, type Participant, type RequestOptions,
  type Responder, type Scheduler, type SendOptions, type SubscribeOptions, type SyncHandler, type SyncOptions, type SyncProvider,
} from '../src/index.js';

const invalid: string[] = [];

/**
 * node:test's test(), whose returned promise the runner awaits itself. The timeout makes a delivery that never comes
 * fail the test instead of hanging the run, because the runner's child process never sees an empty event loop.
 */
export function it(name: string, body: (context: TestContext) => void | Promise<void>): void {
  void test(name, {timeout: 10_000}, async context => {
    invalid.length = 0;
    await body(context);
    assert.deepEqual(invalid, [], 'every message the test saw follows profile 2.0');
  });
}

const BASE = 'https://bunny.invalid/events/';
const block = (name: string): object => ({$ref: `${BASE}blocks/2.0#/$defs/${name}`});
const closed = (properties: Record<string, object>): object =>
  ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
// Sync names an entity by its schema family, so the test session state and its removal share `test-session`.
export const SESSION_FAMILY = 'test-session';
export const SESSION_SCHEMA = `${BASE}test-session/2.0`;
export const TURN_SCHEMA = `${BASE}test-turn/2.0`;
export const MODE_SCHEMA = `${BASE}test-mode/2.0`;
const validator = new MessageValidator();
validator.register(SESSION_SCHEMA, closed({id: block('id'), revision: block('revision')}));
validator.register(TURN_SCHEMA, closed({sessionId: block('id')}));
validator.register(MODE_SCHEMA, closed({requestId: block('requestId'), mode: {enum: ['work', 'quiet', 'free']}}));

/** Checks one message against profile 2.0 and its payload schema. */
export function assertValid(message: unknown): void {
  const result = validator.validate(message);
  if (!result.ok) assert.fail(`${result.error.code}: ${result.error.detail ?? ''}`);
}

function check(message: unknown, where: string): void {
  const result = validator.validate(message);
  if (!result.ok) invalid.push(`${where}: ${result.error.code} ${result.error.detail ?? ''}`);
}

/** The participant, with every message it sends or receives checked against profile 2.0 for `it`. */
export function checked(sdk: Participant): Participant {
  return {
    source: sdk.source,
    close: () => sdk.close(),
    publish: async <T extends object>(key: string, draft: Draft<T>, options?: SendOptions) => {
      const message = await sdk.publish(key, draft, options);
      check(message, `published on ${key}`);
      return message;
    },
    subscribe: <T extends object>(pattern: string, handler: Handler<T>, options?: SubscribeOptions) => sdk.subscribe<T>(pattern, message => {
      check(message, `delivered on ${pattern}`);
      return handler(message);
    }, options),
    request: async <T extends object>(key: string, draft: CommandDraft<T>, options: RequestOptions) => {
      const result = await sdk.request(key, draft, options);
      if (result.status !== 'uncertain' && result.reply !== undefined) check(result.reply, `reply on ${key}`);
      return result;
    },
    respond: <T extends object>(pattern: string, responder: Responder<T>) => sdk.respond<T>(pattern, command => {
      check(command, `command on ${pattern}`);
      return responder(command);
    }),
    sync: async <T extends object>(families: readonly string[], handler: SyncHandler<T>, options: SyncOptions) => {
      const result = await sdk.sync<T>(families, change => {
        if (change.type !== 'failed' && change.message !== undefined) check(change.message, `sync change on ${families.join(',')}`);
        return handler(change);
      }, options);
      if (result.status === 'synced') check(result.message, `sync result on ${families.join(',')}`);
      return result;
    },
    serveSync: (families: readonly string[], provider: SyncProvider) => sdk.serveSync(families, request => {
      check(request, `sync request on ${families.join(',')}`);
      return provider(request);
    }),
  };
}

export type Session = {id: string; revision: number};
export type Removal = {entity: {family: string; id: string}; revision: number; reason: 'expired' | 'retired' | 'deleted'};
export type Mode = {mode: 'work' | 'quiet' | 'free'};

export const session = (id: string, revision: number): Draft<Session> =>
  ({kind: 'state', type: 'org.bunny.session.updated', subject: id, dataschema: SESSION_SCHEMA, data: {id, revision}});
export const removed = (id: string, revision: number): Draft<Removal> => ({
  kind: 'removal', type: 'org.bunny.session.removed', subject: id, dataschema: `${BASE}removal/2.0`,
  data: {entity: {family: SESSION_FAMILY, id}, revision, reason: 'expired'},
});
export const turnEnded = (sessionId: string): Draft<{sessionId: string}> =>
  ({kind: 'occurrence', type: 'org.bunny.turn.ended', subject: sessionId, dataschema: TURN_SCHEMA, data: {sessionId}});
export const setMode = (mode: Mode['mode']): CommandDraft<Mode> =>
  ({type: 'org.bunny.mode.set.requested', subject: 'wall', dataschema: MODE_SCHEMA, data: {mode}});
export type Outcome = {requestId: string; result: 'succeeded' | 'failed' | 'uncertain'; evidence: 'transmitted' | 'observed' | 'none'};
export const modeSet = (requestId: string): Draft<Outcome> => ({
  kind: 'outcome', type: 'org.bunny.mode.set.completed', subject: 'wall', dataschema: `${BASE}outcome/2.0`,
  data: {requestId, result: 'succeeded', evidence: 'observed'},
});

/** A bus whose handler errors are collected, with checked core and wall participants. */
export function bus(options: BusOptions = {}): {bus: InProcessBus; core: Participant; wall: Participant; errors: {error: unknown; scope: ErrorScope}[]} {
  const errors: {error: unknown; scope: ErrorScope}[] = [];
  const created = new InProcessBus({onError: (error, scope) => { errors.push({error, scope}); }, ...options});
  return {bus: created, core: checked(created.connect('bunny/core')), wall: checked(created.connect('bunny/wall')), errors};
}

/** Lets every queued delivery run: setImmediate runs after all pending promise callbacks. */
export const flush = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

/** The promise's value if it has settled once pending deliveries ran, or undefined while it is still pending. */
export async function peek<T>(promise: Promise<T>): Promise<T | undefined> {
  const pending = Symbol('pending');
  const value = await Promise.race([promise, flush().then(() => pending)]);
  return value === pending ? undefined : value as T;
}

/** Whether the promise has settled once pending deliveries ran. */
export async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => { done = true; }, () => { done = true; });
  await flush();
  return done;
}

export function deferred<T>(): {promise: Promise<T>; resolve: (value: T) => void} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(settle => { resolve = settle; });
  return {promise, resolve};
}

export const START = Date.parse('2026-10-06T12:00:00.000Z');

/** A clock and scheduler that move only when the test advances them, like a module's clock in the runtime. */
export function manualClock(start = START): {now: () => number; scheduler: Scheduler; advance: (ms: number) => void; pending: () => number} {
  let now = start;
  const timers = new Set<{at: number; callback: () => void}>();
  return {
    now: () => now,
    scheduler: {after: (delayMs, callback) => {
      const timer = {at: now + delayMs, callback};
      timers.add(timer);
      return () => { timers.delete(timer); };
    }},
    advance: ms => {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at > now) break;
        // A callback that ran earlier in this pass may have cancelled this one.
        if (timers.delete(timer)) timer.callback();
      }
    },
    pending: () => timers.size,
  };
}
export const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** The trace id, span id and flags of a version-00 traceparent. */
export function trace(traceparent: string): {traceId: string; spanId: string; flags: string} {
  const match = TRACEPARENT.exec(traceparent);
  assert.ok(match, `traceparent ${traceparent}`);
  const [, traceId = '', spanId = '', flags = ''] = match;
  return {traceId, spanId, flags};
}
