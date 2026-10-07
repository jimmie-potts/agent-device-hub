// The client side of the remote transport (Hub #883): the same SDK calls, carried to an edge over SSE and HTTP. The
// client builds every message itself, so the edge injects it unchanged. Subscriptions, responders and sync owners
// live on one event stream; after a lost stream the client reconnects, registers them again and tells every
// subscription of the gap, so a sync copy resyncs. Nothing is replayed.
import {randomUUID} from 'node:crypto';
import {MAX_DETAIL, SCHEMA_BASE, errorBody, type ErrorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {reporter, warnSafely, type OnDiagnostic} from './diagnostics.js';
import {buildMessage} from './envelope.js';
import type {ErrorScope} from './in-process.js';
import {DeliveryQueue} from './queue.js';
import {refusalOf, replyOf} from './refusal.js';
import {EventStreamParser, REMOTE_PATH, REMOTE_SCHEMA, SOURCE_HEADER} from './remote-protocol.js';
import {parseKey} from './routing.js';
import {
  SdkError, type Command, type CommandDraft, type Draft, type Handler, type Overflow, type Reply, type RequestOptions, type RequestResult,
  MAX_TIMEOUT_MS, type Cancel, type Participant, type Responder, type Scheduler, type SendOptions, type SubscribeOptions, type Subscription,
} from './sdk.js';
import {startSync, type OutgoingSync, type Snapshot, type SyncAnswer, type SyncHandler, type SyncOptions, type SyncProvider, type SyncRequest} from './sync.js';
import {childOf, traceIdOf} from './trace.js';

export type RemoteOptions = {
  /** The edge's base URL, such as `http://127.0.0.1:8790`. */
  url: string;
  source: string;
  /** The bearer token the edge granted this source. It is sent only in the `authorization` header. */
  token: string;
  now?: () => number;
  /** How many messages may wait in one subscription's or responder's queue on this side. Defaults to 1024. */
  maxQueued?: number;
  /** Receives handler errors and dropped deliveries. Defaults to a `BunnySdkWarning` that never quotes the error's message. */
  onError?: (error: unknown, scope: ErrorScope) => void;
  /**
   * Hears the client's own decisions: `remote.disconnected` once when the stream is lost, and `remote.reconnected` with
   * the count of failed attempts when it is back, instead of each failed attempt; `remote.command.uncertain` when the
   * client settles a request `uncertain-result` itself, because the edge failed, went silent or the requester closed;
   * and `sync.restarted` when an overflow restarts a copy. A no-op by default; a throw is ignored.
   */
  onDiagnostic?: OnDiagnostic;
  /** How long to wait before reconnecting a lost stream. Defaults to 100 ms, doubling up to 5 s. */
  reconnectDelayMs?: number;
  /** Runs request and sync deadlines and reconnect delays. Defaults to the global `setTimeout`. */
  scheduler?: Scheduler;
  /**
   * How long the stream may stay silent before the client takes it as lost and reconnects, so that its copies sync
   * again (Hub #835). The edge writes a heartbeat every 15 s, so a live stream is never silent that long. Defaults to
   * 45 s.
   */
  idleMs?: number;
  /** Runs the idle limit. It concerns a real socket, so it defaults to the global `setTimeout`, whatever `scheduler` is. */
  liveness?: Scheduler;
};

/**
 * A remote participant: the SDK calls, and `close`, which ends its stream and closes everything it opened, its sync
 * copies included. A first sync still under way resolves `cancelled`, and its request is withdrawn at the edge.
 */
export type RemoteParticipant = Participant;
const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};
/** Real timers that never keep the process alive, for the liveness of the real stream. */
const realTimers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs).unref();
  return () => { clearTimeout(timer); };
}};

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_RECONNECT_DELAY_MS = 5000;
/** How long a stream may stay silent before the client reconnects: three of the edge's heartbeats (Hub #835). */
export const IDLE_MS = 45_000;
/**
 * How long past its deadline a remote requester waits for the edge's answer. The edge answers when its bus settles,
 * at the deadline, so this only decides when the edge cannot be heard.
 */
