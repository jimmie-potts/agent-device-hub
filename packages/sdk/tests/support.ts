// Shared helpers for the SDK suites. In-process calls never validate; these tests check every message they see against
// profile 2.0 instead (ADR 0012).
import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, type BusOptions, type CommandDraft, type Draft, type ErrorScope, type Sdk} from '../src/index.js';

/**
 * node:test's test(), whose returned promise the runner awaits itself. The timeout makes a delivery that never comes
 * fail the test instead of hanging the run, because the runner's child process never sees an empty event loop.
 */
export function it(name: string, body: (context: TestContext) => void | Promise<void>): void {
  void test(name, {timeout: 10_000}, body);
}

const BASE = 'https://bunny.invalid/events/';
const block = (name: string): object => ({$ref: `${BASE}blocks/2.0#/$defs/${name}`});
const closed = (properties: Record<string, object>): object =>
  ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
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

export type Session = {id: string; revision: number};
export type Removal = {entity: {family: string; id: string}; revision: number; reason: 'expired' | 'retired' | 'deleted'};
export type Mode = {mode: 'work' | 'quiet' | 'free'};

export const session = (id: string, revision: number): Draft<Session> =>
  ({kind: 'state', type: 'org.bunny.session.updated', subject: id, dataschema: SESSION_SCHEMA, data: {id, revision}});
export const removed = (id: string, revision: number): Draft<Removal> => ({
  kind: 'removal', type: 'org.bunny.session.removed', subject: id, dataschema: `${BASE}removal/2.0`,
  data: {entity: {family: 'session', id}, revision, reason: 'expired'},
});
export const turnEnded = (sessionId: string): Draft<{sessionId: string}> =>
  ({kind: 'occurrence', type: 'org.bunny.turn.ended', subject: sessionId, dataschema: TURN_SCHEMA, data: {sessionId}});
export const setMode = (mode: Mode['mode']): CommandDraft<Mode> =>
  ({type: 'org.bunny.mode.set.requested', subject: 'wall', dataschema: MODE_SCHEMA, data: {mode}});

/** A bus whose handler errors are collected, with a core and a wall participant. */
export function bus(options: BusOptions = {}): {bus: InProcessBus; core: Sdk; wall: Sdk; errors: {error: unknown; scope: ErrorScope}[]} {
  const errors: {error: unknown; scope: ErrorScope}[] = [];
  const created = new InProcessBus({onError: (error, scope) => { errors.push({error, scope}); }, ...options});
  return {bus: created, core: created.connect('bunny/core'), wall: created.connect('bunny/wall'), errors};
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
export const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** The trace id, span id and flags of a version-00 traceparent. */
export function trace(traceparent: string): {traceId: string; spanId: string; flags: string} {
  const match = TRACEPARENT.exec(traceparent);
  assert.ok(match, `traceparent ${traceparent}`);
  const [, traceId = '', spanId = '', flags = ''] = match;
  return {traceId, spanId, flags};
}
