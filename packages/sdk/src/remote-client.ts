// The client side of the remote transport (Hub #883): the same SDK calls, carried to an edge over SSE and HTTP. The
// client builds every message itself, so the edge injects it unchanged. Subscriptions, responders and sync owners
// live on one event stream; after a lost stream the client reconnects, registers them again and tells every
// subscription of the gap, so a sync copy resyncs. Nothing is replayed.
import {randomUUID} from 'node:crypto';
import {MAX_DETAIL, SCHEMA_BASE, errorBody, type ErrorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {buildMessage} from './envelope.js';
import type {ErrorScope} from './in-process.js';
import {DeliveryQueue} from './queue.js';
import {EventStreamParser, REMOTE_PATH, REMOTE_SCHEMA} from './remote-protocol.js';
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
  onError?: (error: unknown, scope: ErrorScope) => void;
  /** How long to wait before reconnecting a lost stream. Defaults to 100 ms, doubling up to 5 s. */
  reconnectDelayMs?: number;
  /** Runs request and sync deadlines and reconnect delays. Defaults to the global `setTimeout`. */
  scheduler?: Scheduler;
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

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_RECONNECT_DELAY_MS = 5000;
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
const isReply = (value: unknown): value is Reply => fields(value).status === 'accepted' || typeof fields(fields(value).error).code === 'string';

/** An edge's refusal as the shared error body, or `unavailable` when the edge could not be reached. */
function bodyOf(error: unknown): ErrorBody {
  if (error instanceof SdkError) return error.body;
  return body('unavailable', 'the edge could not be reached');
}

/** The request or sync answer when the edge refused the call itself, naming the request and its trace. */
const named = (refused: ErrorBody, ids: {requestId: string; traceId: string}): ErrorBody => ({error: {...refused.error, ...ids}});

type Item = {message: Message} | {gap: Overflow};
/** `ready` holds a gap notice back until the subscription is registered again after a reconnect. */
type Local = {pattern: string; queue: DeliveryQueue<Item>; dropped: number; unknownGap: boolean; ready: Promise<void>};
type Answering<T> = {queue: DeliveryQueue<Message<T>>; register: (connection: string) => Promise<unknown>};

class RemoteClient {
  readonly #base: string;
  readonly #source: string;
  readonly #token: string;
  readonly #now: () => number;
  readonly #maxQueued: number;
  readonly #onError: (error: unknown, scope: ErrorScope) => void;
  readonly #firstDelayMs: number;
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
    this.#onError = options.onError ?? ((error, scope) => {
      const reason = error instanceof Error ? error.message : 'a non-Error value was thrown';
      const warning = new Error(`${scope.source} on ${scope.pattern}: ${reason}`, {cause: error});
      warning.name = 'BunnySdkWarning';
      process.emitWarning(warning);
    });
    this.#scheduler = options.scheduler ?? timers;
    this.#firstDelayMs = options.reconnectDelayMs ?? 100;
    this.#delayMs = this.#firstDelayMs;
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
        if (local !== undefined && !local.queue.push({message})) {
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
    this.#connected = this.#reconnect();
    this.#connected.catch(() => {});
  }

  async #reconnect(): Promise<string> {
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
        return connection;
      } catch (error) {
        this.#report(error, 'stream');
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

  async #subscribe(pattern: string, handler: Handler<Record<string, unknown>>, {onOverflow}: SubscribeOptions): Promise<Subscription> {
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
    const local: Local = {pattern, dropped: 0, unknownGap: false, ready: Promise.resolve(), queue: new DeliveryQueue<Item>(this.#maxQueued, async item => {
      const notice: Overflow | undefined = local.unknownGap ? {} : local.dropped > 0 ? {dropped: local.dropped} : undefined;
      local.dropped = 0;
      local.unknownGap = false;
      if (notice !== undefined && onOverflow !== undefined) {
        await local.ready;
        await run(() => onOverflow(notice));
      }
      if ('message' in item) {
        await run(() => handler(item.message));
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

  async #reply<T extends object>(command: Command<T>, responder: Responder<T>, id: string): Promise<void> {
    let reply: Reply;
    try {
      reply = await responder(command);
      if (!isReply(reply)) throw new TypeError('a responder returned something other than a reply');
    } catch (error) {
      this.#report(error, `respond ${command.type}`);
      reply = body('internal', 'the responder failed');
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
    try {
      return await this.#within(waitMs, silent, async signal => {
        try {
          return fields(await this.#post('request', {key, command}, signal)).result as RequestResult;
        } catch (error) {
          if (error instanceof SdkError) return {status: 'rejected', requestId, error: named(error.body, ids)};
          return silent;
        }
      }, {signal: abandon.signal, answer: abandoned});
    } finally {
      this.#requests.delete(abandon);
    }
  }

  #syncRequest({families, requestId, timeoutMs, trace, signal}: OutgoingSync): Promise<SyncAnswer> {
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
        return fields(await this.#post('sync', {request}, dropped)).answer as SyncAnswer;
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

  #headers(): Record<string, string> {
    return {authorization: `Bearer ${this.#token}`, 'content-type': 'application/json'};
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

  async #refusal(response: Response): Promise<ErrorBody> {
    const parsed = fields(await response.json().catch(() => ({})));
    const code = fields(parsed.error).code;
    return typeof code === 'string' ? parsed as ErrorBody : body('internal', `the edge answered ${response.status}`);
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
