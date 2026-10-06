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
  type Responder, type Sdk, type SendOptions, type SubscribeOptions, type Subscription,
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
};

/** A remote participant: the SDK calls, and `close`, which ends its stream and everything it opened. */
export interface RemoteParticipant extends Sdk {
  close(): Promise<void>;
}

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_RECONNECT_DELAY_MS = 5000;
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
type Local = {pattern: string; queue: DeliveryQueue<Item>; dropped: number; unknownGap: boolean};
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
  #stream: AbortController | undefined;
  /** The current connection's id; while the stream is lost, a promise of the next one. */
  #connected: Promise<string> = Promise.resolve('');
  readonly #subscriptions = new Map<string, Local>();
  readonly #answering = new Map<string, Answering<object>>();

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
      sync: <T extends object>(families: readonly string[], handler: SyncHandler<T>, options: SyncOptions) => startSync<T>({
        now: this.#now,
        subscribe: (pattern, deliver, subscribeOptions) => this.#subscribe(pattern, deliver, subscribeOptions),
        request: outgoing => this.#syncRequest(outgoing),
        report: error => { this.#report(error, `sync ${families.join(',')}`); },
      }, families, handler, options),
      serveSync: (families: readonly string[], provider: SyncProvider) =>
        this.#answer<SyncRequest>('serve', {families: [...families]}, `sync ${families.join(',')}`, (request, id) => this.#serve(request, provider, id)),
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
      await new Promise(resolve => { setTimeout(resolve, this.#delayMs); });
      if (this.#closed) throw new SdkError(body('invalid-state', `${this.#source} is closed`));
      try {
        const connection = await this.#open();
        for (const [id, local] of this.#subscriptions) await this.#post('subscribe', {connection, id, pattern: local.pattern});
        for (const [id, answering] of this.#answering) await answering.register(connection).catch((error: unknown) => { this.#report(error, id); });
        this.#delayMs = this.#firstDelayMs;
        for (const id of this.#subscriptions.keys()) this.#gap(id, {});
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
    const local: Local = {pattern, dropped: 0, unknownGap: false, queue: new DeliveryQueue<Item>(this.#maxQueued, async item => {
      const notice: Overflow | undefined = local.unknownGap ? {} : local.dropped > 0 ? {dropped: local.dropped} : undefined;
      local.dropped = 0;
      local.unknownGap = false;
      if (notice !== undefined && onOverflow !== undefined) await run(() => onOverflow(notice));
      if ('message' in item) await run(() => handler(item.message));
      else if (onOverflow !== undefined) await run(() => onOverflow(item.gap));
    })};
    // Registered before the call, so a message that the stream carries before the reply still finds its handler.
    this.#subscriptions.set(id, local);
    try {
      await this.#post('subscribe', {connection, id, pattern});
    } catch (error) {
      this.#subscriptions.delete(id);
      await local.queue.close();
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
    await this.#post('reply', {connection: await this.#connected, responder: id, requestId: command.data.requestId, reply});
  }

  async #serve(request: Message<SyncRequest>, provider: SyncProvider, id: string): Promise<void> {
    let answer: Snapshot | ErrorBody;
    try {
      answer = await provider(request);
    } catch (error) {
      this.#report(error, `sync ${request.subject}`);
      answer = body('internal', 'the owner could not serve the sync');
    }
    await this.#post('answer', {connection: await this.#connected, server: id, requestId: request.data.requestId, answer});
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
    // A remote requester cannot know whether the handler started, so its deadline is always uncertain.
    const late: RequestResult = {status: 'uncertain', requestId, error: body('uncertain-result', `no reply within ${timeoutMs} ms`, ids)};
    return this.#within(timeoutMs, late, async signal => {
      try {
        return fields(await this.#post('request', {key, command}, signal)).result as RequestResult;
      } catch (error) {
        if (error instanceof SdkError) return {status: 'rejected', requestId, error: named(error.body, ids)};
        return late;
      }
    });
  }

  #syncRequest({families, requestId, timeoutMs, trace}: OutgoingSync): Promise<SyncAnswer> {
    const sentAtMs = this.#now();
    const request = buildMessage(this.#source, 'sync-request', {
      type: 'org.bunny.sync.requested', subject: families.join(','), dataschema: SYNC_REQUEST, data: {requestId, families: [...families]},
    }, trace, sentAtMs, sentAtMs + timeoutMs);
    const ids = {requestId, traceId: traceIdOf(trace.traceparent)};
    // A sync changes nothing, so at the deadline it is unavailable, as in process.
    const late: SyncAnswer = {status: 'rejected', requestId, error: body('unavailable', `no sync answer within ${timeoutMs} ms`, ids)};
    return this.#within(timeoutMs, late, async signal => {
      try {
        return fields(await this.#post('sync', {request}, signal)).answer as SyncAnswer;
      } catch (error) {
        return {status: 'rejected', requestId, error: named(bodyOf(error), ids)};
      }
    });
  }

  /** Runs one call until `timeoutMs`; at the deadline it aborts the call and settles with `late`. */
  async #within<T>(timeoutMs: number, late: T, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<T>(resolve => { timer = setTimeout(() => { resolve(late); }, timeoutMs); });
    try {
      return await Promise.race([deadline, call(controller.signal)]);
    } finally {
      clearTimeout(timer);
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

  async #close(): Promise<void> {
    this.#closed = true;
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
    if (!response.ok) throw new SdkError(await this.#refusal(response));
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
