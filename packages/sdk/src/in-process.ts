// The in-process bus (#879): every module in the runtime talks through one of these. Messages pass as plain objects,
// never copied or serialized; schemas are checked in tests and at remote edges, not here (ADR 0012).
import {randomUUID} from 'node:crypto';
import {MAX_DETAIL, errorBody, type ErrorBody, type ErrorCode, type Message, type MessageKind} from '@jimmie-potts/event-contracts/v2';
import {reporter, warnSafely, type Diagnostic, type OnDiagnostic} from './diagnostics.js';
import {SyncOwners} from './in-process-sync.js';
import {DeliveryQueue} from './queue.js';
import {replyOf} from './refusal.js';
import {keyClassOf, overlaps, parseKey, parsePattern, type Pattern, type RoutingKey} from './routing.js';
import {
  MAX_TIMEOUT_MS, SdkError, type Command, type CommandDraft, type Draft, type Handler, type PublishedKind, type Reply, type RequestOptions,
  type Cancel, type Participant, type RequestResult, type Responder, type Scheduler, type SendOptions, type SubscribeOptions, type Subscription,
  type TraceContext,
} from './sdk.js';
import {noSpans, startSpan, type Span, type SpanAttributes, type SpanRecorder, type SpanStatus} from './spans.js';
import {startSync, type SyncAnswer, type SyncHandler, type SyncOptions, type SyncProvider, type SyncRequest} from './sync.js';
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
  /**
   * Receives handler errors and dropped deliveries. Defaults to a `BunnySdkWarning` process warning that names the
   * source, the pattern and the error's type, never its message.
   */
  onError?: (error: unknown, scope: ErrorScope) => void;
  /**
   * Hears each decision the bus makes about a command or a sync, once, at its level (ADR 0012, "Observability"). A
   * no-op by default; a throw is ignored and changes nothing.
   */
  onDiagnostic?: OnDiagnostic;
  /** Records each command's request, queue and execute spans. By default nothing is recorded. */
  spans?: SpanRecorder;
  /** Runs request deadlines. Defaults to the global `setTimeout`. The runtime passes the scheduler its modules use. */
  scheduler?: Scheduler;
  /** Hears of each overflow that restarts a copy's sync, with the copy's source and families. */
  onSyncRestart?: (scope: ErrorScope) => void;
};

const SOURCE = /^bunny(\/[a-z0-9][a-z0-9-]*)+$/;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const REPLY_SCHEMA = 'https://bunny.invalid/events/reply/2.0';
/** The shared error body, with `detail` cut to the length the error block allows, since it may quote a caller's key. */
const body = (code: ErrorCode, detail: string, ids: {requestId?: string; traceId?: string} = {}): ErrorBody =>
  errorBody(code, {...ids, detail: detail.slice(0, MAX_DETAIL)});
const invalid = (detail: string): SdkError => new SdkError(body('invalid-request', detail));
const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};

/**
 * What a forwarding responder, such as a remote edge's, may return in place of a reply. `unanswered`: its handler had
 * the command and gave no reply, so the request is `uncertain`, never a refusal. `failed`: its handler had the command
 * and failed, as a local responder that throws does, so the request is `uncertain` too. `undelivered`: the command never
 * reached a handler, so it is refused as `unavailable`, with no reply message. Internal to the SDK; not exported.
 */
export const unanswered: unique symbol = Symbol('unanswered');
export const failed: unique symbol = Symbol('failed');
export const undelivered: unique symbol = Symbol('undelivered');
/** Why a request whose responder threw, or answered with something other than a valid reply, is uncertain. */
const FAILED_DETAIL = 'the responder failed after it started';

/** Whether a message of this kind travels through publish. */
const isPublished = (kind: MessageKind): kind is PublishedKind => keyClassOf(kind) !== undefined;

/** A command span's registered attributes: the requester, the routing key and the request ID. */
const spanFields = (source: string, key: string, requestId: string): SpanAttributes =>
  ({'bunny.participant': source, 'bunny.routing.key': key, 'bunny.request.id': requestId});

/** How the bus records a request's end: the owner's reply, its own refusal or cancellation, or an uncertain result. */
type Decision = Pick<Diagnostic, 'event' | 'level' | 'outcome' | 'code'> & {status: SpanStatus};
function decisionOf(result: RequestResult): Decision {
  switch (result.status) {
    case 'accepted':
      return {event: 'command.replied', level: 'info', outcome: 'accepted', status: 'unset'};
    case 'uncertain':
      return {event: 'command.uncertain', level: 'warn', outcome: 'uncertain', code: result.error.error.code, status: 'error'};
    case 'rejected': {
      const {code} = result.error.error;
      // Only the owner's typed refusal comes with a reply message; it proves no effect, so it is no failure either.
      if (result.reply !== undefined) return {event: 'command.replied', level: 'info', outcome: 'rejected', code, status: 'unset'};
      if (code === 'cancelled') return {event: 'command.cancelled', level: 'info', outcome: 'cancelled', code, status: 'unset'};
      return {event: 'command.refused', level: 'warn', outcome: 'rejected', code, status: 'error'};
    }
  }
}