export const REQUESTER_GRACE_MS = 1000;
const SYNC_REQUEST = `${SCHEMA_BASE}sync-request/2.0`;
const body = (code: ErrorCode, detail: string, ids: {requestId?: string; traceId?: string} = {}): ErrorBody =>
  errorBody(code, {...ids, detail: detail.slice(0, MAX_DETAIL)});
const invalid = (detail: string): SdkError => new SdkError(body('invalid-request', detail));
type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields => typeof value === 'object' && value !== null ? value as Fields : {};

/** An edge's refusal as the shared error body, or `unavailable` when the edge could not be reached. */
function bodyOf(error: unknown): ErrorBody {
  if (error instanceof SdkError) return error.body;
  return body('unavailable', 'the edge could not be reached');
}

/** The request or sync answer when the edge refused the call itself, naming the request and its trace. */
const named = (refused: ErrorBody, ids: {requestId: string; traceId: string}): ErrorBody => ({error: {...refused.error, ...ids}});

type Item = {message: Message; key?: string} | {gap: Overflow};
/** `ready` holds a gap notice back until the subscription is registered again after a reconnect. */
type Local = {
  pattern: string; queue: DeliveryQueue<Item>; dropped: number; unknownGap: boolean; ready: Promise<void>;
  /** The subscription's own filter, on the routing key the edge says it delivered on. */
  accept?: (key: string) => boolean;
};
type Answering<T> = {queue: DeliveryQueue<Message<T>>; register: (connection: string) => Promise<unknown>};

class RemoteClient {
  readonly #base: string;
  readonly #source: string;
  readonly #token: string;
  readonly #now: () => number;
  readonly #maxQueued: number;
  readonly #onError: (error: unknown, scope: ErrorScope) => void;
  readonly #diagnose: OnDiagnostic;
  readonly #firstDelayMs: number;
  readonly #idleMs: number;
  readonly #liveness: Scheduler;
  #delayMs: number;
  #closed = false;
  #closing: Promise<void> | undefined;
  #stream: AbortController | undefined;
  /** Cancels the reconnect backoff, and wakes its wait, when the participant closes. */
  #backoff: {cancel: Cancel; wake: () => void} | undefined;
  /** Abandons each request still waiting for the edge's answer. */
  readonly #requests = new Set<AbortController>();
  /** The current connection's id; while the stream is lost, a promise of the next one. */
  #connected: Promise<string> = Promise.resolve('');
  readonly #subscriptions = new Map<string, Local>();
  readonly #answering = new Map<string, Answering<object>>();
  /** Sync copies, which close with the participant. */
  readonly #copies = new Set<Subscription>();
  readonly #scheduler: Scheduler;

