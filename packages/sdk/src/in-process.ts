// The in-process bus (#879): every module in the runtime talks through one of these. Messages pass as plain objects,
// never copied or serialized; schemas are checked in tests and at remote edges, not here (ADR 0012).
import {randomUUID} from 'node:crypto';
import {MAX_DETAIL, errorBody, type ErrorBody, type ErrorCode, type Message, type MessageKind} from '@jimmie-potts/event-contracts/v2';
import {SyncOwners} from './in-process-sync.js';
import {DeliveryQueue} from './queue.js';
import {overlaps, parseKey, parsePattern, type Category, type Pattern} from './routing.js';
import {
  SdkError, type Command, type CommandDraft, type Draft, type Handler, type PublishedKind, type Reply, type RequestOptions,
  type Cancel, type Participant, type RequestResult, type Responder, type Scheduler, type SendOptions, type SubscribeOptions, type Subscription,
  type TraceContext,
} from './sdk.js';
import {startSync, type SyncHandler, type SyncOptions, type SyncProvider} from './sync.js';
import {childOf, traceIdOf} from './trace.js';

/** Which participant and subscription a reported error belongs to. */
export type ErrorScope = {source: string; pattern: string};
export type BusOptions = {
  /** The clock for `time`, `expiresat` and expiry checks, in epoch milliseconds. Defaults to `Date.now()`. */
  now?: () => number;
  /**
   * How many messages may wait in one subscription's or responder's queue. Defaults to 1024. A full subscription
   * queue drops the message for that subscription and reports `capacity` to `onError`; a full responder queue refuses
   * the request with `capacity`.
   */
  maxQueued?: number;
  /** Receives handler errors and dropped deliveries. Defaults to a `BunnySdkWarning` process warning. */
  onError?: (error: unknown, scope: ErrorScope) => void;
  /** Runs request deadlines. Defaults to the global `setTimeout`. The runtime passes the scheduler its modules use. */
  scheduler?: Scheduler;
};

const SOURCE = /^bunny(\/[a-z0-9][a-z0-9-]*)+$/;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const REPLY_SCHEMA = 'https://bunny.invalid/events/reply/2.0';
// setTimeout's longest delay; a longer one would fire at once.
const MAX_TIMEOUT_MS = 2_147_483_647;
/** The shared error body, with `detail` cut to the length the error block allows, since it may quote a caller's key. */
const body = (code: ErrorCode, detail: string, ids: {requestId?: string; traceId?: string} = {}): ErrorBody =>
  errorBody(code, {...ids, detail: detail.slice(0, MAX_DETAIL)});
const invalid = (detail: string): SdkError => new SdkError(body('invalid-request', detail));
const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};

/** State and removal events travel on `bunny.state` keys, occurrences and outcomes on `bunny.event` keys. */
function categoryOf(kind: PublishedKind): Category {
  switch (kind) {
    case 'state':
    case 'removal':
      return 'state';
    case 'occurrence':
    case 'outcome':
      return 'event';
  }
}

const isReply = (value: unknown): value is Reply => typeof value === 'object' && value !== null
  && (('status' in value && value.status === 'accepted') || ('error' in value && typeof value.error === 'object' && value.error !== null));

/** Runs a call so that a thrown refusal becomes a rejected promise, as a remote transport would report it. */
function attempt<T>(call: () => T | Promise<T>): Promise<T> {
  try {
    return Promise.resolve(call());
  } catch (error) {
    return Promise.reject(error);
  }
}

/** `dropped` counts the messages its full queue dropped since the subscriber was last told. */
type Subscriber = {pattern: Pattern; scope: ErrorScope; queue: DeliveryQueue<Message<unknown>>; dropped: number};
type Delivery = {command: Command<object>; expiresAtMs: number; settle: (result: RequestResult) => void};
type Owner = {pattern: Pattern; scope: ErrorScope; queue: DeliveryQueue<Delivery>};
/** What one participant opened, so that its close can undo all of it. */
type Member = {
  source: string; closed: boolean; closing: Promise<void> | undefined; opened: Set<Subscription>;
  /** Abandons each request still waiting for its result. */
  requests: Set<() => void>;
};
type Envelope<T> = {type: string; subject: string; dataschema: string; data: T};