const foreign = (source: string, message: Message<unknown>): SdkError =>
  new SdkError(body('forbidden', `${source} cannot send a message from ${String(message.source)}`));

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
/** A command on its way to a handler: its routing key, its request span, and its queue span while it waits. */
type Delivery = {
  command: Command<object>; key: string; expiresAtMs: number; settle: (result: RequestResult) => void; request: Span; queue: Span | undefined;
};
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
  readonly #onSyncRestart: (scope: ErrorScope) => void;
  readonly #diagnose: OnDiagnostic;
  readonly #spans: SpanRecorder;

  constructor(options: BusOptions = {}) {
    const maxQueued = options.maxQueued ?? 1024;
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 1) throw new RangeError('maxQueued must be a positive integer');
    this.#now = options.now ?? (() => Date.now());
    this.#maxQueued = maxQueued;
    this.#scheduler = options.scheduler ?? timers;
    this.#onError = options.onError ?? warnSafely;
    this.#onSyncRestart = options.onSyncRestart ?? (() => {});
    this.#diagnose = reporter(options.onDiagnostic);
    this.#spans = options.spans ?? noSpans;
    this.#sync = new SyncOwners({
      now: this.#now, scheduler: this.#scheduler, maxQueued, report: (error, scope) => { this.#report(error, scope); },
      envelope: (source, kind, draft, trace, deadline) => this.#envelope(source, kind, draft, trace, deadline),
      diagnose: this.#diagnose,
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
      publishMessage: <T extends object>(key: string, message: Message<T>) => open(() => this.#publishMessage(source, key, message)),
      subscribe: <T extends object>(pattern: string, handler: Handler<T>, options?: SubscribeOptions) =>
        open(() => this.#subscribe(member, pattern, handler, options)),
      request: <T extends object>(key: string, draft: CommandDraft<T>, options: RequestOptions) =>
        open(() => this.#request(member, key, draft, options)),
      respond: <T extends object>(pattern: string, responder: Responder<T>) => open(() => this.#respond(member, pattern, responder)),
      sync: <T extends object>(families: readonly string[], handler: SyncHandler<T>, options: SyncOptions) => open(() => {
        const scope = {source, pattern: `sync ${families.join(',')}`};
        return startSync({
          now: this.#now,
          // Like the participant's own calls, a copy's subscriptions are refused once the participant has closed.
          subscribe: (pattern, deliver, subscribeOptions) => open(() => this.#subscribe(member, pattern, deliver, subscribeOptions)),
          request: outgoing => this.#sync.request(source, outgoing),
          report: error => { this.#report(error, scope); },
          restarted: () => {
            this.#diagnose({event: 'sync.restarted', level: 'debug', source, pattern: scope.pattern});
            try {
              this.#onSyncRestart(scope);
            } catch {
              // A failing listener must not stop the copy from syncing again.
            }
          },
          track: copy => this.#track(member, copy),
        }, families, handler, options);
      }),
      serveSync: (families: readonly string[], provider: SyncProvider) => open(() => {
        const served = this.#sync.serve(source, families, provider);
        let untrack = (): void => {};
        const subscription: Subscription = {close: () => {
          untrack();
          return served.close();
        }};
        untrack = this.#track(member, subscription);
        return subscription;
      }),
      close: () => member.closing ??= this.#close(member),
    };
  }

  /** Keeps what a participant opened, so that its close closes it; returns what forgets it again. */
  #track(member: Member, opened: Subscription): () => void {
    member.opened.add(opened);
    return () => { member.opened.delete(opened); };
  }

  async #close(member: Member): Promise<void> {
    member.closed = true;
    // Settle the participant's own requests first. A handler of this participant that awaits one can then finish, so
    // the close never waits for another participant's handler.
    for (const abandon of [...member.requests]) abandon();
    await Promise.all([...member.opened].map(subscription => subscription.close()));
  }

  /**
   * Sends a command that a remote part prepared, unchanged, from `source`, and waits `waitMs` for its result. For a
   * remote edge, which has validated the command, and which aborts `signal` when the remote part stops waiting: a
   * command still queued is then taken out, so it never runs.
   */
  requestMessage(source: string, key: string, command: Command<object>, waitMs: number, signal?: AbortSignal): Promise<RequestResult> {
    return attempt(() => {
      const route = parseKey(key);
      if (route?.category !== 'cmd') throw invalid('a request needs a bunny.cmd routing key');
      if (command.source !== source) throw foreign(source, command);
      if (command.kind !== 'command' || !command.type.endsWith('.requested')) throw invalid('a command type ends in .requested');
      const {requestId} = command.data as {requestId?: unknown};
      if (typeof requestId !== 'string' || !ID.test(requestId)) throw invalid('requestId is not an identifier');
      const expiresAtMs = Date.parse(command.expiresat ?? '');
      if (Number.isNaN(expiresAtMs)) throw invalid('a command carries expiresat');
      if (!Number.isSafeInteger(waitMs) || waitMs <= 0 || waitMs > MAX_TIMEOUT_MS) throw invalid(`waitMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
      // The edge authenticated and validated the command, so its context is trusted: the server span continues it.
      const request = startSpan(this.#spans, 'bunny.command.request', {parent: command, kind: 'server', attributes: spanFields(source, key, requestId)});
      return this.#dispatch(undefined, key, route, command, expiresAtMs, waitMs, request, signal);
    });
  }

  /**
   * Sends a sync request that a remote part prepared, unchanged, and waits `waitMs` for its answer. For a remote edge,
   * which aborts `signal` when the remote part stops waiting, so the request is withdrawn.
   */
  syncMessage(source: string, request: Message<SyncRequest>, waitMs: number, signal: AbortSignal): Promise<SyncAnswer> {
    return attempt(() => {
      if (request.source !== source) throw foreign(source, request);
      if (request.kind !== 'sync-request') throw invalid('a sync request has kind sync-request');
      const expiresAtMs = Date.parse(request.expiresat ?? '');
      if (Number.isNaN(expiresAtMs)) throw invalid('a sync request carries expiresat');
      if (!Number.isSafeInteger(waitMs) || waitMs <= 0 || waitMs > MAX_TIMEOUT_MS) throw invalid(`waitMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
      return this.#sync.dispatch(request, expiresAtMs, waitMs, signal);
    });
  }

  #route(key: string, kind: PublishedKind): RoutingKey {
    const route = parseKey(key);
    if (route === undefined) throw invalid(`routing key ${key}`);
    if (route.category === 'cmd') throw invalid('commands are sent with request');
    if (keyClassOf(kind) !== route.category) throw invalid(`a ${String(kind)} message cannot use a bunny.${route.category} key`);
    return route;
  }

  #publish<T extends object>(source: string, key: string, draft: Draft<T>, options: SendOptions): Message<T> {
    const route = this.#route(key, draft.kind);
    const message = this.#envelope(source, draft.kind, draft, childOf(options.parent));
    this.#deliver(key, route, message);
    return message;
  }

  /** A prepared message goes out as it is; only its own source may send it. */
  #publishMessage<T extends object>(source: string, key: string, message: Message<T>): Message<T> {
    if (message.source !== source) throw foreign(source, message);
    if (!isPublished(message.kind)) throw invalid(`a ${message.kind} message is not published`);
    this.#deliver(key, this.#route(key, message.kind), message);
    return message;
  }

  #deliver(key: string, route: RoutingKey, message: Message<unknown>): void {
    for (const subscriber of this.#subscribers) {
      if (overlaps(subscriber.pattern, route) && !subscriber.queue.push(message)) {
        subscriber.dropped += 1;
        this.#report(new SdkError(body('capacity', `dropped ${message.id} on ${key}: the delivery queue is full`)), subscriber.scope);
      }
    }
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
    // The command carries its request span's context, so the owner's spans and records join that span.
    const request = startSpan(this.#spans, 'bunny.command.request', {parent: options.parent, kind: 'client', attributes: spanFields(member.source, key, requestId)});
    const command = this.#envelope(member.source, 'command', {...draft, data}, request.context, {sentAtMs, expiresAtMs});
    return this.#dispatch(member, key, route, command, expiresAtMs, timeoutMs, request);
  }

  /**
   * Hands a command to the responder that owns `route`, and settles at its reply or after `waitMs`. A participant's
   * own requests settle when it closes; a remote edge's have no participant and settle by their wait. The admission and
   * the one settlement are each recorded once, with the command's own trace, and end the request's spans.
   */
  #dispatch(
    member: Member | undefined, key: string, route: RoutingKey, command: Command<object>, expiresAtMs: number, waitMs: number, request: Span,
    signal?: AbortSignal,
  ): Promise<RequestResult> {
    const {requestId} = command.data;
    const ids = {requestId, traceId: traceIdOf(command.traceparent)};
    const facts = {source: command.source, key, requestId, messageId: command.id, trace: {traceparent: command.traceparent}};
    const decided = (result: RequestResult, queue?: Span): RequestResult => {
      const {status, ...decision} = decisionOf(result);
      queue?.end(status);
      request.end(status);
      this.#diagnose({...decision, ...facts});
      return result;
    };
    // Refusals name the command's own deadline, which the remote requester chose, not what was left of it here.
    const timeoutMs = Math.round(expiresAtMs - Date.parse(command.time));
    const owner = [...this.#owners].find(candidate => overlaps(candidate.pattern, route));
    if (owner === undefined) {
      return Promise.resolve(decided({status: 'rejected', requestId, error: body('unavailable', `no responder for ${key}`, ids)}));
    }
    return new Promise(resolve => {
      let settled = false;
      let cancel: Cancel = () => {};
      const settle = (result: RequestResult): void => {
        if (settled) return;
        settled = true;
        cancel();
        member?.requests.delete(abandon);
        signal?.removeEventListener('abort', abandon);
        resolve(decided(result, delivery.queue));
      };
      const delivery: Delivery = {command, key, expiresAtMs, settle, request, queue: undefined};
      // A command still waiting in the responder's queue never reached its handler, so it is taken out and nothing
      // can have happened. One the handler has may have taken effect, and it is never sent again.
      const end = (unsent: RequestResult, sent: RequestResult): void => { settle(owner.queue.remove(delivery) ? unsent : sent); };
      const abandon = (): void => {
        end({status: 'rejected', requestId, error: body('cancelled', 'the requester closed', ids)},
          {status: 'uncertain', requestId, error: body('uncertain-result', 'the requester closed before the reply', ids)});
      };
      member?.requests.add(abandon);
      signal?.addEventListener('abort', abandon);
      cancel = this.#scheduler.after(waitMs, () => {
        end({status: 'rejected', requestId, error: body('expired', `the responder did not start it within ${timeoutMs} ms`, ids)},
          {status: 'uncertain', requestId, error: body('uncertain-result', `no reply within ${timeoutMs} ms`, ids)});
      });
      // A requester that stopped waiting before the command was queued: it never runs.
      if (signal?.aborted === true) {
        settle({status: 'rejected', requestId, error: body('cancelled', 'the requester closed', ids)});
        return;
      }
      if (!owner.queue.push(delivery)) {
        settle({status: 'rejected', requestId, error: body('capacity', 'the responder\'s queue is full', ids)});
        return;
      }
      delivery.queue = startSpan(this.#spans, 'bunny.command.queue', {parent: request.context, attributes: spanFields(command.source, key, requestId)});
      this.#diagnose({event: 'command.admitted', level: 'info', outcome: 'queued', ...facts});
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
    const owner: Owner = {pattern: parsed, scope, queue: new DeliveryQueue(this.#maxQueued, async delivery => {
      const {command, expiresAtMs, settle} = delivery;
      // A command past its expiry is ignored and never answered. It did not reach the handler, so its requester learns
      // that it expired, unless the deadline already settled the request.
      if (expiresAtMs <= this.#now()) {
        const {requestId} = command.data;
        const ids = {requestId, traceId: traceIdOf(command.traceparent)};
        settle({status: 'rejected', requestId, error: body('expired', 'the command reached the responder after its expiry', ids)});
        return;
      }
      const {requestId} = command.data;
      const ids = {requestId, traceId: traceIdOf(command.traceparent)};
      delivery.queue?.end();
      const execute = startSpan(this.#spans, 'bunny.command.execute', {
        parent: delivery.request.context, attributes: spanFields(command.source, delivery.key, requestId),
      });
      // The handler has started, so an exception may come after an effect: the request is uncertain, never a refusal.
      // Only a typed refusal, an error body the responder returns, proves that nothing happened (ADR 0012).
      const uncertain = (detail: string): RequestResult => ({status: 'uncertain', requestId, error: body('uncertain-result', detail, ids)});
      let answer: Reply;
      try {
        const given: unknown = await responder(command as Command<T>);
        if (given === unanswered) {
          execute.end('error');
          settle(uncertain('the responder gave no reply'));
          return;
        }
        if (given === failed) {
          execute.end('error');
          settle(uncertain(FAILED_DETAIL));
          return;
        }
        if (given === undelivered) {
          execute.end('error');
          settle({status: 'rejected', requestId, error: body('unavailable', 'the command never reached the responder', ids)});
          return;
        }
        // A refusal must be a valid error body: one with an unregistered code or a wrong flag claims nothing.
        const reply = replyOf(given);
        if (reply === undefined) throw new TypeError('a responder returned something other than a reply');
        answer = reply;
      } catch (error) {
        execute.end('error');
        this.#report(error, scope);
        settle(uncertain(FAILED_DETAIL));
        return;
      }
      execute.end();
      settle(this.#reply(source, command, answer, execute.context));
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

  /** The reply message to `command`, in the context of the execute span that answered it. */
  #reply(source: string, command: Command<object>, answer: Reply, trace: TraceContext): RequestResult {
    const {requestId} = command.data;
    const base = {type: command.type.replace(/\.requested$/, '.replied'), subject: command.subject, dataschema: REPLY_SCHEMA};
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