  constructor(options: RemoteOptions) {
    this.#base = `${options.url.replace(/\/$/, '')}${REMOTE_PATH}`;
    this.#source = options.source;
    this.#token = options.token;
    this.#now = options.now ?? (() => Date.now());
    this.#maxQueued = options.maxQueued ?? 1024;
    if (!Number.isSafeInteger(this.#maxQueued) || this.#maxQueued < 1) throw new RangeError('maxQueued must be a positive integer');
    this.#onError = options.onError ?? warnSafely;
    this.#diagnose = reporter(options.onDiagnostic);
    this.#scheduler = options.scheduler ?? timers;
    this.#firstDelayMs = options.reconnectDelayMs ?? 100;
    this.#delayMs = this.#firstDelayMs;
    this.#idleMs = options.idleMs ?? IDLE_MS;
    this.#liveness = options.liveness ?? realTimers;
    if (!Number.isSafeInteger(this.#idleMs) || this.#idleMs < 1 || this.#idleMs > MAX_TIMEOUT_MS) throw new RangeError(`idleMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }

  async start(): Promise<RemoteParticipant> {
    this.#connected = Promise.resolve(await this.#open());
    const source = this.#source;
    return {
      source,
      publish: <T extends object>(key: string, draft: Draft<T>, options: SendOptions = {}) =>
        this.#publish(key, buildMessage(source, draft.kind, draft, childOf(options.parent), this.#now())),
      publishMessage: <T extends object>(key: string, message: Message<T>) => this.#publish(key, message),
      subscribe: <T extends object>(pattern: string, handler: Handler<T>, options: SubscribeOptions = {}) =>
        this.#subscribe(pattern, handler as Handler<Record<string, unknown>>, options),
      request: <T extends object>(key: string, draft: CommandDraft<T>, options: RequestOptions) => this.#request(key, draft, options),
      respond: <T extends object>(pattern: string, responder: Responder<T>) =>
        this.#answer<T>('respond', {pattern}, `respond ${pattern}`, (command, id) => this.#reply(command as Command<T>, responder, id)),
      sync: async <T extends object>(families: readonly string[], handler: SyncHandler<T>, options: SyncOptions) => {
        this.#live();
        return startSync<T>({
          now: this.#now,
          subscribe: (pattern, deliver, subscribeOptions) => this.#subscribe(pattern, deliver, subscribeOptions),
          request: outgoing => this.#syncRequest(outgoing),
          report: error => { this.#report(error, `sync ${families.join(',')}`); },
          restarted: () => { this.#diagnose({event: 'sync.restarted', level: 'debug', source, pattern: `sync ${families.join(',')}`}); },
          track: copy => {
            this.#copies.add(copy);
            return () => { this.#copies.delete(copy); };
          },
        }, families, handler, options);
      },
      serveSync: (families: readonly string[], provider: SyncProvider) => this.#answer<SyncRequest>('serve', {families: [...families]}, `sync ${families.join(',')}`, (request, id) => this.#serve(request, provider, id)),
      close: () => this.#close(),
    };
  }

  // The stream.

  /** Opens one stream and resolves with its connection id once the edge says it is ready. */
  #open(): Promise<string> {
    const controller = new AbortController();
    this.#stream = controller;
    return new Promise<string>((resolve, reject) => {
      let ready = false;
      // A stream that stays silent past `idleMs`, heartbeats included, is lost without a close, as when the runtime's
      // host slept: the client ends it and reconnects.
      let idle: Cancel = () => {};
      const watch = (): void => {
        idle();
        idle = this.#liveness.after(this.#idleMs, () => { controller.abort(); });
      };
      void (async () => {
        try {
          const response = await fetch(`${this.#base}/stream`, {headers: this.#headers(), signal: controller.signal});
          if (!response.ok || response.body === null) {
            reject(new SdkError(await this.#refusal(response)));
            return;
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          const parser = new EventStreamParser();
          for (;;) {
            watch();
            const {value, done} = await reader.read();
            if (done) break;
            for (const {event, data} of parser.push(decoder.decode(value, {stream: true}))) {
              const frame = fields(JSON.parse(data));
              if (event === 'ready' && typeof frame.connection === 'string') {
                ready = true;
                resolve(frame.connection);
              } else {
                this.#receive(event, frame);
              }
            }
          }
        } catch (error) {
          if (!ready) reject(new SdkError(bodyOf(error)));
        }
        idle();
        if (!ready) reject(new SdkError(body('unavailable', 'the stream ended before it was ready')));
        else this.#lost(controller);
      })();
    });
  }

  #receive(event: string, frame: Fields): void {
    switch (event) {
      case 'message': {
        const local = this.#subscriptions.get(String(frame.subscription));
        const message = frame.message as Message;
        // A subscription that declines the key never queues the message, as in process.
        if (local?.accept !== undefined && (typeof frame.key !== 'string' || !local.accept(frame.key))) return;
        if (local !== undefined && !local.queue.push({message, ...(typeof frame.key === 'string' ? {key: frame.key} : {})})) {
          local.dropped += 1;
          this.#report(new SdkError(body('capacity', `dropped ${String(message.id)} on ${local.pattern}: the delivery queue is full`)), local.pattern);
        }
        return;
      }
      case 'overflow': {
        const dropped = typeof frame.dropped === 'number' ? frame.dropped : undefined;
        this.#gap(String(frame.subscription), dropped === undefined ? {} : {dropped});
        return;
      }
      case 'command':
        this.#answering.get(String(frame.responder))?.queue.push(frame.command as Message<object>);
        return;
      case 'sync-request':
        this.#answering.get(String(frame.server))?.queue.push(frame.request as Message<object>);
        return;
      default:
        return;
    }
  }

  /** Tells one subscription of a gap, in its own order; a full queue folds the gap into the next notice. */
  #gap(id: string, gap: Overflow): void {
    const local = this.#subscriptions.get(id);
    if (local === undefined || local.queue.push({gap})) return;
    if (gap.dropped === undefined) local.unknownGap = true;
    else local.dropped += gap.dropped;
  }

  /** A lost stream: reconnect, register again, then tell every subscription of the gap. Nothing is replayed. */
  #lost(controller: AbortController): void {
    if (this.#closed || controller !== this.#stream) return;
    this.#diagnose({event: 'remote.disconnected', level: 'warn', source: this.#source});
    this.#connected = this.#reconnect();
    this.#connected.catch(() => {});
  }

  /**
   * Reconnects with capped backoff until the stream is back or the participant closes. Failed attempts are expected
   * while the edge is away, so they are counted and reported once, with the recovery, not each as an error.
   */
  async #reconnect(): Promise<string> {
    let attempts = 0;
    for (;;) {
      await new Promise<void>(resolve => {
        this.#backoff = {cancel: this.#scheduler.after(this.#delayMs, resolve), wake: resolve};
      });
      this.#backoff = undefined;
      if (this.#closed) throw new SdkError(body('invalid-state', `${this.#source} is closed`));
      try {
        const connection = await this.#open();
        // Every subscription hears of the gap before any message of the new stream, but only once all of them are
        // registered again, so a sync copy that resyncs on it never asks before its subscriptions exist.
        let registered = (): void => {};
        const ready = new Promise<void>(resolve => { registered = resolve; });
        for (const [id, local] of this.#subscriptions) {
          local.ready = ready;
          this.#gap(id, {});
        }
        try {
          // One registration that fails is reported, so it cannot keep the others from reconnecting.
          for (const [id, local] of this.#subscriptions) {
            await this.#post('subscribe', {connection, id, pattern: local.pattern}).catch((error: unknown) => { this.#report(error, local.pattern); });
          }
          for (const [id, answering] of this.#answering) await answering.register(connection).catch((error: unknown) => { this.#report(error, id); });
        } finally {
          registered();
        }
        this.#delayMs = this.#firstDelayMs;
        this.#diagnose({event: 'remote.reconnected', level: 'info', source: this.#source, attempts});
        return connection;
      } catch {
        attempts += 1;
        this.#delayMs = Math.min(this.#delayMs * 2, MAX_RECONNECT_DELAY_MS);
      }
    }
  }

  // The calls.

  async #publish<T extends object>(key: string, message: Message<T>): Promise<Message<T>> {
    this.#live();
    try {
      await this.#post('publish', {key, message});
    } catch (error) {
      throw new SdkError(bodyOf(error));
    }
    return message;
  }

  async #subscribe(pattern: string, handler: Handler<Record<string, unknown>>, {onOverflow, accept}: SubscribeOptions): Promise<Subscription> {
    this.#live();
    const connection = await this.#connected;
    const id = randomUUID();
    const run = async (call: () => void | Promise<void>): Promise<void> => {
      try {
        await call();
      } catch (error) {
        this.#report(error, pattern);
      }
    };
    const local: Local = {pattern, dropped: 0, unknownGap: false, ready: Promise.resolve(), ...(accept === undefined ? {} : {accept}), queue: new DeliveryQueue<Item>(this.#maxQueued, async item => {
      const notice: Overflow | undefined = local.unknownGap ? {} : local.dropped > 0 ? {dropped: local.dropped} : undefined;
      local.dropped = 0;
      local.unknownGap = false;
      if (notice !== undefined && onOverflow !== undefined) {
        await local.ready;
        await run(() => onOverflow(notice));
      }
      if ('message' in item) {
        await run(() => handler(item.message, item.key));
      } else if (onOverflow !== undefined) {
        await local.ready;
        await run(() => onOverflow(item.gap));
      }
    })};
    // Registered before the call, so a message that the stream carries before the reply still finds its handler.
    this.#subscriptions.set(id, local);
    try {
      await this.#post('subscribe', {connection, id, pattern});
    } catch (error) {
      this.#subscriptions.delete(id);
      await local.queue.close();
      this.#forget(id);
      throw new SdkError(bodyOf(error));
    }
    return {close: () => this.#unregister(id, () => local.queue.close(), () => this.#subscriptions.delete(id))};
  }

  /** Registers a responder or sync owner, whose commands or sync requests arrive on the stream. */
  async #answer<T extends object>(
    call: 'respond' | 'serve', what: Fields, scope: string, handle: (message: Message<T>, id: string) => Promise<void>,
  ): Promise<Subscription> {
    this.#live();
    const connection = await this.#connected;
    const id = randomUUID();
    const answering: Answering<object> = {
      register: registered => this.#post(call, {connection: registered, id, ...what}),
      queue: new DeliveryQueue<Message<object>>(this.#maxQueued, async message => {
        // A command or sync request past its expiry is ignored and never answered.
        if (Date.parse(message.expiresat ?? '') <= this.#now()) return;
        try {
          await handle(message as Message<T>, id);
        } catch (error) {
          this.#report(error, scope);
        }
      }),
    };
    this.#answering.set(id, answering);
    try {
      await answering.register(connection);
    } catch (error) {
      this.#answering.delete(id);
      await answering.queue.close();
      this.#forget(id);
      throw new SdkError(bodyOf(error));
    }
    return {close: () => this.#unregister(id, () => answering.queue.close(), () => this.#answering.delete(id))};
  }

  /**
   * Runs the remote responder and sends its answer. A handler that throws, or answers with something other than a
   * valid reply, such as an error body with an unregistered code or the wrong flag, has started and may have acted. It
   * sends `{status: 'uncertain'}`, which the edge settles as `uncertain` with `uncertain-result`, as the bus does in
   * process; never a refusal.
   */
  async #reply<T extends object>(command: Command<T>, responder: Responder<T>, id: string): Promise<void> {
    let reply: Reply | {status: 'uncertain'};
    try {
      const given = replyOf(await responder(command));
      if (given === undefined) throw new TypeError('a responder returned something other than a reply');
      reply = given;
    } catch (error) {
      this.#report(error, `respond ${command.type}`);
      reply = {status: 'uncertain'};
    }
    await this.#post('reply', {connection: await this.#connected, responder: id, command: command.id, requestId: command.data.requestId, reply});
  }

  async #serve(request: Message<SyncRequest>, provider: SyncProvider, id: string): Promise<void> {
    let answer: Snapshot | ErrorBody;
    try {
      answer = await provider(request);
    } catch (error) {
      this.#report(error, `sync ${request.subject}`);
      answer = body('internal', 'the owner could not serve the sync');
    }
    await this.#post('answer', {connection: await this.#connected, server: id, request: request.id, requestId: request.data.requestId, answer});
  }

  async #request<T extends object>(key: string, draft: CommandDraft<T>, options: RequestOptions): Promise<RequestResult> {
    this.#live();
    if (parseKey(key)?.category !== 'cmd') throw invalid('a request needs a bunny.cmd routing key');
    if (!draft.type.endsWith('.requested')) throw invalid('a command type ends in .requested');
    const {timeoutMs} = options;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) throw invalid(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
    const requestId = options.requestId ?? randomUUID();
    if (!ID.test(requestId)) throw invalid('requestId is not an identifier');
    const sentAtMs = this.#now();
    const command = buildMessage(this.#source, 'command', {...draft, data: {...draft.data, requestId}}, childOf(options.parent), sentAtMs, sentAtMs + timeoutMs);
    const ids = {requestId, traceId: traceIdOf(command.traceparent)};
    // The edge answers at the deadline, as the bus settles: expired, uncertain-result or the reply. Only an edge that
    // cannot be heard leaves the requester to decide, after its grace, and then the command's fate is unknown.
    const waitMs = timeoutMs + REQUESTER_GRACE_MS;
    const silent: RequestResult = {status: 'uncertain', requestId, error: body('uncertain-result', `the edge did not answer within ${waitMs} ms`, ids)};
    // A participant that closes abandons the request. The call is dropped, so the edge takes a still-queued command
    // out; whether a handler already had it, the requester cannot know.
    const abandoned: RequestResult = {status: 'uncertain', requestId, error: body('uncertain-result', 'the requester closed before the reply', ids)};
    const abandon = new AbortController();
    this.#requests.add(abandon);
    // The results the client decides itself, rather than passing on the edge's answer or refusal, which the edge and its
    // bus record.
    const own = new Set<RequestResult>([silent, abandoned]);
    try {
      const result = await this.#within<RequestResult>(waitMs, silent, async signal => {
        try {
          return fields(await this.#post('request', {key, command}, signal)).result as RequestResult;
        } catch (error) {
          if (!(error instanceof SdkError)) return silent;
          const {code} = error.body.error;
          // The edge failed. The requester cannot tell whether that was before or after the command reached a handler,
          // so it may have run: uncertain, never a refusal that claims no effect.
          if (code === 'internal' || code === 'uncertain-result') {
            const uncertain: RequestResult = {
              status: 'uncertain', requestId,
              error: code === 'internal' ? body('uncertain-result', 'the edge failed; the command may have run', ids) : named(error.body, ids),
            };
            own.add(uncertain);
            return uncertain;
          }
          return {status: 'rejected', requestId, error: named(error.body, ids)};
        }
      }, {signal: abandon.signal, answer: abandoned});
      if (own.has(result)) {
        this.#diagnose({
          event: 'remote.command.uncertain', level: 'warn', source: this.#source, key, requestId, messageId: command.id, outcome: 'uncertain',
          code: 'uncertain-result', trace: {traceparent: command.traceparent},
        });
      }
      return result;
    } finally {
      this.#requests.delete(abandon);
    }
  }

  #syncRequest({families, requestId, timeoutMs, trace, signal, owner}: OutgoingSync): Promise<SyncAnswer> {
    const sentAtMs = this.#now();
    const request = buildMessage(this.#source, 'sync-request', {
      type: 'org.bunny.sync.requested', subject: families.join(','), dataschema: SYNC_REQUEST, data: {requestId, families: [...families]},
    }, trace, sentAtMs, sentAtMs + timeoutMs);
    const ids = {requestId, traceId: traceIdOf(trace.traceparent)};
    // A sync changes nothing, so at the deadline it is unavailable on every transport. The edge says so at the
    // deadline; the requester's grace decides only when the edge cannot be heard.
    const waitMs = timeoutMs + REQUESTER_GRACE_MS;
    const silent: SyncAnswer = {status: 'rejected', requestId, error: body('unavailable', `the edge did not answer within ${waitMs} ms`, ids)};
    // A copy that closes withdraws its request: the call is dropped, and the edge takes it out of the owner's queue.
    const withdrawn: SyncAnswer = {status: 'rejected', requestId, error: body('cancelled', 'the requester closed', ids)};
    return this.#within(waitMs, silent, async dropped => {
      try {
        // The owner travels with the call, as a command's routing key does, so the request message stays as it was.
        return fields(await this.#post('sync', {request, ...(owner === undefined ? {} : {owner})}, dropped)).answer as SyncAnswer;
      } catch (error) {
        const refused = bodyOf(error);
        // An edge whose clock is ahead finds the request expired. A sync only reads, so asking again is safe.
        if (refused.error.code === 'expired') {
          return {status: 'rejected', requestId, error: body('unavailable', 'the edge found the sync request expired; the clocks may differ', ids)};
        }
        return {status: 'rejected', requestId, error: named(refused, ids)};
      }
    }, {signal, answer: withdrawn});
  }

  /**
   * Runs one call until `timeoutMs` on the scheduler; at the deadline it drops the call and settles with `late`. When
   * `withdraw.signal` aborts first, it drops the call and settles with `withdraw.answer`.
   */
  async #within<T>(timeoutMs: number, late: T, call: (signal: AbortSignal) => Promise<T>, withdraw?: {signal: AbortSignal; answer: T}): Promise<T> {
    const controller = new AbortController();
    let cancel: Cancel = () => {};
    let stop = (): void => {};
    const ended = new Promise<T>(resolve => {
      cancel = this.#scheduler.after(timeoutMs, () => { resolve(late); });
      if (withdraw === undefined) return;
      const withdrawn = (): void => { resolve(withdraw.answer); };
      if (withdraw.signal.aborted) withdrawn();
      withdraw.signal.addEventListener('abort', withdrawn);
      stop = () => { withdraw.signal.removeEventListener('abort', withdrawn); };
    });
    try {
      return await Promise.race([ended, call(controller.signal)]);
    } finally {
      cancel();
      stop();
      controller.abort();
    }
  }