export class InProcessBus {
  readonly #subscribers = new Set<Subscriber>();
  readonly #owners = new Set<Owner>();
  readonly #now: () => number;
  readonly #maxQueued: number;
  readonly #onError: (error: unknown, scope: ErrorScope) => void;
  readonly #scheduler: Scheduler;
  readonly #sync: SyncOwners;

  constructor(options: BusOptions = {}) {
    const maxQueued = options.maxQueued ?? 1024;
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 1) throw new RangeError('maxQueued must be a positive integer');
    this.#now = options.now ?? (() => Date.now());
    this.#maxQueued = maxQueued;
    this.#scheduler = options.scheduler ?? timers;
    this.#onError = options.onError ?? ((error, scope) => {
      // An Error warning prints its own name and message, so they carry the scope; the original is its cause.
      const reason = error instanceof Error ? error.message : 'a non-Error value was thrown';
      const warning = new Error(`${scope.source} on ${scope.pattern}: ${reason}`, {cause: error});
      warning.name = 'BunnySdkWarning';
      process.emitWarning(warning);
    });
    this.#sync = new SyncOwners({
      now: this.#now, maxQueued, report: (error, scope) => { this.#report(error, scope); },
      envelope: (source, kind, draft, trace, deadline) => this.#envelope(source, kind, draft, trace, deadline),
    });
  }

  /**
   * A participant's connection. `source` is its CloudEvents source, such as `bunny/core` or `bunny/modules/pixoo`; a
   * malformed one throws `SdkError` at once. Its `close` closes everything the participant opened.
   */
  connect(source: string): Participant {
    if (!SOURCE.test(source) || source.length > 256) throw invalid(`source ${source}`);
    const member: Member = {source, closed: false, closing: undefined, opened: new Set(), requests: new Set()};
    const open = <T>(call: () => T | Promise<T>): Promise<T> => attempt(() => {
      if (member.closed) throw new SdkError(body('invalid-state', `${source} is closed`));
      return call();
    });
    return {
      source,
      publish: <T extends object>(key: string, draft: Draft<T>, options: SendOptions = {}) =>
        open(() => this.#publish(source, key, draft, options)),
      subscribe: <T extends object>(pattern: string, handler: Handler<T>, options?: SubscribeOptions) =>
        open(() => this.#subscribe(member, pattern, handler, options)),
      request: <T extends object>(key: string, draft: CommandDraft<T>, options: RequestOptions) =>
        open(() => this.#request(member, key, draft, options)),
      respond: <T extends object>(pattern: string, responder: Responder<T>) => open(() => this.#respond(member, pattern, responder)),
      sync: <T extends object>(families: readonly string[], handler: SyncHandler<T>, options: SyncOptions) => open(() => startSync({
        now: this.#now,
        subscribe: (pattern, deliver, subscribeOptions) => attempt(() => this.#subscribe(member, pattern, deliver, subscribeOptions)),
        request: outgoing => this.#sync.request(source, outgoing),
        report: error => { this.#report(error, {source, pattern: `sync ${families.join(',')}`}); },
      }, families, handler, options)),
      serveSync: (families: readonly string[], provider: SyncProvider) => open(() => this.#sync.serve(source, families, provider)),
      close: () => member.closing ??= this.#close(member),
    };
  }

  async #close(member: Member): Promise<void> {
    member.closed = true;
    // Settle the participant's own requests first. A handler of this participant that awaits one can then finish, so
    // the close never waits for another participant's handler.
    for (const abandon of [...member.requests]) abandon();
    await Promise.all([...member.opened].map(subscription => subscription.close()));
  }

  #publish<T extends object>(source: string, key: string, draft: Draft<T>, options: SendOptions): Message<T> {
    const route = parseKey(key);
    if (route === undefined) throw invalid(`routing key ${key}`);
    if (route.category === 'cmd') throw invalid('commands are sent with request');
    if (categoryOf(draft.kind) !== route.category) throw invalid(`a ${String(draft.kind)} message cannot use a bunny.${route.category} key`);
    const message = this.#envelope(source, draft.kind, draft, childOf(options.parent));
    for (const subscriber of this.#subscribers) {
      if (overlaps(subscriber.pattern, route) && !subscriber.queue.push(message)) {
        subscriber.dropped += 1;
        this.#report(new SdkError(body('capacity', `dropped ${message.id} on ${key}: the delivery queue is full`)), subscriber.scope);
      }
    }
    return message;
  }

  #subscribe<T extends object>(member: Member, pattern: string, handler: Handler<T>, {onOverflow}: SubscribeOptions = {}): Subscription {
    const parsed = parsePattern(pattern);
    if (parsed === undefined) throw invalid(`pattern ${pattern}`);
    if (parsed.category === 'cmd') throw invalid('commands go to their one responder; use respond');
    const scope = {source: member.source, pattern};
    const run = async (call: () => void | Promise<void>): Promise<void> => {
      try {
        await call();
      } catch (error) {
        this.#report(error, scope);
      }
    };
    const subscriber: Subscriber = {pattern: parsed, scope, dropped: 0, queue: new DeliveryQueue(this.#maxQueued, async message => {
      // A drop leaves a message waiting, so the subscriber hears of the gap before that message, in its own order.
      const {dropped} = subscriber;
      subscriber.dropped = 0;
      if (dropped > 0 && onOverflow !== undefined) await run(() => onOverflow({dropped}));
      await run(() => handler(message as Message<T>));
    })};
    this.#subscribers.add(subscriber);
    const subscription: Subscription = {close: () => {
      this.#subscribers.delete(subscriber);
      member.opened.delete(subscription);
      return subscriber.queue.close();
    }};
    member.opened.add(subscription);
    return subscription;
  }

  #request<T extends object>(member: Member, key: string, draft: CommandDraft<T>, options: RequestOptions): Promise<RequestResult> {
    const route = parseKey(key);
    if (route?.category !== 'cmd') throw invalid('a request needs a bunny.cmd routing key');
    if (!draft.type.endsWith('.requested')) throw invalid('a command type ends in .requested');
    const {timeoutMs} = options;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) throw invalid(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
    const requestId = options.requestId ?? randomUUID();
    if (!ID.test(requestId)) throw invalid('requestId is not an identifier');
    const sentAtMs = this.#now(), expiresAtMs = sentAtMs + timeoutMs;
    const data = {...draft.data, requestId};
    const command = this.#envelope(member.source, 'command', {...draft, data}, childOf(options.parent), {sentAtMs, expiresAtMs});
    const ids = {requestId, traceId: traceIdOf(command.traceparent)};
    const owner = [...this.#owners].find(candidate => overlaps(candidate.pattern, route));
    if (owner === undefined) {
      return Promise.resolve({status: 'rejected', requestId, error: body('unavailable', `no responder for ${key}`, ids)});
    }
    return new Promise(resolve => {
      let settled = false;
      let cancel: Cancel = () => {};
      const settle = (result: RequestResult): void => {
        if (settled) return;
        settled = true;
        cancel();
        member.requests.delete(abandon);
        resolve(result);
      };
      const delivery: Delivery = {command, expiresAtMs, settle};
      // A command still waiting in the responder's queue never reached its handler, so it is taken out and nothing
      // can have happened. One the handler has may have taken effect, and it is never sent again.
      const end = (unsent: RequestResult, sent: RequestResult): void => { settle(owner.queue.remove(delivery) ? unsent : sent); };
      const abandon = (): void => {
        end({status: 'rejected', requestId, error: body('cancelled', 'the requester closed', ids)},
          {status: 'uncertain', requestId, error: body('uncertain-result', 'the requester closed before the reply', ids)});
      };
      member.requests.add(abandon);
      cancel = this.#scheduler.after(timeoutMs, () => {
        end({status: 'rejected', requestId, error: body('expired', `the responder did not start it within ${timeoutMs} ms`, ids)},
          {status: 'uncertain', requestId, error: body('uncertain-result', `no reply within ${timeoutMs} ms`, ids)});
      });
      if (!owner.queue.push(delivery)) {
        settle({status: 'rejected', requestId, error: body('capacity', 'the responder\'s queue is full', ids)});
      }
    });
  }

  #respond<T extends object>(member: Member, pattern: string, responder: Responder<T>): Subscription {
    const parsed = parsePattern(pattern);
    if (parsed?.category !== 'cmd') throw invalid('respond needs a bunny.cmd pattern');
    for (const other of this.#owners) {
      if (overlaps(other.pattern, parsed)) {
        throw new SdkError(body('invalid-state', `${other.scope.source} already responds to ${other.scope.pattern}`));
      }
    }
    const {source} = member;
    const scope = {source, pattern};
    const owner: Owner = {pattern: parsed, scope, queue: new DeliveryQueue(this.#maxQueued, async ({command, expiresAtMs, settle}) => {
      // A command past its expiry is ignored and never answered. It did not reach the handler, so its requester learns
      // that it expired, unless the deadline already settled the request.
      if (expiresAtMs <= this.#now()) {
        const {requestId} = command.data;
        const ids = {requestId, traceId: traceIdOf(command.traceparent)};
        settle({status: 'rejected', requestId, error: body('expired', 'the command reached the responder after its expiry', ids)});
        return;
      }
      let answer: Reply;
      try {
        answer = await responder(command as Command<T>);
        if (!isReply(answer)) throw new TypeError('a responder returned something other than a reply');
      } catch (error) {
        this.#report(error, scope);
        answer = body('internal', 'the responder failed');
      }
      settle(this.#reply(source, command, answer));
    })};
    this.#owners.add(owner);
    const subscription: Subscription = {close: () => {
      this.#owners.delete(owner);
      member.opened.delete(subscription);
      // Commands still waiting never reached the responder, so their requesters learn that at once.
      return owner.queue.close(({command, settle}) => {
        const {requestId} = command.data;
        settle({status: 'rejected', requestId, error: body('unavailable', 'the responder closed', {requestId, traceId: traceIdOf(command.traceparent)})});
      });
    }};
    member.opened.add(subscription);
    return subscription;
  }

  #reply(source: string, command: Command<object>, answer: Reply): RequestResult {
    const {requestId} = command.data;
    const base = {type: command.type.replace(/\.requested$/, '.replied'), subject: command.subject, dataschema: REPLY_SCHEMA};
    const trace = childOf(command);
    if ('error' in answer) {
      const error: ErrorBody = {error: {...answer.error, requestId, traceId: traceIdOf(trace.traceparent)}};
      const reply = this.#envelope(source, 'reply', {...base, data: {requestId, error: error.error}}, trace);
      return {status: 'rejected', requestId, error, reply};
    }
    const reply = this.#envelope(source, 'reply', {...base, data: {requestId, status: 'accepted' as const}}, trace);
    return {status: 'accepted', requestId, reply};
  }

  #envelope<T>(source: string, kind: MessageKind, draft: Envelope<T>, trace: TraceContext, deadline?: {sentAtMs: number; expiresAtMs: number}): Message<T> {
    return {
      specversion: '1.0', bunnyprofile: '2.0', id: randomUUID(), source, type: draft.type, subject: draft.subject,
      time: new Date(deadline?.sentAtMs ?? this.#now()).toISOString(), kind, datacontenttype: 'application/json',
      dataschema: draft.dataschema, ...trace, ...(deadline === undefined ? {} : {expiresat: new Date(deadline.expiresAtMs).toISOString()}),
      data: draft.data,
    };
  }

  #report(error: unknown, scope: ErrorScope): void {
    try {
      this.#onError(error, scope);
    } catch {
      // The error handler itself failed; there is nowhere left to report it, and delivery must go on.
    }
  }
}