  async #unregister(id: string, close: () => Promise<void>, forget: () => void): Promise<void> {
    forget();
    const closing = close();
    const connection = await this.#connected.catch(() => '');
    if (!this.#closed && connection !== '') await this.#post('close', {connection, id}).catch(() => {});
    await closing;
  }

  /** Forgets an id at the edge after a failed registration, in case a reconnect registered it meanwhile. */
  #forget(id: string): void {
    void this.#connected.then(connection => this.#post('close', {connection, id})).catch(() => {});
  }

  #close(): Promise<void> {
    return this.#closing ??= this.#shutdown();
  }

  async #shutdown(): Promise<void> {
    this.#closed = true;
    this.#backoff?.cancel();
    this.#backoff?.wake();
    // Requests waiting for the edge settle at once; their calls are dropped and their deadlines cancelled.
    for (const abandon of [...this.#requests]) abandon.abort();
    // Copies first: each settles its first sync as cancelled and withdraws its request before the stream goes.
    const copies = [...this.#copies].map(copy => copy.close());
    this.#copies.clear();
    await Promise.all(copies);
    this.#stream?.abort();
    const queues = [...[...this.#subscriptions.values()].map(local => local.queue), ...[...this.#answering.values()].map(answering => answering.queue)];
    this.#subscriptions.clear();
    this.#answering.clear();
    await Promise.all(queues.map(queue => queue.close()));
  }

  #live(): void {
    if (this.#closed) throw new SdkError(body('invalid-state', `${this.#source} is closed`));
  }

  /** Every call names the source the part acts as, so that the edge refuses a token used under another one at once. */
  #headers(): Record<string, string> {
    return {authorization: `Bearer ${this.#token}`, 'content-type': 'application/json', [SOURCE_HEADER]: this.#source};
  }

  /** One call to the edge. An edge refusal throws `SdkError` with its error body; a lost connection throws as fetch does. */
  async #post(call: string, payload: Fields, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(`${this.#base}/${call}`, {
      method: 'POST', headers: this.#headers(), body: JSON.stringify({schema: REMOTE_SCHEMA, ...payload}), ...(signal === undefined ? {} : {signal}),
    });
    if (!response.ok) {
      const refused = await this.#refusal(response);
      // The edge no longer knows a connection that was lost meanwhile. Asking again on the next one is safe.
      if (payload.connection !== undefined && refused.error.code === 'not-found') {
        throw new SdkError(body('unavailable', 'the stream was lost; try again once it reconnects'));
      }
      throw new SdkError(refused);
    }
    return await response.json() as unknown;
  }

  /** The edge's refusal, rebuilt; a body with an unregistered code or the wrong flag is not one, and becomes `internal`. */
  async #refusal(response: Response): Promise<ErrorBody> {
    return refusalOf(await response.json().catch(() => ({}))) ?? body('internal', `the edge answered ${response.status}`);
  }

  #report(error: unknown, pattern: string): void {
    try {
      this.#onError(error, {source: this.#source, pattern});
    } catch {
      // The error handler itself failed; there is nowhere left to report it.
    }
  }
}

/** Connects a remote part to its edge. Resolves once the stream is open, or rejects with the edge's refusal. */
export function connectRemote(options: RemoteOptions): Promise<RemoteParticipant> {
  try {
    return new RemoteClient(options).start();
  } catch (error) {
    return Promise.reject(error);
  }
}
